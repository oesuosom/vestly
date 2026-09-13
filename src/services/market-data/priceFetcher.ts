import type { Account, Settings } from '@/types'
import { saveAccounts } from '@/storage/portfolioStore'
import { eodhdProvider } from './eodhd'
import { fetchCoinGeckoSpotPrices, getCoinGeckoId } from './coinGecko'
import type { NormalizedTicker, PriceCache, PriceCacheEntry, PriceProvider, PriceResult } from './types'

// ─────────────────────────────────────────
// CoinGecko spot-price fetcher (all crypto / exchange === 'CC')
// Free, no API key, returns PLN natively — no rate-limit issues.
// ─────────────────────────────────────────

async function fetchCryptoPrices(tickers: NormalizedTicker[], apiKey?: string): Promise<PriceResult[]> {
  if (tickers.length === 0) return []
  const now = new Date().toISOString()

  const unknown = tickers.filter((t) => !getCoinGeckoId(t.ticker))
  const known   = tickers.filter((t) =>  getCoinGeckoId(t.ticker) !== null)

  const unknownResults: PriceResult[] = unknown.map((t) => ({
    holdingId: t.holdingId, price: 0, currency: 'PLN', fetchedAt: now,
    error: `Unknown crypto ticker: ${t.ticker} — add it to the CoinGecko ID map`,
  }))

  if (known.length === 0) return unknownResults

  try {
    const priceMap = await fetchCoinGeckoSpotPrices(known.map((t) => t.ticker), apiKey)
    const knownResults: PriceResult[] = known.map((t) => {
      const base = t.ticker.toUpperCase().replace(/-USD$/, '')
      const price = priceMap.get(base)
      return {
        holdingId: t.holdingId,
        price: price ?? 0,
        currency: 'PLN',
        fetchedAt: now,
        error: price == null ? `CoinGecko returned no price for ${t.ticker}` : undefined,
      }
    })
    return [...knownResults, ...unknownResults]
  } catch (err) {
    return tickers.map((t) => ({
      holdingId: t.holdingId, price: 0, currency: 'PLN', fetchedAt: now,
      error: err instanceof Error ? err.message : 'CoinGecko fetch failed',
    }))
  }
}

// ─────────────────────────────────────────
// Provider registry
// ─────────────────────────────────────────

const PROVIDERS: Record<string, PriceProvider> = {
  eodhd: eodhdProvider,
}

// ─────────────────────────────────────────
// Cache helpers
// ─────────────────────────────────────────

// Bump this version whenever a breaking change is made to exchange-code mapping
// or currency-conversion logic so old cached prices are automatically discarded.
// v1 → v2: fixed UK→LSE exchange code; added per-exchange EUR/PLN conversion.
const CACHE_KEY = 'ft_price_cache_v2'
const CACHE_MAX_AGE_MS = 23 * 60 * 60 * 1000  // 23 hours

function readCache(): PriceCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PriceCache
  } catch {
    return null
  }
}

