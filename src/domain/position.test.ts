import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { walkPosition, walkSales } from './position'
import type { TradeFees } from './tradeFees'

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

/** Fees keyed by the trade they were charged on, as `pairTradeFees` returns them. */
function feesFor(...pairs: [Transaction, number][]): TradeFees {
  return new Map(pairs.map(([trade, feePLN]) => [trade.id, feePLN]))
}

// ─── walkPosition ──────────────────────────────────────────────────────────────

describe('walkPosition', () => {
  it('returns an empty position when there are no transactions', () => {
    expect(walkPosition([])).toEqual({
      quantity: 0,
      costPLN: 0,
      averageCostPLN: 0,
      realizedProfitPLN: 0,
      unexplainedQuantity: 0,
    })
  })

  it('averages buys by quantity', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000), // 100 each
      tx('buy', '2025-02-10', 10, -1200), // 120 each
    ])
    expect(position).toMatchObject({ quantity: 20, costPLN: 2200, averageCostPLN: 110 })
  })

  it('uses the rebuy price after everything was sold', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('sell', '2025-02-10', 10, 1500),
      tx('buy', '2025-03-10', 10, -2000),
    ])
    // The first 10 units and their 1,000 PLN left with the sale.
    expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
  })

  it('leaves the average cost unchanged after a partial sale', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('buy', '2025-02-10', 10, -1200), // 20 units, 2,200 PLN, average 110
      tx('sell', '2025-03-10', 5, 900),   // removes 5 × 110 = 550
    ])
    expect(position).toMatchObject({ quantity: 15, costPLN: 1650, averageCostPLN: 110 })
  })

  it('blends a buy made after a partial sale into the remaining pool', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('buy', '2025-02-10', 10, -1200),
      tx('sell', '2025-03-10', 5, 900),   // 15 units, 1,650 PLN
      tx('buy', '2025-04-10', 5, -950),   // 20 units, 2,600 PLN
    ])
    expect(position).toMatchObject({ quantity: 20, costPLN: 2600, averageCostPLN: 130 })
  })

  it('keeps the sale proceeds out of the cost: only the average cost leaves the pool', () => {
    const cheap = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('sell', '2025-02-10', 4, 1)])
    const dear = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('sell', '2025-02-10', 4, 99999)])
    // The price of a sale decides its profit, never the cost of what is left.
    const remaining = { quantity: 6, costPLN: 600, averageCostPLN: 100 }
    expect(cheap).toMatchObject(remaining)
    expect(dear).toMatchObject(remaining)
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
    expect(position).toMatchObject({ quantity: 2, costPLN: 100000, averageCostPLN: 50000 })
  })

  it('resets the pool when a send empties the position', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 1, -100000),
      tx('send', '2025-02-10', 1, 0),
      tx('buy', '2025-03-10', 2, -300000),
    ])
    expect(position).toMatchObject({ quantity: 2, costPLN: 300000, averageCostPLN: 150000 })
  })

  it('closes the position without floating-point residue', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; the leftover must not survive as a holding.
    const position = walkPosition([
      tx('buy', '2025-01-10', 0.1, -10),
      tx('buy', '2025-02-10', 0.2, -20),
      tx('sell', '2025-03-10', 0.3, 45),
    ])
    expect(position).toMatchObject({ quantity: 0, costPLN: 0, averageCostPLN: 0 })
  })

  it('closes the position when more is sold than held, then starts fresh', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 5, -500),
      tx('sell', '2025-02-10', 8, 1200),  // history is incomplete: only 5 were held
      tx('buy', '2025-03-10', 2, -300),
    ])
    expect(position).toMatchObject({ quantity: 2, costPLN: 300, averageCostPLN: 150 })
  })

  it('ignores a sale made before anything was bought', () => {
    const position = walkPosition([
      tx('sell', '2025-01-10', 5, 700),
      tx('buy', '2025-02-10', 10, -1000),
    ])
    expect(position).toMatchObject({ quantity: 10, costPLN: 1000, averageCostPLN: 100 })
  })

  it('ignores transaction types that do not move units, and rows without a quantity', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('dividend', '2025-02-10', undefined, 50),
      tx('fee', '2025-02-11', undefined, -5),
      tx('buy', '2025-02-12', undefined, -400), // malformed: no quantity
      tx('sell', '2025-02-13', undefined, 400), // malformed: no quantity
    ])
    expect(position).toMatchObject({ quantity: 10, costPLN: 1000, averageCostPLN: 100 })
  })

  it('walks in date order whatever order the transactions arrive in', () => {
    const position = walkPosition([
      tx('buy', '2025-03-10', 10, -2000),
      tx('sell', '2025-02-10', 10, 1500),
      tx('buy', '2025-01-10', 10, -1000),
    ])
    expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
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
      expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('runs a date-only buy before a same-day timestamped sale', () => {
      const position = walkPosition([
        tx('sell', '2026-02-10T08:00:00.000Z', 10, 1500),
        tx('buy', '2026-02-10', 10, -1000),
        tx('buy', '2026-03-10', 10, -2000),
      ])
      expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('runs date-only buys before date-only sales on the same day', () => {
      const position = walkPosition([
        tx('sell', '2026-02-10', 10, 1500),
        tx('buy', '2026-02-10', 10, -1000),
        tx('buy', '2026-03-10', 10, -2000),
      ])
      expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('keeps timestamped trades in time order, including sell-then-rebuy', () => {
      const position = walkPosition([
        tx('buy', '2026-02-09T10:00:00.000Z', 10, -1000),
        tx('buy', '2026-02-10T15:00:00.000Z', 10, -2000),
        tx('sell', '2026-02-10T09:00:00.000Z', 10, 1500),
      ])
      // Sold the first lot in the morning, bought back at 200 in the afternoon.
      expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })

    it('puts the buy first when a buy and a sale share a timestamp', () => {
      const position = walkPosition([
        tx('sell', '2026-02-10T09:00:00.000Z', 10, 1500),
        tx('buy', '2026-02-10T09:00:00.000Z', 10, -1000),
      ])
      expect(position).toMatchObject({ quantity: 0, costPLN: 0, averageCostPLN: 0 })
    })

    it('never lets an earlier day be overtaken by a later one', () => {
      const position = walkPosition([
        tx('sell', '2026-02-11', 10, 1500),
        tx('buy', '2026-02-10T23:59:59.999Z', 10, -1000),
        tx('buy', '2026-02-12T00:00:00.000Z', 10, -2000),
      ])
      expect(position).toMatchObject({ quantity: 10, costPLN: 2000, averageCostPLN: 200 })
    })
  })
})

// ─── walkPosition: realized profit ─────────────────────────────────────────────

describe('walkPosition — realized profit', () => {
  it('is zero until something is sold', () => {
    const position = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('buy', '2025-02-10', 10, -1200)])
    expect(position.realizedProfitPLN).toBe(0)
    expect(position.unexplainedQuantity).toBe(0)
  })

  it('is the proceeds minus the cost of the units sold', () => {
    // 10 bought for 1,000, all sold for 1,500 → 1,500 − 1,000 = +500.
    const position = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('sell', '2025-02-10', 10, 1500)])
    expect(position).toEqual({
      quantity: 0,
      costPLN: 0,
      averageCostPLN: 0,
      realizedProfitPLN: 500,
      unexplainedQuantity: 0,
    })
  })

  it('reports a loss as a negative number', () => {
    // 10 bought for 1,000, all sold for 700 → 700 − 1,000 = −300.
    const position = walkPosition([tx('buy', '2025-01-10', 10, -1000), tx('sell', '2025-02-10', 10, 700)])
    expect(position.realizedProfitPLN).toBe(-300)
  })

  it('prices each sale at the average cost on the day it happened', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('buy', '2025-02-10', 10, -1200), // 20 for 2,200 → average 110
      tx('sell', '2025-03-10', 5, 900),   // 900 − 5 × 110 = +350; 15 left for 1,650
      tx('buy', '2025-04-10', 5, -950),   // 20 for 2,600 → average 130
      tx('sell', '2025-05-10', 10, 1000), // 1,000 − 10 × 130 = −300; 10 left for 1,300
    ])
    // 350 − 300 = +50
    expect(position).toEqual({
      quantity: 10,
      costPLN: 1300,
      averageCostPLN: 130,
      realizedProfitPLN: 50,
      unexplainedQuantity: 0,
    })
  })

  it('starts from the rebuy price after a position was sold out', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 10, -1000),
      tx('sell', '2025-02-10', 10, 1500), // 1,500 − 1,000 = +500
      tx('buy', '2025-03-10', 10, -2000),
      tx('sell', '2025-04-10', 10, 2100), // 2,100 − 2,000 = +100, not 2,100 − 1,500
    ])
    expect(position.realizedProfitPLN).toBe(600)
  })

  it('realizes nothing on a send, and takes the sent units out at the average', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 2, -200000),  // average 100,000
      tx('send', '2025-02-10', 1, 0),       // 1 leaves with 100,000 of cost; no profit
      tx('sell', '2025-03-10', 1, 130000),  // 130,000 − 100,000 = +30,000
    ])
    expect(position.realizedProfitPLN).toBe(30000)
    expect(position.quantity).toBe(0)
  })

  it('uses only the rebuy cost after everything was sent away', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 1, -100000),
      tx('send', '2025-02-10', 1, 0),       // position closed, nothing realized
      tx('buy', '2025-03-10', 1, -200000),
      tx('sell', '2025-04-10', 1, 250000),  // 250,000 − 200,000 = +50,000
    ])
    expect(position.realizedProfitPLN).toBe(50000)
  })

  // Open question in #27: should a receive with no recorded cost join at the
  // position's average instead? Until that is decided it joins at zero, which
  // lowers the average and raises the profit on a later sale. This test pins
  // today's behaviour so that changing it is a deliberate act.
  it('lets a receive with unknown cost (amountPLN 0) join at zero cost', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 1, -100000),
      tx('receive', '2025-02-10', 1, 0),    // 2 for 100,000 → average 50,000
      tx('sell', '2025-03-10', 1, 120000),  // 120,000 − 50,000 = +70,000
    ])
    expect(position).toEqual({
      quantity: 1,
      costPLN: 50000,
      averageCostPLN: 50000,
      realizedProfitPLN: 70000,
      unexplainedQuantity: 0,
    })
  })

  it('uses a receive\'s recorded cost basis', () => {
    const position = walkPosition([
      tx('receive', '2025-01-10', 1, 80000),
      tx('sell', '2025-02-10', 1, 120000),  // 120,000 − 80,000 = +40,000
    ])
    expect(position.realizedProfitPLN).toBe(40000)
  })

  it('counts profit on a same-day sale whose time is unknown', () => {
    // The date-only sale sorts after the timestamped buy (see sortKey), so it
    // finds the units it sells: 1,500 − 1,000 = +500, and nothing is unexplained.
    const position = walkPosition([
      tx('sell', '2025-01-10', 10, 1500),
      tx('buy', '2025-01-10T14:00:00.000Z', 10, -1000),
    ])
    expect(position.realizedProfitPLN).toBe(500)
    expect(position.unexplainedQuantity).toBe(0)
  })

  it('does not turn floating-point residue into profit or unexplained units', () => {
    // 0.1 + 0.2 is a hair over 0.3: 45 − 30 = +15.
    const over = walkPosition([
      tx('buy', '2025-01-10', 0.1, -10),
      tx('buy', '2025-02-10', 0.2, -20),
      tx('sell', '2025-03-10', 0.3, 45),
    ])
    expect(over.realizedProfitPLN).toBeCloseTo(15, 9)
    expect(over.unexplainedQuantity).toBe(0)

    // 0.3 − 0.1 is a hair under 0.2: (15 − 10) + (30 − 20) = +15.
    const under = walkPosition([
      tx('buy', '2025-01-10', 0.3, -30),
      tx('sell', '2025-02-10', 0.1, 15),
      tx('sell', '2025-03-10', 0.2, 30),
    ])
    expect(under.realizedProfitPLN).toBeCloseTo(15, 9)
    expect(under.unexplainedQuantity).toBe(0)
    expect(under.quantity).toBe(0)
  })
})

