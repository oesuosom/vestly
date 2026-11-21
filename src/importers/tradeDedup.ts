/**
 * Cross-format duplicate detection for XTB trades.
 *
 * XTB reports the same purchase through two documents that share no identifier:
 *
 *   • Cash Operations export (XLS/CSV) — dedups on its own `ID` column
 *   • Daily confirmation (PDF)         — carries a *Numer zlecenia* (order number)
 *
 * Those are different ID spaces, so `externalId` equality can't catch a trade
 * that arrives through both routes. Importing a daily confirmation today and the
 * monthly cash-operations export later would otherwise double-count the buy,
 * corrupting both quantity and cost basis.
 *
 * This module matches on the trade's economic identity instead — account, type,
 * ticker, quantity, cash amount and date. Callers surface matches in the import
 * preview rather than dropping them silently: the tolerances below are
 * deliberately loose, so a match is a strong hint, not a verdict.
 */
import type { Transaction } from '@/types'
import { resolveTransactionTicker } from '@/domain/calculations'
import { isCloseSale } from '@/domain/closePosition'

// ─────────────────────────────────────────
// Tolerances
// ─────────────────────────────────────────

/** Quantity equality tolerance — fractional shares carry 4 decimals. */
const QTY_EPSILON = 1e-6

/** Cash amount tolerance in PLN — absorbs rounding between the two documents. */
const AMOUNT_EPSILON = 0.01

/**
 * Date tolerance in milliseconds (±1 day).
 *
 * The confirmation timestamps the *execution*; the cash-operations row
 * timestamps the *settlement*, which can land on the next day.
 */
const DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000

// ─────────────────────────────────────────
// Matching
// ─────────────────────────────────────────

/** Trade types this matcher applies to; other types have no quantity to compare. */
function isTrade(t: Transaction): boolean {
  return t.type === 'buy' || t.type === 'sell'
}

/**
 * Find an existing transaction that looks like the same real-world trade as
 * `candidate`.
 *
 * Two trades match when all of the following hold:
 *   • same account and same type (buy/sell)
 *   • same ticker, case-insensitive (both must have one)
 *   • quantity equal within {@link QTY_EPSILON}
 *   • `amountPLN` equal within {@link AMOUNT_EPSILON}
 *   • dates within {@link DATE_TOLERANCE_MS}
 *
 * Returns the first match, or null. Transactions sharing `candidate`'s
 * `externalId` are ignored — those are exact-ID duplicates, which the calling
 * parser already handles and reports separately.
 */
export function findDuplicateTrade(
  candidate: Transaction,
  existing: Transaction[],
): Transaction | null {
  if (!isTrade(candidate)) return null
  if (candidate.quantity == null || !candidate.ticker) return null

  const ticker = candidate.ticker.toUpperCase()
  const time = new Date(candidate.date).getTime()
  if (Number.isNaN(time)) return null

  for (const t of existing) {
    if (t.externalId === candidate.externalId) continue
    if (t.accountId !== candidate.accountId) continue
    if (t.type !== candidate.type) continue
    if (t.quantity == null || !t.ticker) continue
    if (t.ticker.toUpperCase() !== ticker) continue
    if (Math.abs(t.quantity - candidate.quantity) > QTY_EPSILON) continue
    if (Math.abs(t.amountPLN - candidate.amountPLN) > AMOUNT_EPSILON) continue

    const otherTime = new Date(t.date).getTime()
    if (Number.isNaN(otherTime)) continue
    if (Math.abs(otherTime - time) > DATE_TOLERANCE_MS) continue

    return t
  }
  return null
}

// ─────────────────────────────────────────
// Orders: fills and their commission
// ─────────────────────────────────────────
//
// The two documents don't always cut a trade the same way:
//
//   • A confirmation line is one whole order (the parser keeps one line per
//     order number). Cash Operations can list that order as several fills,
//     each with the order's size after a slash: "OPEN BUY ACME.US 0.5/2.5 @ …"
//     and "OPEN BUY ACME.US 2/2.5 @ …" are one order of 2.5.
//   • A confirmation's amount has the order's costs (commission, FX cost) in
//     it. Cash Operations has the trade at its gross amount, and the
//     commission as a separate `Commission` row (a `fee`) with the same
//     instrument and the same time.
//
// So the matcher compares *orders*: a single trade row, or the fills of one
// order taken together, each with the fee rows charged at the same time.

/** One real-world order as one document records it. */
type Order = {
  rows: Transaction[]
  /** Fee rows charged with it: same account, instrument and timestamp. */
  fees: Transaction[]
  quantity: number
  amountPLN: number
  feesPLN: number
  time: number
}

