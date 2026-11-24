// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Holding, type Settings } from '@/types'
import { fetchAllPrices } from '@/services/market-data/priceFetcher'
import { buildHistoricalPricesCache } from '@/services/market-data/yahooHistorical'
import { toEODHDTicker, toYahooTicker } from '@/services/market-data/tickerUtils'
import { parseXTBCashOperationsText } from '@/importers/xtbParser'

// Issue #67: a holding is valued in its own listing currency, not its market's.
// Synthetic tickers, prices and rates only.

const now = '2026-01-01T00:00:00.000Z'
const base: Holding = {
  id: 'h', accountId: 'a1', name: 'Example', ticker: 'EXMP', exchange: 'UK', category: 'stock',
  quantity: 1, purchasePrice: 1, currentPrice: 1, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
const account = (holdings: Holding[]): Account => ({
  id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings,
})

/** EODHD and NBP on, with a fake key; Yahoo and CoinGecko off. */
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd', enabled: true },
  exchangeRateProvider: { id: 'yahoo', enabled: false },
  nbpEnabled: true,
  coinGeckoEnabled: false,
}

/** Made-up PLN rates, far enough apart that the wrong one shows. */
const RATES: Record<string, number> = { USD: 4, EUR: 4.25, GBP: 5 }
/** Made-up raw quotes, in each listing's own unit. */
const QUOTES: Record<string, number> = {
  'GBPS.LSE': 10,     // a London share quoted in pounds
  'PNCE.LSE': 1000,   // a London share quoted in pence: 10 GBP
  'USDE.LSE': 10,     // a London ETF quoted in dollars
  'EXGL.XETRA': 10,
  'VBLD.AS': 10,
}

const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input)
  const fx = url.match(/real-time\/([A-Z]{3})PLN\.FOREX/)
  if (fx) return Response.json({ close: RATES[fx[1]] })
  const quote = url.match(/real-time\/([^?]+)\?/)
  if (quote && QUOTES[quote[1]] !== undefined) return Response.json({ close: QUOTES[quote[1]] })
  return new Response('not found', { status: 404 })
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

async function pricesFor(holdings: Holding[]) {
  const r = await fetchAllPrices([account(holdings)], settings, { forceRefresh: true, skipPersist: true })
  return new Map(r.results.map((p) => [p.holdingId, p]))
}

describe('London listings are valued in their own currency', () => {
  it('a GBP-quoted share uses the GBP rate, and a GBX-quoted one is divided by 100 first', async () => {
    const prices = await pricesFor([
      { ...base, id: 'gbp', ticker: 'GBPS', currency: 'GBP' },
      { ...base, id: 'gbx', ticker: 'PNCE', currency: 'GBX' },
    ])
    expect(prices.get('gbp')).toMatchObject({ price: 50, currency: 'GBP' })
    expect(prices.get('gbx')).toMatchObject({ price: 50, currency: 'GBX' })
  })

  it('a USD-quoted London ETF still uses USD', async () => {
    const prices = await pricesFor([{ ...base, id: 'usd', ticker: 'USDE', currency: 'USD', category: 'etf' }])
    expect(prices.get('usd')).toMatchObject({ price: 40, currency: 'USD' })
  })
})

