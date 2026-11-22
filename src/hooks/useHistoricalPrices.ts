import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { differenceInDays, parseISO } from 'date-fns'
import type { Account, HistoricalPricesCache } from '@/types'
import { buildHistoricalPricesCache, historyProviderSignature } from '@/services/market-data/yahooHistorical'
import type { ProviderSettings } from '@/services/providers'
import {
  HISTORICAL_PRICES_STORAGE_KEY,
  HISTORICAL_PRICES_UPDATED_EVENT,
  isHistoricalCacheFresh,
  loadHistoricalPricesCache,
  saveHistoricalPricesCache,
} from '@/storage/historicalPriceStorage'

// No general loading/error state: a failed rebuild keeps the previous cache and
// logs, and a series that came back empty is shown as such by the chart. Only an
// explicit retry is tracked, so the chart can show loading while it runs.
type UseHistoricalPricesResult = {
  historicalPrices: HistoricalPricesCache | null
  /** Fetch again whatever has no history yet (e.g. after loading failed). No reload. */
  retry: () => void
  /** A retry is running: series that failed count as loading, not failed, meanwhile. */
  isRetrying: boolean
}

// A fetched series may legitimately lag a few days behind today (weekends, holidays — the
// latest close is the previous trading day). Beyond this, the series has stopped advancing
// and the chart would flat-line recent dates, so we force a catch-up rebuild.
const DATA_STALE_DAYS = 4

/**
 * True when any ticker/crypto holding's cached price series ends well before today — the
 * signature of a cache that froze and stopped advancing. Bonds (interpolated to today) and
 * holdings with no data (failed fetches, handled by the coverage check) are ignored.
 */
function cacheDataIsBehind(cache: HistoricalPricesCache | null, accounts: Account[]): boolean {
  if (!cache) return false
  const pricesById = new Map(cache.histories.map((h) => [h.holdingId, h.prices]))
  const today = new Date()
  for (const account of accounts) {
    for (const holding of account.holdings) {
      const isFetched = !!(holding.ticker && holding.exchange) || holding.category === 'crypto'
      if (!isFetched) continue
      const prices = pricesById.get(holding.id)
      if (!prices || prices.length === 0) continue
      const lastDate = prices[prices.length - 1].date
      if (differenceInDays(today, parseISO(lastDate)) > DATA_STALE_DAYS) return true
    }
  }
  return false
}

/**
 * Manages historical price data lifecycle:
 * - Loads from localStorage cache on mount
 * - Fetches fresh data when cache is stale or holdings are added/removed
 * - Saves to localStorage on successful fetch
 *
 * NOTE: Only reruns when holding *IDs* change, not on currentPrice updates.
 * This prevents a cascade of Yahoo requests every time "Refresh All Prices" fires.
 */
