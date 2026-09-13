/**
 * Parser for XTB daily order confirmations
 * ("Potwierdzenie zleceń wykonanych w dniu DD.MM.YYYY", filename
 * `<account>_<YYYYMMDD>_DailyStatement.pdf`).
 *
 * ── Why this parser is layout-based ──────────────────────────────────────────
 *
 * These PDFs are hostile to plain text extraction in two ways:
 *
 *  1. The table is drawn **rotated 90°** on a portrait page, so grouping text
 *     runs by Y — what the Revolut parsers do — yields one "line" per table
 *     *column*, not per row. {@link extractPDFLayout} projects onto reading-order
 *     axes so rows come out as rows.
 *
 *  2. The **Typ** cell ("Kupno" / "Sprzedaż") is not in the text layer at all —
 *     it is rasterised as a small coloured badge image. No font on the page
 *     contains those glyphs, so buy/sell is unrecoverable from text. We classify
 *     it from the badge's ink **hue** instead (XTB draws buy green, sell red),
 *     and when the hue is unreadable we leave `direction: null` for the wizard
 *     to resolve rather than guessing — a wrong guess inverts a trade.
 *
 * Cells are assigned to columns by position against the header row, which keeps
 * the parser correct despite the missing Typ value and despite cells that wrap
 * onto a continuation line.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Transaction } from '@/types'
import { extractPDFLayout, hueOf, type LayoutLine, type LayoutPage } from './pdfText'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type ConfirmationWarning = {
  fileName: string
  message: string
}

/**
 * A parsed trade awaiting confirmation.
 *
 * `direction` is null when the Typ badge could not be classified; the wizard
 * must collect it before the transaction can be built.
 */
export type ParsedTrade = {
  /** Stable id for wizard state (becomes the Transaction id on import). */
  id: string
  direction: 'buy' | 'sell' | null
  orderNo: string
  ticker: string
  exchange: string
  instrument: string
  quantity: number
  /** Unit price in the instrument's quotation currency. */
  unitPriceOriginal: number
  currency: string
  fxRate: number
  /** Łączne koszty — commission plus FX costs, in account currency (PLN). */
  totalCosts: number
  /** ISO datetime of execution. */
  date: string
  /** Gross consideration in PLN, unsigned. */
  grossPLN: number
}

export type ConfirmationParseResult = {
  trades: ParsedTrade[]
  warnings: ConfirmationWarning[]
  /** Free cash from the page header, shown in the preview as a sanity check. */
  statement: { freeCash?: number }
}

// ─────────────────────────────────────────
// Number & date helpers
// ─────────────────────────────────────────

/**
 * Parse a number as XTB writes it.
 *
 * Most cells use Polish convention — space thousands separator, comma decimal
 * ("7 399,89"). The FX rate column uses a dot decimal instead ("1.0000"), so a
 * comma is treated as the decimal mark when present and a dot otherwise.
 */
export function parseXTBNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0]/g, '').trim()
  if (!cleaned) return null
  const normalised = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  if (!/^-?\d*\.?\d+$/.test(normalised)) return null
  const n = parseFloat(normalised)
  return Number.isFinite(n) ? n : null
}

