import { describe, it, expect } from 'vitest'
import type { Holding, Transaction } from '@/types'
import { quantityAtDate } from '@/domain/historicalQuantity'

const NOW = '2026-01-01T00:00:00.000Z'
const DATE = '2026-06-01'

function holding(fields: Partial<Holding> & Pick<Holding, 'id' | 'name'>): Holding {
  return {
    accountId: 'acc', category: 'stock', quantity: 999, purchasePrice: 100, currentPrice: 100,
    purchaseDate: '2026-01-01', createdAt: NOW, updatedAt: NOW, ...fields,
  }
}

function buy(id: string, quantity: number, fields: Partial<Transaction> = {}): Transaction {
  return {
    id, externalId: id, accountId: 'acc', type: 'buy', date: '2026-02-01', amountPLN: -quantity * 100, quantity,
    source: 'manual', createdAt: NOW, ...fields,
  }
}

describe('quantityAtDate — name matching', () => {
  const log = [
    buy('a', 10, { instrument: 'Apple' }),
    buy('b', 50, { instrument: 'Apple Hospitality REIT' }),
  ]

  it('does not count another instrument whose name contains the holding name', () => {
    expect(quantityAtDate(holding({ id: 'h', name: 'Apple' }), 'acc', log, DATE)).toBe(10)
  })

  it('does not count another instrument whose name is contained in the holding name', () => {
    expect(quantityAtDate(holding({ id: 'h', name: 'Apple Hospitality REIT' }), 'acc', log, DATE)).toBe(50)
  })

  it('matches the same name with different case and extra spaces', () => {
    const messy = [
      buy('a', 10, { instrument: '  apple   hospitality reit ' }),
      buy('b', 5, { instrument: 'APPLE HOSPITALITY\tREIT' }),
    ]
    expect(quantityAtDate(holding({ id: 'h', name: 'Apple Hospitality REIT' }), 'acc', messy, DATE)).toBe(15)
  })

  it('falls back to the recorded quantity when no transaction has the same name', () => {
    const other = [buy('b', 50, { instrument: 'Apple Hospitality REIT' })]
    expect(quantityAtDate(holding({ id: 'h', name: 'Apple' }), 'acc', other, DATE)).toBe(999)
  })
})

describe('quantityAtDate — ticker and bond matching', () => {
  it('matches by ticker, ignoring case and the instrument name', () => {
    const log = [
      buy('a', 4, { ticker: 'acme', instrument: 'Something Else' }),
      buy('b', 7, { ticker: 'OTHER', instrument: 'Acme' }),
    ]
    expect(quantityAtDate(holding({ id: 'h', name: 'Acme', ticker: 'ACME' }), 'acc', log, DATE)).toBe(4)
  })

  it('counts only a bond lot’s own rows by relatedHoldingId', () => {
    const lot1 = holding({ id: 'lot1', name: 'Bond Series X', category: 'bond' })
    const lot2 = holding({ id: 'lot2', name: 'Bond Series X', category: 'bond' })
    const log = [
      buy('a', 3, { instrument: 'Bond Series X', source: 'bond_holding', relatedHoldingId: 'lot1' }),
      buy('b', 8, { instrument: 'Bond Series X', source: 'bond_holding', relatedHoldingId: 'lot2' }),
    ]
    expect(quantityAtDate(lot1, 'acc', log, DATE)).toBe(3)
    expect(quantityAtDate(lot2, 'acc', log, DATE)).toBe(8)
  })

  it('ignores other accounts and later dates', () => {
    const log = [
      buy('a', 2, { instrument: 'Apple' }),
      buy('b', 6, { instrument: 'Apple', accountId: 'other' }),
      buy('c', 9, { instrument: 'Apple', date: '2026-07-01' }),
    ]
    expect(quantityAtDate(holding({ id: 'h', name: 'Apple' }), 'acc', log, DATE)).toBe(2)
  })
})
