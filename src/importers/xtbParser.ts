import { v4 as uuidv4 } from 'uuid'
import type { Account, InstrumentAlias, Transaction, TransactionType } from '@/types'
import { excelSerialToISO, isWorkbookFile, readTextFile, readWorkbook, type WorkbookSheet } from './xlsReader'
import {
  assertHomeCurrency,
  cashOperationsHeaderIndex,
  detectSeparator,
  findCashOperationsSheet,
  parseCSVNumber,
  sheetCells,
  splitCSVLine,
  type Cell,
} from './xtbStatement'
import { staticLookupInstrument } from '@/domain/instrumentLookup'
import { feesChargedWith, findClosedByHandSales, findDuplicateTradeGroups, type TradeDuplicate } from './tradeDedup'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type ParseWarning = {
  row: number
  message: string
  rawData: string
}

/** A sale in the file that Close position already recorded by hand. */
export type ClosedByHandMatch = {
  /** The file's sale, not imported. */
  sale: Transaction
  /** The sale Close position recorded. */
  existing: Transaction
  /**
   * The file's fee rows charged on that sale, not imported either: the fee
   * entered in Close position already came off its amount. Empty when no fee
   * was entered there; the file's fee rows are then imported.
   */
  fees: Transaction[]
}

export type ParseResult = {
  transactions: Transaction[]
  skipped: number           // duplicate externalIds already in store
  /**
   * Rows dropped because they match a trade already imported from a daily
   * confirmation PDF: the trade, every fill of its order, and the commission
   * the confirmation already counted. Those carry XTB's *order* number, which
   * is a different ID space from this export's `ID` column, so `skipped` can't
   * catch them — see tradeDedup.ts.
   */
  crossFormatSkipped: number
  /** The same, trade by trade, for the preview. */
  crossFormat: TradeDuplicate[]
  /**
   * Transfer rows left out because they cancel out inside the file: money
   * moved between two parts of the same XTB account (see `pairInternalTransfers`).
   */
  internalTransfersSkipped: number
  /**
   * Sales left out because the holding was already closed by hand with the
   * same ticker, quantity and day (see `findClosedByHandSales`). Shown in the
   * preview as likely duplicates.
   */
  closedByHand: ClosedByHandMatch[]
  warnings: ParseWarning[]
  /** The statement's period, from the file's header block, when it has one. */
  period?: StatementPeriod
}

// ─────────────────────────────────────────
// XTB type mapping
// ─────────────────────────────────────────

/**
 * What each XTB `Type` imports as, keyed lowercase. XTB has renamed some
 * types over the years; older spellings map to the same thing.
 *
 * Fees use the existing `fee` type: they are money out of the account that
 * belongs to no dividend or interest payment, which is what `fee` already
 * means (Revolut's trade fees). XTB fee rows are never paired with a trade
 * (`pairTradeFees` only knows Revolut ids), so they move Cash and show in
 * Activity, and stay out of cost basis.
 *
 * `Spinoff` is cash paid out by a company to its shareholders, so it imports
 * as a dividend. `Transfer` and `Subaccount transfer` move money between XTB
 * accounts: in is a deposit, out a withdrawal (see {@link typeForRow}).
 */
const XTB_TYPE_MAP: Record<string, TransactionType | 'transfer'> = {
  'stock purchase':           'buy',
  'stocks/etf purchase':      'buy',
  'stock sale':               'sell',
  'stock sell':               'sell',
  'stocks/etf sale':          'sell',
  'deposit':                  'deposit',
  'withdrawal':               'withdrawal',
  'dividend':                 'dividend',
  'divident':                 'dividend',
  'spinoff':                  'dividend',
  'withholding tax':          'withholding_tax',
  'free funds interest':      'interest',
  'free funds interests':     'interest',
  'free funds interest tax':  'interest_tax',
  'free funds interests tax': 'interest_tax',
  'commission':               'fee',
  'sec fee':                  'fee',
  'tax iftt':                 'fee',
  'transfer':                 'transfer',
  'subaccount transfer':      'transfer',
}

/** CFD rows: Vestly tracks shares only, so these are skipped with a warning. */
const CFD_TYPES = new Set(['swap', 'close trade', 'profit/loss (fx/cfd)'])

