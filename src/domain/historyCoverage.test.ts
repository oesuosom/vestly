import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type HistoricalPricesCache, type Holding, type Settings } from '@/types'
import { getHistoryCoverage, missingHistoryMessage, noHistoryMessage, offProvidersFor } from './historyCoverage'
import { buildChartData } from '@/components/charts/chartData'

// Synthetic data only.
const NOW = '2026-01-01T00:00:00.000Z'
const today = new Date().toISOString().slice(0, 10)

function holding(fields: Partial<Holding> & Pick<Holding, 'id' | 'name' | 'category'>): Holding {
  return {
    accountId: 'a1', quantity: 1, purchasePrice: 100, currentPrice: 200,
    purchaseDate: '2026-01-01', createdAt: NOW, updatedAt: NOW, ...fields,
  }
}
const stock = holding({ id: 's1', name: 'Przykład SA', category: 'stock', ticker: 'PRZK', exchange: 'PL', quantity: 10 })
const usStock = holding({ id: 's2', name: 'Example Corp', category: 'stock', ticker: 'EXMP', exchange: 'US' })
const btc = holding({ id: 'c1', name: 'Bitcoin', category: 'crypto', ticker: 'BTC', exchange: 'CC', currentPrice: 1000 })
const eth = holding({ id: 'c2', name: 'Ethereum', category: 'crypto', ticker: 'ETH', exchange: 'CC' })
const sol = holding({ id: 'c3', name: 'Solana', category: 'crypto', ticker: 'SOL', exchange: 'CC' })
const bond = holding({ id: 'b1', name: 'Bond', category: 'bond', quantity: 10 })

const account = (holdings: Holding[]): Account => ({
  id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings,
})
const on: Settings = DEFAULT_SETTINGS // Yahoo, NBP and CoinGecko on
const off: Settings = {
  ...DEFAULT_SETTINGS,
  exchangeRateProvider: { id: 'yahoo', enabled: false },
  nbpEnabled: false,
  coinGeckoEnabled: false,
}

/** Flat 150 PLN from the purchase date to today. */
function cache(ids: string[]): HistoricalPricesCache {
  return {
    histories: ids.map((holdingId) => ({
      holdingId,
      prices: [{ date: '2026-01-01', pricePLN: 150 }, { date: today, pricePLN: 150 }],
    })),
    fetchedAt: NOW,
    expiresAt: NOW,
  }
}

describe('offProvidersFor', () => {
  it('names CoinGecko for crypto, and Yahoo Finance and EODHD for stocks', () => {
    expect(offProvidersFor(btc, off)).toEqual(['coingecko'])
    expect(offProvidersFor(stock, off)).toEqual(['yahoo', 'eodhd'])
  })

  it('names NBP for a foreign stock when a price source is on but rates are off', () => {
    expect(offProvidersFor(usStock, { ...on, nbpEnabled: false })).toEqual(['nbp'])
    expect(offProvidersFor(stock, { ...on, nbpEnabled: false })).toEqual([])
  })

  it('names nothing when the providers are on', () => {
    expect(offProvidersFor(btc, on)).toEqual([])
    expect(offProvidersFor(bond, off)).toEqual([])
  })
})

describe('getHistoryCoverage', () => {
  it('ignores a cached series whose provider has been switched off', () => {
    const c = getHistoryCoverage([account([stock, btc])], { ...on, coinGeckoEnabled: false }, cache(['s1', 'c1']))
    expect([...c.historiesMap.keys()]).toEqual(['s1'])
    expect(c.missing.map((m) => [m.holding.id, m.off])).toEqual([['c1', ['coingecko']]])
    expect(c.noHistory).toBe(false)
  })

  it('reports no history at all when every holding is left out because providers are off', () => {
    const c = getHistoryCoverage([account([stock, btc])], off, cache(['s1', 'c1']))
    expect(c.noHistory).toBe(true)
    expect(c.offProviders).toEqual(['yahoo', 'eodhd', 'coingecko'])
  })

  it('still draws bonds, so a bond account is never "no history"', () => {
    const c = getHistoryCoverage([account([stock, bond])], off, cache(['b1']))
    expect(c.noHistory).toBe(false)
    expect(c.missing.map((m) => m.holding.id)).toEqual(['s1'])
  })

  it('leaves out a holding whose fetch came back empty, without naming a provider', () => {
    const c = getHistoryCoverage([account([stock, bond])], on, { ...cache(['b1']), histories: [...cache(['b1']).histories, { holdingId: 's1', prices: [] }] })
    expect(c.missing).toEqual([{ holding: stock, off: [] }])
    expect(c.noHistory).toBe(false)
    expect(c.allFailed).toBe(false)
    expect(missingHistoryMessage(c)).toBe("Przykład SA isn't in this chart: its price history couldn't be loaded.")
  })

  it('treats holdings as pending, not missing, before any history has loaded', () => {
    expect(getHistoryCoverage([account([stock])], on, null).missing).toEqual([])
  })

  it('treats a holding not fetched yet as pending, so it never drops out of the line and comes back', () => {
    // History has loaded for the stock; Bitcoin (provider on) has no entry yet.
    const c = getHistoryCoverage([account([stock, btc])], on, cache(['s1']))
    expect(c.missing).toEqual([])
    const accounts = [account([stock, btc])]
    const points = buildChartData({ snapshots: [], accounts, transactions: [], dateRange: '1M', historicalPrices: cache(['s1']), coverage: c })
    // Today's value includes Bitcoin, as it did before history loaded.
    expect(points[points.length - 1].totalValue).toBe(2000 + 1000)
  })
})

