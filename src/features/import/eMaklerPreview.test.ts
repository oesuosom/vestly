import { describe, expect, it } from 'vitest'
import type { EMaklerHoldingResult, EMaklerImportResult, EMaklerTransactionData } from '@/importers/eMaklerImport'
import type { Account, Holding } from '@/types'
import { planEMaklerPreview } from './eMaklerPreview'

const NOW = '2026-01-01T00:00:00.000Z'

function holding(name: string, fields: Partial<Holding> = {}): Holding {
  return {
    id: name.toLowerCase(), accountId: 'mb', name, ticker: name, exchange: 'PL', category: 'stock', quantity: 10,
    purchasePrice: 50, currentPrice: 60, purchaseDate: '2025-06-01', createdAt: NOW, updatedAt: NOW, ...fields,
  }
}

function imported(name: string, quantity = 10): EMaklerHoldingResult {
  return {
    name, exchange: 'PL', quantity, currentPrice: 55, purchasePrice: 50, purchaseDate: '2026-02-03', priceCurrency: 'PLN',
    originalPurchasePrice: 50, nbpRateUsed: 1, status: 'complete', category: 'stock',
  }
}

function order(name: string, side: 'buy' | 'sell', quantity: number, price: number, date: string): EMaklerTransactionData {
  return {
    deduplicationKey: `${name}|PL|${date}|${quantity}|${price}`, date, name, exchange: 'PL', side, quantity,
    pricePerUnitPLN: price, amountPLN: side === 'buy' ? -quantity * price : quantity * price,
    originalCurrency: 'PLN', pricePerUnitOriginal: price,
  }
}

function result(holdings: EMaklerHoldingResult[], transactions: EMaklerTransactionData[] = []): EMaklerImportResult {
  return { holdings, transactions, duplicatesSkipped: 0, warnings: [] }
}

const alpha = holding('ALPHA')
const beta = holding('BETA')
const gamma = holding('GAMMA')
const cash = holding('Cash', { id: 'cash', category: 'cash', isSynthetic: true, exchange: undefined })
const account: Account = { id: 'mb', name: 'Broker', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings: [alpha, beta, gamma, cash] }

describe('planEMaklerPreview — order history alone', () => {
  const buyAlpha = order('ALPHA', 'buy', 10, 50, '2026-02-03T10:00:00.000Z')

  it('changes only the instruments it has orders for, and lists nothing as missing', () => {
    const plan = planEMaklerPreview(result([imported('ALPHA')], [buyAlpha]), true, account, [])
    expect(plan.rows.map((r) => [r.action, r.existingHolding?.id])).toEqual([['update', 'alpha']])
    expect(plan).toMatchObject({ missing: [], noOverlap: false })
  })

  it('uploaded again (every order already imported) proposes nothing at all', () => {
    const plan = planEMaklerPreview(result([], []), true, account, [])
    expect(plan).toEqual({ rows: [], missing: [], noOverlap: false })
  })

  it('never closes a holding, even one it has a sale for', () => {
    const sellBeta = order('BETA', 'sell', 10, 70, '2026-03-01T11:00:00.000Z')
    const plan = planEMaklerPreview(result([], [sellBeta]), true, account, [])
    expect(plan.rows).toEqual([])
    expect(plan.missing).toEqual([])
  })
})

describe('planEMaklerPreview — portfolio file', () => {
  it('lists holdings the file lacks under "Not in this file", never the Cash row', () => {
    const plan = planEMaklerPreview(result([imported('ALPHA')]), false, account, [])
    expect(plan.rows.map((r) => r.action)).toEqual(['update'])
    expect(plan.missing.map((h) => h.id)).toEqual(['beta', 'gamma'])
  })

  it('closes a missing holding with its sale from the same upload instead of listing it', () => {
    const sellBeta = order('BETA', 'sell', 10, 70, '2026-03-01T11:00:00.000Z')
    const plan = planEMaklerPreview(result([imported('ALPHA')], [sellBeta]), false, account, [])
    expect(plan.rows.map((r) => [r.action, r.existingHolding?.id])).toEqual([['update', 'alpha'], ['sold', 'beta']])
    expect(plan.missing.map((h) => h.id)).toEqual(['gamma'])
  })

  it('still lists a missing holding whose upload sale covers only part of it', () => {
    const sellSome = order('BETA', 'sell', 4, 70, '2026-03-01T11:00:00.000Z')
    const plan = planEMaklerPreview(result([imported('ALPHA')], [sellSome]), false, account, [])
    expect(plan.rows.map((r) => r.action)).toEqual(['update'])
    expect(plan.missing.map((h) => h.id)).toEqual(['beta', 'gamma'])
  })

  it('warns instead of listing missing holdings when the file shares none with the account', () => {
    const plan = planEMaklerPreview(result([imported('DELTA')]), false, account, [])
    expect(plan.rows.map((r) => r.action)).toEqual(['add'])
    expect(plan).toMatchObject({ missing: [], noOverlap: true })
  })
})