describe('XTB market suffixes', () => {
  const csv = (ticker: string, instrument: string) => [
    'Type,Instrument,Ticker,Time,Amount,ID,Comment,Product',
    `Stock purchase,${instrument},${ticker},2026-02-10 09:15:30,-42.5,1,OPEN BUY 1 @ 10.00,Stocks`,
    'Total,,,,-42.5',
  ].join('\n')

  it('".DE" imports as XETRA, with XETRA symbols', () => {
    const t = parseXTBCashOperationsText(csv('EXGL.DE', 'Example Global ETF'), 'a1', new Set()).transactions[0]
    expect(t.exchange).toBe('XETRA')
    expect(toYahooTicker(t.ticker!, t.exchange!)).toBe('EXGL.DE')
    expect(toEODHDTicker(t.ticker!, t.exchange!)).toBe('EXGL.XETRA')
  })

  it('".NL" imports as Euronext Amsterdam, with Amsterdam symbols', () => {
    const t = parseXTBCashOperationsText(csv('VBLD.NL', 'Voorbeeld NV'), 'a1', new Set()).transactions[0]
    expect(t.exchange).toBe('NL')
    expect(toYahooTicker(t.ticker!, t.exchange!)).toBe('VBLD.AS')
    expect(toEODHDTicker(t.ticker!, t.exchange!)).toBe('VBLD.AS')
  })

  it('XETRA and Amsterdam holdings with no known currency convert with EUR', async () => {
    const prices = await pricesFor([
      { ...base, id: 'de', ticker: 'EXGL', exchange: 'XETRA' },
      { ...base, id: 'nl', ticker: 'VBLD', exchange: 'NL' },
    ])
    expect(prices.get('de')).toMatchObject({ price: 42.5, currency: 'EUR' })
    expect(prices.get('nl')).toMatchObject({ price: 42.5, currency: 'EUR' })
  })
})

describe('price history', () => {
  /** Yahoo on, EODHD off: history comes from Yahoo, rates from NBP. */
  const yahooOnly: Settings = {
    ...settings,
    priceProvider: { ...settings.priceProvider, enabled: false },
    exchangeRateProvider: { id: 'yahoo', enabled: true },
  }
  const day = Date.UTC(2026, 0, 5) / 1000
  const chart = (currency: string, close: number) => Response.json({
    chart: { result: [{ meta: { currency }, timestamp: [day], indicators: { quote: [{ close: [close] }] } }], error: null },
  })
  const nbpRange = (currency: string) => Response.json({ rates: [{ effectiveDate: '2026-01-05', mid: RATES[currency] }] })

  it('a GBX-quoted London share is converted with the GBP rate ÷ 100', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/v8/finance/chart/PNCE.L')) return chart('GBp', 1000)
      const nbp = url.match(/exchangerates\/rates\/a\/([a-z]{3})\//)
      if (nbp) return nbpRange(nbp[1].toUpperCase())
      return new Response('not found', { status: 404 })
    })
    const h: Holding = { ...base, id: 'gbx', ticker: 'PNCE', currency: 'GBX', purchaseDate: '2026-01-01' }
    const cache = await buildHistoricalPricesCache([account([h])], yahooOnly)
    expect(cache.histories[0].prices).toEqual([{ date: '2026-01-05', pricePLN: 50 }])
  })
})

