// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Holding, type Settings } from '@/types'
import {
  assertProviderOn,
  describeOff,
  isProviderOn,
  isProviderSwitchedOn,
  ProviderOffError,
} from '@/services/providers'
import { generateAccountInsight, generateInsight, type AccountInsightInput, type InsightInput } from '@/services/claude'
import { fetchAllPrices } from '@/services/market-data/priceFetcher'
import { eodhdProvider } from '@/services/market-data/eodhd'
import { fetchUpcomingDividends } from '@/services/market-data/eodhdDividends'
import { fetchCoinGeckoHistory, fetchCoinGeckoSpotPrices } from '@/services/market-data/coinGecko'
import { buildHistoricalPricesCache } from '@/services/market-data/yahooHistorical'
import { fetchNewsHeadlines } from '@/services/news'
import { getNBPRate, getNBPRateRange, getNBPRateToday } from '@/services/nbp'
import { buildEMaklerImport, canResolveExchangeRates } from '@/importers/eMaklerImport'
import type { EMaklerOrderRow } from '@/importers/eMaklerParser'

// Synthetic data only.
const now = '2026-01-01T00:00:00.000Z'
const usStock: Holding = {
  id: 'h-us', accountId: 'a1', name: 'Example Corp', ticker: 'EXMP', exchange: 'US', category: 'stock',
  quantity: 10, purchasePrice: 100, currentPrice: 110, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
const plStock: Holding = { ...usStock, id: 'h-pl', name: 'Przykład SA', ticker: 'PRZK', exchange: 'PL' }
const coin: Holding = {
  id: 'h-btc', accountId: 'a1', name: 'Bitcoin', ticker: 'BTC', exchange: 'CC', category: 'crypto',
  quantity: 0.01, purchasePrice: 300000, currentPrice: 350000, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
const account = (holdings: Holding[]): Account => ({
  id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings,
})

/** Every switch off, with a fake key saved for each keyed provider. */
const allOff: Settings = {
  ...DEFAULT_SETTINGS,
  claudeApiKey: 'sk-fake', anthropicEnabled: false,
  priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd', enabled: false },
  exchangeRateProvider: { id: 'yahoo', enabled: false },
  nbpEnabled: false,
  coinGeckoEnabled: false, coinGeckoApiKey: 'fake-cg',
}
const allOn: Settings = {
  ...allOff,
  anthropicEnabled: true,
  priceProvider: { ...allOff.priceProvider, enabled: true },
  exchangeRateProvider: { id: 'yahoo', enabled: true },
  nbpEnabled: true,
  coinGeckoEnabled: true,
}
const only = (patch: Partial<Settings>): Settings => ({ ...allOff, ...patch })

const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('[]', { status: 500 }))
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))
const called = (part: string) => urls().filter((u) => u.includes(part))

const insightInput: InsightInput = {
  totalValue: 1000, delta: 10, deltaPercent: 1, period: 'since 1 Jan 2026',
  currentAllocation: { bonds: 0, stocks: 100, cash: 0, crypto: 0 },
  unrealizedPnL: 100, realizedPnL: 0, topHoldings: [], upcomingDividends: [], newsHeadlines: [],
}
const accountInsightInput: AccountInsightInput = {
  accountName: 'Test Broker', accountType: 'brokerage', totalValuePLN: 1000, costBasisPLN: 900,
  totalReturnPLN: 100, totalReturnPercent: 11, holdings: [],
}

describe('isProviderOn', () => {
  it('needs the switch and, for Anthropic and EODHD, a key', () => {
    expect(isProviderOn(allOff, 'anthropic')).toBe(false)
    expect(isProviderOn(allOn, 'anthropic')).toBe(true)
    expect(isProviderOn({ ...allOn, claudeApiKey: '' }, 'anthropic')).toBe(false)
    expect(isProviderSwitchedOn({ ...allOn, claudeApiKey: '' }, 'anthropic')).toBe(true)
    expect(isProviderOn({ ...allOn, priceProvider: { id: 'eodhd', apiKey: '', enabled: true } }, 'eodhd')).toBe(false)
  })

  it("doesn't need a CoinGecko key: the free tier works without one", () => {
    expect(isProviderOn({ ...allOn, coinGeckoApiKey: '' }, 'coingecko')).toBe(true)
  })

  it('throws ProviderOffError for a provider that is off', () => {
    expect(() => assertProviderOn(allOff, 'nbp')).toThrow(ProviderOffError)
    expect(() => assertProviderOn(allOn, 'nbp')).not.toThrow()
  })

  it('names the providers that are off', () => {
    expect(describeOff(['coingecko'])).toBe('CoinGecko is off')
    expect(describeOff(['yahoo', 'eodhd'])).toBe('Yahoo Finance and EODHD are off')
    expect(describeOff(['yahoo', 'eodhd', 'coingecko'])).toBe('Yahoo Finance, EODHD and CoinGecko are off')
  })
})

describe('Anthropic', () => {
  it('is never contacted while off, even with a key saved', async () => {
    await expect(generateInsight(insightInput, allOff)).rejects.toThrow(ProviderOffError)
    await expect(generateAccountInsight(accountInsightInput, allOff)).rejects.toThrow(ProviderOffError)
    expect(called('/api/anthropic')).toEqual([])
  })

  it('is contacted once switched on', async () => {
    await expect(generateInsight(insightInput, allOn)).rejects.toThrow()
    expect(called('/api/anthropic')).toHaveLength(1)
  })
})

