import { addDays, differenceInDays, format, parseISO } from 'date-fns'
import type { Account, Holding, HistoricalPricesCache, HoldingPriceHistory, HoldingPricePoint } from '@/types'
import { currencyForExchange, toEODHDTicker, toYahooTicker } from './tickerUtils'
import { getNBPRateRange } from '@/services/nbp'
import { fetchCoinGeckoHistory, getCoinGeckoId } from './coinGecko'

const EODHD_BASE = '/api/eodhd'

// Rotate between query1 and query2 on 429 — they share backends but separate rate-limit buckets.
const YAHOO_BASES = ['/api/yahoo', '/api/yahoo2']

// ─────────────────────────────────────────
// Yahoo v8/finance/chart historical response
// ─────────────────────────────────────────

type YahooHistoricalResponse = {
  chart: {
    result: {
      meta: { currency: string }
      timestamp: number[]
      indicators: { quote: [{ close: (number | null)[] }] }
    }[] | null
    error: { code: string; description: string } | null
  }
}

// ─────────────────────────────────────────
// NBP rate lookup helper
// ─────────────────────────────────────────

/**
 * Given a sorted Map of date→rate, find the most recent rate on or before `date`.
 * Falls back to the earliest available rate if nothing is ≤ date.
 */
function lookupRate(rateMap: Map<string, number>, date: string): number {
  const dates = [...rateMap.keys()].sort()
  let result: number | undefined
  for (const d of dates) {
    if (d <= date) result = rateMap.get(d)
    else break
  }
  // Fallback: use earliest rate if date is before all available data
  if (result === undefined && dates.length > 0) {
    result = rateMap.get(dates[0])
  }
  return result ?? 1
}

// ─────────────────────────────────────────
// Ticker-based: fetch from Yahoo Finance
// ─────────────────────────────────────────

async function fetchTickerHistory(holding: Holding, range = '5y', retries = 1, attempt = 0): Promise<HoldingPricePoint[]> {
  const base = YAHOO_BASES[attempt % YAHOO_BASES.length]
  const symbol = toYahooTicker(holding.ticker!, holding.exchange!)
  const url = `${base}/v8/finance/chart/${symbol}?interval=1d&range=${range}`

  const res = await fetch(url)

  if (res.status === 429 && retries > 0) {
    await new Promise((r) => setTimeout(r, 3000))
    return fetchTickerHistory(holding, range, retries - 1, attempt + 1)
  }

  if (!res.ok) throw new Error(`Yahoo historical: HTTP ${res.status} for ${symbol}`)

  const data = (await res.json()) as YahooHistoricalResponse
  const result = data.chart?.result?.[0]
  if (!result) throw new Error(`Yahoo historical: no result for ${symbol}`)

  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []

  // Build raw price points in native currency
  type RawPoint = { date: string; priceNative: number }
  const rawPoints: RawPoint[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    if (close === null || close === undefined || isNaN(close)) continue
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
    // Only include points on or after the holding's purchase date
    if (date >= holding.purchaseDate) {
      rawPoints.push({ date, priceNative: close })
    }
  }

  if (rawPoints.length === 0) return []

  // Convert to PLN
  const currency = currencyForExchange(holding.exchange!)
  if (currency === 'PLN') {
    return rawPoints.map(p => ({ date: p.date, pricePLN: p.priceNative }))
  }

  // Fetch NBP FX range for this currency
  const startDate = rawPoints[0].date
  const endDate = rawPoints[rawPoints.length - 1].date
  const rateMap = await getNBPRateRange(currency, startDate, endDate)

  return rawPoints.map(p => ({
    date: p.date,
    pricePLN: p.priceNative * lookupRate(rateMap, p.date),
  }))
}

// ─────────────────────────────────────────
// EODHD historical (primary when an API key is set; Yahoo otherwise)
// ─────────────────────────────────────────

type EODHDBar = { date: string; adjusted_close: number; close: number }

