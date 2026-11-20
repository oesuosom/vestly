import { describe, expect, it } from 'vitest'
import type { Account, Holding, Transaction } from '@/types'
import { findMissingHoldings, hasErrors, markAsSoldDefaults, markAsSoldErrors, parseAmount, wholeHolding } from './missingHoldings'

const NOW = '2026-01-01T00:00:00.000Z'

function holding(id: string, fields: Partial<Holding> = {}): Holding {
  return {
    id,
    accountId: 'acc',
    name: id.toUpperCase(),
    ticker: id.toUpperCase(),
    category: 'stock',
    quantity: 10,
    purchasePrice: 50,
    currentPrice: 60.125,
    purchaseDate: '2025-06-01',
    createdAt: NOW,
    updatedAt: NOW,
    ...fields,
  }
}

const alpha = holding('alpha')
const beta = holding('beta')
const gamma = holding('gamma', { purchaseDate: '2026-02-10' })
const cash = holding('cash', { name: 'Cash', category: 'cash', isSynthetic: true })

describe('findMissingHoldings', () => {
  it('lists the open holdings the file does not, never the synthetic Cash row', () => {
    const result = findMissingHoldings([alpha, beta, gamma, cash], new Set(['alpha']), true)
    expect(result).toEqual({ missing: [beta, gamma], noOverlap: false })
  })

  it('lists nothing when the file has every holding', () => {
    expect(findMissingHoldings([alpha, beta], new Set(['alpha', 'beta']), true).missing).toEqual([])
  })

  it('warns instead of listing anything when the file shares no holding with the account', () => {
    expect(findMissingHoldings([alpha, beta, cash], new Set(), true)).toEqual({ missing: [], noOverlap: true })
  })

  it('does not warn about an empty account or an empty file', () => {
    expect(findMissingHoldings([cash], new Set(), true)).toEqual({ missing: [], noOverlap: false })
    expect(findMissingHoldings([alpha], new Set(), false)).toEqual({ missing: [alpha], noOverlap: false })
  })

  it('leaves out holdings bought after the statement date: they could not be in the file', () => {
    const result = findMissingHoldings([alpha, beta, gamma], new Set(['alpha']), true, '2026-01-31')
    expect(result.missing).toEqual([beta])
  })
})

describe('markAsSoldDefaults', () => {
  it('prefills the last known value and the statement date', () => {
    expect(markAsSoldDefaults(wholeHolding(alpha), '2026-11-20', '2026-10-31')).toEqual({ date: '2026-10-31', amount: '601.25' })
  })

  it('uses today when the file has no statement date', () => {
    expect(markAsSoldDefaults(wholeHolding(alpha), '2026-11-20').date).toBe('2026-11-20')
  })

  it('values only what is left after the upload’s sales', () => {
    expect(markAsSoldDefaults({ holding: alpha, quantity: 7, priorSales: [] }, '2026-11-20').amount).toBe('420.88')
  })
})

describe('markAsSoldErrors', () => {
  const account: Account = { id: 'acc', name: 'Acc', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings: [alpha, beta] }
  const later: Transaction = {
    id: 'b', externalId: 'b', accountId: 'acc', type: 'buy', date: '2026-03-01', amountPLN: -100, quantity: 2, ticker: 'ALPHA',
    source: 'xtb_import', createdAt: NOW,
  }
  const today = '2026-11-20'

  it('accepts a date from the last purchase to today and an amount of 0 or more', () => {
    expect(hasErrors(markAsSoldErrors(wholeHolding(alpha), account, [], { date: '2025-06-01', amount: '0' }, today))).toBe(false)
    expect(hasErrors(markAsSoldErrors(wholeHolding(alpha), account, [], { date: today, amount: '1 234,5' }, today))).toBe(false)
  })

  it('rejects a missing, future or pre-purchase date', () => {
    expect(markAsSoldErrors(wholeHolding(alpha), account, [], { date: '', amount: '1' }, today).date).toBe('required')
    expect(markAsSoldErrors(wholeHolding(alpha), account, [], { date: '2026-11-21', amount: '1' }, today).date).toBe('future')
    const early = markAsSoldErrors(wholeHolding(alpha), account, [later], { date: '2026-02-01', amount: '1' }, today)
    expect(early).toMatchObject({ date: 'beforePurchase', earliest: '2026-03-01' })
  })

  it('rejects a date before the upload’s last sale of it', () => {
    const sold: Transaction = { ...later, id: 's', externalId: 's', type: 'sell', date: '2026-04-10T10:00:00.000Z', amountPLN: 120, quantity: 2 }
    const partly = { holding: alpha, quantity: 8, priorSales: [sold] }
    expect(markAsSoldErrors(partly, account, [], { date: '2026-04-09', amount: '1' }, today)).toMatchObject({
      date: 'beforePurchase', earliest: '2026-04-10',
    })
    expect(hasErrors(markAsSoldErrors(partly, account, [], { date: '2026-04-10', amount: '1' }, today))).toBe(false)
  })

  it('rejects an empty amount', () => {
    expect(markAsSoldErrors(wholeHolding(alpha), account, [], { date: today, amount: '' }, today).amount).toBe('required')
  })

  it('blocks a holding that shares its ticker with another open holding', () => {
    const twin = holding('twin', { ticker: 'ALPHA' })
    const shared = { ...account, holdings: [alpha, twin] }
    expect(markAsSoldErrors(wholeHolding(alpha), shared, [], { date: today, amount: '1' }, today).sharedWith).toBe(twin)
  })
})

describe('parseAmount', () => {
  it('reads a comma or a dot, with spaces as thousands separators', () => {
    expect(parseAmount('1 234,50')).toBe(1234.5)
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('')).toBeNaN()
  })
})