/** The whole order's size, from a Cash Operations fill: "… 0.5/2.5 @ 10.00" → 2.5. */
function orderSize(t: Transaction): number | undefined {
  if (t.source !== 'xtb_import' || !t.comment) return undefined
  const m = t.comment.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+@/)
  return m ? parseFloat(m[2]) : undefined
}

/**
 * Keys a fee row and a trade share when the fee was charged on that trade:
 * same account, same instrument (by ticker or by name), same timestamp. Only
 * timestamped rows have them; a date-only row's time is unknown.
 */
function chargeKeys(accountId: string, tickers: (string | undefined)[], names: (string | undefined)[], date: string): string[] {
  if (date.length <= 10) return []
  return [
    ...tickers.filter(Boolean).map((t) => `${accountId}|T:${t!.toUpperCase()}|${date}`),
    ...names.filter(Boolean).map((n) => `${accountId}|N:${n!.toLowerCase()}|${date}`),
  ]
}

function feesByKey(pool: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>()
  for (const f of pool) {
    if (f.type !== 'fee') continue
    for (const k of chargeKeys(f.accountId, [f.relatedTicker, f.ticker], [f.relatedInstrument, f.instrument], f.date)) {
      map.set(k, [...(map.get(k) ?? []), f])
    }
  }
  return map
}

function toOrder(rows: Transaction[], fees: Map<string, Transaction[]>): Order {
  const charged = new Map<string, Transaction>()
  for (const t of rows) {
    for (const k of chargeKeys(t.accountId, [t.ticker], [t.instrument], t.date)) {
      for (const f of fees.get(k) ?? []) charged.set(f.id, f)
    }
  }
  const chargedFees = [...charged.values()]
  return {
    rows,
    fees: chargedFees,
    quantity: rows.reduce((s, t) => s + (t.quantity ?? 0), 0),
    amountPLN: rows.reduce((s, t) => s + t.amountPLN, 0),
    feesPLN: chargedFees.reduce((s, f) => s + f.amountPLN, 0),
    time: new Date(rows[0].date).getTime(),
  }
}

/**
 * Every way a pool's trades can be read as orders: each trade on its own
 * first (a confirmation line, or a fill matched fill to fill), then the fills
 * of each order together. Fills are grouped by account, side, ticker and order
 * size, in time order, within {@link DATE_TOLERANCE_MS} of the first, until
 * their quantities add up to the order size.
 */
function ordersOf(pool: Transaction[]): Order[] {
  const fees = feesByKey(pool)
  const trades = pool.filter((t) => isTrade(t) && t.quantity != null && t.ticker && !Number.isNaN(new Date(t.date).getTime()))
  const singles = trades.map((t) => toOrder([t], fees))

  const byOrder = new Map<string, Transaction[]>()
  for (const t of trades) {
    const size = orderSize(t)
    if (size == null || Math.abs(size - t.quantity!) <= QTY_EPSILON) continue
    const k = `${t.accountId}|${t.type}|${t.ticker!.toUpperCase()}|${size}`
    byOrder.set(k, [...(byOrder.get(k) ?? []), t])
  }
  const groups: Order[] = []
  for (const fills of byOrder.values()) {
    const size = orderSize(fills[0])!
    fills.sort((a, b) => a.date.localeCompare(b.date))
    let open: Transaction[] = []
    for (const t of fills) {
      if (open.length > 0 && new Date(t.date).getTime() - new Date(open[0].date).getTime() > DATE_TOLERANCE_MS) open = []
      open.push(t)
      const sum = open.reduce((s, f) => s + f.quantity!, 0)
      if (Math.abs(sum - size) <= QTY_EPSILON) {
        groups.push(toOrder(open, fees))
        open = []
      } else if (sum > size) {
        open = []
      }
    }
  }
  return [...singles, ...groups]
}

/**
 * Whether two orders are the same trade, and if so whether the candidate's
 * fee rows are part of it (the existing side counted the commission inside
 * its amount). Amount tolerance grows with the number of rows added up.
 */
function ordersMatch(candidate: Order, existing: Order): { candidateFees: boolean } | null {
  const a = candidate.rows[0]
  const b = existing.rows[0]
  if (a.accountId !== b.accountId || a.type !== b.type) return null
  if (a.ticker!.toUpperCase() !== b.ticker!.toUpperCase()) return null
  if (Math.abs(candidate.quantity - existing.quantity) > QTY_EPSILON) return null
  if (Math.abs(candidate.time - existing.time) > DATE_TOLERANCE_MS) return null

  const tolerance = AMOUNT_EPSILON * Math.max(candidate.rows.length + candidate.fees.length, existing.rows.length + existing.fees.length)
  const near = (x: number, y: number) => Math.abs(x - y) <= tolerance
  if (near(candidate.amountPLN, existing.amountPLN)) return { candidateFees: false }
  if (candidate.fees.length > 0 && near(candidate.amountPLN + candidate.feesPLN, existing.amountPLN)) return { candidateFees: true }
  if (existing.fees.length > 0 && near(candidate.amountPLN, existing.amountPLN + existing.feesPLN)) return { candidateFees: false }
  return null
}