/** "08.09.2026" + "09:02:54" → ISO datetime. Time is optional. */
export function parseXTBDateTime(raw: string): string | null {
  const dateMatch = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (!dateMatch) return null
  const [, dd, mm, yyyy] = dateMatch
  const timeMatch = raw.match(/(\d{2}):(\d{2}):(\d{2})/)
  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}` : '00:00:00'
  const iso = new Date(`${yyyy}-${mm}-${dd}T${time}Z`)
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString()
}

// ─────────────────────────────────────────
// Column model
// ─────────────────────────────────────────

type ColumnKey =
  | 'nr' | 'orderNo' | 'symbol' | 'instrument' | 'system' | 'typ' | 'volume'
  | 'datetime' | 'orderKind' | 'unitPrice' | 'totalPrice' | 'assetClass'
  | 'currency' | 'fxRate' | 'fxCost' | 'commission' | 'totalCosts'

/**
 * Header-label patterns, in priority order. Matched against the first header
 * line's cells, which carry one cell per column at the column's start position.
 *
 * "Cena całkowita" must be tested before "Cena" (the unit-price header wraps as
 * "Cena" / "jednostkowa"), and likewise "Koszty przewalutowania" before the
 * bare "Koszty".
 */
const COLUMN_PATTERNS: [ColumnKey, RegExp][] = [
  ['nr',          /^Nr$/i],
  ['orderNo',     /^Numer zlecenia/i],
  ['symbol',      /^Symbol/i],
  ['instrument',  /^Nazwa/i],
  ['system',      /^System/i],
  ['typ',         /^Typ$/i],
  ['volume',      /^Wolumen/i],
  ['datetime',    /^Data i czas/i],
  ['orderKind',   /^Zlecenie/i],
  ['totalPrice',  /^Cena całkowita/i],
  ['unitPrice',   /^Cena/i],
  ['assetClass',  /^Klasa aktywów/i],
  ['currency',    /^Waluta/i],
  ['fxRate',      /^Kurs/i],
  ['fxCost',      /^Koszty/i],
  ['commission',  /^Prowizja/i],
  ['totalCosts',  /^Łączne koszty/i],
]

type Column = { key: ColumnKey; pos: number }

/** Columns that must be present for the table to be parseable. */
const REQUIRED_COLUMNS: ColumnKey[] = ['orderNo', 'symbol', 'volume', 'datetime', 'totalPrice']

/**
 * Locate the table header line and derive column start positions from it.
 *
 * The header's first line holds exactly one cell per column; subsequent lines
 * are wrapped continuations of the same labels and are ignored.
 */
function findColumns(lines: LayoutLine[]): { columns: Column[]; headerIndex: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].cells
    const hasNr = cells.some((c) => /^Nr$/i.test(c.text))
    const hasOrder = cells.some((c) => /^Numer zlecenia/i.test(c.text))
    if (!hasNr || !hasOrder) continue

    const columns: Column[] = []
    for (const cell of cells) {
      const match = COLUMN_PATTERNS.find(
        ([key, re]) => re.test(cell.text) && !columns.some((c) => c.key === key),
      )
      if (match) columns.push({ key: match[0], pos: cell.pos })
    }
    columns.sort((a, b) => a.pos - b.pos)

    if (REQUIRED_COLUMNS.every((k) => columns.some((c) => c.key === k))) {
      return { columns, headerIndex: i }
    }
  }
  return null
}

/** Column a position falls in: the last column starting at or before it. */
function columnAt(columns: Column[], pos: number): ColumnKey | null {
  let found: ColumnKey | null = null
  for (const col of columns) {
    // 2pt of slack absorbs the gap between a column rule and its first glyph.
    if (pos >= col.pos - 2) found = col.key
    else break
  }
  return found
}

/** Assign a line's cells to columns, space-joining multiple cells per column. */
function cellsToRow(line: LayoutLine, columns: Column[]): Partial<Record<ColumnKey, string>> {
  const row: Partial<Record<ColumnKey, string>> = {}
  for (const cell of line.cells) {
    const key = columnAt(columns, cell.pos)
    if (!key) continue
    row[key] = row[key] ? `${row[key]} ${cell.text}` : cell.text
  }
  return row
}

// ─────────────────────────────────────────
// Typ badge classification
// ─────────────────────────────────────────

/** Hue windows for XTB's Kupno (green) and Sprzedaż (red) badges. */
const BUY_HUE = [90, 170]
const SELL_HUE_LOW = 20
const SELL_HUE_HIGH = 340

/**
 * Classify a row's Typ badge by the hue of its ink.
 *
 * Returns null when no badge sits in the row's Typ cell or its colour is not
 * confidently green or red — the caller then asks the user rather than guessing.
 */
function classifyTypBadge(
  page: LayoutPage,
  columns: Column[],
  rowCross: number,
): 'buy' | 'sell' | null {
  const typCol = columns.find((c) => c.key === 'typ')
  if (!typCol) return null
  const next = columns[columns.indexOf(typCol) + 1]

  for (const img of page.images) {
    if (Math.abs(img.cross - rowCross) > 10) continue
    if (img.pos < typCol.pos - 4) continue
    if (next && img.pos >= next.pos) continue
    if (!img.inkRGB) continue

    const hue = hueOf(img.inkRGB)
    if (hue == null) continue
    if (hue >= BUY_HUE[0] && hue <= BUY_HUE[1]) return 'buy'
    if (hue <= SELL_HUE_LOW || hue >= SELL_HUE_HIGH) return 'sell'
  }
  return null
}

// ─────────────────────────────────────────
// Row parsing
// ─────────────────────────────────────────

const ORDER_NO_RE = /^\d{6,}$/
const SYMBOL_RE = /^([A-Z0-9]{1,10})\.([A-Z]{2,4})$/

/** A data row starts with a row index and carries an order number. */
function isDataRow(row: Partial<Record<ColumnKey, string>>): boolean {
  return /^\d+$/.test(row.nr ?? '') && ORDER_NO_RE.test((row.orderNo ?? '').trim())
}

/**
 * Merge continuation lines into a data row.
 *
 * Long cells wrap onto the following line at the same column position — the
 * execution time under the date, "dot. akcji" under "Prawa ułamkowe". A line is
 * a continuation when it is close below the row, is not itself a data row, and
 * only touches columns the row already populated.
 */
function mergeContinuations(
  rowLineIndex: number,
  lines: LayoutLine[],
  columns: Column[],
  row: Partial<Record<ColumnKey, string>>,
): void {
  for (let i = rowLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.cross - lines[i - 1].cross > 15) return

    const cont = cellsToRow(line, columns)
    if (isDataRow(cont)) return

    const keys = Object.keys(cont) as ColumnKey[]
    if (keys.length === 0) return
    if (!keys.every((k) => row[k] != null)) return

    for (const k of keys) row[k] = `${row[k]} ${cont[k]}`
  }
}

/** Turn one assigned row into a ParsedTrade, or explain why it can't be. */
function buildTrade(
  row: Partial<Record<ColumnKey, string>>,
  direction: 'buy' | 'sell' | null,
): { trade: ParsedTrade } | { error: string } {
  const orderNo = (row.orderNo ?? '').trim()

  const symbolMatch = (row.symbol ?? '').trim().match(SYMBOL_RE)
  if (!symbolMatch) return { error: `Order ${orderNo}: unrecognised symbol "${row.symbol ?? ''}"` }

  const quantity = parseXTBNumber(row.volume ?? '')
  if (quantity == null || quantity <= 0) {
    return { error: `Order ${orderNo}: invalid volume "${row.volume ?? ''}"` }
  }

  const date = parseXTBDateTime(row.datetime ?? '')
  if (!date) return { error: `Order ${orderNo}: invalid date "${row.datetime ?? ''}"` }

  const totalPriceOriginal = parseXTBNumber(row.totalPrice ?? '')
  if (totalPriceOriginal == null) {
    return { error: `Order ${orderNo}: invalid total price "${row.totalPrice ?? ''}"` }
  }

  const unitPriceOriginal = parseXTBNumber(row.unitPrice ?? '') ?? totalPriceOriginal / quantity
  // A missing or zero FX rate means no conversion was applied.
  const parsedRate = parseXTBNumber(row.fxRate ?? '')
  const fxRate = parsedRate && parsedRate > 0 ? parsedRate : 1
  const totalCosts = parseXTBNumber(row.totalCosts ?? '') ?? 0

  const currency = (row.currency ?? '').trim().toUpperCase() || 'PLN'

  return {
    trade: {
      id: uuidv4(),
      direction,
      orderNo,
      ticker: symbolMatch[1],
      exchange: symbolMatch[2],
      instrument: (row.instrument ?? '').trim() || symbolMatch[1],
      quantity,
      unitPriceOriginal,
      currency,
      fxRate,
      totalCosts,
      date,
      grossPLN: totalPriceOriginal * fxRate,
    },
  }
}

// ─────────────────────────────────────────
// Statement header
// ─────────────────────────────────────────

/**
 * Read free cash from the page header. It produces no transaction; the preview
 * shows it as a sanity check against the account's synthetic cash holding.
 *
 * The header is two lines: labels, then values in the same column order.
 */
function parseStatementHeader(lines: LayoutLine[]): ConfirmationParseResult['statement'] {
  for (let i = 0; i < lines.length; i++) {
    const labels = lines[i].cells.map((c) => c.text)
    const idx = labels.findIndex((t) => /^Wolne środki$/i.test(t))
    if (idx < 0) continue
    const value = lines[i + 1]?.cells[idx]?.text ?? ''
    return { freeCash: parseXTBNumber(value) ?? undefined }
  }
  return {}
}

// ─────────────────────────────────────────
// Public API
// ─────────────────────────────────────────

/**
 * Parse one or more XTB daily confirmation PDFs into pending trades.
 *
 * Trades are deduplicated across files by order number, so re-dropping the same
 * statement in a multi-file import is harmless. Files that yield no table are
 * reported as warnings rather than failing the batch.
 */
export async function parseXTBConfirmations(files: File[]): Promise<ConfirmationParseResult> {
  const trades: ParsedTrade[] = []
  const warnings: ConfirmationWarning[] = []
  const seenOrders = new Set<string>()
  let statement: ConfirmationParseResult['statement'] = {}

  // Decoding is the expensive part and the files are independent, so read them
  // all at once; the fold below stays sequential to keep output order stable.
  type Decoded =
    | { file: File; pages: LayoutPage[] }
    | { file: File; error: string }

  const decoded: Decoded[] = await Promise.all(
    files.map(async (file): Promise<Decoded> => {
      try {
        return { file, pages: await extractPDFLayout(file) }
      } catch (err) {
        return { file, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )

  for (const entry of decoded) {
    const { file } = entry
    if ('error' in entry) {
      warnings.push({ fileName: file.name, message: `Failed to read PDF: ${entry.error}` })
      continue
    }
    const { pages } = entry

    let rowsInFile = 0

    for (const page of pages) {
      const found = findColumns(page.lines)
      if (!found) continue
      const { columns, headerIndex } = found

      if (statement.freeCash == null) statement = parseStatementHeader(page.lines)

      for (let i = headerIndex + 1; i < page.lines.length; i++) {
        const row = cellsToRow(page.lines[i], columns)
        if (!isDataRow(row)) continue

        mergeContinuations(i, page.lines, columns, row)

        const orderNo = (row.orderNo ?? '').trim()
        if (seenOrders.has(orderNo)) continue
        seenOrders.add(orderNo)
        rowsInFile++

        const direction = classifyTypBadge(page, columns, page.lines[i].cross)
        const built = buildTrade(row, direction)
        if ('error' in built) {
          warnings.push({ fileName: file.name, message: built.error })
          continue
        }
        trades.push(built.trade)
      }
    }

    if (rowsInFile === 0) {
      warnings.push({
        fileName: file.name,
        message: 'No executed orders found in this statement.',
      })
    }
  }

  trades.sort((a, b) => a.date.localeCompare(b.date))
  return { trades, warnings, statement }
}

/**
 * Signed PLN cash impact of a trade.
 *
 * Follows the app's convention that money out is negative. Costs always reduce
 * the cash position, so they are added to a purchase's outlay and subtracted
 * from a sale's proceeds. The preview calls this too, so the amount shown before
 * import is the amount imported.
 */
export function signedAmountPLN(trade: ParsedTrade, type: 'buy' | 'sell'): number {
  return type === 'buy'
    ? -(trade.grossPLN + trade.totalCosts)
    : trade.grossPLN - trade.totalCosts
}

/**
 * Convert confirmed trades into transactions.
 *
 * `externalId` is namespaced with an `xtb-order:` prefix because XTB's order
 * numbers live in a different ID space from the Cash Operations export's `ID`
 * column — see tradeDedup.ts for how overlap between the two is caught.
 */
export function tradesToTransactions(
  trades: ParsedTrade[],
  accountId: string,
  directions: Map<string, 'buy' | 'sell'>,
): Transaction[] {
  const createdAt = new Date().toISOString()

  return trades.flatMap((trade) => {
    const type = directions.get(trade.id) ?? trade.direction
    if (!type) return []

    const amountPLN = signedAmountPLN(trade, type)

    return [{
      id: trade.id,
      accountId,
      type,
      date: trade.date,
      amountPLN,
      instrument: trade.instrument,
      ticker: trade.ticker,
      exchange: trade.exchange,
      quantity: trade.quantity,
      pricePerUnitPLN: Math.abs(amountPLN) / trade.quantity,
      originalCurrency: trade.currency,
      pricePerUnitOriginal: trade.unitPriceOriginal,
      externalId: `xtb-order:${trade.orderNo}`,
      comment: `${type === 'buy' ? 'Kupno' : 'Sprzedaż'} ${trade.quantity} ${trade.ticker}.${trade.exchange} @ ${trade.unitPriceOriginal} ${trade.currency}`,
      source: 'xtb_confirmation' as const,
      createdAt,
    }]
  })
}