// ─── walkPosition: incomplete history ──────────────────────────────────────────

describe('walkPosition — selling more than was recorded', () => {
  it('counts profit only on the recorded units and reports the rest', () => {
    // 1 bought for 100, 10 sold for 1,000. The log explains 1 of the 10, so it
    // gets 1/10 of the proceeds: 100 − 100 = 0. The other 9 are unexplained.
    const position = walkPosition([tx('buy', '2025-01-10', 1, -100), tx('sell', '2025-02-10', 10, 1000)])
    expect(position).toEqual({
      quantity: 0,
      costPLN: 0,
      averageCostPLN: 0,
      realizedProfitPLN: 0,
      unexplainedQuantity: 9,
    })
  })

  it('pro-rates the proceeds by the share of units the log explains', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 5, -500),
      tx('sell', '2025-02-10', 8, 1200),  // 5 of 8 explained: 1,200 × 5/8 − 500 = +250; 3 unexplained
      tx('buy', '2025-03-10', 2, -300),   // a fresh position
    ])
    expect(position).toEqual({
      quantity: 2,
      costPLN: 300,
      averageCostPLN: 150,
      realizedProfitPLN: 250,
      unexplainedQuantity: 3,
    })
  })

  it('counts nothing for a sale made before anything was bought', () => {
    const position = walkPosition([
      tx('sell', '2025-01-10', 5, 700),   // nothing held: all 5 unexplained, no profit
      tx('buy', '2025-02-10', 10, -1000),
    ])
    expect(position.realizedProfitPLN).toBe(0)
    expect(position.unexplainedQuantity).toBe(5)
  })

  it('reports units sent beyond those recorded, and adds up across events', () => {
    const position = walkPosition([
      tx('buy', '2025-01-10', 1, -100),
      tx('send', '2025-02-10', 3, 0),     // 2 unexplained
      tx('sell', '2025-03-10', 4, 800),   // nothing held: 4 unexplained, no profit
    ])
    expect(position.realizedProfitPLN).toBe(0)
    expect(position.unexplainedQuantity).toBe(6)
  })
})