function writeCache(entries: PriceCacheEntry[]): PriceCache {
  const cache: PriceCache = {
    entries,
    cachedAt: new Date().toISOString(),
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  return cache
}

function isCacheFresh(cache: PriceCache): boolean {
  const age = Date.now() - new Date(cache.cachedAt).getTime()
  return age < CACHE_MAX_AGE_MS
}

// ─────────────────────────────────────────
// Fetch result type
// ─────────────────────────────────────────

export type FetchAllPricesResult = {
  results: PriceResult[]
  warnings: string[]
  fromCache: boolean
  cachedAt: string | null
  /** Accounts array with updated currentPrice values. Undefined when results came from cache. */
  updatedAccounts?: Account[]
}

// ─────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────

/**
 * Fetch prices for all eligible holdings across all accounts.
 *
 * Eligible: holding.ticker && holding.exchange set, isSynthetic !== true.
 *
 * On success: updates holding.currentPrice and holding.updatedAt in-memory
 * and persists to localStorage. Results are cached for 23 hours.
 */
export async function fetchAllPrices(
  accounts: Account[],
  settings: Settings,
  options: { forceRefresh?: boolean; skipPersist?: boolean } = {}
): Promise<FetchAllPricesResult> {
  const warnings: string[] = []

  // Resolve active provider. Keyed by string, not PriceProviderId, so a corrupted
  // or out-of-date localStorage value falls through to the warning below.
  const providerId: string = settings.priceProvider?.id ?? 'eodhd'
  const provider = PROVIDERS[providerId]
  if (!provider) {
    return {
      results: [],
      warnings: [`Unknown price provider: "${providerId}"`],
      fromCache: false,
      cachedAt: null,
    }
  }

  const apiKey = settings.priceProvider?.apiKey ?? ''

  // Build list of eligible tickers
  const tickers: NormalizedTicker[] = []
  for (const account of accounts) {
    for (const holding of account.holdings) {
      if (holding.isSynthetic) continue
      if (!holding.ticker || !holding.exchange) continue
      tickers.push({
        holdingId: holding.id,
        ticker: holding.ticker,
        exchange: holding.exchange,
      })
    }
  }

  if (tickers.length === 0) {
    return {
      results: [],
      warnings: ['No holdings with ticker and exchange set. Add exchange info to holdings to enable price fetching.'],
      fromCache: false,
      cachedAt: null,
    }
  }

  // Warn if provider doesn't support Polish stocks but user has Polish holdings
  const polishTickers = tickers.filter((t) => t.exchange === 'PL')
  if (polishTickers.length > 0 && !provider.supported.polishStocks) {
    warnings.push(
      `Provider "${provider.name}" does not support Polish stocks. ` +
      `${polishTickers.length} holding(s) on Warsaw Stock Exchange will be skipped.`
    )
  }

  // Check cache unless force refresh
  if (!options.forceRefresh) {
    const cache = readCache()
    if (cache && isCacheFresh(cache)) {
      return {
        results: cache.entries.map((e) => ({
          holdingId: e.holdingId,
          price: e.price,
          currency: e.currency,
          fetchedAt: e.fetchedAt,
        })),
        warnings,
        fromCache: true,
        cachedAt: cache.cachedAt,
      }
    }
  }

  // Separate crypto (CC) tickers — EODHD doesn't cover them, so they go to
  // CoinGecko (see fetchCryptoPrices above), which returns PLN directly.
  const cryptoTickers = tickers.filter((t) => t.exchange === 'CC')
  const nonCryptoTickers = tickers.filter((t) => t.exchange !== 'CC')

  // Filter non-crypto tickers by what provider supports (e.g. Polish stocks)
  const supportedTickers = provider.supported.polishStocks
    ? nonCryptoTickers
    : nonCryptoTickers.filter((t) => t.exchange !== 'PL')

  // Fetch prices from main provider (non-crypto) and CoinGecko (crypto) in parallel
  const [providerResults, cryptoResults] = await Promise.all([
    supportedTickers.length > 0
      ? provider.fetchPrices(supportedTickers, apiKey)
      : Promise.resolve([] as PriceResult[]),
    fetchCryptoPrices(cryptoTickers, settings.coinGeckoApiKey),
  ])

  const results = [...providerResults, ...cryptoResults]

  if (results.length === 0) {
    return {
      results: [],
      warnings: [...warnings, 'No supported holdings for this provider after filtering.'],
      fromCache: false,
      cachedAt: null,
    }
  }

  // Update holdings in accounts
  const now = new Date().toISOString()
  const priceMap = new Map(results.filter((r) => !r.error).map((r) => [r.holdingId, r.price]))

  const updatedAccounts = accounts.map((account) => ({
    ...account,
    holdings: account.holdings.map((holding) => {
      const newPrice = priceMap.get(holding.id)
      if (newPrice === undefined) return holding
      return {
        ...holding,
        currentPrice: newPrice,
        updatedAt: now,
      }
    }),
  }))

  // Persist updated accounts to localStorage (skip when caller manages persistence itself)
  if (!options.skipPersist) {
    saveAccounts(updatedAccounts)
  }

  // Write cache
  const cacheEntries: PriceCacheEntry[] = results
    .filter((r) => !r.error)
    .map((r) => ({
      holdingId: r.holdingId,
      price: r.price,
      currency: r.currency,
      fetchedAt: r.fetchedAt,
    }))
  const written = writeCache(cacheEntries)

  return {
    results,
    warnings,
    fromCache: false,
    cachedAt: written.cachedAt,
    updatedAccounts,
  }
}
