import { describe, expect, it } from 'vitest'
import type { Account, Holding } from '@/types'
import {
  currencyCode,
  currencyFromStatement,
  currencyFromYahoo,
  holdingPriceCurrency,
  priceToPLN,
  rateCurrency,
  unitsPerRateUnit,
  withReportedCurrencies,
  withReportedCurrency,
} from './priceCurrency'

// Synthetic rates only.
const TABLE = new Map([['USD', 4], ['EUR', 4.25], ['GBP', 5], ['CHF', 4.5]])

describe('holdingPriceCurrency', () => {
  it('is the holding’s own currency when it has one', () => {
    expect(holdingPriceCurrency({ exchange: 'UK', currency: 'GBP' })).toBe('GBP')
    expect(holdingPriceCurrency({ exchange: 'UK', currency: 'GBX' })).toBe('GBX')
    expect(holdingPriceCurrency({ exchange: 'XETRA', currency: 'USD' })).toBe('USD')
  })

  it('falls back to the market’s default, as before', () => {
    expect(holdingPriceCurrency({ exchange: 'PL' })).toBe('PLN')
    expect(holdingPriceCurrency({ exchange: 'US' })).toBe('USD')
    expect(holdingPriceCurrency({ exchange: 'UK' })).toBe('USD')
    expect(holdingPriceCurrency({ exchange: 'XETRA' })).toBe('EUR')
    expect(holdingPriceCurrency({ exchange: 'NL' })).toBe('EUR')
    expect(holdingPriceCurrency({})).toBe('USD')
  })
})

describe('conversion', () => {
  it('pence convert at the GBP rate ÷ 100', () => {
    expect(rateCurrency('GBX')).toBe('GBP')
    expect(unitsPerRateUnit('GBX')).toBe(100)
    expect(priceToPLN(1000, 'GBX', 5)).toBe(50)
  })

  it('every other currency at its own rate', () => {
    expect(rateCurrency('GBP')).toBe('GBP')
    expect(priceToPLN(10, 'GBP', 5)).toBe(50)
    expect(priceToPLN(10, 'EUR', 4.25)).toBe(42.5)
    expect(priceToPLN(10, 'USD', 4)).toBe(40)
  })

  it('PLN is not converted', () => {
    expect(priceToPLN(10, 'PLN', 123)).toBe(10)
  })
})

describe('currencyFromYahoo', () => {
  it('reads GBp as pence, and ISO codes as they are', () => {
    expect(currencyFromYahoo('GBp')).toBe('GBX')
    expect(currencyFromYahoo('GBP')).toBe('GBP')
    expect(currencyFromYahoo('USD')).toBe('USD')
    expect(currencyFromYahoo('EUR')).toBe('EUR')
  })

  it('knows nothing else, so the market default applies', () => {
    expect(currencyFromYahoo('ZAc')).toBeUndefined()
    expect(currencyFromYahoo('')).toBeUndefined()
    expect(currencyFromYahoo(null)).toBeUndefined()
    expect(currencyFromYahoo(undefined)).toBeUndefined()
  })
})

describe('currencyCode (a file’s currency column)', () => {
  it('reads ISO codes and pence, trimmed', () => {
    expect(currencyCode(' EUR ')).toBe('EUR')
    expect(currencyCode('GBX')).toBe('GBX')
    expect(currencyCode('GBp')).toBe('GBX')
  })

  it('guesses nothing else', () => {
    expect(currencyCode('eur')).toBeUndefined()
    expect(currencyCode('Euro')).toBeUndefined()
    expect(currencyCode('')).toBeUndefined()
  })
})

describe('currencyFromStatement', () => {
  it('matches the statement’s PLN rate to a currency, pence included', () => {
    expect(currencyFromStatement(4.01, TABLE)).toBe('USD')
    expect(currencyFromStatement(5, TABLE)).toBe('GBP')
    expect(currencyFromStatement(0.05, TABLE)).toBe('GBX')
    expect(currencyFromStatement(1, TABLE)).toBe('PLN')
  })

  it('is unknown when nothing is close, or there is no rate', () => {
    expect(currencyFromStatement(2, TABLE)).toBeUndefined()
    expect(currencyFromStatement(undefined, TABLE)).toBeUndefined()
  })
})

describe('order: statement, then price data, then the market default', () => {
  it('price data fills a currency only when the holding has none', () => {
    const none = { currency: undefined as string | undefined }
    expect(withReportedCurrency(none, 'GBX')).toEqual({ currency: 'GBX' })
    const fromStatement = { currency: 'GBP' }
    expect(withReportedCurrency(fromStatement, 'GBX')).toBe(fromStatement)
    expect(withReportedCurrency(none, undefined)).toBe(none)
  })

  it('saves reported currencies on the holdings that lack one, and nothing else', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const h = (id: string, currency?: string): Holding => ({
      id, accountId: 'a1', name: id, ticker: id.toUpperCase(), exchange: 'UK', category: 'stock', quantity: 1,
      purchasePrice: 1, currentPrice: 1, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now, ...(currency && { currency }),
    })
    const accounts: Account[] = [{ id: 'a1', name: 'A', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [h('a'), h('b', 'GBP'), h('c')] }]
    const next = withReportedCurrencies(accounts, [
      { holdingId: 'a', prices: [], reportedCurrency: 'GBX' },
      { holdingId: 'b', prices: [], reportedCurrency: 'GBX' },
      { holdingId: 'c', prices: [], currency: 'USD' },
    ])
    expect(next[0].holdings.map((x) => x.currency)).toEqual(['GBX', 'GBP', undefined])
    expect(withReportedCurrencies(next, [{ holdingId: 'a', prices: [], reportedCurrency: 'GBX' }])).toBe(next)
  })
})
