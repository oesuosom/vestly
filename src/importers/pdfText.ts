/**
 * Shared pdf.js plumbing for the PDF import parsers.
 *
 * Two extraction modes:
 *
 *   extractPDFText()    — plain reading-order text. Groups items into lines by Y
 *                         and joins with spaces. Used by the Revolut parsers,
 *                         which only ever regex over the resulting string.
 *
 *   extractPDFLayout()  — rotation-aware, position-preserving cells plus the
 *                         page's raster images. Used by the XTB confirmation
 *                         parser, which has to assign cells to table columns by
 *                         position (its table has a column whose value is drawn
 *                         as an image, so reading order alone loses a field).
 *
 * pdf.js is loaded on demand. It is a large dependency reachable only through
 * the import flows, so a static import would put it in the initial bundle for
 * every visitor. `getPdfjs()` memoises the module and configures `workerSrc`
 * exactly once, on first use.
 */

// ─────────────────────────────────────────
// Lazy pdf.js loader
// ─────────────────────────────────────────

type PdfjsModule = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfjsModule> | null = null

function getPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href
    return lib
  })
  return pdfjsPromise
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawTextItem = any

/** pdf.js text items are `TextItem | TextMarkedContent`; keep only the former. */
function textItems(items: RawTextItem[]): RawTextItem[] {
  return items.filter((item) => typeof item.str === 'string' && item.str.trim())
}

// ─────────────────────────────────────────
// Plain reading-order text
// ─────────────────────────────────────────

/**
 * Extract a PDF's text as newline-separated lines, in reading order.
 *
 * Items are grouped into lines by Y coordinate (within ±3pt), lines sorted
 * top-to-bottom (Y descending in PDF coords) and items within a line
 * left-to-right.
 */
export async function extractPDFText(file: File): Promise<string> {
  const pdfjsLib = await getPdfjs()
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise
  const pageParts: string[] = []

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const textContent = await page.getTextContent()
      const items = textItems(textContent.items as RawTextItem[])

      const lines: { y: number; items: RawTextItem[] }[] = []
      for (const item of items) {
        const y: number = item.transform[5]
        const existing = lines.find((l) => Math.abs(l.y - y) < 3)
        if (existing) {
          existing.items.push(item)
        } else {
          lines.push({ y, items: [item] })
        }
      }

      lines.sort((a, b) => b.y - a.y)
      for (const line of lines) {
        line.items.sort((a, b) => a.transform[4] - b.transform[4])
      }

      pageParts.push(lines.map((l) => l.items.map((i) => i.str).join(' ')).join('\n'))
    }
  } finally {
    // Releases the worker-side document and the buffer behind it.
    await doc.destroy()
  }

  return pageParts.join('\n')
}

// ─────────────────────────────────────────
// Rotation-aware layout extraction
// ─────────────────────────────────────────

/** One text run, with its position along the reading direction. */
export type LayoutCell = {
  text: string
  /** Position along the line, increasing in reading order (left → right). */
  pos: number
}

export type LayoutLine = {
  /** Position across lines, increasing in reading order (top → bottom). */
  cross: number
  cells: LayoutCell[]
}

/** A raster image drawn on the page, with its ink colour sampled. */
export type LayoutImage = {
  /** Position along the line, matching {@link LayoutCell.pos}. */
  pos: number
  /** Position across lines, matching {@link LayoutLine.cross}. */
  cross: number
  /** Mean colour of the non-white, non-transparent pixels; null if none. */
  inkRGB: [number, number, number] | null
}

export type LayoutPage = {
  lines: LayoutLine[]
  images: LayoutImage[]
}

/**
 * Text drawn rotated 90° has a transform matrix of the form `[0, ±s, ∓s, 0, …]`
 * — the horizontal scale component is zero. XTB's confirmation PDFs are laid
 * out this way (a landscape table on a portrait page).
 */
function isRotated(items: RawTextItem[]): boolean {
  const rotatedCount = items.filter(
    (i) => Math.abs(i.transform[0]) < 0.01 && Math.abs(i.transform[1]) > 0.01,
  ).length
  return rotatedCount > items.length / 2
}

/**
 * Project a PDF coordinate pair onto reading-order axes.
 *
 * Upright text reads +X along a line and −Y down the page; 90°-rotated text
 * (as produced by XTB) reads −Y along a line and −X down the page. Negating
 * makes both axes increase in reading order, so downstream column logic is
 * rotation-agnostic.
 */
function project(x: number, y: number, rotated: boolean): { pos: number; cross: number } {
  return rotated ? { pos: -y, cross: -x } : { pos: x, cross: -y }
}

