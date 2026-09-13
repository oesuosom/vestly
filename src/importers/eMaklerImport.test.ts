import { describe, it, expect } from 'vitest'
import { buildEMaklerImport } from './eMaklerImport'
import type { EMaklerOrderRow, EMaklerPortfolioRow } from './eMaklerParser'

// PLN-only fixtures: resolveRate short-circuits to 1 without touching the NBP API,
// so these stay hermetic.
function order(o: Partial<EMaklerOrderRow> = {}): EMaklerOrderRow {
  const base = {
    name: 'KRUK',
    exchange: 'PL',
    side: 'buy' as const,
    quantityOrdered: 10,
    quantityExecuted: 10,
    price: 400,
    currency: 'PLN',
    date: '2026-03-02T10:00:00.000Z',
    ...o,
  }
  return {
    ...base,
    deduplicationKey: `${base.name}|${base.exchange}|${base.date}|${base.quantityExecuted}|${base.price}`,
  }
}

function portfolio(p: Partial<EMaklerPortfolioRow> = {}): EMaklerPortfolioRow {
  return {
    name: 'KRUK',
    exchange: 'PL',
    quantity: 6,
    currentPrice: 450,
    priceCurrency: 'PLN',
    totalValuePLN: 2700,
    ...p,
  }
}

describe('buildEMaklerImport — sell orders', () => {
  it('records sells in the transaction log instead of dropping them', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10, price: 400 }),
      order({ side: 'sell', quantityExecuted: 4, price: 450, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const { transactions } = await buildEMaklerImport([portfolio()], orders, new Set())

    expect(transactions).toHaveLength(2)
    const sell = transactions.find((t) => t.side === 'sell')!
    expect(sell).toBeDefined()
    expect(sell.quantity).toBe(4)
  })

  it('signs a sell as proceeds in and a buy as cash out', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10, price: 400 }),
      order({ side: 'sell', quantityExecuted: 4, price: 450, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const { transactions } = await buildEMaklerImport([portfolio()], orders, new Set())

    expect(transactions.find((t) => t.side === 'buy')!.amountPLN).toBe(-4000)
    expect(transactions.find((t) => t.side === 'sell')!.amountPLN).toBe(1800)
  })

  it('derives cost basis from buys only, ignoring the sell price', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10, price: 400 }),
      order({ side: 'sell', quantityExecuted: 4, price: 999, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const { holdings } = await buildEMaklerImport([portfolio()], orders, new Set())

    expect(holdings[0].purchasePrice).toBe(400)
  })

  it('trusts the portfolio snapshot for quantity rather than re-deriving it', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10 }),
      order({ side: 'sell', quantityExecuted: 4, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const { holdings } = await buildEMaklerImport([portfolio({ quantity: 6 })], orders, new Set())

    expect(holdings[0].quantity).toBe(6)
  })

  it('nets buys against sells when there is no portfolio snapshot', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10 }),
      order({ side: 'sell', quantityExecuted: 4, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const { holdings } = await buildEMaklerImport([], orders, new Set())

    expect(holdings).toHaveLength(1)
    expect(holdings[0].quantity).toBe(6)
  })

  it('omits a fully closed position when there is no portfolio snapshot', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10 }),
      order({ side: 'sell', quantityExecuted: 10, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const { holdings, transactions } = await buildEMaklerImport([], orders, new Set())

    expect(holdings).toHaveLength(0)
    // the round trip is still auditable even though nothing is held
    expect(transactions).toHaveLength(2)
  })
})

describe('buildEMaklerImport — re-import safety', () => {
  // Backfilling historical sells means clearing ft_emakler_order_keys and
  // re-importing. That is only safe if a given order yields the same
  // deduplicationKey every time, because that key becomes the Transaction's
  // externalId and is what importTransactions() dedups buys on.
  it('produces stable dedup keys across repeated runs', async () => {
    const orders = [
      order({ side: 'buy', quantityExecuted: 10, price: 400 }),
      order({ side: 'sell', quantityExecuted: 4, price: 450, date: '2026-04-10T10:00:00.000Z' }),
    ]
    const first = await buildEMaklerImport([portfolio()], orders, new Set())
    const second = await buildEMaklerImport([portfolio()], orders, new Set())

    expect(second.transactions.map((t) => t.deduplicationKey))
      .toEqual(first.transactions.map((t) => t.deduplicationKey))
  })

  it('still honours the stored keys when they are present', async () => {
    const orders = [order({ side: 'buy' })]
    const keys = new Set(orders.map((o) => o.deduplicationKey))
    const { transactions, duplicatesSkipped } = await buildEMaklerImport([portfolio()], orders, keys)

    expect(transactions).toHaveLength(0)
    expect(duplicatesSkipped).toBe(1)
  })
})