export function useHistoricalPrices(accounts: Account[], settings: ProviderSettings): UseHistoricalPricesResult {
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPricesCache | null>(() =>
    loadHistoricalPricesCache()
  )

  // Changes when a history provider is switched on or off (or its key changes),
  // so switching one on takes effect without a reload.
  const providers = historyProviderSignature(settings)
  const keys = `${settings.priceProvider.apiKey}|${settings.coinGeckoApiKey}`

  // Latest settings for the effect below, which only re-runs on the strings above.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  })

  // Bumped when providers changed while a build was running, to run once more.
  const [rerun, setRerun] = useState(0)

  // Try again: each request bumps the token; the effect rebuilds once per token.
  const [retryToken, setRetryToken] = useState(0)
  const [isRetrying, setIsRetrying] = useState(false)
  const handledRetryRef = useRef(0)
  const retryTokenRef = useRef(0)
  const retry = useCallback(() => {
    retryTokenRef.current += 1
    setIsRetrying(true)
    setRetryToken(retryTokenRef.current)
  }, [])

  // Guard: prevent concurrent fetches (e.g. rapid accounts updates mid-fetch)
  const isFetchingRef = useRef(false)

  // Stable string that only changes when holdings are added/removed — NOT on price updates
  const holdingIds = useMemo(
    () => accounts.flatMap((a) => a.holdings.map((h) => h.id)).sort().join(','),
    [accounts],
  )

  useEffect(() => {
    if (!holdingIds) return
    if (isFetchingRef.current) return // already in-flight, skip

    const cache = loadHistoricalPricesCache()

    // Check if every current holding is covered by the existing cache
    const allIds = holdingIds.split(',').filter(Boolean)
    const cachedIds = new Set(cache?.histories.map((h) => h.holdingId) ?? [])
    const cacheCoversAll = allIds.every((id) => cachedIds.has(id))

    const cacheIsStale = !isHistoricalCacheFresh(cache)
    // Rebuild when the cache was built on a previous calendar day so the chart always
    // shows prices for today and any days missed since the last open.
    const today = new Date().toISOString().slice(0, 10)
    const cacheDate = cache?.fetchedAt?.slice(0, 10) ?? null
    const cacheIsFromPreviousDay = cacheDate !== null && cacheDate < today
    // Also rebuild when the price data itself has stopped advancing (e.g. a cache frozen by
    // an earlier bug). This heals on a plain page refresh instead of waiting for tomorrow's
    // first open, since fetchedAt being today otherwise suppresses the daily rebuild.
    const cacheIsBehind = cacheDataIsBehind(cache, accounts)

    // A provider switched on since the cache was built: fetch what it can now provide.
    const providerSwitchedOn = cache !== null &&
      providers.split(',').some((id) => id && !(cache.providers ?? '').split(',').includes(id))

    // Try again was pressed: refetch the series that came back empty.
    const retryRequested = retryToken !== handledRetryRef.current

    const shouldRebuild = cacheIsStale || !cacheCoversAll || cacheIsFromPreviousDay || cacheIsBehind || providerSwitchedOn || retryRequested

    // No rebuild: state already matches the cache — it's initialised from it,
    // and every later write is picked up by the listeners below.
    if (!shouldRebuild) return

    isFetchingRef.current = true
    handledRetryRef.current = retryToken

    // Pass the existing cache unless it's fully stale (7+ days) — buildHistoricalPricesCache
    // will extend stocks/ETFs with today's price point and re-interpolate bonds cheaply,
    // avoiding a full 5-year Yahoo Finance re-fetch on every daily rebuild.
    // A fully stale cache is discarded so all holdings get a fresh fetch.
    const cacheToReuse = cacheIsStale ? null : cache
    const builtWith = historyProviderSignature(settingsRef.current)
    buildHistoricalPricesCache(accounts, settingsRef.current, cacheToReuse)
      .then((newCache) => {
        saveHistoricalPricesCache(newCache)
        setHistoricalPrices(newCache)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to fetch historical prices'
        console.error('[HistoricalPrices]', msg)
        if (cache) setHistoricalPrices(cache)
      })
      .finally(() => {
        isFetchingRef.current = false
        if (handledRetryRef.current === retryTokenRef.current) setIsRetrying(false)
        // Providers changed, or Try again was pressed, while this build ran: run once more.
        if (historyProviderSignature(settingsRef.current) !== builtWith || handledRetryRef.current !== retryTokenRef.current) {
          setRerun((n) => n + 1)
        }
      })
  }, [holdingIds, providers, keys, rerun, retryToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up cache writes made elsewhere in the tree (e.g. the "Rebuild" button in the
  // settings overlay, which stays mounted alongside this hook) without a page reload,
  // and writes from other tabs, which only announce themselves via the `storage` event.
  useEffect(() => {
    const onUpdate = () => {
      const fresh = loadHistoricalPricesCache()
      if (fresh) setHistoricalPrices(fresh)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === HISTORICAL_PRICES_STORAGE_KEY) onUpdate()
    }
    window.addEventListener(HISTORICAL_PRICES_UPDATED_EVENT, onUpdate)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(HISTORICAL_PRICES_UPDATED_EVENT, onUpdate)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return { historicalPrices, retry, isRetrying }
}
