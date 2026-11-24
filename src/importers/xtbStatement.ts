/**
 * The structure of XTB's account statement, shared by the format detector and
 * the Cash Operations parser.
 *
 * XTB exports one .xlsx with a sheet each for Closed Positions, Cash
 * Operations and Open Positions. Every sheet starts with a header block in
 * columns A–B (account number, sheet name, then the period or "Data as of
 * report generated"), followed by a header row naming the columns. Sheets are
 * found by name and confirmed by that header row, never by position.
 *
 * Some people still copy the Cash Operations sheet into its own file and save
 * it as CSV, so the same structure is also read from CSV text, whatever
 * separator and number format the spreadsheet app saved it with.
 */
import type { HoldingsStatement, StatementHolding, StatementLot } from '@/domain/holdingsCheck'
import { exchangeFromXTBSuffix } from '@/domain/exchanges'
import { excelSerialToISO, type CellValue, type Workbook, type WorkbookSheet } from './xlsReader'

/** A cell the parser reads: text stays text, numbers stay numbers. */
export type Cell = string | number

/** Lowercased, trimmed column names of a row. */
const names = (row: readonly Cell[]) => row.map((c) => String(c).trim().toLowerCase())

/**
 * Index of the Cash Operations header row in `rows`, or -1. It is the row that
 * names a `Type` and an `Amount` column (XTB has shipped 7-, 8- and 10-column
 * layouts, so nothing else is assumed). `strict` also asks for `Instrument`
 * and `Comment`, which together tell it apart from any other table with a type
 * and an amount: the detector uses it.
 */
export function cashOperationsHeaderIndex(rows: readonly (readonly Cell[])[], strict = false): number {
  return rows.findIndex((row) => {
    const n = names(row)
    return n.includes('type') && n.includes('amount') && (!strict || (n.includes('instrument') && n.includes('comment')))
  })
}

// ─────────────────────────────────────────
// CSV
// ─────────────────────────────────────────

export type Separator = ',' | ';'

/** Split one CSV line. Fields may be quoted; `""` inside quotes is a quote. */
export function splitCSVLine(line: string, separator: Separator = ','): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === separator && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

/**
 * The separator a saved CSV uses. Spreadsheet apps set to a language that
 * writes decimal commas (Polish among them) save with `;`. It is `;` when the
 * Cash Operations header row only splits into columns with `;`.
 */
export function detectSeparator(lines: readonly string[]): Separator {
  const header = (sep: Separator) => cashOperationsHeaderIndex(lines.slice(0, 50).map((l) => splitCSVLine(l, sep)))
  return header(',') < 0 && header(';') >= 0 ? ';' : ','
}

/**
 * Read a number from a CSV field.
 *
 * Comma-separated files are written by XTB or by an app set to English: a
 * plain "-1234.56", read as it always was. Semicolon-separated files come from
 * an app that writes numbers the local way: "-1 234,56" (space, non-breaking or
 * narrow non-breaking space between thousands, decimal comma), or "-1.234,56".
 * A field with no comma keeps its dot as the decimal point.
 */
export function parseCSVNumber(value: string, separator: Separator): number {
  if (separator === ',') return parseFloat(value)
  let v = value.trim().replace(/[\s\u00A0\u202F]/g, '')
  if (!v) return NaN
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.')
  // A minus sign some apps write as U+2212.
  v = v.replace(/^\u2212/, '-')
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) ? Number(v) : NaN
}

// ─────────────────────────────────────────
// Workbook
// ─────────────────────────────────────────

const sheetNamed = (wb: Workbook, name: string) =>
  wb.sheets.filter((s) => s.name.trim().toLowerCase() === name)

/** A sheet's rows as parser cells: empty cells are `''`. */
export function sheetCells(sheet: WorkbookSheet): Cell[][] {
  return sheet.rows.map((row) => Array.from(row, (v: CellValue | undefined) =>
    v === null || v === undefined ? '' : typeof v === 'boolean' ? String(v).toUpperCase() : v))
}

/**
 * The workbook's Cash Operations sheet, wherever it is in the file: the one
 * named "Cash Operations" if it has the Cash Operations header row, else any
 * sheet that has it. Null when none does.
 */