// `from` defaults to the holding's purchase date (full history); pass a later date to fetch
// only the recent tail when extending an already-cached series.
async function fetchEodhdHistory(holding: Holding, apiKey: string, from = holding.purchaseDate): Promise<HoldingPricePoint[]> {
  const eodhdTicker = toEODHDTicker(holding.ticker!, holding.exchange!)
  const to = format(new Date(), 'yyyy-MM-dd')
  const url = `${EODHD_BASE}/eod/${eodhdTicker}?api_token=${apiKey}&fmt=json&from=${from}&to=${to}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`EODHD historical: HTTP ${res.status} for ${eodhdTicker}`)

  const data = await res.json() as EODHDBar[]
  if (!Array.isArray(data) || data.length === 0) return []

  const rawPoints = data
    .map((d) => ({ date: d.date, priceNative: d.adjusted_close ?? d.close }))
    .filter((p) => p.priceNative && !isNaN(p.priceNative))

  if (rawPoints.length === 0) return []

  const currency = currencyForExchange(holding.exchange!)
  if (currency === 'PLN') {
    return rawPoints.map((p) => ({ date: p.date, pricePLN: p.priceNative }))
  }

  const rateMap = await getNBPRateRange(currency, rawPoints[0].date, rawPoints[rawPoints.length - 1].date)
  return rawPoints.map((p) => ({ date: p.date, pricePLN: p.priceNative * lookupRate(rateMap, p.date) }))
}

// ─────────────────────────────────────────
// Non-ticker: linear interpolation (bonds)
// ─────────────────────────────────────────

function interpolateBondHistory(holding: Holding): HoldingPricePoint[] {
  const purchaseDate = parseISO(holding.purchaseDate)
  const today = new Date()
  const totalDays = differenceInDays(today, purchaseDate)

  if (totalDays <= 0) {
    return [{ date: holding.purchaseDate, pricePLN: holding.purchasePrice }]
  }

  const points: HoldingPricePoint[] = []

  // Daily ticks from purchaseDate through today
  let cursor = purchaseDate
  while (cursor <= today) {
    const dateStr = format(cursor, 'yyyy-MM-dd')
    const days = differenceInDays(cursor, purchaseDate)
    const t = Math.max(0, Math.min(1, days / totalDays))
    const price = holding.purchasePrice + (holding.currentPrice - holding.purchasePrice) * t
    points.push({ date: dateStr, pricePLN: price })
    cursor = addDays(cursor, 1)
  }

  return points
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

/**
 * Merge freshly fetched price points onto an existing series.
 * Points are deduped by date with the fresh value winning on overlap, then
 * sorted ascending. Both inputs come from the *same* provider (Yahoo or
 * CoinGecko) with the same NBP FX logic, so this never mixes price sources.
 */
function mergeHistories(
  existing: HoldingPricePoint[],
  fresh: HoldingPricePoint[],
): HoldingPricePoint[] {
  if (fresh.length === 0) return existing
  const byDate = new Map(existing.map((p) => [p.date, p]))
  for (const p of fresh) byDate.set(p.date, p)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ─────────────────────────────────────────
// Build full cache for all accounts
// ─────────────────────────────────────────

// Smallest Yahoo `range` that comfortably covers the gap since the last cached point.
// Keeps the daily catch-up cheap (1mo) while still fully backfilling a series that was
// frozen for a long time (e.g. caches left stale by the previous freeze bug).
function rangeForGap(lastDate: string): string {
  const days = differenceInDays(new Date(), parseISO(lastDate))
  if (days <= 25) return '1mo'
  if (days <= 80) return '3mo'
  if (days <= 170) return '6mo'
  if (days <= 350) return '1y'
  return '5y'
}

export async function buildHistoricalPricesCache(
  accounts: Account[],
  coinGeckoApiKey?: string,
  existingCache?: HistoricalPricesCache | null,
  eodhdApiKey?: string,
): Promise<HistoricalPricesCache> {
  const allHoldings = accounts.flatMap((a) => a.holdings)
  const todayStr = new Date().toISOString().slice(0, 10)

  // Reuse any holding that already has non-empty price history in the existing cache.
  // Empty histories are always re-fetched (e.g. first fetch without a key, now key is set).
  const reuseMap = new Map<string, HoldingPriceHistory>()
  if (existingCache) {
    for (const h of existingCache.histories) {
      reuseMap.set(h.holdingId, h)
    }
  }

  const histories: HoldingPriceHistory[] = []
  // Tasks needing a network fetch. `existing` empty → full history fetch (new holding
  // or a previous fetch that failed). `existing` non-empty → incremental extend: fetch a
  // short recent range and merge, so the series advances to today instead of freezing at
  // the date it was first fetched.
  const fetchTasks: { holding: Holding; existing: HoldingPricePoint[] }[] = []
  for (const holding of allHoldings) {
    const hasTicker = !!(holding.ticker && holding.exchange)
    const isCrypto = holding.category === 'crypto'

    if (!hasTicker && !isCrypto) {
      // Bonds / manually-entered / synthetic holdings — linear interpolation, synchronous.
      histories.push({ holdingId: holding.id, prices: interpolateBondHistory(holding) })
      continue
    }

    const cachedPrices = reuseMap.get(holding.id)?.prices ?? []
    if (cachedPrices.length === 0) {
      // New holding, or a previous fetch that failed / was rate-limited — fetch full history.
      fetchTasks.push({ holding, existing: [] })
      continue
    }

    const lastDate = cachedPrices[cachedPrices.length - 1].date
    if (lastDate >= todayStr) {
      // Series already reaches today — reuse as-is, no network call. (currentPrice is never
      // appended here: it comes from EODHD with a live FX rate and would create a
      // mixed-source spike; the chart shows today separately via liveTotal.)
      histories.push({ holdingId: holding.id, prices: cachedPrices })
    } else {
      // Series is behind (cache built on an earlier day) — extend it with the missing days.
      fetchTasks.push({ holding, existing: cachedPrices })
    }
  }

  // Process one at a time with per-provider throttling to stay within rate limits.
  // Demo CoinGecko key: 100 req/min → 750ms between calls keeps us at ~80 req/min.
  // EODHD (keyed): generous limits → light spacing. Yahoo (public): 429s hard → 2.5s spacing.
  const CONCURRENCY = 1
  const YAHOO_DELAY_MS = 2500
  const EODHD_DELAY_MS = 250
  const COINGECKO_DELAY_MS = 750
  let lastYahooFetch = 0
  let lastEodhdFetch = 0
  let lastCoinGeckoFetch = 0

  const throttle = async (last: number, delay: number) => {
    const elapsed = Date.now() - last
    if (last > 0 && elapsed < delay) await new Promise((r) => setTimeout(r, delay - elapsed))
  }

  // Stocks/ETFs: prefer EODHD when a key is set (keyed, reliable, no 429s) and fall back to
  // the public Yahoo endpoint; with no key, Yahoo is the only option. Either way the loser is
  // a fallback, so a single provider failing never blanks the series.
  const fetchTicker = async (holding: Holding, range: string, from: string): Promise<HoldingPricePoint[]> => {
    const tryYahoo = async () => {
      await throttle(lastYahooFetch, YAHOO_DELAY_MS)
      lastYahooFetch = Date.now()
      return fetchTickerHistory(holding, range)
    }
    const tryEodhd = async () => {
      await throttle(lastEodhdFetch, EODHD_DELAY_MS)
      lastEodhdFetch = Date.now()
      return fetchEodhdHistory(holding, eodhdApiKey!, from)
    }

    if (eodhdApiKey) {
      try {
        const eodhd = await tryEodhd()
        if (eodhd.length > 0) return eodhd
      } catch { /* fall through to Yahoo */ }
      try {
        return await tryYahoo()
      } catch {
        return []
      }
    }
    try {
      return await tryYahoo()
    } catch {
      return []
    }
  }

  for (let i = 0; i < fetchTasks.length; i += CONCURRENCY) {
    const batch = fetchTasks.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async ({ holding, existing }) => {
        let fetched: HoldingPricePoint[]
        const isCrypto = holding.category === 'crypto'
        const cryptoTicker = holding.ticker?.replace(/-USD$/, '')

        if (isCrypto && cryptoTicker && getCoinGeckoId(cryptoTicker)) {
          await throttle(lastCoinGeckoFetch, COINGECKO_DELAY_MS)
          lastCoinGeckoFetch = Date.now()
          // CoinGecko's daily endpoint is cheap & key-free; the full series replaces the
          // recent window and merge keeps any older points the existing cache had.
          fetched = await fetchCoinGeckoHistory(cryptoTicker, coinGeckoApiKey)
        } else if (isCrypto) {
          // Crypto with unknown ticker — leave empty (no interpolation for volatile assets)
          fetched = []
        } else if (holding.ticker && holding.exchange) {
          // Extend with the smallest range covering the gap; full history for new holdings.
          const from = existing.length > 0 ? existing[existing.length - 1].date : holding.purchaseDate
          const range = existing.length > 0 ? rangeForGap(from) : '5y'
          fetched = await fetchTicker(holding, range, from)
        } else {
          // Bonds / manually-entered holdings without ticker — synchronous, no delay needed
          fetched = interpolateBondHistory(holding)
        }
        const prices = existing.length > 0 ? mergeHistories(existing, fetched) : fetched
        return { holdingId: holding.id, prices } satisfies HoldingPriceHistory
      })
    )
    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled') {
        histories.push(result.value)
      } else {
        // Fetch failed (e.g. 429 rate limit). Keep the existing series if we had one so an
        // extend failure never wipes good data; otherwise store an empty entry so the cache
        // still "covers" this holding and we don't loop re-fetching it. Retried when the
        // 7-day TTL expires or the user force-refreshes.
        histories.push({ holdingId: batch[j].holding.id, prices: batch[j].existing })
        console.warn(`[HistoricalPrices] Skipped ${batch[j].holding.name}:`, result.reason)
      }
    }
  }

  // Preserve the original expiry across cheap daily/extend rebuilds so the 7-day TTL still
  // forces a periodic full refetch (corporate actions, adjusted-close restatements). A fresh
  // window is only minted on a full build (existingCache null = first fetch or stale cache).
  // fetchedAt always advances — it drives the once-per-day extend in useHistoricalPrices.
  const now = new Date()
  let expiresAt: string
  if (existingCache) {
    expiresAt = existingCache.expiresAt
  } else {
    const expires = new Date(now)
    expires.setDate(expires.getDate() + 7)
    expiresAt = expires.toISOString()
  }

  return {
    histories,
    fetchedAt: now.toISOString(),
    expiresAt,
  }
}
