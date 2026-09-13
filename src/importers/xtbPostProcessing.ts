import { calculateAverageCostBasis } from '@/domain/calculations'
import type { Account, AssetCategory, InstrumentAlias, Transaction } from '@/types'
import { staticLookupInstrument } from '@/domain/instrumentLookup'

// ─────────────────────────────────────────
// Cost-basis diff computation
// ─────────────────────────────────────────

export type CostBasisDiffRow = {
  holdingId: string
  holdingName: string
  ticker: string
  currentPricePLN: number    // existing purchasePrice before recalculation
  calculatedPricePLN: number // weighted average from buy transactions
  quantity: number
}

/**
 * For each non-synthetic holding with a ticker in the given account, compute
 * the weighted-average cost from that account's buy transactions. Returns only
 * rows where the calculated value differs from the stored purchasePrice
 * (±0.001 PLN tolerance).
 *
 * Scoped to a single account so that holdings and transactions from other
 * accounts (e.g. BTC in a crypto account) are never pulled into an XTB import.
 */
export function computeCostBasisDiff(
  accounts: Account[],
  transactions: Transaction[],
  accountId: string,
): CostBasisDiffRow[] {
  const account = accounts.find(a => a.id === accountId)
  if (!account) return []

  // Only consider buy transactions belonging to this account.
  const accountTransactions = transactions.filter(t => t.accountId === accountId)

  const rows: CostBasisDiffRow[] = []
  for (const h of account.holdings) {
    if (h.isSynthetic) continue
    if (!h.ticker) continue
    const { averageCostPLN, totalQuantity } = calculateAverageCostBasis(accountTransactions, h.ticker)
    if (totalQuantity === 0) continue
    if (Math.abs(averageCostPLN - h.purchasePrice) < 0.001) continue
    rows.push({
      holdingId: h.id,
      holdingName: h.name,
      ticker: h.ticker,
      currentPricePLN: h.purchasePrice,
      calculatedPricePLN: averageCostPLN,
      quantity: h.quantity,
    })
  }
  return rows
}

// ─────────────────────────────────────────
// Unmatched instruments computation
// ─────────────────────────────────────────

export type UnmatchedRow = {
  instrument: string          // XTB instrument name
  ticker: string              // resolved ticker
  exchange?: string           // resolved exchange (e.g. 'US', 'PL') from transaction data
  totalQuantity: number       // sum of all buy quantities
  avgCostPLN: number          // weighted average cost per unit in PLN
  earliestDate: string        // YYYY-MM-DD of the earliest buy transaction
  suggestedCategory?: AssetCategory  // from static lookup or user aliases
}

export type UnresolvedRow = {
  instrument: string          // XTB instrument name (no ticker could be determined)
  totalQuantity: number
  avgCostPLN: number
  earliestDate: string        // YYYY-MM-DD of the earliest buy transaction
}

type UnmatchedResult = {
  matched: UnmatchedRow[]     // buy txns with a resolved ticker, no existing holding
  unresolved: UnresolvedRow[] // buy txns where ticker is unknown entirely
}

/** Resolve an instrument name via user aliases then static lookup. */
function resolveInstrumentName(
  name: string,
  aliases?: Record<string, InstrumentAlias>
): { ticker: string; exchange?: string; category?: AssetCategory; canonicalName?: string } | undefined {
  if (aliases) {
    // Try exact key first, then lowercase
    const hit = aliases[name] ?? aliases[name.toLowerCase()]
    if (hit) return hit
  }
  return staticLookupInstrument(name)
}

/**
 * From the merged buy transactions for a given account, find instruments
 * whose ticker does NOT already have a matching holding in the account.
 * Groups by ticker (matched) or by instrument name (unresolved, no ticker).
 * Sums quantities and computes weighted average cost for each group.
 *
 * When a buy transaction has no ticker, the instrument name is checked against
 * user-defined aliases and the built-in static lookup so that previously
 * imported transactions are resolved retroactively.
 */
