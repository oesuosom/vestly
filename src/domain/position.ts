import type { Transaction } from '@/types'
import type { TradeFees } from './tradeFees'

/**
 * The state of one position — one ticker in one account — after walking its
 * transactions in date order.
 *
 * This is the single definition of "position": cost basis and realized profit
 * come out of the same walk, so they cannot disagree. New facts about a
 * position become new fields here rather than a second walk somewhere else.
 */
export type Position = {
  /** Units still held. Never negative. */
  quantity: number
  /** What the units still held cost, in PLN. */
  costPLN: number
  /** `costPLN / quantity`, or 0 when nothing is held. */
  averageCostPLN: number
  /**
   * Profit (+) or loss (−) on every sale so far, in PLN: what the sales brought
   * in, minus the average cost of the units they removed. Counted only on units
   * the log explains — see `unexplainedQuantity`.
   */
  realizedProfitPLN: number
  /**
   * Units sold or sent that the log never recorded coming in. Above zero means
   * the history is incomplete (a buy is missing), so `realizedProfitPLN` leaves
   * those units out: their cost is unknown.
   */
  unexplainedQuantity: number
}

/**
 * Below this many units a position counts as closed. Crypto quantities go
 * down to 1e-8 (one satoshi), so anything smaller is floating-point residue
 * from adding and subtracting fractional quantities, not a real remainder.
 */
const QUANTITY_EPSILON = 1e-9

/** Units a transaction adds to (+) or removes from (−) the position. */
function quantityDelta(t: Transaction): number {
  const quantity = t.quantity ?? 0
  if (t.type === 'buy' || t.type === 'receive') return quantity
  if (t.type === 'sell' || t.type === 'send') return -quantity
  return 0
}

/**
 * Sort key for the walk. Dates are stored either date-only ("2026-02-10", XTB
 * Cash Operations) or as a full ISO timestamp ("2026-02-10T10:59:02.277Z"), and
 * one position can mix both. A plain string sort puts every date-only row
 * before the same day's timestamped rows, so a date-only sale would run before
 * the timestamped buy that funded it and be dropped as "nothing to sell".
 *
 * Within one calendar day (the first ten characters, as stored) the order is:
 *   0. date-only buys and receives — time unknown, assumed to come first
 *   1. timestamped rows, in time order
 *   2. date-only sells and sends   — time unknown, assumed to come last
 * Rows that still tie — the same timestamp, or several date-only rows on the
 * same side — put inflows before outflows and otherwise keep their input order.
 *
 * So when the time of day is unknown, a sale never runs before a same-day buy.
 * The only same-day sequence this gets wrong is "sell, then buy back" recorded
 * without times, which is read as "buy, then sell"; quantity is the same either
 * way, and the cost differs only if the buy-back price differs from the average.
 */
function sortKey(t: Transaction): { day: string; rank: number; time: string; side: number } {
  const day = t.date.slice(0, 10)
  const time = t.date.slice(10)
  const side = quantityDelta(t) < 0 ? 1 : 0
  const rank = time ? 1 : side === 0 ? 0 : 2
  return { day, rank, time, side }
}

function compareForWalk(a: Transaction, b: Transaction): number {
  const ka = sortKey(a)
  const kb = sortKey(b)
  if (ka.day !== kb.day) return ka.day < kb.day ? -1 : 1
  if (ka.rank !== kb.rank) return ka.rank - kb.rank
  if (ka.time !== kb.time) return ka.time < kb.time ? -1 : 1
  return ka.side - kb.side
}

const NO_FEES: TradeFees = new Map()

/**
 * Walk one position's transactions in date order using the average-cost method.
 *
 * `transactions` must already be narrowed to **one account and one ticker** —
 * the walk does no filtering of its own, so mixing accounts or tickers here
 * mixes their costs. `calculateAverageCostBasis` and `getPositions` do that
 * narrowing. The input may be in any order and is not modified.
 *
 * `tradeFees` holds fees that are stored apart from their trade (Revolut; see
 * `pairTradeFees`). Without it every trade's amount is taken as it stands.
 * A transaction's own `feePLN` is never read here: it is already inside
 * `amountPLN` (Close position stores it for display only).
 *
 * Rules:
 * - **buy** adds its quantity and its cost: `|amountPLN|` plus its fee. The
 *   fee is part of what the units cost, so it stays with them until they go.
 * - **receive** (inbound crypto transfer) adds its quantity and its recorded
 *   cost basis. A receive stored with `amountPLN: 0` (cost unknown) adds units
 *   at zero cost, which lowers the average.
 * - **sell** and **send** remove quantity at the current average, so the
 *   per-unit cost of what is left does not change.
 * - **sell** also realizes profit: its proceeds (`amountPLN` minus its fee)
 *   minus the cost of the units it removed. A **send** realizes nothing — the
 *   units left, but nothing was received for them.
 * - When the quantity reaches zero the pool resets: a later buy starts a new
 *   position at its own price.
 * - Selling or sending more than is held (incomplete history) closes the
 *   position. The excess is not carried as a negative quantity; it is added to
 *   `unexplainedQuantity`. A sale's profit is then counted on the held units
 *   only, with the same share of its proceeds: selling 10 for 1,000 PLN while
 *   holding 1 realizes 100 PLN minus that unit's cost, not 1,000.
 * - Rows without a quantity, and every other transaction type (dividends,
 *   fees, …), leave the position unchanged.
 *
 * Same-day ordering is described on {@link sortKey}.
 */
