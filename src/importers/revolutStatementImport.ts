/**
 * From a parsed Revolut Crypto Account Statement (`revolutStatement.ts`) to the
 * rows Vestly stores, and the check of the holdings against the statement's
 * closing amounts.
 *
 * What the statement's columns mean (checked by the owner on real files, #81):
 * - Quantity is Value ÷ Price. Value is the PLN paid (buy) or received (sell).
 *   On a buy the fee is taken in coins, so fewer coins arrive than Quantity
 *   says; on a sell more leave than it says. Sends and receives match.
 * - Price is rounded to 2 decimals; Quantity uses the exact rate. So amounts
 *   come from Value and Fee, never Price × Quantity.
 * - The statement's fee is a grosz lower than the app's, so the coin amounts
 *   below are close, not exact. The holdings check closes the gap with one
 *   adjustment row per coin.
 *
 * Stored so that the position walk gives cost = buy Value and proceeds =
 * sell Value, with the fee as its own row (paired by `pairTradeFees`):
 *
 * | Type    | amountPLN       | fee row | quantity                           |
 * |---------|-----------------|---------|------------------------------------|
 * | buy     | −(Value − Fee)  | −Fee    | Quantity × (Value − Fee) ÷ Value    |
 * | sell    | Value + Fee     | −Fee    | Quantity × (Value + Fee) ÷ Value    |
 * | send    | 0               | —       | Quantity                           |
 * | receive | cost (Value)    | —       | Quantity                           |
 */
import { v4 as uuidv4 } from 'uuid'
import type { Account, Holding, Transaction } from '@/types'
import { positionKey } from '@/domain/calculations'
import { holdingPositionKey } from '@/domain/closePosition'
import { lastClosedCycle, walkPosition } from '@/domain/position'
import { pairTradeFees } from '@/domain/tradeFees'
import { transactionDay } from '@/domain/transactionDay'
import { formatQuantity } from '@/utils/formatters'
import type { RevolutStatement, StatementRow, StatementRowType } from './revolutStatement'

// ─────────────────────────────────────────
// IDs
// ─────────────────────────────────────────

/** Every row this import stores has an `externalId` with this prefix. */
export const STATEMENT_ID_PREFIX = 'revolut-stmt-'
/** The holdings check's adjustment rows. */
export const ADJUSTMENT_ID_PREFIX = 'revolut-stmt-adjust-'
/** A trade's fee row has its trade's id plus this suffix (see `domain/tradeFees.ts`). */
export const FEE_ID_SUFFIX = '-fee'

/** The note Activity shows on an adjustment row. */
export const ADJUSTMENT_NOTE = 'Adjustment to match Revolut statement'

/**
 * A row's id: coin, type, UTC time to the second and the statement's quantity,
 * plus which of the statement's identical rows it is (1, 2, …). There are no
 * transaction ids in the statement; coin, type, time and quantity are
 * practically unique, and the occurrence keeps two identical rows apart.
 * Re-importing an overlapping statement gives the same ids, so adds nothing.
 */
export function statementRowId(row: Pick<StatementRow, 'symbol' | 'type' | 'date' | 'quantity'>, occurrence: number): string {
  return `${STATEMENT_ID_PREFIX}${row.symbol}-${row.type}-${row.date}-${row.quantity}-${occurrence}`
}

export function isAdjustmentRow(t: Pick<Transaction, 'externalId'>): boolean {
  return t.externalId.startsWith(ADJUSTMENT_ID_PREFIX)
}

// ─────────────────────────────────────────
// Rows → transactions
// ─────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100
export const round8 = (n: number) => Math.round(n * 1e8) / 1e8

/** A statement row with its id: what the preview lists and the import stores. */
export type PlannedRow = StatementRow & {
  id: string
  /** Already in the log (an overlapping statement imported before). */
  duplicate: boolean
}

/** Give every row its id, in statement order, and mark the ones already imported. */
export function planStatementRows(statement: RevolutStatement, existingExternalIds: ReadonlySet<string>): PlannedRow[] {
  const seen = new Map<string, number>()
  return statement.rows.map((row) => {
    const base = statementRowId(row, 0)
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)
    const id = statementRowId(row, occurrence)
    return { ...row, id, duplicate: existingExternalIds.has(id) }
  })
}

/** Coins received, per buy/sell/fee rule above. */
export function storedQuantity(row: Pick<StatementRow, 'type' | 'quantity' | 'value' | 'fee'>): number {
  if (row.value <= 0) return row.quantity
  if (row.type === 'buy') return round8((row.quantity * (row.value - row.fee)) / row.value)
  if (row.type === 'sell') return round8((row.quantity * (row.value + row.fee)) / row.value)
  return row.quantity
}