// ─── walkPosition: trade fees ──────────────────────────────────────────────────

describe('walkPosition — trade fees', () => {
  it('adds a buy\'s fee to the cost of the units bought', () => {
    const buy = tx('buy', '2025-01-10', 2, -2000)
    // 2,000 + 20 fee = 2,020 → 1,010 per unit.
    expect(walkPosition([buy], feesFor([buy, 20]))).toMatchObject({
      quantity: 2,
      costPLN: 2020,
      averageCostPLN: 1010,
    })
  })

  it('takes a sale\'s fee off its proceeds, and never changes the cost of what is left', () => {
    const buy = tx('buy', '2025-01-10', 2, -2000)
    const sell = tx('sell', '2025-02-10', 1, 1500)
    // Cost 2,020 → 1,010 per unit. Sale: (1,500 − 15) − 1,010 = +475.
    // The unit left still costs 1,010.
    expect(walkPosition([buy, sell], feesFor([buy, 20], [sell, 15]))).toEqual({
      quantity: 1,
      costPLN: 1010,
      averageCostPLN: 1010,
      realizedProfitPLN: 475,
      unexplainedQuantity: 0,
    })
  })

  it('counts each fee once over the life of the position', () => {
    const buy = tx('buy', '2025-01-10', 2, -2000)
    const first = tx('sell', '2025-02-10', 1, 1500)
    const second = tx('sell', '2025-03-10', 1, 1600)
    // (1,500 − 15) − 1,010 = +475, then (1,600 − 16) − 1,010 = +574 → +1,049.
    // The same as all proceeds minus all costs: 3,100 − 2,000 − (20 + 15 + 16).
    const position = walkPosition([buy, first, second], feesFor([buy, 20], [first, 15], [second, 16]))
    expect(position.realizedProfitPLN).toBe(1049)
  })

  it('pro-rates the fee with the proceeds when more is sold than was recorded', () => {
    const buy = tx('buy', '2025-01-10', 1, -100)
    const sell = tx('sell', '2025-02-10', 10, 1000)
    // 1 of 10 explained: (1,000 − 50) × 1/10 − 100 = −5.
    expect(walkPosition([buy, sell], feesFor([sell, 50])).realizedProfitPLN).toBeCloseTo(-5, 9)
  })

  it('takes amounts as they stand when no fees are passed', () => {
    const position = walkPosition([tx('buy', '2025-01-10', 1, -1000), tx('sell', '2025-02-10', 1, 1500)])
    expect(position.realizedProfitPLN).toBe(500)
  })
})

