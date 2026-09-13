import type { HistoricalPricesCache } from '@/types'

// v6: removed extendWithToday — historiesMap now contains only Yahoo/CoinGecko data,
// no EODHD currentPrice points mixed in. Invalidates v5 caches that have contaminated series.
const STORAGE_KEY = 'ft_historical_prices_v6'
const TTL_DAYS = 7

// Fired after the cache is written so mounted consumers (e.g. the chart hook) can pick up
// writes made from elsewhere in the tree — like the "Rebuild" button in the settings overlay
// — without a full page reload.
export const HISTORICAL_PRICES_UPDATED_EVENT = 'ft:historical-prices-updated'

export function loadHistoricalPricesCache(): HistoricalPricesCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as HistoricalPricesCache
  } catch {
    return null
  }
}

export function saveHistoricalPricesCache(cache: HistoricalPricesCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(HISTORICAL_PRICES_UPDATED_EVENT))
    }
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

export function isHistoricalCacheFresh(cache: HistoricalPricesCache | null): boolean {
  if (!cache) return false
  return new Date(cache.expiresAt) > new Date()
}

export function clearHistoricalPricesCache(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export { TTL_DAYS }