function typeForRow(rawType: string, amount: number): TransactionType | undefined {
  const mapped = XTB_TYPE_MAP[rawType.trim().toLowerCase()]
  if (mapped !== 'transfer') return mapped
  return amount < 0 ? 'withdrawal' : 'deposit'
}

// ─────────────────────────────────────────
// Comment parsers
// ─────────────────────────────────────────

export type TradeComment = {
  /** `OPEN` starts a position, `CLOSE` ends one. */
  action: 'OPEN' | 'CLOSE'
  /** The side of the position: `BUY` is a long (shares), `SELL` a short (CFD). */
  side: 'BUY' | 'SELL'
  /** When the comment names the instrument: "ACME" from "ACME.US". */
  ticker?: string
  exchange?: string
  /** Units in this row. */
  quantity: number
  /** Units in the whole order, when the row is one fill of it ("0.5/2.5"). */
  orderQuantity?: number
  pricePerUnitOriginal: number
}

const NUMBER = String.raw`\d+(?:\.\d+)?`
const TRADE_COMMENT_RE = new RegExp(
  String.raw`^\s*(OPEN|CLOSE)\s+(BUY|SELL)\s+(?:(\S+)\.([A-Z]{2,3})\s+)?(${NUMBER})(?:\s*/\s*(${NUMBER}))?\s+@\s+(${NUMBER})`,
)

/**
 * Parse a trade comment. Every shape XTB writes:
 *   "OPEN BUY 0.25 @ 100.00"             → buy 0.25
 *   "OPEN BUY ACME.US 2 @ 10.00"         → buy 2, ticker ACME on US
 *   "OPEN BUY ACME.US 0.5/2.5 @ 10.00"   → buy 0.5, one fill of an order of 2.5
 *   "CLOSE BUY 6/12 @ 55.00"             → sale of 6 shares held
 * `OPEN SELL` and `CLOSE SELL` are short (CFD) trades; the caller skips them.
 */
export function parseTradeComment(comment: string): TradeComment | null {
  const m = comment.match(TRADE_COMMENT_RE)
  if (!m) return null
  const quantity = parseFloat(m[5])
  if (!(quantity > 0)) return null
  return {
    action: m[1] as TradeComment['action'],
    side: m[2] as TradeComment['side'],
    ...(m[3] && { ticker: m[3], exchange: m[4] }),
    quantity,
    ...(m[6] && { orderQuantity: parseFloat(m[6]) }),
    pricePerUnitOriginal: parseFloat(m[7]),
  }
}

/**
 * Parse ticker and exchange from a comment that starts with a ticker symbol.
 * Examples:
 *   "AGNC.US USD 0.1200/ SHR"  → { ticker: "AGNC", exchange: "US" }
 *   "AGNC.US USD WHT 15%"      → { ticker: "AGNC", exchange: "US" }
 *   "KRU.PL ..."               → { ticker: "KRU",  exchange: "PL" }
 */
export function parseTickerFromComment(comment: string): {
  ticker: string
  exchange: string
} | null {
  const match = comment.match(/^([A-Z0-9]+)\.([A-Z]{2})\s/)
  if (!match) return null
  return { ticker: match[1], exchange: match[2] }
}

/** A `Ticker` column value: "ACME.US" → ACME on US; a bare "ACME" has no exchange. */
function parseTickerCell(cell: string): { ticker: string; exchange?: string } | null {
  const value = cell.trim()
  if (!value) return null
  const m = value.match(/^(\S+)\.([A-Z]{2,3})$/)
  return m ? { ticker: m[1], exchange: m[2] } : { ticker: value }
}

// ─────────────────────────────────────────
// The Cash Operations table
// ─────────────────────────────────────────

/** Cash amounts in whole grosze, so sums of many rows don't pick up float noise. */
const toCents = (amount: number) => Math.round(amount * 100)

type RawRow = {
  /** 1-based row number in the file, as a spreadsheet shows it. */
  line: number
  /** Column name (lowercase) → value. Text stays text and numbers stay numbers; times are ISO text. */
  cells: Record<string, Cell>
  raw: string
}

/** The statement's period, from its header block: UTC ISO timestamps (or dates). */
export type StatementPeriod = { from: string; to: string }