describe('price history: where the currency comes from', () => {
  const yahooOnly: Settings = {
    ...settings,
    priceProvider: { ...settings.priceProvider, enabled: false },
    exchangeRateProvider: { id: 'yahoo', enabled: true },
  }
  const day = Date.UTC(2026, 0, 5) / 1000
  /** Yahoo reports `currency` for every symbol; NBP answers with the made-up rates. */
  function serve(currency: string, close: number) {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/v8/finance/chart/')) {
        return Response.json({ chart: { result: [{ meta: { currency }, timestamp: [day], indicators: { quote: [{ close: [close] }] } }], error: null } })
      }
      const nbp = url.match(/exchangerates\/rates\/a\/([a-z]{3})\//)
      if (nbp) return Response.json({ rates: [{ effectiveDate: '2026-01-05', mid: RATES[nbp[1].toUpperCase()] }] })
      return new Response('not found', { status: 404 })
    })
  }
  const nbpCurrencies = () => fetchMock.mock.calls.map((c) => String(c[0])).flatMap((u) => u.match(/rates\/a\/([a-z]{3})\//)?.[1] ?? [])
  const uk = (extra: Partial<Holding> = {}): Holding => ({ ...base, id: 'uk', ticker: 'UNKN', purchaseDate: '2026-01-01', ...extra })

  it('uses what Yahoo reports when the holding has no currency, and says so', async () => {
    serve('GBp', 1000)
    const cache = await buildHistoricalPricesCache([account([uk()])], yahooOnly)
    expect(cache.histories[0]).toEqual({ holdingId: 'uk', prices: [{ date: '2026-01-05', pricePLN: 50 }], currency: 'GBX', reportedCurrency: 'GBX' })
    expect(nbpCurrencies()).toEqual(['gbp'])
  })

  it('the statement’s currency wins over what Yahoo reports', async () => {
    serve('GBp', 10)
    const cache = await buildHistoricalPricesCache([account([uk({ currency: 'USD' })])], yahooOnly)
    expect(cache.histories[0]).toMatchObject({ prices: [{ date: '2026-01-05', pricePLN: 40 }], currency: 'USD', reportedCurrency: 'GBX' })
  })

  it('a series cached in another currency is fetched again in full, not extended', async () => {
    serve('GBP', 10)
    const stale = {
      histories: [{ holdingId: 'uk', prices: [{ date: '2026-01-02', pricePLN: 40 }] }], // converted at USD before #67
      fetchedAt: '2026-01-03T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    }
    const cache = await buildHistoricalPricesCache([account([uk({ currency: 'GBP' })])], yahooOnly, stale)
    expect(cache.histories[0].prices).toEqual([{ date: '2026-01-05', pricePLN: 50 }])
    expect(fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/chart/'))).toContain('range=5y')
  })

  it('EODHD’s history converts from the holding’s currency: pence at the GBP rate ÷ 100', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('/eod/PNCE.LSE')) return Response.json([{ date: '2026-01-05', close: 1000, adjusted_close: 1000 }])
      const nbp = url.match(/exchangerates\/rates\/a\/([a-z]{3})\//)
      if (nbp) return Response.json({ rates: [{ effectiveDate: '2026-01-05', mid: RATES[nbp[1].toUpperCase()] }] })
      return new Response('not found', { status: 404 })
    })
    const h: Holding = { ...base, id: 'gbx', ticker: 'PNCE', currency: 'GBX', purchaseDate: '2026-01-01' }
    const cache = await buildHistoricalPricesCache([account([h])], settings)
    expect(cache.histories[0]).toEqual({ holdingId: 'gbx', prices: [{ date: '2026-01-05', pricePLN: 50 }], currency: 'GBX' })
  })
})

describe('provider switches still hold', () => {
  it('with NBP off, a GBP holding’s history is not fetched, and NBP is never asked', async () => {
    const nbpOff: Settings = { ...settings, nbpEnabled: false, exchangeRateProvider: { id: 'yahoo', enabled: true } }
    const h: Holding = { ...base, id: 'gbp', ticker: 'GBPS', currency: 'GBP' }
    const cache = await buildHistoricalPricesCache([account([h])], nbpOff)
    expect(cache.histories).toEqual([{ holdingId: 'gbp', prices: [] }])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('with EODHD off, no price is requested for any listing', async () => {
    const eodhdOff: Settings = { ...settings, priceProvider: { ...settings.priceProvider, enabled: false } }
    const r = await fetchAllPrices([account([{ ...base, id: 'gbx', ticker: 'PNCE', currency: 'GBX' }])], eodhdOff, { forceRefresh: true, skipPersist: true })
    expect(r.results).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a missing GBP rate fails only the GBP holdings; nothing falls back to another rate', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input)
      if (url.includes('GBPPLN.FOREX')) return new Response('error', { status: 500 })
      const fx = url.match(/real-time\/([A-Z]{3})PLN\.FOREX/)
      if (fx) return Response.json({ close: RATES[fx[1]] })
      const quote = url.match(/real-time\/([^?]+)\?/)
      if (quote && QUOTES[quote[1]] !== undefined) return Response.json({ close: QUOTES[quote[1]] })
      return new Response('not found', { status: 404 })
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const prices = await pricesFor([
      { ...base, id: 'gbp', ticker: 'GBPS', currency: 'GBP' },
      { ...base, id: 'usd', ticker: 'USDE', currency: 'USD' },
    ])
    expect(prices.get('gbp')).toMatchObject({ price: 0, error: 'Failed to fetch GBP/PLN exchange rate' })
    expect(prices.get('usd')).toMatchObject({ price: 40, currency: 'USD' })
    // The GBP holding's quote is never fetched without its rate.
    expect(fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('GBPS.LSE'))).toBe(false)
  })
})
