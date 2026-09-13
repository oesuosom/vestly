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

/**
 * Pair each candidate with its likely duplicate, if any.
 *
 * Already-matched existing transactions are not reused, so two identical trades
 * on the same day (a real scenario when an order fills in parts) can only match
 * two distinct existing rows — never the same one twice.
 */
export function findDuplicateTrades(
  candidates: Transaction[],
  existing: Transaction[],
): Map<string, Transaction> {
  const matches = new Map<string, Transaction>()
  const consumed = new Set<string>()

  for (const candidate of candidates) {
    const pool = existing.filter((t) => !consumed.has(t.id))
    const match = findDuplicateTrade(candidate, pool)
    if (match) {
      matches.set(candidate.id, match)
      consumed.add(match.id)
    }
  }
  return matches
}