export function storedAmount(row: Pick<StatementRow, 'type' | 'value' | 'fee'>, receiveCost?: number): number {
  switch (row.type) {
    case 'buy': return -round2(row.value - row.fee)
    case 'sell': return round2(row.value + row.fee)
    case 'send': return 0
    case 'receive': return round2(receiveCost ?? row.value)
  }
}

/**
 * The transactions for the new rows: the trade, and a fee row for a buy or
 * sell with a fee. Duplicates are left out.
 *
 * @param receiveCosts What each received row cost, by row id. Defaults to the
 *                     statement's Value; the preview lets the person change it.
 */
export function buildStatementTransactions({
  rows,
  statement,
  accountId,
  receiveCosts = new Map(),
  now = new Date().toISOString(),
}: {
  rows: PlannedRow[]
  statement: Pick<RevolutStatement, 'names'>
  accountId: string
  receiveCosts?: ReadonlyMap<string, number>
  now?: string
}): Transaction[] {
  const out: Transaction[] = []
  for (const row of rows) {
    if (row.duplicate) continue
    const instrument = statement.names[row.symbol] ?? row.symbol
    const quantity = storedQuantity(row)
    const amountPLN = storedAmount(row, receiveCosts.get(row.id))
    const trade: Transaction = {
      id: uuidv4(),
      accountId,
      type: row.type,
      date: row.date,
      amountPLN,
      instrument,
      ticker: row.symbol,
      quantity,
      pricePerUnitPLN: quantity > 0 ? Math.abs(amountPLN) / quantity : 0,
      originalCurrency: 'PLN',
      pricePerUnitOriginal: row.price,
      externalId: row.id,
      // Transfers move coins, not this account's money.
      ...((row.type === 'send' || row.type === 'receive') && { affectsCash: false }),
      comment: row.raw,
      source: 'revolut_crypto',
      createdAt: now,
    }
    out.push(trade)
    if ((row.type === 'buy' || row.type === 'sell') && row.fee > 0) {
      out.push({
        id: uuidv4(),
        accountId,
        type: 'fee',
        date: row.date,
        amountPLN: -round2(row.fee),
        relatedInstrument: instrument,
        relatedTicker: row.symbol,
        externalId: `${row.id}${FEE_ID_SUFFIX}`,
        source: 'revolut_crypto',
        createdAt: now,
      })
    }
  }
  return out
}

/** How many of each type a coin has among the rows to import. */
export type CoinCounts = Record<StatementRowType, number>

export function countByCoin(rows: PlannedRow[]): { symbol: string; counts: CoinCounts }[] {
  const by = new Map<string, CoinCounts>()
  for (const row of rows) {
    if (row.duplicate) continue
    const c = by.get(row.symbol) ?? { buy: 0, sell: 0, send: 0, receive: 0 }
    c[row.type]++
    by.set(row.symbol, c)
  }
  return [...by].map(([symbol, counts]) => ({ symbol, counts }))
}

// ─────────────────────────────────────────
// Holdings check
// ─────────────────────────────────────────

/** Below this many coins the walk and the statement agree (one satoshi is 1e-8). */
export const CRYPTO_TOLERANCE = 1e-8 + 1e-12

export type CoinDifference = {
  symbol: string
  name: string
  /** What the log holds at the end of the statement's period. */
  vestly: number
  /** The statement's closing amount. */
  revolut: number
  /** Coins the adjustment adds (+) or removes (−). */
  delta: number
  /** Why they may differ, most likely first ("Fees estimated from the statement"). */
  reasons: string[]
}

/** Coins in and out over the period: what the imported rows add up to, and Account summary's amounts. */
export type CoinFlows = {
  in: { vestly: number; revolut: number }
  out: { vestly: number; revolut: number }
}

export type StatementHoldingsCheck = {
  /** The statement's end day, `yyyy-MM-dd`. */
  asOf: string
  matching: string[]
  differences: CoinDifference[]
  /** Coins with no closing amount to compare against. */
  unchecked: string[]
  /**
   * Per coin with an Account summary: the rows' coins in and out against the
   * summary's amount in and amount out. Only reported (in the "Why" text), so
   * a systematic quantity problem is visible; nothing is corrected with it.
   */
  flows: Record<string, CoinFlows>
}

/**
 * The statement rows' coins in (buys, receives) and out (sells, sends) for a
 * coin, as stored (`storedQuantity`), against Account summary's amount in and
 * amount out. Undefined without a summary for the coin.
 */
