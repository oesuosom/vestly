import { toEODHDTicker } from './tickerUtils'
import { holdingPriceCurrency, priceToPLN, rateCurrency } from '@/domain/priceCurrency'
import type { NormalizedTicker, PriceProvider, PriceResult } from './types'
import { assertProviderOn, type ProviderSettings } from '@/services/providers'

// ─────────────────────────────────────────
// EODHD API base URL
//
// In development, requests are proxied through Vite (/api/eodhd → https://eodhd.com/api)
// to avoid the browser CORS restriction (EODHD does not return Access-Control-Allow-Origin).
// In production you would similarly need a server-side proxy or serverless function.
// ─────────────────────────────────────────

const EODHD_BASE = '/api/eodhd'

// ─────────────────────────────────────────
// EODHD API response shapes
// ─────────────────────────────────────────

type EODHDQuote = {
  code: string
  close: number
  previousClose: number
  open: number
  high: number
  low: number
  volume: number
  timestamp: number
}

// ─────────────────────────────────────────
// EODHD Provider
// ─────────────────────────────────────────

export const eodhdProvider: PriceProvider = {
  id: 'eodhd',
  name: 'EODHD',
  supported: {
    polishStocks: true,
    exchangeRates: true,
    crypto: false,   // EODHD crypto endpoint requires a paid plan; handled via Yahoo Finance
  },

  async fetchExchangeRate(from: string, to: string, settings: ProviderSettings): Promise<number> {
    assertProviderOn(settings, 'eodhd')
    const apiKey = settings.priceProvider.apiKey
    const pair = `${from}${to}.FOREX`
    const url = `${EODHD_BASE}/real-time/${pair}?api_token=${apiKey}&fmt=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`EODHD exchange rate fetch failed: ${res.status}`)
    const data = await res.json() as EODHDQuote
    const rate = data.close ?? data.previousClose
    if (!rate || isNaN(rate)) throw new Error(`EODHD returned invalid rate for ${pair}`)
    return rate
  },

  async fetchPrices(tickers: NormalizedTicker[], settings: ProviderSettings): Promise<PriceResult[]> {
    assertProviderOn(settings, 'eodhd')
    const apiKey = settings.priceProvider.apiKey
    const now = new Date().toISOString()

    // Each ticker converts from its own price currency (GBX at the GBP rate ÷ 100),
    // falling back to its market's default when the holding doesn't know it.
    const currencyOf = (t: NormalizedTicker) => holdingPriceCurrency(t)

    // Fetch each rate the tickers need, once (USD/PLN, EUR/PLN, GBP/PLN, …).
    const needed = [...new Set(tickers.map((t) => rateCurrency(currencyOf(t))).filter((c) => c !== 'PLN'))]
    const rates = new Map<string, number>([['PLN', 1]])
    const rateErrors = new Map<string, string>()
    for (const currency of needed) {
      try {
        rates.set(currency, await eodhdProvider.fetchExchangeRate!(currency, 'PLN', settings))
      } catch (err) {
        console.error(`[EODHD] Failed to fetch ${currency}/PLN rate:`, err)
        rateErrors.set(currency, `Failed to fetch ${currency}/PLN exchange rate`)
      }
    }

    // Fetch each ticker individually
    const results = await Promise.all(
      tickers.map(async (t): Promise<PriceResult> => {
        const currency = currencyOf(t)
        const rateError = rateErrors.get(rateCurrency(currency))
        // No rate, no price: a price converted with another currency's rate would be wrong.
        if (rateError) return { holdingId: t.holdingId, price: 0, currency, fetchedAt: now, error: rateError }
        const eodhdTicker = toEODHDTicker(t.ticker, t.exchange)
        const url = `${EODHD_BASE}/real-time/${eodhdTicker}?api_token=${apiKey}&fmt=json`
        try {
          const res = await fetch(url)
          if (!res.ok) {
            return { holdingId: t.holdingId, price: 0, currency, fetchedAt: now, error: `HTTP ${res.status}` }
          }
          const data = await res.json() as EODHDQuote
          const rawPrice = data.close ?? data.previousClose
          if (!rawPrice || isNaN(rawPrice)) {
            return { holdingId: t.holdingId, price: 0, currency, fetchedAt: now, error: 'No price returned' }
          }
          return {
            holdingId: t.holdingId,
            price: priceToPLN(rawPrice, currency, rates.get(rateCurrency(currency))!),
            currency,
            fetchedAt: now,
          }
        } catch (err) {
          return {
            holdingId: t.holdingId,
            price: 0,
            currency,
            fetchedAt: now,
            error: err instanceof Error ? err.message : 'Unknown error',
          }
        }
      })
    )

    return results
  },
}
