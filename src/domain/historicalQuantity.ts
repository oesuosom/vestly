import type { Holding, Transaction } from '@/types'
import { staticLookupInstrument } from './instrumentLookup'

/**
 * Compute the quantity of a holding actually held at a given date,
 * reconstructed from imported transaction history.
 *
 * If no transactions match this holding (e.g. manually-entered holding
 * with no import history), falls back to `holding.quantity`.
 *
 * Matching rules (in priority order):
 *   1. ticker match (case-insensitive) within the same account
 *   2. instrument name match within the same account
 */
export function quantityAtDate(
  holding: Holding,
  accountId: string,
  transactions: Transaction[],
  date: string,
): number {
  const relevant = transactions.filter((t) => {
    if (t.accountId !== accountId) return false
    if (t.date.slice(0, 10) > date) return false

    // Bond buy transactions carry an explicit holdingId — match only to their own holding.
    // Without this, two bond holdings with the same name (e.g. two ED00535 series purchased
    // in different months) both pick up all transactions for that name, inflating quantities.
    if (t.source === 'bond_holding' && t.relatedHoldingId) {
      return t.relatedHoldingId === holding.id
    }

    // Primary: match by ticker
    if (holding.ticker && t.ticker) {
      return t.ticker.toUpperCase() === holding.ticker.toUpperCase()
    }

    // Secondary: holding has ticker but transaction pre-dates ticker resolution —
    // resolve instrument name → ticker via static lookup (same map used by xtbParser)
    if (holding.ticker && !t.ticker && t.instrument) {
      const resolved = staticLookupInstrument(t.instrument)
      if (resolved) {
        return resolved.ticker.toUpperCase() === holding.ticker.toUpperCase()
      }
    }

    // Fallback: match by instrument name
    if (t.instrument && holding.name) {
      const inst = t.instrument.toLowerCase()
      const name = holding.name.toLowerCase()
      return inst === name || inst.includes(name) || name.includes(inst)
    }

    return false
  })

  // No matching transactions → use the holding's recorded quantity as-is
  if (relevant.length === 0) return holding.quantity

  const qty = relevant.reduce((sum, t) => {
    if (t.type === 'buy' || t.type === 'receive') return sum + (t.quantity ?? 0)
    if (t.type === 'sell' || t.type === 'send') return sum - (t.quantity ?? 0)
    return sum
  }, 0)

  // If qty is negative, transaction history is incomplete (e.g. sells imported
  // without the corresponding buys). Fall back to the holding's recorded quantity
  // rather than clamping to zero and showing a false gap in the chart.
  if (qty < 0) return holding.quantity

  return qty
}
