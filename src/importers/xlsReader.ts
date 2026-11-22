/** File extensions accepted by all import flows. */
export const IMPORT_FILE_ACCEPT = '.csv,.xls,.xlsx,.pdf,application/pdf'

/** Returns true when the file has a supported import extension. */
export function isSupportedImportFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.csv') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.pdf')
  )
}

/** True for the Excel formats SheetJS reads (.xls, .xlsx). */
export function isWorkbookFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.xls') || name.endsWith('.xlsx')
}

// ─────────────────────────────────────────
// Text files
// ─────────────────────────────────────────

/**
 * Decode a text file's bytes. UTF-8 first, without a byte-order mark. A file
 * saved by a Polish-language spreadsheet app may be windows-1250 instead: when
 * UTF-8 decoding produces replacement characters, the bytes weren't UTF-8, so
 * they are decoded as windows-1250.
 */
export function decodeText(bytes: ArrayBuffer | Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const text = utf8.includes('\uFFFD') ? new TextDecoder('windows-1250').decode(bytes) : utf8
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

/** A text file's contents, decoded with {@link decodeText}. */
export async function readTextFile(file: File): Promise<string> {
  return decodeText(await file.arrayBuffer())
}

// ─────────────────────────────────────────
// Workbooks
// ─────────────────────────────────────────

/** A cell as the file holds it: text stays text, numbers stay numbers. Dates are Excel serial numbers. */
export type CellValue = string | number | boolean | null

export type WorkbookSheet = {
  name: string
  /** Row-major from A1: `rows[0]` is spreadsheet row 1. Blank rows are kept, as empty arrays. */
  rows: CellValue[][]
}

export type Workbook = {
  /** In file order. */
  sheets: WorkbookSheet[]
  /** Dates count from 1904 instead of 1900 (old Mac Excel files). */
  date1904: boolean
}

type XLSXModule = typeof import('xlsx')

/** SheetJS is ~1MB and only needed here, so it is loaded on demand. */
const loadXLSX = (): Promise<XLSXModule> => import('xlsx')

/**
 * Parse a workbook with SheetJS. Some exports, XTB's among them, are zipped
 * with data descriptors whose sizes SheetJS misreads; it then logs "Bad
 * uncompressed size" or "Bad compressed size" to console.error and reads the
 * file correctly anyway. Those messages are dropped here so a good file
 * doesn't look broken in the console. Anything else still gets through.
 * The swap is synchronous, so nothing else can log in between.
 */
function parseWorkbook(XLSX: XLSXModule, data: ArrayBuffer): import('xlsx').WorkBook {
  const original = console.error
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && /^Bad (un)?compressed size: /.test(args[0])) return
    original.apply(console, args)
  }
  try {
    return XLSX.read(data, { type: 'array' })
  } finally {
    console.error = original
  }
}

/**
 * The label of the row that holds an account number. Its value is blanked as
 * the sheet is read, so it never leaves this module: not stored, logged or shown.
 */
const ACCOUNT_NUMBER_LABEL = /^\s*account\s+(number|no\.?)\s*$/i

const cache = new WeakMap<File, Promise<Workbook>>()

/**
 * Read every sheet of an .xls/.xlsx file as typed cells. Read once per File:
 * detecting a file's format and then importing it opens the workbook once.
 *
 * Date cells come back as Excel serial numbers (SheetJS doesn't expose their
 * number format), so the caller, which knows which columns are dates, converts
 * them with {@link excelSerialToISO}. Nothing here converts through local time.
 */
export function readWorkbook(file: File): Promise<Workbook> {
  let pending = cache.get(file)
  if (!pending) {
    pending = file.arrayBuffer().then(async (buffer) => workbookFromSheetJS(parseWorkbook(await loadXLSX(), buffer)))
    cache.set(file, pending)
    pending.catch(() => cache.delete(file))
  }
  return pending
}