/** The Cash Operations table, read from a CSV or from the workbook's sheet. Everything after this is shared. */
type CashOperationsTable = {
  rows: RawRow[]
  total: RawRow | null
  period?: StatementPeriod
  /** Reads a number the source wrote as text, the way that source writes numbers. */
  toNumber: (value: string) => number
}

/**
 * XTB Cash Operations structure, the same in the .xlsx sheet and in a CSV:
 *   A header block (account number, "Cash Operations", date from / to in UTC)
 *   A header row naming the columns: Type, Instrument, Time, Amount, ID, Comment, …
 *   Transaction rows, newest first
 *   A "Total" row: the sum of the Amount column
 *
 * XTB has shipped several layouts (7, 8 and 10 columns, some with a `Ticker`
 * column), so the header row is found by its names, not its position, and
 * columns are read by name. Names are matched case-insensitively and stored
 * lowercase. The account number in the header block is never read.
 *
 * @param grid  The rows from row 1, as cells.
 * @param time  A `Time` or period cell as text that {@link parseCashOperationsTime} reads.
 * @param raw   The source text of row `i`, for warnings.
 */
function cashOperationsTable(
  grid: Cell[][],
  { toNumber, time, raw }: { toNumber: (value: string) => number; time: (value: Cell) => string; raw?: (i: number) => string },
): CashOperationsTable {
  const headerIndex = cashOperationsHeaderIndex(grid)
  if (headerIndex < 0) return { rows: [], total: null, toNumber }

  const headers = grid[headerIndex].map((h) => String(h).trim().toLowerCase())
  const timeAt = headers.indexOf('time')
  const number = (v: Cell | undefined) => (typeof v === 'number' ? v : toNumber(v ?? ''))
  const rows: RawRow[] = []
  let total: RawRow | null = null

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const values = grid[i].map((v, j) => (j === timeAt && v !== '' ? time(v) : v))
    if (values.every((v) => v === '')) continue
    const cells: Record<string, Cell> = {}
    headers.forEach((h, j) => { if (h) cells[h] = values[j] ?? '' })
    const row = { line: i + 1, cells, raw: raw?.(i) ?? values.join(',') }
    if (String(values[0]).trim().toLowerCase() === 'total' || String(cells['type'] ?? '').trim().toLowerCase() === 'total') {
      // The Total value sits under Amount; if a layout puts it elsewhere, it is the row's last number.
      if (!Number.isFinite(number(cells['amount']))) {
        const last = values.filter((v) => v !== '' && Number.isFinite(number(v))).at(-1)
        if (last !== undefined) cells['amount'] = last
      }
      total = row
      continue
    }
    rows.push(row)
  }

  return { rows, total, period: statementPeriod(grid.slice(0, headerIndex), time), toNumber }
}

/** "Date from (UTC)" and "Date to (UTC)" in the header block. Only those two rows are read. */
function statementPeriod(block: Cell[][], time: (value: Cell) => string): StatementPeriod | undefined {
  const find = (label: string) => {
    const row = block.find((r) => String(r[0] ?? '').trim().toLowerCase().startsWith(label))
    return row && row[1] !== undefined && row[1] !== '' ? parseCashOperationsTime(time(row[1])) : null
  }
  const from = find('date from')
  const to = find('date to')
  return from && to ? { from, to } : undefined
}

/** A Cash Operations CSV, saved by XTB or by hand from the .xlsx. */
function cashOperationsFromCSV(text: string): CashOperationsTable {
  const lines = (text.startsWith('\uFEFF') ? text.slice(1) : text).split(/\r?\n/)
  const separator = detectSeparator(lines)
  const grid = lines.map((line) => (line.trim() ? splitCSVLine(line, separator) : []))
  return cashOperationsTable(grid, {
    toNumber: (v) => parseCSVNumber(v, separator),
    time: (v) => String(v),
    raw: (i) => lines[i].trim(),
  })
}

/** The Cash Operations sheet of XTB's .xlsx. `Time` cells are Excel date serials, read as UTC. */
function cashOperationsFromSheet(sheet: WorkbookSheet, date1904: boolean): CashOperationsTable {
  return cashOperationsTable(sheetCells(sheet), {
    toNumber: (v) => parseFloat(v),
    time: (v) => (typeof v === 'number' ? excelSerialToISO(v, date1904) ?? String(v) : v),
  })
}