export function computeUnmatchedInstruments(
  transactions: Transaction[],
  accounts: Account[],
  accountId: string,
  instrumentAliases?: Record<string, InstrumentAlias>
): UnmatchedResult {
  // Build a set of tickers already held in this account, plus a name→ticker
  // map mirroring the parser's holdingNameMap. This is needed for buy-only
  // instruments (e.g. XTB stock) whose stored transactions have ticker=undefined
  // because they were imported before the holding was created — we can still
  // match them by holding name and skip them.
  const account = accounts.find(a => a.id === accountId)
  const existingTickers = new Set<string>()
  const holdingNameMap = new Map<string, string>()
  if (account) {
    for (const h of account.holdings) {
      if (h.ticker) existingTickers.add(h.ticker.toUpperCase())
      if (h.ticker) holdingNameMap.set(h.name.toLowerCase(), h.ticker.toUpperCase())
    }
  }

  type Agg = {
    instrument: string
    totalCost: number
    totalQty: number
    exchange?: string
    earliestDate: string
    suggestedCategory?: AssetCategory
  }

  // Ticker-resolved buys with no existing holding
  const byTicker = new Map<string, Agg>()
  // Buys where no ticker was resolved at all
  const byInstrument = new Map<string, Agg>()

  for (const t of transactions) {
    if (t.type !== 'buy') continue
    if (t.accountId !== accountId) continue

    // Determine effective ticker: from transaction, or via alias/static lookup on instrument name.
    // Always attempt resolution to get suggestedCategory even when ticker is already stored.
    let effectiveTicker = t.ticker
    let effectiveExchange = t.exchange
    let suggestedCategory: AssetCategory | undefined
    let canonicalName: string | undefined

    if (t.instrument) {
      const resolved = resolveInstrumentName(t.instrument, instrumentAliases)
      if (resolved) {
        if (!effectiveTicker) {
          effectiveTicker = resolved.ticker
          effectiveExchange = resolved.exchange
        }
        suggestedCategory = resolved.category
        canonicalName = resolved.canonicalName
      }
    }

    // Fallback: resolve ticker via existing holding names, same as the parser does.
    // Covers buy-only instruments whose stored transactions have ticker=undefined
    // because they were first imported before the holding was manually created.
    if (!effectiveTicker && t.instrument) {
      const fromHolding = holdingNameMap.get(t.instrument.toLowerCase())
      if (fromHolding) effectiveTicker = fromHolding
    }

    if (!effectiveTicker) {
      // Truly unresolved — collect by instrument name
      const key = t.instrument ?? ''
      if (!key) continue
      const prev = byInstrument.get(key)
      if (prev) {
        prev.totalCost += Math.abs(t.amountPLN)
        prev.totalQty  += t.quantity ?? 0
        if (t.date < prev.earliestDate) prev.earliestDate = t.date
      } else {
        byInstrument.set(key, {
          instrument: key,
          totalCost: Math.abs(t.amountPLN),
          totalQty:  t.quantity ?? 0,
          earliestDate: t.date,
        })
      }
      continue
    }

    const key = effectiveTicker.toUpperCase()
    if (existingTickers.has(key)) continue  // already has a holding

    const prev = byTicker.get(key)
    if (prev) {
      prev.totalCost += Math.abs(t.amountPLN)
      prev.totalQty  += t.quantity ?? 0
      if (t.date < prev.earliestDate) prev.earliestDate = t.date
      if (!prev.suggestedCategory && suggestedCategory) prev.suggestedCategory = suggestedCategory
    } else {
      byTicker.set(key, {
        instrument: canonicalName ?? t.instrument ?? effectiveTicker,
        totalCost: Math.abs(t.amountPLN),
        totalQty:  t.quantity ?? 0,
        exchange:  effectiveExchange,
        earliestDate: t.date,
        suggestedCategory,
      })
    }
  }

  const matched: UnmatchedRow[] = [...byTicker.entries()]
    .filter(([, agg]) => agg.totalQty > 0)
    .map(([ticker, agg]) => ({
      instrument: agg.instrument,
      ticker,
      exchange: agg.exchange,
      totalQuantity: agg.totalQty,
      avgCostPLN: agg.totalCost / agg.totalQty,
      earliestDate: agg.earliestDate.slice(0, 10),
      suggestedCategory: agg.suggestedCategory,
    }))

  const unresolved: UnresolvedRow[] = [...byInstrument.values()]
    .filter(agg => agg.totalQty > 0)
    .map(agg => ({
      instrument: agg.instrument,
      totalQuantity: agg.totalQty,
      avgCostPLN: agg.totalCost / agg.totalQty,
      earliestDate: agg.earliestDate.slice(0, 10),
    }))

  return { matched, unresolved }
}
