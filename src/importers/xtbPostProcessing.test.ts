import { describe, it, expect } from 'vitest'
import type { Account, Holding, Transaction } from '@/types'
import { computeCostBasisDiff, computeUnmatchedInstruments } from './xtbPostProcessing'
import { moveToClosed, planClose } from '@/domain/closePosition'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeHolding(overrides: Partial<Holding>): Holding {
  return {
    id: 'h1',
    accountId: 'xtb',
    name: 'Test Holding',
    ticker: 'ETFW',
    category: 'etf',
    quantity: 10,
    purchasePrice: 100,
    currentPrice: 100,
    purchaseDate: '2025-01-10',
    createdAt: '2025-01-10T00:00:00.000Z',
    updatedAt: '2025-01-10T00:00:00.000Z',
    ...overrides,
  }
}

function makeAccount(id: string, holdings: Holding[]): Account {
  return {
    id,
    name: id,
    type: 'brokerage',
    createdAt: '2025-01-10T00:00:00.000Z',
    lastUpdated: '2025-01-10T00:00:00.000Z',
    holdings,
  }
}

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't1',
    accountId: 'xtb',
    type: 'buy',
    date: '2025-01-10',
    amountPLN: -1000,
    ticker: 'ETFW',
    quantity: 10,
    externalId: 'ext1',
    source: 'xtb_import',
    createdAt: '2025-01-10T00:00:00.000Z',
    ...overrides,
  }
}

// ─── computeCostBasisDiff ──────────────────────────────────────────────────────

describe('computeCostBasisDiff', () => {
  it('proposes the rebuy price after everything was sold', () => {
    const accounts = [makeAccount('xtb', [makeHolding({ purchasePrice: 150 })])]
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', amountPLN: 1500 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-03-10', amountPLN: -2000 }),
    ]
    expect(computeCostBasisDiff(accounts, transactions, 'xtb')).toEqual([
      { holdingId: 'h1', holdingName: 'Test Holding', ticker: 'ETFW', currentPricePLN: 150, calculatedPricePLN: 200, quantity: 10 },
    ])
  })

  it('proposes nothing when a partial sale leaves the stored average correct', () => {
    const accounts = [makeAccount('xtb', [makeHolding({ quantity: 6, purchasePrice: 100 })])]
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', quantity: 4, amountPLN: 600 }),
    ]
    expect(computeCostBasisDiff(accounts, transactions, 'xtb')).toEqual([])
  })

  it("ignores another account's transactions and holdings for the same ticker", () => {
    const accounts = [
      makeAccount('xtb', [makeHolding({ id: 'h1', purchasePrice: 90 })]),
      makeAccount('other', [makeHolding({ id: 'h2', accountId: 'other', purchasePrice: 1 })]),
    ]
    const transactions = [
      makeTx({ id: 't1', accountId: 'xtb', amountPLN: -1000 }),
      makeTx({ id: 't2', accountId: 'other', amountPLN: -3000 }),
    ]
    const rows = computeCostBasisDiff(accounts, transactions, 'xtb')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ holdingId: 'h1', currentPricePLN: 90, calculatedPricePLN: 100 })
  })

  it('proposes nothing for a holding whose position was sold out in the log', () => {
    const accounts = [makeAccount('xtb', [makeHolding({ purchasePrice: 123 })])]
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', amountPLN: 1500 }),
    ]
    expect(computeCostBasisDiff(accounts, transactions, 'xtb')).toEqual([])
  })
})

// ─── computeUnmatchedInstruments ───────────────────────────────────────────────

describe('computeUnmatchedInstruments', () => {
  const kgh = (overrides: Partial<Transaction>) =>
    makeTx({ ticker: 'KGH', instrument: 'KGHM', exchange: 'PL', ...overrides })

  it('proposes buys with no sales as before: summed quantity, weighted average, first buy date', () => {
    const transactions = [
      kgh({ id: 't1', date: '2025-01-10', quantity: 10, amountPLN: -1000 }),
      kgh({ id: 't2', date: '2025-02-10T10:00:00.000Z', quantity: 10, amountPLN: -1200 }),
    ]
    // 20 units for 2 200 → 110 each.
    expect(computeUnmatchedInstruments(transactions, [makeAccount('xtb', [])], 'xtb').matched).toEqual([
      { instrument: 'KGHM', ticker: 'KGH', exchange: 'PL', totalQuantity: 20, avgCostPLN: 110, earliestDate: '2025-01-10', suggestedCategory: undefined },
    ])
  })

  it('proposes a partly sold instrument at the units left and their average cost', () => {
    const transactions = [
      kgh({ id: 't1', date: '2025-01-10', quantity: 10, amountPLN: -1000 }),
      kgh({ id: 't2', date: '2025-02-10', quantity: 10, amountPLN: -1200 }), // 20 for 2 200 → 110 each
      kgh({ id: 't3', type: 'sell', date: '2025-03-10', quantity: 5, amountPLN: 700 }), // 15 left at 110
    ]
    expect(computeUnmatchedInstruments(transactions, [makeAccount('xtb', [])], 'xtb').matched).toMatchObject([
      { ticker: 'KGH', totalQuantity: 15, avgCostPLN: 110, earliestDate: '2025-01-10' },
    ])
  })

  it('dates a rebuy after a full sale from the rebuy, at its own price', () => {
    const transactions = [
      kgh({ id: 't1', date: '2025-01-10', quantity: 10, amountPLN: -1000 }),
      kgh({ id: 't2', type: 'sell', date: '2025-02-10', quantity: 10, amountPLN: 1500 }),
      kgh({ id: 't3', date: '2025-04-10', quantity: 4, amountPLN: -600 }), // new pool: 4 at 150
    ]
    expect(computeUnmatchedInstruments(transactions, [makeAccount('xtb', [])], 'xtb').matched).toMatchObject([
      { ticker: 'KGH', totalQuantity: 4, avgCostPLN: 150, earliestDate: '2025-04-10' },
    ])
  })

  it('does not propose a holding again after Close position', () => {
    const holding = makeHolding({ id: 'kgh', name: 'KGHM', ticker: 'KGH', category: 'stock', quantity: 10, purchasePrice: 100 })
    const account = makeAccount('xtb', [holding])
    const log = [kgh({ id: 't1', date: '2025-01-10', quantity: 10, amountPLN: -1000 })]
    const plan = planClose(holding, account, log, { date: '2025-06-01', saleAmountPLN: 1300, feePLN: 0 })
    const accounts = moveToClosed([account], 'kgh', '2025-06-01', '2025-06-01T00:00:00.000Z')

    // A later import brings in an unrelated buy, which is what opens this step.
    const after = [...log, ...plan.transactions, kgh({ id: 't9', ticker: 'PKN', instrument: 'Orlen', date: '2025-07-01', quantity: 3, amountPLN: -180 })]
    expect(computeUnmatchedInstruments(after, accounts, 'xtb').matched.map((r) => r.ticker)).toEqual(['PKN'])
  })

  it('nets unresolved instruments the same way', () => {
    const unknown = (overrides: Partial<Transaction>) => makeTx({ ticker: undefined, instrument: 'Some Unknown Fund', ...overrides })
    const transactions = [
      unknown({ id: 't1', date: '2025-01-10', quantity: 10, amountPLN: -1000 }),
      unknown({ id: 't2', type: 'sell', date: '2025-02-10', quantity: 10, amountPLN: 1100 }),
    ]
    expect(computeUnmatchedInstruments(transactions, [makeAccount('xtb', [])], 'xtb').unresolved).toEqual([])
  })
})