/** XTB types that move money between XTB accounts, keyed lowercase. */
const TRANSFER_TYPES = new Set(['transfer', 'subaccount transfer'])

/**
 * Transfer rows that cancel out inside the file: the two legs of moving money
 * between two parts of one XTB account (say, from trading to an investment
 * plan). Each pair is two transfer rows with the same time and comment,
 * opposite amounts and a different Product. Imported, they would add a
 * deposit and a withdrawal that net to zero but inflate both totals, so they
 * are left out. A transfer with no partner in the file moves money in or out
 * of it, and imports by its sign.
 */
function pairInternalTransfers(rows: RawRow[], amountOf: (row: RawRow) => number): Set<RawRow> {
  const paired = new Set<RawRow>()
  const text = (row: RawRow, name: string) => String(row.cells[name] ?? '')
  const transfers = rows.filter((r) => TRANSFER_TYPES.has(text(r, 'type').trim().toLowerCase()))
  for (const a of transfers) {
    if (paired.has(a)) continue
    const amountA = toCents(amountOf(a))
    if (!Number.isFinite(amountA) || amountA === 0) continue
    const b = transfers.find((r) =>
      r !== a &&
      !paired.has(r) &&
      text(r, 'time') === text(a, 'time') &&
      text(r, 'comment') === text(a, 'comment') &&
      text(r, 'product') !== text(a, 'product') &&
      toCents(amountOf(r)) === -amountA,
    )
    if (b) {
      paired.add(a)
      paired.add(b)
    }
  }
  return paired
}

// ─────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────

/**
 * Parse an XTB Cash Operations file into Transaction objects: XTB's original
 * .xlsx statement (its Cash Operations sheet, wherever it is in the file) or a
 * CSV of that sheet.
 *
 * Throws {@link StatementCurrencyError} and imports nothing when the statement
 * is for an account in another currency than PLN (see `statementCurrency`).
 *
 * @param file                  The File object from the file picker
 * @param accountId             The account this import belongs to
 * @param existingExternalIds   Set of externalIds already in the store (for deduplication)
 * @param accounts              Optional existing accounts — used as a final fallback to
 *                              resolve tickers for buy-only instruments (e.g. Fortinet)
 *                              that never appear in dividend rows. Matched by
 *                              case-insensitive holding name against the CSV Instrument column.
 * @param existingTransactions  The log, to catch trades already imported from a daily
 *                              confirmation and sales already recorded with Close position.
 */
export async function parseXTBCashOperations(
  file: File,
  accountId: string,
  existingExternalIds: Set<string>,
  accounts?: Account[],
  instrumentAliases?: Record<string, InstrumentAlias>,
  existingTransactions?: Transaction[]
): Promise<ParseResult> {
  let table: CashOperationsTable
  if (isWorkbookFile(file)) {
    const workbook = await readWorkbook(file)
    assertHomeCurrency(workbook, file.name)
    const sheet = findCashOperationsSheet(workbook)
    if (!sheet) throw new Error('This file has no Cash Operations sheet.')
    table = cashOperationsFromSheet(sheet, workbook.date1904)
  } else {
    assertHomeCurrency(null, file.name)
    table = cashOperationsFromCSV(await readTextFile(file))
  }
  return parseCashOperationsTable(table, accountId, existingExternalIds, accounts, instrumentAliases, existingTransactions)
}

/** {@link parseXTBCashOperations} on a CSV's text. */
export function parseXTBCashOperationsText(
  text: string,
  accountId: string,
  existingExternalIds: Set<string>,
  accounts?: Account[],
  instrumentAliases?: Record<string, InstrumentAlias>,
  existingTransactions?: Transaction[]
): ParseResult {
  return parseCashOperationsTable(cashOperationsFromCSV(text), accountId, existingExternalIds, accounts, instrumentAliases, existingTransactions)
}

