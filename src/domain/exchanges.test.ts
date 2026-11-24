import { describe, it, expect } from 'vitest'
import { EXCHANGE_CODES, exchangeFromXTBSuffix, exchangeOptions } from './exchanges'
import { toEODHDTicker, toYahooTicker } from '@/services/market-data/tickerUtils'

const CODE_LABELS = { US: 'US', PL: 'PL', UK: 'UK', XETRA: 'XETRA', NL: 'NL' }

// ─── exchangeOptions ──────────────────────────────────────────────────────────

describe('exchangeOptions', () => {
  it('lists blank, every exchange in order, then Other', () => {
    expect(exchangeOptions(CODE_LABELS).map(o => o.value)).toEqual(['', 'US', 'PL', 'UK', 'XETRA', 'NL', 'Other'])
  })

  it('uses the given labels and blank label', () => {
    const options = exchangeOptions({ ...CODE_LABELS, UK: 'UK (LSE)' }, 'None')
    expect(options[0]).toEqual({ value: '', label: 'None' })
    expect(options.find(o => o.value === 'UK')?.label).toBe('UK (LSE)')
  })

  it('defaults the blank label to an em dash', () => {
    expect(exchangeOptions(CODE_LABELS)[0].label).toBe('—')
  })
})

// ─── Provider tickers for every pickable exchange ─────────────────────────────

describe('pickable exchanges resolve to provider tickers', () => {
  const expected = {
    US:    { yahoo: 'ABC',    eodhd: 'ABC.US' },
    PL:    { yahoo: 'ABC.WA', eodhd: 'ABC.WAR' },
    UK:    { yahoo: 'ABC.L',  eodhd: 'ABC.LSE' },
    XETRA: { yahoo: 'ABC.DE', eodhd: 'ABC.XETRA' },
    NL:    { yahoo: 'ABC.AS', eodhd: 'ABC.AS' },
  }

  it.each(EXCHANGE_CODES)('%s', code => {
    expect(toYahooTicker('ABC', code)).toBe(expected[code].yahoo)
    expect(toEODHDTicker('ABC', code)).toBe(expected[code].eodhd)
  })
})

// ─── XTB's market suffixes ────────────────────────────────────────────────────

describe('exchangeFromXTBSuffix', () => {
  it.each([
    ['US', 'US'], ['PL', 'PL'], ['UK', 'UK'], ['DE', 'XETRA'], ['NL', 'NL'], ['de', 'XETRA'],
  ])('%s → %s', (suffix, code) => {
    expect(exchangeFromXTBSuffix(suffix)).toBe(code)
  })

  it('knows nothing else, so the caller keeps the suffix and warns', () => {
    expect(exchangeFromXTBSuffix('FR')).toBeUndefined()
    expect(exchangeFromXTBSuffix('')).toBeUndefined()
  })
})