export function walkPosition(transactions: Transaction[], tradeFees: TradeFees = NO_FEES): Position {
  return walk(transactions, tradeFees)
}

/** What one sale realized, as `walkPosition` counted it. */
export type SaleResult = {
  /** What the sale brought in, after its fee, for the units the log explains. */
  proceedsPLN: number
  /** The average cost of the units the sale removed. */
  costPLN: number
  /** `proceedsPLN − costPLN`: this sale's share of `realizedProfitPLN`. */
  profitPLN: number
}

/**
 * The same walk as {@link walkPosition}, reporting each sale on its own, keyed
 * by transaction `id`. The profits add up to the position's
 * `realizedProfitPLN` exactly, so a figure shown for one sale (the Closed
 * positions row) can never disagree with the realized total on Overview.
 * Takes the same input, narrowed to one account and one ticker.
 */
export function walkSales(transactions: Transaction[], tradeFees: TradeFees = NO_FEES): Map<string, SaleResult> {
  const sales = new Map<string, SaleResult>()
  walk(transactions, tradeFees, (id, result) => sales.set(id, result))
  return sales
}

/**
 * The same walk again, reporting each sale that empties the position, keyed by
 * its `id`, with the results of every sale since the position last opened
 * added together (that sale included). A position sold in three parts reads
 * as one close: the three proceeds, costs and profits summed.
 */
export function walkClosingSales(transactions: Transaction[], tradeFees: TradeFees = NO_FEES): Map<string, SaleResult> {
  const closes = new Map<string, SaleResult>()
  let cycle: SaleResult | null = null
  walk(
    transactions,
    tradeFees,
    (_id, result) => {
      cycle = {
        proceedsPLN: (cycle?.proceedsPLN ?? 0) + result.proceedsPLN,
        costPLN: (cycle?.costPLN ?? 0) + result.costPLN,
        profitPLN: (cycle?.profitPLN ?? 0) + result.profitPLN,
      }
    },
    (t) => {
      if (cycle && t.type === 'sell') closes.set(t.id, cycle)
      cycle = null
    },
  )
  return closes
}

function walk(
  transactions: Transaction[],
  tradeFees: TradeFees,
  onSale?: (id: string, result: SaleResult) => void,
  /** Called after an outflow that leaves nothing held. */
  onEmptied?: (t: Transaction) => void,
): Position {
  let quantity = 0
  let costPLN = 0
  let realizedProfitPLN = 0
  let unexplainedQuantity = 0

  for (const t of [...transactions].sort(compareForWalk)) {
    const delta = quantityDelta(t)
    const feePLN = tradeFees.get(t.id) ?? 0
    if (delta > 0) {
      quantity += delta
      costPLN += Math.abs(t.amountPLN) + (t.type === 'buy' ? feePLN : 0)
    } else if (delta < 0) {
      const leaving = -delta
      const removed = Math.min(leaving, quantity)
      const removedCostPLN = quantity > 0 ? (costPLN / quantity) * removed : 0
      // A shortfall below the epsilon is floating-point residue, not missing history.
      const unexplained = leaving - removed < QUANTITY_EPSILON ? 0 : leaving - removed
      unexplainedQuantity += unexplained

      if (t.type === 'sell') {
        const explainedShare = (leaving - unexplained) / leaving
        const proceedsPLN = (t.amountPLN - feePLN) * explainedShare
        realizedProfitPLN += proceedsPLN - removedCostPLN
        onSale?.(t.id, { proceedsPLN, costPLN: removedCostPLN, profitPLN: proceedsPLN - removedCostPLN })
      }

      costPLN -= removedCostPLN
      quantity -= removed
      if (quantity < QUANTITY_EPSILON) {
        quantity = 0
        costPLN = 0
        onEmptied?.(t)
      }
    }
  }

  return {
    quantity,
    costPLN,
    averageCostPLN: quantity === 0 ? 0 : costPLN / quantity,
    realizedProfitPLN,
    unexplainedQuantity,
  }
}
