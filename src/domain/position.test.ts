import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { walkPosition } from './position'

// ─── Helpers ───────────────────────────────────────────────────────────────────

let nextId = 0

/** One transaction of a single position (same account, same ticker). */
function tx(
  type: Transaction['type'],
  date: string,
  quantity: number | undefined,
  amountPLN: number,
): Transaction {
  const id = `t${++nextId}`
  return {
    id,
    accountId: 'acc1',
    type,
    date,
    amountPLN,
    ticker: 'XYZ',
    quantity,
    externalId: id,
    source: 'manual',
    createdAt: '2025-01-01T00:00:00.000Z',
  }
}

// ─── walkPosition ──────────────────────────────────────────────────────────────

describe('walkPosition', () => {
  it('returns an empty position when there are no transactions', () => {
    expect(walkPosition([])).toEqual({ quantity: 0, costPLN: 0, averageCostPLN: 0 })
  })

  it('averages buys by quantity', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000), // 100 each
      tx('buy', '2025-02-10', 10, -1200), // 120 each
    ])
    expect(position).toEqual({ quantity: 20, costPLN: 2200, averageCostPLN: 110 })
  })

  it('uses the rebuy price after everything was sold', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('sell', '2025-02-10', 10, 1500),
      tx('buy', '2025-03-10', 10, -2000),
    ])
    // The first 10 units and their 1,000 PLN left with the sale.
    expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
  })

  it('leaves the average cost unchanged after a partial sale', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('buy', '2025-02-10', 10, -1200), // 20 units, 2,200 PLN, average 110
      tx('sell', '2025-03-10', 5, 900),   // removes 5 × 110 = 550
    ])
    expect(position).toEqual({ quantity: 15, costPLN: 1650, averageCostPLN: 110 })
  })

  it('blends a buy made after a partial sale into the remaining pool', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('buy', '2025-02-10', 10, -1200),
      tx('sell', '2025-03-10', 5, 900),   // 15 units, 1,650 PLN
      tx('buy', '2025-04-10', 5, -950),   // 20 units, 2,600 PLN
    ])
    expect(position).toEqual({ quantity: 20, costPLN: 2600, averageCostPLN: 130 })
  })

  it('ignores the sale proceeds: only the average cost leaves the pool', () => {
    const cheap = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('sell', '2025-02-10', 4, 1)])
    const dear = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('sell', '2025-02-10', 4, 99999)])
    expect(cheap).toEqual({ quantity: 6, costPLN: 600, averageCostPLN: 100 })
    expect(dear).toEqual(cheap)
  })

  it('handles crypto transfers: receive adds quantity and cost, send removes at the average', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10T09:00:00.000Z', 1, -100000),
      tx('receive', '2025-02-10T09:00:00.000Z', 0.5, 20000), // 1.5 BTC, 120,000 PLN, average 80,000
      tx('sell', '2025-03-10T09:00:00.000Z', 0.2, 30000),    // removes 16,000
      tx('send', '2025-04-10T09:00:00.000Z', 0.1, 0),        // removes 8,000
    ])
    expect(position.quantity).toBeCloseTo(1.2, 10)
    expect(position.costPLN).toBeCloseTo(96000, 6)
    expect(position.averageCostPLN).toBeCloseTo(80000, 6)
  })

  it('adds a receive with unknown cost (amountPLN 0) at zero cost', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 1, -100000),
      tx('receive', '2025-02-10', 1, 0),
    ])
    expect(position).toEqual({ quantity: 2, costPLN: 100000, averageCostPLN: 50000 })
  })

  it('resets the pool when a send empties the position', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 1, -100000),
      tx('send', '2025-02-10', 1, 0),
      tx('buy', '2025-03-10', 2, -300000),
    ])
    expect(position).toEqual({ quantity: 2, costPLN: 300000, averageCostPLN: 150000 })
  })

  it('closes the position without floating-point residue', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; the leftover must not survive as a holding.
    const position = walkPosition([
      tx('buy', '2025-01-10', 0.1, -10),
      tx('buy', '2025-02-10', 0.2, -20),
      tx('sell', '2025-03-10', 0.3, 45),
    ])
    expect(position).toEqual({ quantity: 0, costPLN: 0, averageCostPLN: 0 })
  })

  it('closes the position when more is sold than held, then starts fresh', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 5, -500),
      tx('sell', '2025-02-10', 8, 1200),  // history is incomplete: only 5 were held
      tx('buy', '2025-03-10', 2, -300),
    ])
    expect(position).toEqual({ quantity: 2, costPLN: 300, averageCostPLN: 150 })
  })

  it('ignores a sale made before anything was bought', () => {
    const position = walkPosition([
      tx('sell', '2025-01-10', 5, 700),
      tx('buy', '2025-02-10', 10, -1000),
    ])
    expect(position).toEqual({ quantity: 10, costPLN: 1000, averageCostPLN: 100 })
  })

  it('ignores transaction types that do not move units, and rows without a quantity', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('dividend', '2025-02-10', undefined, 50),
      tx('fee', '2025-02-11', undefined, -5),
      tx('buy', '2025-02-12', undefined, -400), // malformed: no quantity
      tx('sell', '2025-02-13', undefined, 400), // malformed: no quantity
    ])
    expect(position).toEqual({ quantity: 10, costPLN: 1000, averageCostPLN: 100 })
  })

  it('walks in date order whatever order the transactions arrive in', () => {
    const position = walkPosition([
      tx('buy', '2025-03-10', 10, -2000),
      tx('sell', '2025-02-10', 10, 1500),
      tx('buy', '2025-01-10', 10, -1000),
    ])
    expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
  })

  it('does not modify or reorder its input', () => {
    const transactions = [tx('buy', '2025-03-10', 10, -2000), tx('buy', '2025-01-10', 10, -1000)]
    const snapshot = structuredClone(transactions)
    walkPosition(transactions)
    expect(transactions).toEqual(snapshot)
  })

  describe('same-day ordering', () => {
    it('runs a date-only sale after the same-day timestamped buy that funded it', () => {
      // As plain strings "2026-02-10" sorts before "2026-02-10T10:59:02.277Z".
      const position = walkPosition([
        tx('sell', '2026-02-10', 10, 1500),
        tx('buy', '2026-02-10T10:59:02.277Z', 10, -1000),
        tx('buy', '2026-03-10', 10, -2000),
      ])
      expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('runs a date-only buy before a same-day timestamped sale', () => {
      const position = walkPosition([
        tx('sell', '2026-02-10T08:00:00.000Z', 10, 1500),
        tx('buy', '2026-02-10', 10, -1000),
        tx('buy', '2026-03-10', 10, -2000),
      ])
      expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('runs date-only buys before date-only sales on the same day', () => {
      const position = walkPosition([
        tx('sell', '2026-02-10', 10, 1500),
        tx('buy', '2026-02-10', 10, -1000),
        tx('buy', '2026-03-10', 10, -2000),
      ])
      expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('keeps timestamped trades in time order, including sell-then-rebuy', () => {
      const position = walkPosition([
        tx('buy', '2026-02-09T10:00:00.000Z', 10, -1000),
        tx('buy', '2026-02-10T15:00:00.000Z', 10, -2000),
        tx('sell', '2026-02-10T09:00:00.000Z', 10, 1500),
      ])
      // Sold the first lot in the morning, bought back at 200 in the afternoon.
      expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('puts the buy first when a buy and a sale share a timestamp', () => {
      const position = walkPosition([
        tx('sell', '2026-02-10T09:00:00.000Z', 10, 1500),
        tx('buy', '2026-02-10T09:00:00.000Z', 10, -1000),
      ])
      expect(position).toEqual({ quantity: 0, costPLN: 0, averageCostPLN: 0 })
    })

    it('never lets an earlier day be overtaken by a later one', () => {
      const position = walkPosition([
        tx('sell', '2026-02-11', 10, 1500),
        tx('buy', '2026-02-10T23:59:59.999Z', 10, -1000),
        tx('buy', '2026-02-12T00:00:00.000Z', 10, -2000),
      ])
      expect(position).toEqual({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })
  })
})