describe('chart messages', () => {
  const missing = (hs: Holding[], settings = off) => ({
    missing: hs.map((h) => ({ holding: h, off: offProvidersFor(h, settings) })),
    allFailed: false,
  })
  /** Providers on, but the fetch came back empty. */
  const failed = (hs: Holding[]) => ({ missing: hs.map((h) => ({ holding: h, off: [] })), allFailed: false })

  it('names one holding', () => {
    expect(missingHistoryMessage(missing([btc]))).toBe("Bitcoin isn't in this chart: CoinGecko is off.")
  })

  it('names two holdings', () => {
    expect(missingHistoryMessage(missing([btc, eth]))).toBe("Bitcoin and Ethereum aren't in this chart: CoinGecko is off.")
  })

  it('counts three or more: coins when all are crypto, holdings otherwise', () => {
    expect(missingHistoryMessage(missing([btc, eth, sol]))).toBe("3 coins aren't in this chart: CoinGecko is off.")
    const stocks = [stock, { ...stock, id: 's3', name: 'Inna SA' }, { ...stock, id: 's4', name: 'Trzecia SA' }]
    expect(missingHistoryMessage(missing(stocks))).toBe("3 holdings aren't in this chart: Yahoo Finance and EODHD are off.")
  })

  it("says one holding's history couldn't be loaded", () => {
    expect(missingHistoryMessage(failed([btc]))).toBe("Bitcoin isn't in this chart: its price history couldn't be loaded.")
  })

  it("says two holdings' history couldn't be loaded", () => {
    expect(missingHistoryMessage(failed([btc, eth]))).toBe(
      "Bitcoin and Ethereum aren't in this chart: their price history couldn't be loaded.",
    )
  })

  it("counts three or more that couldn't be loaded: coins when all are crypto, holdings otherwise", () => {
    expect(missingHistoryMessage(failed([btc, eth, sol]))).toBe(
      "3 coins aren't in this chart: their price history couldn't be loaded.",
    )
    expect(missingHistoryMessage(failed([btc, eth, stock]))).toBe(
      "3 holdings aren't in this chart: their price history couldn't be loaded.",
    )
  })

  it('prefers the provider-off message when some are off and others failed to load', () => {
    const mixed = {
      missing: [{ holding: btc, off: offProvidersFor(btc, off) }, { holding: stock, off: [] }],
      allFailed: false,
    }
    expect(missingHistoryMessage(mixed)).toBe("Bitcoin isn't in this chart: CoinGecko is off.")
  })

  it('names only the providers that are off when nothing has history', () => {
    expect(noHistoryMessage(['yahoo', 'eodhd'])).toBe(
      "Yahoo Finance and EODHD are off, so the chart can't show how prices moved. Values today are still correct.",
    )
    expect(noHistoryMessage(['coingecko'])).toBe(
      "CoinGecko is off, so the chart can't show how prices moved. Values today are still correct.",
    )
  })
})

describe('every holding failed to load', () => {
  const accounts = [account([stock, btc])]
  const historicalPrices: HistoricalPricesCache = {
    ...cache([]),
    histories: [{ holdingId: 's1', prices: [] }, { holdingId: 'c1', prices: [] }],
  }

  it('keeps the chart empty instead of the "No price history … off" message or a pill', () => {
    const coverage = getHistoryCoverage(accounts, on, historicalPrices)
    expect(coverage.allFailed).toBe(true)
    expect(coverage.noHistory).toBe(false)
    expect(missingHistoryMessage(coverage)).toBeNull()
    expect(buildChartData({ snapshots: [], accounts, transactions: [], dateRange: '1M', historicalPrices, coverage })).toEqual([])
  })

  it('is not "all failed" when one is off and the other failed', () => {
    const coverage = getHistoryCoverage(accounts, { ...on, coinGeckoEnabled: false }, historicalPrices)
    expect(coverage.allFailed).toBe(false)
    expect(coverage.noHistory).toBe(false)
    expect(missingHistoryMessage(coverage)).toBe("Bitcoin isn't in this chart: CoinGecko is off.")
  })
})

describe('chart line without price history', () => {
  const accounts = [account([stock, btc])]
  const historicalPrices = cache(['s1', 'c1'])

  it('leaves the holding out of every point, today included, instead of a straight line', () => {
    const coverage = getHistoryCoverage(accounts, { ...on, coinGeckoEnabled: false }, historicalPrices)
    const points = buildChartData({ snapshots: [], accounts, transactions: [], dateRange: '1M', historicalPrices, coverage })
    // Only the stock: 10 × 150 on history days, 10 × 200 today. Bitcoin (1 000) is in none of them.
    expect(points[0].totalValue).toBe(1500)
    expect(points[points.length - 1]).toEqual({ date: today, totalValue: 2000 })
    expect(points.every((p) => p.totalValue === undefined || p.totalValue <= 2000)).toBe(true)
  })

  it('draws every holding when all have history', () => {
    const coverage = getHistoryCoverage(accounts, on, historicalPrices)
    const points = buildChartData({ snapshots: [], accounts, transactions: [], dateRange: '1M', historicalPrices, coverage })
    expect(points[0].totalValue).toBe(1500 + 150)
    expect(points[points.length - 1].totalValue).toBe(2000 + 1000)
  })
})