/** The fee rows in `pool` charged with these trades: same account, instrument and timestamp. */
export function feesChargedWith(trades: Transaction[], pool: Transaction[]): Transaction[] {
  return toOrder(trades, feesByKey(pool)).fees
}

/** One trade found in both documents. */
export type TradeDuplicate = {
  /** The candidate's rows for it: one trade, or the fills of one order. */
  candidates: Transaction[]
  /**
   * The candidate's fee rows that the existing trade already counted in its
   * amount (a confirmation's commission): duplicates too.
   */
  candidateFees: Transaction[]
  /** The existing rows it matches. */
  existing: Transaction[]
}

/**
 * Find the candidates' trades that are already in `existing`, order by order:
 * a confirmation line matches one Cash Operations row or all the fills of its
 * order, with or without the commission row charged on it, and the other way
 * round. Each row on either side is used once. Rows sharing an `externalId`
 * are left to the callers' exact-ID check.
 */
export function findDuplicateTradeGroups(candidates: Transaction[], existing: Transaction[]): TradeDuplicate[] {
  const candidateIds = new Set(candidates.map((t) => t.externalId))
  const pool = existing.filter((t) => !candidateIds.has(t.externalId))
  const candidateOrders = ordersOf(candidates)
  const existingOrders = ordersOf(pool)

  const used = new Set<string>()
  const free = (o: Order) => o.rows.every((t) => !used.has(t.id))
  const result: TradeDuplicate[] = []
  for (const c of candidateOrders) {
    if (!free(c)) continue
    for (const e of existingOrders) {
      if (!free(e)) continue
      const match = ordersMatch(c, e)
      if (!match) continue
      const candidateFees = match.candidateFees ? c.fees.filter((f) => !used.has(f.id)) : []
      for (const t of [...c.rows, ...e.rows, ...candidateFees]) used.add(t.id)
      result.push({ candidates: c.rows, candidateFees, existing: e.rows })
      break
    }
  }
  return result
}

/**
 * Pair each candidate trade with its likely duplicate, if any: the first
 * existing row of the order it matches (see {@link findDuplicateTradeGroups}).
 * Every fill of a matched order is in the map. Fee rows are not.
 */
export function findDuplicateTrades(
  candidates: Transaction[],
  existing: Transaction[],
): Map<string, Transaction> {
  const matches = new Map<string, Transaction>()
  for (const d of findDuplicateTradeGroups(candidates, existing)) {
    for (const t of d.candidates) matches.set(t.id, d.existing[0])
  }
  return matches
}

// ─────────────────────────────────────────
// Sales already recorded with Close position
// ─────────────────────────────────────────

/** Whole days between two stored dates, by the day each is stored on. */
function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / DATE_TOLERANCE_MS
}

/**
 * Pair each imported sale with a sale Close position recorded by hand for the
 * same holding, if any: same account, same ticker, the same quantity, and a
 * day at most one apart (the person picks the day in their own time zone; the
 * file's day is UTC).
 *
 * The amount is not compared. Close position stores the proceeds after the
 * fee, and the person may have typed a rounded figure, while the file has the
 * gross proceeds. Each hand-recorded sale matches at most one imported sale.
 */
export function findClosedByHandSales(
  candidates: Transaction[],
  existing: Transaction[],
): Map<string, Transaction> {
  const closes = existing.filter(isCloseSale)
  const matches = new Map<string, Transaction>()
  if (closes.length === 0) return matches
  const consumed = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.type !== 'sell' || candidate.quantity == null) continue
    const ticker = resolveTransactionTicker(candidate)
    if (!ticker) continue
    const match = closes.find((t) =>
      !consumed.has(t.id) &&
      t.accountId === candidate.accountId &&
      t.quantity != null &&
      Math.abs(t.quantity - candidate.quantity!) <= QTY_EPSILON &&
      resolveTransactionTicker(t) === ticker &&
      dayGap(t.date, candidate.date) <= 1,
    )
    if (match) {
      matches.set(candidate.id, match)
      consumed.add(match.id)
    }
  }
  return matches
}
