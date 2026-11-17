import { describe, it, expect } from 'vitest'
import type { Account, Holding, HoldingPricePoint, Transaction } from '@/types'
import { computePortfolioAt } from './portfolioValue'

const NOW = '2026-01-01T00:00:00.000Z'
const TODAY = new Date('2026-06-01T12:00:00.000Z')

/** 10 shares bought 1 Jan for 100 each, sold 1 Mar; last price before the sale 159. */
const closed: Holding = {
  id: 'closed', accountId: 'acc', name: 'Closed Co', ticker: 'CLS', category: 'stock',
  quantity: 10, purchasePrice: 100, currentPrice: 159, purchaseDate: '2026-01-01', closedAt: '2026-03-01',
  createdAt: NOW, updatedAt: NOW,
}
const cash: Holding = {
  id: 'cash_acc', accountId: 'acc', name: 'Cash', category: 'cash', quantity: 1,
  purchasePrice: 0, currentPrice: 0, purchaseDate: '2026-01-01', isSynthetic: true, createdAt: NOW, updatedAt: NOW,
}
const account: Account = {
  id: 'acc', name: 'XTB', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings: [cash], closedHoldings: [closed],
}

function tx(fields: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'date' | 'amountPLN'>): Transaction {
  return { accountId: 'acc', externalId: fields.id, source: 'xtb_import', createdAt: NOW, ...fields }
}
const log: Transaction[] = [
  tx({ id: 'dep', type: 'deposit', date: '2026-01-01', amountPLN: 1000 }),
  tx({ id: 'buy', type: 'buy', date: '2026-01-01', amountPLN: -1000, quantity: 10, ticker: 'CLS' }),
  tx({ id: 'sell', type: 'sell', date: '2026-03-01', amountPLN: 1500, quantity: 10, ticker: 'CLS', source: 'manual', affectsCash: true }),
]

describe('computePortfolioAt — closed holdings', () => {
  it('counts a closed holding before its close date, interpolated up to the close date', () => {
    // 31 of the 59 days from 1 Jan to 1 Mar: 100 + (159 − 100) × 31/59 = 131 per share → 1 310.
    // Cash that day: 1 000 deposit − 1 000 buy = 0, so it adds nothing.
    expect(computePortfolioAt('2026-02-01', [account], log, null, TODAY)).toBeCloseTo(1310, 9)
  })

  it('uses its cached prices when there are some', () => {
    const prices: HoldingPricePoint[] = [{ date: '2026-01-30', pricePLN: 140 }]
    const histories = new Map([['closed', prices]])
    expect(computePortfolioAt('2026-02-01', [account], log, histories, TODAY)).toBe(1400)
  })

  it('stops counting it on the close date, when the proceeds reach Cash', () => {
    // Holding gone; Cash = 1 000 − 1 000 + 1 500 = 1 500.
    expect(computePortfolioAt('2026-03-01', [account], log, null, TODAY)).toBe(1500)
  })

  it('interpolates a closed crypto holding too: both ends are known', () => {
    const coin = { ...closed, id: 'coin', ticker: 'BTC', category: 'crypto' as const }
    const crypto: Account = { ...account, type: 'crypto', holdings: [], closedHoldings: [coin] }
    const cryptoLog = log.filter((t) => t.type !== 'deposit').map((t) => ({ ...t, ticker: 'BTC' }))
    expect(computePortfolioAt('2026-02-01', [crypto], cryptoLog, null, TODAY)).toBeCloseTo(1310, 9)
  })
})