/** The parser proper, on the table from either source. */
function parseCashOperationsTable(
  { rows, total, period, toNumber }: CashOperationsTable,
  accountId: string,
  existingExternalIds: Set<string>,
  accounts?: Account[],
  instrumentAliases?: Record<string, InstrumentAlias>,
  existingTransactions?: Transaction[]
): ParseResult {
  const cell = (row: RawRow, name: string) => String(row.cells[name] ?? '')
  const amountOf = (row: RawRow) => {
    const v = row.cells['amount']
    return typeof v === 'number' ? v : toNumber(v ?? '')
  }
  const tickerCell = (row: RawRow) => parseTickerCell(cell(row, 'ticker') || cell(row, 'symbol'))

  // Pass 1: build instrument name → ticker map from the rows that name one:
  // a Ticker column, a trade comment with a ticker ("OPEN BUY ACME.US 2 @ …"),
  // or a dividend/withholding-tax comment ("AGNC.US USD 0.1200/ SHR"). Trade
  // rows of the same instrument that don't name it then still resolve.
  const instrumentTickerMap = new Map<string, { ticker: string; exchange?: string }>()
  for (const row of rows) {
    const instrument = cell(row, 'instrument').trim()
    if (!instrument || instrumentTickerMap.has(instrument)) continue
    const comment = cell(row, 'comment')
    const type = XTB_TYPE_MAP[cell(row, 'type').trim().toLowerCase()]
    const fromComment = type === 'dividend' || type === 'withholding_tax'
      ? parseTickerFromComment(comment)
      : type === 'buy' || type === 'sell'
        ? parseTradeComment(comment)
        : null
    const tickerInfo = tickerCell(row) ?? (fromComment?.ticker ? { ticker: fromComment.ticker, exchange: fromComment.exchange } : null)
    if (tickerInfo) instrumentTickerMap.set(instrument, tickerInfo)
  }

  // Fallback map: lowercase holding name → ticker, built from existing accounts.
  // Used for buy-only instruments that never appear in dividend rows and therefore
  // can't be resolved via instrumentTickerMap. The user must have set the ticker
  // on the holding manually for this to help.
  const holdingNameMap = new Map<string, string>()
  if (accounts) {
    for (const acc of accounts) {
      for (const h of acc.holdings) {
        if (h.ticker) holdingNameMap.set(h.name.toLowerCase(), h.ticker)
      }
    }
  }

  // Pass 2: parse all rows into transactions
  const transactions: Transaction[] = []
  const warnings: ParseWarning[] = []
  let skipped = 0
  /** Amount of every row imported, or left out on purpose (duplicates, CFD), in grosze. */
  let accountedCents = 0
  const internalTransfers = pairInternalTransfers(rows, amountOf)
  const warn = (row: RawRow, message: string) =>
    warnings.push({ row: row.line, message, rawData: JSON.stringify(row.cells) })

  for (const row of rows) {
    const rawType = cell(row, 'type')
    const rawInstrument = cell(row, 'instrument')
    const rawTime = cell(row, 'time')
    const rawAmount = cell(row, 'amount')
    const rawId = cell(row, 'id')
    const rawComment = cell(row, 'comment')
    const amountPLN = amountOf(row)

    // 1. Deduplication: skip if externalId already exists
    if (rawId && existingExternalIds.has(rawId)) {
      skipped++
      if (Number.isFinite(amountPLN)) accountedCents += toCents(amountPLN)
      continue
    }

    // 2. Amount
    if (!Number.isFinite(amountPLN)) {
      warn(row, `Invalid amount: "${rawAmount}"`)
      continue
    }

    // 3. A transfer that another row in the file cancels out: not imported.
    if (internalTransfers.has(row)) {
      accountedCents += toCents(amountPLN)
      continue
    }

    // 4. CFD rows: not shares, so not imported. Nothing is guessed.
    const typeKey = rawType.trim().toLowerCase()
    if (CFD_TYPES.has(typeKey)) {
      warn(row, `Not imported: "${rawType}" is a CFD row, and Vestly tracks shares only`)
      accountedCents += toCents(amountPLN)
      continue
    }

    // 5. Map type
    const type = typeForRow(rawType, amountPLN)
    if (!type) {
      warn(row, `Unknown transaction type: "${rawType}"`)
      continue
    }

    // 6. Parse date
    const date = parseCashOperationsTime(rawTime)
    if (!date) {
      warn(row, `Invalid date: "${rawTime}"`)
      continue
    }

    // 7. Build transaction with type-specific fields
    const base = {
      id: uuidv4(),
      accountId,
      type,
      date,
      amountPLN,
      externalId: rawId,
      comment: rawComment || undefined,
      source: 'xtb_import' as const,
      createdAt: new Date().toISOString(),
    }

    if (type === 'buy' || type === 'sell') {
      const parsed = parseTradeComment(rawComment)
      if (!parsed) {
        warn(row, `Could not parse ${type === 'buy' ? 'buy' : 'sale'} comment: "${rawComment}"`)
        continue
      }
      // A short position (OPEN SELL / CLOSE SELL) on a share row is a CFD trade.
      if (parsed.side === 'SELL') {
        warn(row, `Not imported: "${rawComment}" is a short (CFD) trade, and Vestly tracks shares only`)
        accountedCents += toCents(amountPLN)
        continue
      }
      // A purchase opens a long position and a sale closes one; anything else is unexpected.
      if ((type === 'buy') !== (parsed.action === 'OPEN')) {
        warn(row, `"${rawType}" row with a comment that doesn't match it: "${rawComment}"`)
        continue
      }

      // Ticker resolution priority for trade rows:
      //   1. Ticker column, when the layout has one
      //   2. Comment ("OPEN BUY ACME.US 2 @ 10.00"); only some rows name it
      //   3. instrumentTickerMap — other rows of the same instrument in this file (Pass 1)
      //   4. instrumentAliases  — user-defined name→ticker map from Settings
      //   5. staticLookupInstrument — built-in map for common ETFs
      //   6. holdingNameMap — case-insensitive name match against existing holdings
      //      (covers buy-only instruments like Fortinet that never appear in dividend rows)
      const instrumentKey = rawInstrument.trim()
      const fromFile = tickerCell(row)
        ?? (parsed.ticker ? { ticker: parsed.ticker, exchange: parsed.exchange } : undefined)
        ?? (instrumentKey ? instrumentTickerMap.get(instrumentKey) : undefined)
      const tickerFromAlias = (!fromFile && instrumentKey && instrumentAliases)
        ? (instrumentAliases[instrumentKey] ?? instrumentAliases[instrumentKey.toLowerCase()])
        : undefined
      const tickerFromStatic = (!fromFile && !tickerFromAlias && instrumentKey)
        ? staticLookupInstrument(instrumentKey)
        : undefined
      const tickerFromHolding = (!fromFile && !tickerFromAlias && !tickerFromStatic && instrumentKey)
        ? holdingNameMap.get(instrumentKey.toLowerCase())
        : undefined
      const tickerInfo = fromFile ?? tickerFromAlias ?? tickerFromStatic
      const ticker = tickerInfo?.ticker ?? tickerFromHolding
      const exchange = tickerInfo?.exchange  // not available from holding name match
      const originalCurrency = exchange === 'PL' ? 'PLN' : exchange === 'US' ? 'USD' : undefined

      transactions.push({
        ...base,
        instrument: rawInstrument || undefined,
        ticker,
        exchange,
        quantity: parsed.quantity,
        // A buy's amount is what it cost; a sale's is the whole proceeds (quantity × price).
        pricePerUnitPLN: Math.abs(amountPLN) / parsed.quantity,
        originalCurrency,
        pricePerUnitOriginal: parsed.pricePerUnitOriginal,
      })
    } else if (type === 'dividend' || type === 'withholding_tax' || type === 'fee') {
      // relatedInstrument from Instrument column, relatedTicker from Comment
      const tickerInfo = tickerCell(row) ?? parseTickerFromComment(rawComment)
        ?? (rawInstrument.trim() ? instrumentTickerMap.get(rawInstrument.trim()) : undefined)

      transactions.push({
        ...base,
        relatedInstrument: rawInstrument || undefined,
        relatedTicker: tickerInfo?.ticker,
        exchange: tickerInfo?.exchange,
      })
    } else {
      // deposit, withdrawal, interest, interest_tax: no instrument fields
      transactions.push(base)
    }
    accountedCents += toCents(amountPLN)
  }

  // Pass 3: drop sales Close position already recorded by hand, then trades
  // that already arrived via a daily confirmation PDF. Matching is by economic
  // identity, not id — none of these share an id with this file. Fee rows
  // charged on a dropped trade go with it when the other record already took
  // the fee out of its amount. All stay accounted for in the Total check:
  // they are in the log already.
  const existing = existingTransactions ?? []
  const dropped = new Set<string>()
  const closedByHand: ClosedByHandMatch[] = []
  for (const [id, match] of findClosedByHandSales(transactions, existing)) {
    const sale = transactions.find((t) => t.id === id)!
    const fees = (match.feePLN ?? 0) > 0 ? feesChargedWith([sale], transactions).filter((f) => !dropped.has(f.id)) : []
    for (const t of [sale, ...fees]) dropped.add(t.id)
    closedByHand.push({ sale, existing: match, fees })
  }
  const usedByHand = new Set(closedByHand.map((m) => m.existing.id))
  const crossFormat = findDuplicateTradeGroups(
    transactions.filter((t) => !dropped.has(t.id)),
    existing.filter((t) => !usedByHand.has(t.id)),
  )
  for (const d of crossFormat) for (const t of [...d.candidates, ...d.candidateFees]) dropped.add(t.id)
  const crossFormatSkipped = crossFormat.reduce((n, d) => n + d.candidates.length + d.candidateFees.length, 0)

  // Pass 4: the rows must add up to the file's Total row (the sum of its
  // Amount column). A gap means rows were dropped — a row type this parser
  // doesn't know yet, or a row it couldn't read.
  if (total) {
    const totalAmount = amountOf(total)
    if (Number.isFinite(totalAmount) && toCents(totalAmount) !== accountedCents) {
      const gap = (toCents(totalAmount) - accountedCents) / 100
      // First: it is the one that says how much is missing.
      warnings.unshift({
        row: total.line,
        message: `The rows add up to ${(accountedCents / 100).toFixed(2)}, but the file's Total row says ${totalAmount.toFixed(2)}: ${Math.abs(gap).toFixed(2)} PLN wasn't imported, so Cash will be off by that much`,
        rawData: total.raw,
      })
    }
  }

  return {
    transactions: dropped.size > 0 ? transactions.filter((t) => !dropped.has(t.id)) : transactions,
    skipped,
    crossFormatSkipped,
    crossFormat,
    internalTransfersSkipped: internalTransfers.size,
    closedByHand,
    warnings,
    ...(period && { period }),
  }
}