export function findCashOperationsSheet(wb: Workbook): WorkbookSheet | null {
  const hasHeader = (s: WorkbookSheet) => cashOperationsHeaderIndex(sheetCells(s), true) >= 0
  return sheetNamed(wb, 'cash operations').find(hasHeader) ?? wb.sheets.find(hasHeader) ?? null
}

// ─────────────────────────────────────────
// Account currency
// ─────────────────────────────────────────

/** The currency Vestly keeps amounts in. */
export const HOME_CURRENCY = 'PLN'

/** Currencies XTB offers accounts in, plus a few neighbours: a filename prefix outside this list is not a currency. */
const ACCOUNT_CURRENCIES = new Set(['PLN', 'EUR', 'USD', 'GBP', 'CZK', 'HUF', 'CHF', 'RON', 'SEK', 'NOK', 'DKK'])

/**
 * The statement's account currency, when the file says it. Sources, in order:
 *   1. Open Positions: the Currency column of its summary table
 *      ("Product | Metric | Amount | Currency").
 *   2. The file name, when it starts with a currency code: "USD_…".
 * Undefined when neither does, e.g. a CSV saved under any other name.
 */
export function statementCurrency(wb: Workbook | null, fileName: string): string | undefined {
  for (const sheet of wb ? [...sheetNamed(wb, 'open positions'), ...wb.sheets] : []) {
    const rows = sheetCells(sheet)
    const header = rows.findIndex((r) => { const n = names(r); return n.includes('metric') && n.includes('currency') })
    if (header < 0) continue
    const col = names(rows[header]).indexOf('currency')
    for (const row of rows.slice(header + 1)) {
      const value = String(row[col] ?? '').trim().toUpperCase()
      if (/^[A-Z]{3}$/.test(value)) return value
      if (row.every((c) => c === '')) break
    }
  }
  const prefix = fileName.match(/^([A-Za-z]{3})_/)?.[1].toUpperCase()
  return prefix && ACCOUNT_CURRENCIES.has(prefix) ? prefix : undefined
}

/** The statement is for an account in another currency; nothing was imported. */
export class StatementCurrencyError extends Error {
  readonly currency: string
  constructor(currency: string) {
    super(`This is a ${currency} statement. Vestly imports ${HOME_CURRENCY} accounts only, so nothing was imported.`)
    this.name = 'StatementCurrencyError'
    this.currency = currency
  }
}

/** Throws {@link StatementCurrencyError} when the statement is known to be in another currency. */
export function assertHomeCurrency(wb: Workbook | null, fileName: string): void {
  const currency = statementCurrency(wb, fileName)
  if (currency && currency !== HOME_CURRENCY) throw new StatementCurrencyError(currency)
}

// ─────────────────────────────────────────
// Open Positions
// ─────────────────────────────────────────

/**
 * Index of the Open Positions header row, or -1: the row that names an
 * `Instrument/Position`, a `Ticker`, a `Volume` and an `Open price` column.
 */
export function openPositionsHeaderIndex(rows: readonly (readonly Cell[])[]): number {
  return rows.findIndex((row) => {
    const n = names(row)
    return n.includes('instrument/position') && n.includes('ticker') && n.includes('volume') && n.includes('open price')
  })
}

/** "ACME.US" → ACME on US, "ACME.DE" → ACME on XETRA; a bare "ACME" has no market. */
function splitTicker(value: string): { ticker: string; exchange?: string } | null {
  const v = value.trim().toUpperCase()
  if (!v) return null
  const m = v.match(/^([A-Z0-9][A-Z0-9-]*)\.([A-Z]+)$/)
  return m ? { ticker: m[1], exchange: exchangeFromXTBSuffix(m[2]) ?? m[2] } : { ticker: v }
}

const CATEGORIES: Record<string, 'stock' | 'etf'> = { stock: 'stock', etf: 'etf' }

