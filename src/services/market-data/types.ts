// ─────────────────────────────────────────
// Provider interface types
// ─────────────────────────────────────────

export type NormalizedTicker = {
  holdingId: string
  ticker: string
  exchange: string  // 'US', 'PL', etc.
}

export type PriceResult = {
  holdingId: string
  price: number       // always PLN
  currency: string    // original currency before conversion
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
  fetchPrices(tickers: NormalizedTicker[], apiKey: string): Promise<PriceResult[]>
  fetchExchangeRate?(from: string, to: string, apiKey: string): Promise<number>
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
}
