import type { Account, Settings } from '@/types'
import { saveAccounts } from '@/storage/portfolioStore'
import { eodhdProvider } from './eodhd'
import { fetchCoinGeckoSpotPrices, getCoinGeckoId } from './coinGecko'
import type { NormalizedTicker, PriceCache, PriceCacheEntry, PriceProvider, PriceResult } from './types'
import { describeOff, isProviderOn, type ProviderId, type ProviderSettings } from '@/services/providers'

// ─────────────────────────────────────────
// CoinGecko spot-price fetcher (all crypto / exchange === 'CC')
// Free, no API key, returns PLN natively — no rate-limit issues.
// ─────────────────────────────────────────

async function fetchCryptoPrices(tickers: NormalizedTicker[], settings: ProviderSettings): Promise<PriceResult[]> {
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
    const priceMap = await fetchCoinGeckoSpotPrices(known.map((t) => t.ticker), settings)
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
// v2 → v3: each holding converts from its own price currency (GBP, GBX, …); XTB's
// "DE" became XETRA and Amsterdam was added, so prices cached under v2 may be wrong.
const CACHE_KEY = 'ft_price_cache_v3'
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

/** Which price providers are on — a cache written under another set is stale. */
function providerSignature(settings: ProviderSettings): string {
  return (['eodhd', 'coingecko'] as const).filter((id) => isProviderOn(settings, id)).join(',')
}

function writeCache(entries: PriceCacheEntry[], providers: string): PriceCache {
  const cache: PriceCache = {
    entries,
    cachedAt: new Date().toISOString(),
    providers,
  }
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  return cache
}

/**
 * Drop cached prices, so the next refresh fetches and converts again: for
 * when a holding's price currency was learned after its price was cached.
 */
export function invalidatePriceCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Storage unavailable: nothing cached to drop.
  }
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
        ...(holding.currency && { currency: holding.currency }),
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
    // A provider switched on since the cache was written hasn't been asked yet.
    if (cache && isCacheFresh(cache) && cache.providers === providerSignature(settings)) {
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
  // A provider that's switched off is skipped: its holdings keep their price.
  const eodhdOn = isProviderOn(settings, 'eodhd')
  const coinGeckoOn = isProviderOn(settings, 'coingecko')
  const cryptoTickers = coinGeckoOn ? tickers.filter((t) => t.exchange === 'CC') : []
  const nonCryptoTickers = eodhdOn ? tickers.filter((t) => t.exchange !== 'CC') : []

  // Filter non-crypto tickers by what provider supports (e.g. Polish stocks)
  const supportedTickers = provider.supported.polishStocks
    ? nonCryptoTickers
    : nonCryptoTickers.filter((t) => t.exchange !== 'PL')

  // Fetch prices from main provider (non-crypto) and CoinGecko (crypto) in parallel
  const [providerResults, cryptoResults] = await Promise.all([
    supportedTickers.length > 0
      ? provider.fetchPrices(supportedTickers, settings)
      : Promise.resolve([] as PriceResult[]),
    fetchCryptoPrices(cryptoTickers, settings),
  ])

  const results = [...providerResults, ...cryptoResults]

  if (results.length === 0) {
    const off: ProviderId[] = []
    if (!eodhdOn && tickers.some((t) => t.exchange !== 'CC')) off.push('eodhd')
    if (!coinGeckoOn && tickers.some((t) => t.exchange === 'CC')) off.push('coingecko')
    return {
      results: [],
      warnings: [
        ...warnings,
        off.length > 0
          ? `${describeOff(off)}, so no prices were updated. Switch ${off.length > 1 ? 'them' : 'it'} on in Settings › Market Data.`
          : 'No supported holdings for this provider after filtering.',
      ],
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
  const written = writeCache(cacheEntries, providerSignature(settings))

  return {
    results,
    warnings,
    fromCache: false,
    cachedAt: written.cachedAt,
    updatedAccounts,
  }
}
