import { calculateAverageCostBasis } from '@/domain/calculations'
import type { Account, AssetCategory, InstrumentAlias, Transaction, TransactionType } from '@/types'
import { staticLookupInstrument } from '@/domain/instrumentLookup'
import { walkPosition } from '@/domain/position'
import { pairTradeFees, type TradeFees } from '@/domain/tradeFees'

// ─────────────────────────────────────────
// Cost-basis diff computation
// ─────────────────────────────────────────

export type CostBasisDiffRow = {
  holdingId: string
  holdingName: string
  ticker: string
  currentPricePLN: number    // existing purchasePrice before recalculation
  calculatedPricePLN: number // average cost of the units still held
  quantity: number
}

/**
 * For each non-synthetic holding with a ticker in the given account, compute
 * the average cost of the units still held, from that account's transactions
 * (see calculateAverageCostBasis). Returns only
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

  const rows: CostBasisDiffRow[] = []
  for (const h of account.holdings) {
    if (h.isSynthetic) continue
    if (!h.ticker) continue
    const { averageCostPLN, quantity } = calculateAverageCostBasis(transactions, accountId, h.ticker)
    if (quantity === 0) continue  // no open position in the log, nothing to propose
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
  totalQuantity: number       // units still held, per the position walk
  avgCostPLN: number          // average cost per unit of those units, in PLN
  earliestDate: string        // YYYY-MM-DD of the first buy of the units still held
  suggestedCategory?: AssetCategory  // from static lookup or user aliases
}

export type UnresolvedRow = {
  instrument: string          // XTB instrument name (no ticker could be determined)
  totalQuantity: number       // units still held, per the position walk
  avgCostPLN: number
  earliestDate: string        // YYYY-MM-DD of the first buy of the units still held
}

type UnmatchedResult = {
  matched: UnmatchedRow[]     // still-held instruments with a resolved ticker, no existing holding
  unresolved: UnresolvedRow[] // still-held instruments whose ticker is unknown entirely
}

/** Rows that move units, and so make up a position. */
const TRADE_TYPES: ReadonlySet<TransactionType> = new Set(['buy', 'sell', 'send', 'receive'])

/**
 * What is still held of one instrument's trades: the position walk's quantity
 * and average cost (see `walkPosition`), and the day of the first buy since
 * the position last went to zero — the purchase date of the units left.
 * Null when nothing is held, e.g. everything was sold or the holding was closed.
 */
function stillHeld(
  rows: Transaction[],
  tradeFees: TradeFees,
): { quantity: number; averageCostPLN: number; earliestDate: string } | null {
  const { quantity, averageCostPLN } = walkPosition(rows, tradeFees)
  if (quantity === 0) return null

  // The latest day the position stood at zero; the units held now were bought after it.
  const days = [...new Set(rows.map((t) => t.date.slice(0, 10)))].sort()
  let resetDay = ''
  for (const day of days) {
    if (walkPosition(rows.filter((t) => t.date.slice(0, 10) <= day), tradeFees).quantity === 0) resetDay = day
  }
  const inflowDays = rows
    .filter((t) => (t.type === 'buy' || t.type === 'receive') && t.date.slice(0, 10) > resetDay)
    .map((t) => t.date.slice(0, 10))
    .sort()
  return { quantity, averageCostPLN, earliestDate: inflowDays[0] ?? days[0] }
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
 * From the merged transactions for a given account, find instruments that are
 * still held according to the log but have no matching holding in the account.
 * Groups by ticker (matched) or by instrument name (unresolved, no ticker),
 * and walks each group's buys, sales and transfers as one position, so an
 * instrument sold out — or a holding marked as sold with Close position — is
 * not proposed again, and a partly sold one is proposed at the units left and
 * their average cost.
 *
 * When a transaction has no ticker, the instrument name is checked against
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

  type Group = {
    instrument: string
    rows: Transaction[]
    exchange?: string
    suggestedCategory?: AssetCategory
  }

  // Ticker-resolved trades with no existing holding
  const byTicker = new Map<string, Group>()
  // Trades where no ticker was resolved at all
  const byInstrument = new Map<string, Group>()

  for (const t of transactions) {
    if (!TRADE_TYPES.has(t.type)) continue
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
      if (prev) prev.rows.push(t)
      else byInstrument.set(key, { instrument: key, rows: [t] })
      continue
    }

    const key = effectiveTicker.toUpperCase()
    if (existingTickers.has(key)) continue  // already has a holding

    const prev = byTicker.get(key)
    if (prev) {
      prev.rows.push(t)
      if (!prev.suggestedCategory && suggestedCategory) prev.suggestedCategory = suggestedCategory
      if (!prev.exchange && effectiveExchange) prev.exchange = effectiveExchange
    } else {
      byTicker.set(key, {
        instrument: canonicalName ?? t.instrument ?? effectiveTicker,
        rows: [t],
        exchange:  effectiveExchange,
        suggestedCategory,
      })
    }
  }

  const tradeFees = pairTradeFees(transactions.filter(t => t.accountId === accountId))

  const matched: UnmatchedRow[] = []
  for (const [ticker, group] of byTicker) {
    const held = stillHeld(group.rows, tradeFees)
    if (!held) continue
    matched.push({
      instrument: group.instrument,
      ticker,
      exchange: group.exchange,
      totalQuantity: held.quantity,
      avgCostPLN: held.averageCostPLN,
      earliestDate: held.earliestDate,
      suggestedCategory: group.suggestedCategory,
    })
  }

  const unresolved: UnresolvedRow[] = []
  for (const group of byInstrument.values()) {
    const held = stillHeld(group.rows, tradeFees)
    if (!held) continue
    unresolved.push({
      instrument: group.instrument,
      totalQuantity: held.quantity,
      avgCostPLN: held.averageCostPLN,
      earliestDate: held.earliestDate,
    })
  }

  return { matched, unresolved }
}
