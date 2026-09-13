import type { Holding } from '@/types'
import type { DividendCacheEntry } from '@/storage/portfolioStore'
import { getNoDivCache, saveNoDivCache } from '@/storage/portfolioStore'
import { toEODHDTicker, currencyForExchange } from './tickerUtils'

const NO_DIV_TTL_MS = 7 * 24 * 60 * 60 * 1000

const EODHD_BASE = '/api/eodhd'

type EODHDDividend = {
  ex_date: string
  value: number
  currency: string
}

type EODHDQuote = {
  close: number
  previousClose: number
}

async function fetchUsdToPln(apiKey: string): Promise<number> {
  try {
    const res = await fetch(`${EODHD_BASE}/real-time/USDPLN.FOREX?api_token=${apiKey}&fmt=json`)
    if (!res.ok) return 4.0
    const data = (await res.json()) as EODHDQuote
    return data.close ?? data.previousClose ?? 4.0
  } catch {
    return 4.0
  }
}

export async function fetchUpcomingDividends(
  holdings: Holding[],
  eodhdApiKey: string,
): Promise<DividendCacheEntry[]> {
  if (!eodhdApiKey) return []

  const eligible = holdings.filter(
    (h) => h.ticker && !h.isSynthetic && h.exchange !== 'CC'
  )
  if (eligible.length === 0) return []

  const today = new Date()
  const from = today.toISOString().slice(0, 10)
  const to = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const cutoff = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Skip tickers that returned 404 recently (no dividend data in EODHD)
  const noDivCache = getNoDivCache()
  const now = Date.now()
  const toFetch = eligible.filter((h) => {
    const eodhdTicker = toEODHDTicker(h.ticker!, h.exchange ?? 'US')
    const cachedAt = noDivCache.tickers[eodhdTicker]
    return !cachedAt || now - new Date(cachedAt).getTime() >= NO_DIV_TTL_MS
  })

  if (toFetch.length === 0) return []

  const needsUsd = toFetch.some((h) => currencyForExchange(h.exchange ?? 'US') === 'USD')
  const usdToPln = needsUsd ? await fetchUsdToPln(eodhdApiKey) : 1

  type FetchResult = { eodhdTicker: string; entry: DividendCacheEntry | null; is404: boolean }

  const results = await Promise.allSettled(
    toFetch.map(async (h): Promise<FetchResult> => {
      const eodhdTicker = toEODHDTicker(h.ticker!, h.exchange ?? 'US')
      const url = `${EODHD_BASE}/div/${eodhdTicker}?api_token=${eodhdApiKey}&from=${from}&to=${to}&fmt=json`
      const res = await fetch(url)
      if (!res.ok) return { eodhdTicker, entry: null, is404: res.status === 404 }
      const data = (await res.json()) as EODHDDividend[]
      if (!Array.isArray(data) || data.length === 0) return { eodhdTicker, entry: null, is404: false }

      const next = data.find((d) => {
        const exDate = new Date(d.ex_date)
        return exDate >= today && exDate <= cutoff
      })
      if (!next) return { eodhdTicker, entry: null, is404: false }

      const currency = currencyForExchange(h.exchange ?? 'US')
      const valueInPln = currency === 'PLN' ? next.value : next.value * usdToPln
      const exDate = new Date(next.ex_date)
      const daysUntil = Math.round((exDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

      return {
        eodhdTicker,
        entry: {
          ticker: h.ticker!,
          name: h.name,
          exDividendDate: next.ex_date,
          daysUntil,
          estimatedPLN: Math.round(valueInPln * h.quantity * 100) / 100,
        },
        is404: false,
      }
    })
  )

  // Cache tickers that returned 404 to avoid re-fetching for 7 days
  const updatedTickers = { ...noDivCache.tickers }
  let noDivChanged = false
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.is404) {
      updatedTickers[r.value.eodhdTicker] = new Date().toISOString()
      noDivChanged = true
    }
  }
  if (noDivChanged) saveNoDivCache({ tickers: updatedTickers })

  return results
    .filter(
      (r): r is PromiseFulfilledResult<FetchResult> =>
        r.status === 'fulfilled' && r.value.entry !== null
    )
    .map((r) => r.value.entry!)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5)
}
