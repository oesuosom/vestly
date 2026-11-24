import type { ProviderSettings } from '@/services/providers'

// ─────────────────────────────────────────
// Provider interface types
// ─────────────────────────────────────────

export type NormalizedTicker = {
  holdingId: string
  ticker: string
  exchange: string  // 'US', 'PL', etc.
  /** The holding's own price currency, when known (ISO code, or 'GBX' for pence). */
  currency?: string
}

export type PriceResult = {
  holdingId: string
  price: number       // always PLN
  currency: string    // original currency before conversion ('GBX' for pence)
  fetchedAt: string
  error?: string
}

export type PriceProviderSupport = {
  polishStocks: boolean
  exchangeRates: boolean
  crypto: boolean         // whether the provider supports exchange === 'CC' tickers
}

export interface PriceProvider {
  id: string
  name: string
  supported: PriceProviderSupport
  /** Throws ProviderOffError when the provider is switched off. */
  fetchPrices(tickers: NormalizedTicker[], settings: ProviderSettings): Promise<PriceResult[]>
  fetchExchangeRate?(from: string, to: string, settings: ProviderSettings): Promise<number>
}

// ─────────────────────────────────────────
// Price cache
// ─────────────────────────────────────────

export type PriceCacheEntry = {
  holdingId: string
  price: number
  currency: string
  fetchedAt: string
}

export type PriceCache = {
  entries: PriceCacheEntry[]
  cachedAt: string  // ISO timestamp of the cache write
  /** Price providers that were on when the cache was written, e.g. "eodhd,coingecko". */
  providers?: string
}
