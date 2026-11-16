import { describe, it, expect } from 'vitest'
import type { Account, Holding, Transaction } from '@/types'
import { computeCostBasisDiff } from './xtbPostProcessing'

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
