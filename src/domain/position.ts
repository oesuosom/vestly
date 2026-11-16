import type { Transaction } from '@/types'

/**
 * The state of one position — one ticker in one account — after walking its
 * transactions in date order.
 *
 * This is the single definition of "position" for cost basis, and the place
 * realized profit will be added, so new facts about a position become new
 * fields here rather than a second walk somewhere else.
 */
export type Position = {
  /** Units still held. Never negative. */
  quantity: number
  /** What the units still held cost, in PLN. */
  costPLN: number
  /** `costPLN / quantity`, or 0 when nothing is held. */
  averageCostPLN: number
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

/**
 * Walk one position's transactions in date order using the average-cost method.
 *
 * `transactions` must already be narrowed to **one account and one ticker** —
 * the walk does no filtering of its own, so mixing accounts or tickers here
 * mixes their costs. `calculateAverageCostBasis` does that narrowing. The input
 * may be in any order and is not modified.
 *
 * Rules:
 * - **buy** adds its quantity and its cost (`|amountPLN|`).
 * - **receive** (inbound crypto transfer) adds its quantity and its recorded
 *   cost basis. A receive stored with `amountPLN: 0` (cost unknown) adds units
 *   at zero cost, which lowers the average.
 * - **sell** and **send** remove quantity at the current average, so the
 *   per-unit cost of what is left does not change.
 * - When the quantity reaches zero the pool resets: a later buy starts a new
 *   position at its own price.
 * - Selling or sending more than is held (incomplete history) closes the
 *   position; the excess is ignored rather than carried as a negative quantity.
 * - Rows without a quantity, and every other transaction type (dividends,
 *   fees, …), leave the position unchanged.
 *
 * Same-day ordering is described on {@link sortKey}.
 */
export function walkPosition(transactions: Transaction[]): Position {
  let quantity = 0
  let costPLN = 0

  for (const t of [...transactions].sort(compareForWalk)) {
    const delta = quantityDelta(t)
    if (delta > 0) {
      quantity += delta
      costPLN += Math.abs(t.amountPLN)
    } else if (delta < 0 && quantity > 0) {
      const removed = Math.min(-delta, quantity)
      costPLN -= (costPLN / quantity) * removed
      quantity -= removed
      if (quantity < QUANTITY_EPSILON) {
        quantity = 0
        costPLN = 0
      }
    }
  }

  if (quantity === 0) return { quantity: 0, costPLN: 0, averageCostPLN: 0 }
  return { quantity, costPLN, averageCostPLN: costPLN / quantity }
}