/**
 * What XTB holds, from the statement's Open Positions sheet, wherever it is in
 * the file. Null when the file has no such sheet or it has no date.
 *
 * The sheet lists each instrument as a summary row (its name in
 * `Instrument/Position`, a `Category`, an empty `Type`) followed by its lots
 * (a position id in `Instrument/Position`, `Type` "BUY"). Lots are grouped by
 * their `Ticker`, so nothing depends on the rows' order; the summary rows only
 * give each instrument its name and category. Columns are found by name.
 * Instruments whose summary says they are neither a stock nor an ETF (CFDs)
 * are left out, as are lots that aren't buys.
 *
 * Each instrument's current price in PLN is its lots' Value (in the account
 * currency) over their volume, and its currency's PLN rate is that Value over
 * volume × Current price: the market suffix can't tell the currency (".UK"
 * instruments can be priced in USD).
 */
export function readOpenPositions(wb: Workbook): HoldingsStatement | null {
  const candidates = [...sheetNamed(wb, 'open positions'), ...wb.sheets]
  for (const sheet of candidates) {
    const rows = sheetCells(sheet)
    const header = openPositionsHeaderIndex(rows)
    if (header < 0) continue

    const asOfCell = rows.slice(0, header).find((r) => /^\s*data as of/i.test(String(r[0] ?? '')))?.[1]
    const asOf = typeof asOfCell === 'number' ? excelSerialToISO(asOfCell, wb.date1904) : null
    if (!asOf) return null

    const n = names(rows[header])
    const col = (name: string) => n.indexOf(name)
    const c = {
      instrument: col('instrument/position'), ticker: col('ticker'), category: col('category'), type: col('type'),
      volume: col('volume'), value: col('value'), current: col('current price'), open: col('open price'),
      openTime: col('open time (utc)'),
    }
    const text = (row: Cell[], i: number) => (i < 0 ? '' : String(row[i] ?? '').trim())
    const num = (row: Cell[], i: number) => (i >= 0 && typeof row[i] === 'number' ? (row[i] as number) : NaN)

    type Group = { name?: string; category?: string; ticker: string; exchange?: string; lots: StatementLot[]; value: number; valued: number; priced: number }
    const groups = new Map<string, Group>()
    const group = (raw: string) => {
      const t = splitTicker(raw)
      if (!t) return null
      let g = groups.get(t.ticker)
      if (!g) groups.set(t.ticker, (g = { ticker: t.ticker, exchange: t.exchange, lots: [], value: 0, valued: 0, priced: 0 }))
      return g
    }

    for (const row of rows.slice(header + 1)) {
      const g = group(text(row, c.ticker))
      if (!g) continue
      const type = text(row, c.type).toUpperCase()
      if (!type) {
        g.name = text(row, c.instrument) || g.name
        g.category = text(row, c.category).toLowerCase() || g.category
        continue
      }
      const volume = num(row, c.volume)
      if (type !== 'BUY' || !(volume > 0)) continue
      const openTime = num(row, c.openTime)
      const value = num(row, c.value)
      const current = num(row, c.current)
      g.lots.push({
        positionId: text(row, c.instrument),
        quantity: volume,
        openPrice: Number.isFinite(num(row, c.open)) ? num(row, c.open) : 0,
        openDate: (Number.isFinite(openTime) && excelSerialToISO(openTime, wb.date1904)) || asOf,
      })
      if (Number.isFinite(value) && Number.isFinite(current) && current > 0) {
        g.value += value
        g.valued += volume
        g.priced += volume * current
      }
    }

    const holdings: StatementHolding[] = []
    for (const g of groups.values()) {
      if (g.lots.length === 0) continue
      if (g.category && !CATEGORIES[g.category]) continue
      const quantity = Math.round(g.lots.reduce((s, l) => s + l.quantity, 0) * 1e8) / 1e8
      holdings.push({
        key: g.ticker,
        ticker: g.ticker,
        exchange: g.exchange,
        name: g.name || g.ticker,
        category: g.category ? CATEGORIES[g.category] : undefined,
        quantity,
        lots: g.lots,
        ...(g.priced > 0 && { currentPricePLN: g.value / g.valued, rateToPLN: g.value / g.priced }),
      })
    }
    return { asOf, holdings }
  }
  return null
}