// ─── walkSales ─────────────────────────────────────────────────────────────────

describe('walkSales', () => {
  it('reports each sale on its own, adding up to the walk\'s realized profit', () => {
    const buy1 = tx('buy', '2025-01-10', 10, -1000)
    const buy2 = tx('buy', '2025-02-10', 10, -1200) // 20 for 2,200 → average 110
    const first = tx('sell', '2025-03-10', 5, 900)  // 900 − 5 × 110 = +350
    const buy3 = tx('buy', '2025-04-10', 5, -950)   // 20 for 2,600 → average 130
    const second = tx('sell', '2025-05-10', 10, 1000) // 1,000 − 10 × 130 = −300
    const rows = [buy1, buy2, first, buy3, second]

    const sales = walkSales(rows)
    expect(sales.get(first.id)).toEqual({ proceedsPLN: 900, costPLN: 550, profitPLN: 350 })
    expect(sales.get(second.id)).toEqual({ proceedsPLN: 1000, costPLN: 1300, profitPLN: -300 })
    expect(sales.size).toBe(2)
    // 350 − 300 = +50, the same as walkPosition.
    expect(walkPosition(rows).realizedProfitPLN).toBe(50)
  })

  it('applies paired fees and the explained share the same way as the walk', () => {
    const buy = tx('buy', '2025-01-10', 1, -100)
    const sell = tx('sell', '2025-02-10', 10, 1000)
    // 1 of 10 explained: proceeds (1,000 − 50) × 1/10 = 95, cost 100 → −5.
    const result = walkSales([buy, sell], feesFor([sell, 50])).get(sell.id)!
    expect(result.proceedsPLN).toBeCloseTo(95, 9)
    expect(result.costPLN).toBe(100)
    expect(result.profitPLN).toBeCloseTo(-5, 9)
  })

  it('ignores a transaction\'s own feePLN, which is already inside its amount', () => {
    const buy = tx('buy', '2025-01-10', 1, -100)
    const sell = { ...tx('sell', '2025-02-10', 1, 140), feePLN: 10 } // sold for 150, 10 fee
    expect(walkSales([buy, sell]).get(sell.id)!.profitPLN).toBe(40)
    expect(walkPosition([buy, sell]).realizedProfitPLN).toBe(40)
  })
})