describe('EODHD', () => {
  it('gets no price, rate or dividend request while off, even with a key saved', async () => {
    await fetchAllPrices([account([usStock])], allOff, { forceRefresh: true, skipPersist: true })
    expect(await fetchUpcomingDividends([usStock], allOff)).toEqual([])
    await expect(eodhdProvider.fetchPrices([{ holdingId: 'h-us', ticker: 'EXMP', exchange: 'US' }], allOff))
      .rejects.toThrow(ProviderOffError)
    expect(called('/api/eodhd')).toEqual([])
  })

  it('gets no history request while off', async () => {
    await buildHistoricalPricesCache([account([plStock])], only({ exchangeRateProvider: { id: 'yahoo', enabled: true } }), null)
    expect(called('/api/eodhd')).toEqual([])
    expect(called('/api/yahoo')).toHaveLength(1)
  })

  it('is asked for prices and dividends once switched on', async () => {
    const on = only({ priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd', enabled: true } })
    await fetchAllPrices([account([plStock])], on, { forceRefresh: true, skipPersist: true })
    await fetchUpcomingDividends([plStock], on)
    expect(called('/api/eodhd/real-time/PRZK')).toHaveLength(1)
    expect(called('/api/eodhd/div/PRZK')).toHaveLength(1)
  })
})

describe('Yahoo Finance', () => {
  it('gets no history or news request while off', async () => {
    await buildHistoricalPricesCache([account([plStock])], only({ nbpEnabled: true }), null)
    expect(await fetchNewsHeadlines([usStock], allOff)).toEqual([])
    expect(called('/api/yahoo')).toEqual([])
  })

  it('is asked for history once switched on', async () => {
    await buildHistoricalPricesCache([account([plStock])], only({ exchangeRateProvider: { id: 'yahoo', enabled: true } }), null)
    expect(called('/api/yahoo/v8/finance/chart/PRZK')).toHaveLength(1)
  })
})

describe('NBP', () => {
  it('gets no rate request while off', async () => {
    await expect(getNBPRate('USD', '2026-01-02', allOff)).rejects.toThrow(ProviderOffError)
    await expect(getNBPRateRange('USD', '2026-01-01', '2026-01-10', allOff)).rejects.toThrow(ProviderOffError)
    await expect(getNBPRateToday('USD', allOff)).rejects.toThrow(ProviderOffError)
    expect(called('api.nbp.pl')).toEqual([])
  })

  it("leaves a foreign stock's history unfetched while off, instead of converting at a made-up rate", async () => {
    const cache = await buildHistoricalPricesCache(
      [account([usStock])],
      only({ exchangeRateProvider: { id: 'yahoo', enabled: true } }),
      null,
    )
    expect(urls()).toEqual([])
    expect(cache.histories).toEqual([{ holdingId: 'h-us', prices: [] }])
  })

  it('lets the eMakler import warn up front when NBP and EODHD are both off', () => {
    expect(canResolveExchangeRates(allOff)).toBe(false)
    expect(canResolveExchangeRates(only({ nbpEnabled: true }))).toBe(true)
    expect(canResolveExchangeRates(only({ priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd', enabled: true } }))).toBe(true)
  })

  it('gets no rate request during an eMakler import while off; EODHD is the fallback when on', async () => {
    const order: EMaklerOrderRow = {
      deduplicationKey: 'k1', date: '2026-01-02T10:00:00', name: 'EXAMPLE CORP', exchange: 'NASDAQ',
      side: 'buy', quantityOrdered: 1, quantityExecuted: 1, price: 10, currency: 'USD',
    }
    await buildEMaklerImport([], [order], new Set(), allOff)
    expect(urls()).toEqual([])

    await buildEMaklerImport([], [order], new Set(), only({ priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd', enabled: true } }))
    expect(called('api.nbp.pl')).toEqual([])
    expect(called('/api/eodhd/eod/USDPLN.FOREX')).toHaveLength(1)

    fetchMock.mockClear()
    await buildEMaklerImport([], [order], new Set(), only({ nbpEnabled: true }))
    expect(called('api.nbp.pl').length).toBeGreaterThan(0)
  })
})

describe('CoinGecko', () => {
  it('gets no price or history request while off, even with a key saved', async () => {
    await fetchAllPrices([account([coin])], allOff, { forceRefresh: true, skipPersist: true })
    await buildHistoricalPricesCache([account([coin])], allOff, null)
    await expect(fetchCoinGeckoSpotPrices(['BTC'], allOff)).rejects.toThrow(ProviderOffError)
    await expect(fetchCoinGeckoHistory('BTC', allOff)).rejects.toThrow(ProviderOffError)
    expect(called('/api/coingecko')).toEqual([])
  })

  it('is asked once switched on, key or not', async () => {
    await fetchAllPrices([account([coin])], only({ coinGeckoEnabled: true, coinGeckoApiKey: '' }), { forceRefresh: true, skipPersist: true })
    expect(called('/api/coingecko/api/v3/simple/price')).toHaveLength(1)
  })
})

describe('fetchAllPrices', () => {
  it('says which switches to turn on when every price provider is off', async () => {
    const result = await fetchAllPrices([account([usStock, coin])], allOff, { forceRefresh: true, skipPersist: true })
    expect(result.warnings).toContain('EODHD and CoinGecko are off, so no prices were updated. Switch them on in Settings › Market Data.')
  })
})
