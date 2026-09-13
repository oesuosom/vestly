import { describe, it, expect } from 'vitest'
import {
  parseXTBNumber,
  parseXTBDateTime,
  tradesToTransactions,
  type ParsedTrade,
} from './xtbConfirmationParser'

describe('parseXTBNumber', () => {
  it('parses Polish-formatted numbers', () => {
    expect(parseXTBNumber('7 399,89')).toBe(7399.89)
    expect(parseXTBNumber('396,50000')).toBe(396.5)
    expect(parseXTBNumber('99,12500')).toBe(99.125)
    expect(parseXTBNumber('0,2500')).toBe(0.25)
    expect(parseXTBNumber('0,00')).toBe(0)
  })

  it('parses the FX rate column, which uses a dot decimal', () => {
    expect(parseXTBNumber('1.0000')).toBe(1)
    expect(parseXTBNumber('4.2731')).toBe(4.2731)
  })

  it('treats a dot as a thousands separator when a comma is present', () => {
    expect(parseXTBNumber('1.234,56')).toBe(1234.56)
  })

  it('rejects non-numeric input', () => {
    expect(parseXTBNumber('rynkowe')).toBeNull()
    expect(parseXTBNumber('')).toBeNull()
    expect(parseXTBNumber('KRU.PL')).toBeNull()
  })
})

describe('parseXTBDateTime', () => {
  it('combines the date and time that wrap across two lines', () => {
    expect(parseXTBDateTime('08.09.2026 09:02:54')).toBe('2026-09-08T09:02:54.000Z')
  })

  it('defaults to midnight when no time is present', () => {
    expect(parseXTBDateTime('08.09.2026')).toBe('2026-09-08T00:00:00.000Z')
  })

  it('rejects input with no date', () => {
    expect(parseXTBDateTime('09:02:54')).toBeNull()
    expect(parseXTBDateTime('')).toBeNull()
  })
})

// ─────────────────────────────────────────

/** The real KRU fractional-rights purchase from a daily statement. */
function kruTrade(overrides: Partial<ParsedTrade> = {}): ParsedTrade {
  return {
    id: 'trade-1',
    direction: 'buy',
    orderNo: '2802219889',
    ticker: 'KRU',
    exchange: 'PL',
    instrument: 'KRUK SA',
    quantity: 0.25,
    unitPriceOriginal: 396.5,
    currency: 'PLN',
    fxRate: 1,
    totalCosts: 0,
    date: '2026-09-08T09:02:54.000Z',
    grossPLN: 99.125,
    ...overrides,
  }
}

describe('tradesToTransactions', () => {
  it('builds a buy with negative cash impact', () => {
    const [t] = tradesToTransactions([kruTrade()], 'acc-1', new Map())
    expect(t).toMatchObject({
      accountId: 'acc-1',
      type: 'buy',
      amountPLN: -99.125,
      ticker: 'KRU',
      exchange: 'PL',
      instrument: 'KRUK SA',
      quantity: 0.25,
      pricePerUnitPLN: 396.5,
      originalCurrency: 'PLN',
      pricePerUnitOriginal: 396.5,
      source: 'xtb_confirmation',
    })
  })

  it('namespaces externalId so it cannot collide with a Cash Operations ID', () => {
    const [t] = tradesToTransactions([kruTrade()], 'acc-1', new Map())
    expect(t.externalId).toBe('xtb-order:2802219889')
  })

  it('adds costs to a purchase and subtracts them from a sale', () => {
    const [buy] = tradesToTransactions([kruTrade({ totalCosts: 5 })], 'acc-1', new Map())
    expect(buy.amountPLN).toBeCloseTo(-104.125, 6)

    const [sell] = tradesToTransactions(
      [kruTrade({ direction: 'sell', totalCosts: 5 })],
      'acc-1',
      new Map(),
    )
    expect(sell.amountPLN).toBeCloseTo(94.125, 6)
  })

  it('converts a foreign-currency trade at the statement FX rate', () => {
    const [t] = tradesToTransactions(
      [
        kruTrade({
          ticker: 'AGNC',
          exchange: 'US',
          currency: 'USD',
          unitPriceOriginal: 10,
          fxRate: 4,
          grossPLN: 400,
          quantity: 10,
        }),
      ],
      'acc-1',
      new Map(),
    )
    expect(t.amountPLN).toBe(-400)
    expect(t.pricePerUnitPLN).toBe(40)
    // The original-currency price is preserved untouched.
    expect(t.pricePerUnitOriginal).toBe(10)
    expect(t.originalCurrency).toBe('USD')
  })

  it("applies the user's direction over the badge reading", () => {
    const directions = new Map<string, 'buy' | 'sell'>([['trade-1', 'sell']])
    const [t] = tradesToTransactions([kruTrade()], 'acc-1', directions)
    expect(t.type).toBe('sell')
    expect(t.amountPLN).toBe(99.125)
  })

  it('drops trades whose direction is still unknown rather than guessing', () => {
    const unknown = kruTrade({ direction: null })
    expect(tradesToTransactions([unknown], 'acc-1', new Map())).toEqual([])
  })
})