// ─────────────────────────────────────────
// Date parsing
// ─────────────────────────────────────────

/**
 * Parse an XTB Cash Operations `Time` cell to a full ISO 8601 timestamp in UTC.
 *
 * XTB labels the file's date range `(UTC)`, and its other sheets' times too,
 * so the time is read as UTC: "2026-01-02 14:37:04" → "2026-01-02T14:37:04.000Z".
 * The stored day (`date.slice(0, 10)`) is the day the file shows. Accepts:
 *   "2026-02-10 10:59:02"         — YYYY-MM-DD HH:MM:SS (real exports)
 *   "2026-02-10 10:59:02.277000"  — with fractional seconds, kept to the millisecond
 *   "2026-02-10T10:59:02.277Z"    — the .xlsx sheet's date cells, already converted
 *   "10.02.2026 10:59:02"         — DD.MM.YYYY HH:MM:SS
 *   "2026-02-10 9:59"             — a CSV saved by hand: one-digit hours, no seconds
 * A bare date ("2026-02-10") stays date-only: the time is unknown.
 *
 * Returns null if unparseable.
 */
export function parseCashOperationsTime(raw: string): string | null {
  const value = raw.trim()
  const clock = String.raw`(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?Z?)?`
  const iso = value.match(new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})${clock}$`))
  const dot = value.match(new RegExp(String.raw`^(\d{2})\.(\d{2})\.(\d{4})${clock}$`))
  const parts = iso
    ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6], iso[7]]
    : dot
      ? [dot[3], dot[2], dot[1], dot[4], dot[5], dot[6], dot[7]]
      : null
  if (!parts) return null

  const [y, mo, d, h, mi, s, frac] = parts
  const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0
  const sec = s ? +s : 0
  const when = new Date(Date.UTC(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0, sec, ms))
  // Date.UTC rolls 2026-02-30 over into March; that is not a real date.
  if (when.getUTCFullYear() !== +y || when.getUTCMonth() !== +mo - 1 || when.getUTCDate() !== +d) return null
  if (h && (when.getUTCHours() !== +h || when.getUTCMinutes() !== +mi || when.getUTCSeconds() !== sec)) return null
  return h ? when.toISOString() : `${y}-${mo}-${d}`
}