export function coinFlows(statement: Pick<RevolutStatement, 'rows' | 'summary'>, symbol: string): CoinFlows | undefined {
  const summary = statement.summary[symbol]
  if (!summary) return undefined
  let inQ = 0
  let outQ = 0
  for (const r of statement.rows) {
    if (r.symbol !== symbol) continue
    if (r.type === 'buy' || r.type === 'receive') inQ += storedQuantity(r)
    else outQ += storedQuantity(r)
  }
  return { in: { vestly: round8(inQ), revolut: summary.in }, out: { vestly: round8(outQ), revolut: summary.out } }
}

/** "Coins in 0,0297 vs Revolut’s 0,03" for each of in and out that differs. */
function flowReasons(flows: CoinFlows | undefined): string[] {
  if (!flows) return []
  const out: string[] = []
  const fmt = (n: number) => formatQuantity(n, 8)
  if (Math.abs(flows.in.vestly - flows.in.revolut) >= CRYPTO_TOLERANCE) out.push(`Coins in ${fmt(flows.in.vestly)} vs Revolut’s ${fmt(flows.in.revolut)}`)
  if (Math.abs(flows.out.vestly - flows.out.revolut) >= CRYPTO_TOLERANCE) out.push(`Coins out ${fmt(flows.out.vestly)} vs Revolut’s ${fmt(flows.out.revolut)}`)
  return out
}

/**
 * The instant "as of the end date" means: the end of that UTC day, or the
 * statement's last row if it falls later (a row late in the evening west of
 * UTC is stored under the next UTC day).
 */
export function statementCutoff(asOf: string, rows: Pick<StatementRow, 'date'>[]): string {
  const endOfDay = `${asOf}T23:59:59.999Z`
  return rows.reduce((latest, r) => (r.date > latest ? r.date : latest), endOfDay)
}

/** What the account's log holds of `symbol` at `cutoff` (an ISO instant). */
export function quantityAsOf(transactions: Transaction[], accountId: string, symbol: string, cutoff: string): number {
  const rows = transactions.filter(
    (t) => t.accountId === accountId && positionKey(t) === symbol && (t.date.length <= 10 ? t.date <= cutoff.slice(0, 10) : t.date <= cutoff),
  )
  return round8(walkPosition(rows, pairTradeFees(transactions)).quantity)
}

/**
 * Compare each coin's quantity in the log, as of the statement's end date,
 * with the statement's closing amount.
 *
 * @param transactions The log after the statement's rows were imported.
 */
export function checkStatementHoldings(
  statement: RevolutStatement,
  transactions: Transaction[],
  accountId: string,
): StatementHoldingsCheck | null {
  if (!statement.period) return null
  const asOf = statement.period.to
  const cutoff = statementCutoff(asOf, statement.rows)
  const coins = [...new Set([...Object.keys(statement.closing), ...statement.rows.map((r) => r.symbol)])].sort()
  const unreadable = new Set(statement.warnings.map((w) => w.summary?.split(' · ')[0]).filter(Boolean))

  const matching: string[] = []
  const differences: CoinDifference[] = []
  const unchecked: string[] = []
  const flows: Record<string, CoinFlows> = {}
  for (const symbol of coins) {
    const flow = coinFlows(statement, symbol)
    if (flow) flows[symbol] = flow
    const closing = statement.closing[symbol]
    if (!closing) {
      unchecked.push(symbol)
      continue
    }
    const vestly = quantityAsOf(transactions, accountId, symbol, cutoff)
    const delta = round8(closing.quantity - vestly)
    if (Math.abs(delta) < CRYPTO_TOLERANCE) {
      matching.push(symbol)
      continue
    }
    const traded = statement.rows.some((r) => r.symbol === symbol && (r.type === 'buy' || r.type === 'sell'))
    const reasons: string[] = []
    if ((statement.opening[symbol] ?? 0) > 0 && delta > 0) reasons.push('Held before the statement’s period')
    // Left-out staking rewards only explain Revolut holding more.
    if (statement.staking[symbol] && delta > 0) reasons.push('Staking rewards left out')
    if (unreadable.has(symbol)) reasons.push('A row couldn’t be read')
    reasons.push(...flowReasons(flow))
    if (traded) reasons.push('Fees estimated from the statement')
    if (reasons.length === 0) reasons.push('Not explained by the statement’s rows')
    differences.push({ symbol, name: statement.names[symbol] ?? symbol, vestly, revolut: closing.quantity, delta, reasons })
  }
  return { asOf, matching, differences, unchecked, flows }
}

/**
 * One 0 PLN row per coin that brings its holding to the statement's closing
 * amount: a `receive` that adds coins, or a `send` that removes them, dated
 * the end of the statement's last day. At 0 PLN it doesn't change what was
 * paid (the walk adds received coins at no cost, and removes sent coins at
 * the average without realizing anything). It moves no cash.
 *
 * The id carries the coin, the day and the amount, so applying the same
 * statement's check twice adds nothing.
 */