/**
 * Per-File layout cache.
 *
 * Format detection and the parser both need the same PDF, and decoding one is
 * by far the most expensive part of an import. Keyed on the File object, so it
 * is dropped as soon as the upload is.
 */
const layoutCache = new WeakMap<File, Promise<LayoutPage[]>>()

/**
 * Extract every page as positioned cells plus its images.
 *
 * Memoised per File: repeat calls for the same upload reuse the first decode.
 */
export function extractPDFLayout(file: File): Promise<LayoutPage[]> {
  const cached = layoutCache.get(file)
  if (cached) return cached
  const pending = readLayout(file)
  layoutCache.set(file, pending)
  return pending
}

async function readLayout(file: File): Promise<LayoutPage[]> {
  const pdfjsLib = await getPdfjs()
  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise

  const pages: LayoutPage[] = []
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)

      const textContent = await page.getTextContent()
      const items = textItems(textContent.items as RawTextItem[])
      const rotated = isRotated(items)

      const lines: LayoutLine[] = []
      for (const item of items) {
        const { pos, cross } = project(item.transform[4], item.transform[5], rotated)
        const existing = lines.find((l) => Math.abs(l.cross - cross) < 3)
        if (existing) {
          existing.cells.push({ text: item.str.trim(), pos })
        } else {
          lines.push({ cross, cells: [{ text: item.str.trim(), pos }] })
        }
      }

      lines.sort((a, b) => a.cross - b.cross)
      for (const line of lines) line.cells.sort((a, b) => a.pos - b.pos)

      pages.push({ lines, images: await extractImages(page, rotated) })
      // Frees the decoded bitmaps this page's images pinned in page.objs.
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return pages
}

// ─────────────────────────────────────────
// Image extraction
// ─────────────────────────────────────────

/**
 * Collect the page's raster images with their position and mean ink colour.
 *
 * pdf.js only populates `page.objs` while building the operator list, so the
 * operator list must be walked first. Image objects resolve asynchronously;
 * `page.objs.get(id, cb)` fires the callback once decoded.
 */
async function extractImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  rotated: boolean,
): Promise<LayoutImage[]> {
  const pdfjsLib = await getPdfjs()
  const ops = await page.getOperatorList()
  const PAINT = pdfjsLib.OPS.paintImageXObject
  const TRANSFORM = pdfjsLib.OPS.transform

  // Track the running CTM so each paint op can be located on the page.
  const placements: { id: string; e: number; f: number }[] = []
  let ctm: number[] | null = null
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === TRANSFORM) ctm = ops.argsArray[i] as number[]
    if (ops.fnArray[i] === PAINT && ctm) {
      placements.push({ id: ops.argsArray[i][0] as string, e: ctm[4], f: ctm[5] })
    }
  }

  // Resolved concurrently: the timeout below is a worst case, and awaiting each
  // in turn would pay it once per image instead of once overall.
  return Promise.all(
    placements.map(async (p) => {
      let img: RawTextItem = null
      try {
        img = await new Promise((resolve) => {
          // Resolve to null rather than hanging if the object never arrives.
          const timer = setTimeout(() => resolve(null), 5000)
          page.objs.get(p.id, (obj: RawTextItem) => {
            clearTimeout(timer)
            resolve(obj)
          })
        })
      } catch {
        img = null
      }
      const { pos, cross } = project(p.e, p.f, rotated)
      return { pos, cross, inkRGB: img ? meanInkColour(img) : null }
    }),
  )
}

/**
 * Mean RGB of a decoded image's "ink" — pixels that are neither transparent
 * nor near-white. Returns null when the image is blank.
 *
 * Handles pdf.js's 24bpp RGB and 32bpp RGBA bitmaps; other layouts (1bpp
 * grayscale masks) return null, which callers treat as "no readable colour".
 */
function meanInkColour(img: RawTextItem): [number, number, number] | null {
  const { width, height, data } = img
  if (!data || !width || !height) return null

  const components = data.length / (width * height)
  if (components !== 3 && components !== 4) return null

  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < width * height; i++) {
    const o = i * components
    const alpha = components === 4 ? data[o + 3] : 255
    if (alpha < 40) continue
    if (data[o] > 230 && data[o + 1] > 230 && data[o + 2] > 230) continue
    r += data[o]
    g += data[o + 1]
    b += data[o + 2]
    n++
  }
  if (n === 0) return null
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

/** Hue in degrees (0–360) for an RGB triple; null for greys. */
export function hueOf([r, g, b]: [number, number, number]): number | null {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  // Too little saturation to read a hue from.
  if (delta < 20) return null

  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4

  h *= 60
  return h < 0 ? h + 360 : h
}