function workbookFromSheetJS(wb: import('xlsx').WorkBook): Workbook {
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904)
  const sheets = wb.SheetNames.map((name): WorkbookSheet => {
    const sheet = wb.Sheets[name]
    const rows: CellValue[][] = []
    const ref = sheet?.['!ref']
    if (!sheet || !ref) return { name, rows }
    const range = decodeRange(ref)
    for (let r = 0; r <= range.e.r; r++) {
      const row: CellValue[] = []
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[encodeCell(r, c)] as import('xlsx').CellObject | undefined
        row[c] = cellValue(cell, date1904)
      }
      while (row.length > 0 && row[row.length - 1] === null) row.pop()
      if (typeof row[0] === 'string' && ACCOUNT_NUMBER_LABEL.test(row[0])) row.length = 1
      rows.push(row)
    }
    return { name, rows }
  })
  return { sheets, date1904 }
}

function cellValue(cell: import('xlsx').CellObject | undefined, date1904: boolean): CellValue {
  if (!cell || cell.v === undefined) return null
  switch (cell.t) {
    case 'n': return cell.v as number
    case 's': return cell.v as string
    case 'b': return cell.v as boolean
    case 'd': {
      // Only when a file stores ISO dates (t="d"); counted back to a serial so every date reads alike.
      const ms = (cell.v as Date).getTime()
      return ms / MS_PER_DAY + (date1904 ? EPOCH_1904 : EPOCH_1900)
    }
    default: return null // errors ('e') and stubs ('z')
  }
}

// Tiny copies of SheetJS's A1 helpers, so reading cells doesn't need the module's utils.
function decodeRange(ref: string): { e: { r: number; c: number } } {
  const end = ref.split(':').at(-1)!
  const m = end.match(/^\$?([A-Z]+)\$?(\d+)$/)
  if (!m) return { e: { r: -1, c: -1 } }
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { e: { r: Number(m[2]) - 1, c: c - 1 } }
}

function encodeCell(r: number, c: number): string {
  let col = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col
  return `${col}${r + 1}`
}

const MS_PER_DAY = 86_400_000
/** Serial of 1970-01-01 in the 1900 date system (which counts Excel's phantom 29 Feb 1900). */
const EPOCH_1900 = 25_569
/** Serial of 1970-01-01 in the 1904 date system. */
const EPOCH_1904 = 24_107

/**
 * An Excel date serial as a UTC ISO timestamp, to the millisecond:
 * 46027.6090772 → "2026-01-05T14:37:04.277Z". The serial is read as the time
 * the file shows; no time zone is applied. A whole number is a date with no
 * time and comes back as "YYYY-MM-DD".
 *
 * Fractional seconds are kept to the millisecond and cut there, not rounded,
 * like the CSV route does for "14:37:04.277391". The serial is a float whose
 * last bit is worth about a microsecond at today's dates, so it is rounded to
 * the microsecond and given one microsecond of slack: .277000 stored as
 * .276999… still reads as .277.
 */
export function excelSerialToISO(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 61)) return null
  const micros = Math.round((serial - (date1904 ? EPOCH_1904 : EPOCH_1900)) * MS_PER_DAY * 1000)
  const when = new Date(Math.floor((micros + 1) / 1000))
  if (Number.isNaN(when.getTime())) return null
  return Number.isInteger(serial) ? when.toISOString().slice(0, 10) : when.toISOString()
}

// ─────────────────────────────────────────
// First sheet as CSV (holdings imports)
// ─────────────────────────────────────────

/**
 * Read a File (CSV, XLS, or XLSX) and return its first sheet as CSV text.
 *
 * - CSV files are returned as plain text unchanged.
 * - XLS / XLSX files have their first sheet serialised to CSV via SheetJS,
 *   preserving row order and blank rows so that row-index-sensitive parsers
 *   keep working. XTB's multi-sheet statement is read by cell instead: see
 *   {@link readWorkbook}.
 */
export async function fileToCSVText(file: File): Promise<string> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    return file.text()
  }

  // XLS / XLSX path. SheetJS is loaded on demand rather than shipped in the
  // initial bundle — `IMPORT_FILE_ACCEPT` and `isSupportedImportFile` are
  // imported by UI that must stay cheap.
  const XLSX = await loadXLSX()
  const workbook = parseWorkbook(XLSX, await file.arrayBuffer())
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // rawNumbers: true outputs raw numeric values (e.g. 5200) instead of locale-formatted
  // display strings (e.g. "5,200.00"), avoiding RFC 4180 quoted fields that confuse the
  // naive comma-split in parseCSVRaw. blankrows defaults to true — keeps row indices stable.
  return XLSX.utils.sheet_to_csv(sheet, { rawNumbers: true })
}