export function adjustmentTransactions(
  differences: CoinDifference[],
  accountId: string,
  asOf: string,
  now = new Date().toISOString(),
): Transaction[] {
  return differences.map((d) => ({
    id: uuidv4(),
    accountId,
    type: d.delta > 0 ? 'receive' : 'send',
    date: `${asOf}T23:59:59.000Z`,
    amountPLN: 0,
    instrument: d.name,
    ticker: d.symbol,
    quantity: round8(Math.abs(d.delta)),
    pricePerUnitPLN: 0,
    externalId: `${ADJUSTMENT_ID_PREFIX}${d.symbol}-${asOf}-${round8(d.delta)}`,
    affectsCash: false,
    comment: ADJUSTMENT_NOTE,
    source: 'revolut_crypto',
    createdAt: now,
  }))
}

// ─────────────────────────────────────────
// New holdings
// ─────────────────────────────────────────

/**
 * Crypto holdings for the statement's coins the account doesn't hold yet,
 * from the walk of the log: its quantity and average cost. Coins with
 * nothing left are skipped, and so are coins the account already has a
 * holding for (`planHoldingSync` handles those).
 */
export function newCoinHoldings(
  account: Account,
  transactions: Transaction[],
  statement: Pick<RevolutStatement, 'names' | 'prices' | 'rows'>,
  coins: string[],
  now = new Date().toISOString(),
): Holding[] {
  const held = new Set(account.holdings.filter((h) => !h.isSynthetic).map(holdingPositionKey))
  const fees = pairTradeFees(transactions)
  const out: Holding[] = []
  for (const symbol of coins) {
    if (held.has(symbol)) continue
    const rows = transactions.filter((t) => t.accountId === account.id && positionKey(t) === symbol)
    const position = walkPosition(rows, fees)
    const quantity = round8(position.quantity)
    if (quantity <= 0) continue
    const days = rows.filter((t) => t.quantity).map(transactionDay).sort()
    out.push({
      id: uuidv4(),
      accountId: account.id,
      name: statement.names[symbol] ?? symbol,
      ticker: symbol,
      exchange: 'CC',
      category: 'crypto',
      quantity,
      purchasePrice: position.averageCostPLN,
      currentPrice: statement.prices[symbol] ?? position.averageCostPLN,
      purchaseDate: days[0] ?? now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    })
  }
  return out
}

/**
 * Closed holdings for the statement's coins that were sold or sent out
 * completely and aren't held at the end: kept like any closed position
 * (`Account.closedHoldings`), so Activity shows their icon and Closed
 * positions their result. The quantity and average cost are those of the
 * last round, from when the coin was last bought or received until it was
 * emptied; closed on that last sale's or send's day. Its result is read from
 * the walk (`closedPositionResult`), so it agrees with realized profit.
 *
 * Skipped: coins still held, coins the account has an open holding for
 * (`planHoldingSync` closes those), and coins already closed on that day.
 */
export function closedCoinHoldings(
  account: Account,
  transactions: Transaction[],
  statement: Pick<RevolutStatement, 'names' | 'prices'>,
  coins: string[],
  now = new Date().toISOString(),
): Holding[] {
  const open = new Set(account.holdings.filter((h) => !h.isSynthetic).map(holdingPositionKey))
  const closed = new Set((account.closedHoldings ?? []).map((h) => `${holdingPositionKey(h)}\n${h.closedAt}`))
  const fees = pairTradeFees(transactions)
  const out: Holding[] = []
  for (const symbol of coins) {
    if (open.has(symbol)) continue
    const rows = transactions.filter((t) => t.accountId === account.id && positionKey(t) === symbol)
    const cycle = lastClosedCycle(rows, fees)
    if (!cycle || cycle.quantity <= 0) continue
    const closedAt = transactionDay(cycle.closedBy)
    if (closed.has(`${symbol}\n${closedAt}`)) continue
    const quantity = round8(cycle.quantity)
    const purchasePrice = cycle.costPLN / cycle.quantity
    const sale = cycle.closedBy.type === 'sell' ? cycle.closedBy : null
    out.push({
      id: uuidv4(),
      accountId: account.id,
      name: statement.names[symbol] ?? symbol,
      ticker: symbol,
      exchange: 'CC',
      category: 'crypto',
      quantity,
      purchasePrice,
      currentPrice: sale?.pricePerUnitPLN ?? statement.prices[symbol] ?? purchasePrice,
      purchaseDate: transactionDay(cycle.openedBy),
      createdAt: now,
      updatedAt: now,
      closedAt,
    })
  }
  return out
}
