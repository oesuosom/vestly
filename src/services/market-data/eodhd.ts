import { toEODHDTicker, currencyForExchange } from './tickerUtils'
import type { NormalizedTicker, PriceProvider, PriceResult } from './types'

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

  async fetchExchangeRate(from: string, to: string, apiKey: string): Promise<number> {
    const pair = `${from}${to}.FOREX`
    const url = `${EODHD_BASE}/real-time/${pair}?api_token=${apiKey}&fmt=json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`EODHD exchange rate fetch failed: ${res.status}`)
    const data = await res.json() as EODHDQuote
    const rate = data.close ?? data.previousClose
    if (!rate || isNaN(rate)) throw new Error(`EODHD returned invalid rate for ${pair}`)
    return rate
  },

  async fetchPrices(tickers: NormalizedTicker[], apiKey: string): Promise<PriceResult[]> {
    const now = new Date().toISOString()

    // Determine which currency conversion rates we need
    const needsUSD = tickers.some((t) => currencyForExchange(t.exchange) === 'USD')
    const needsEUR = tickers.some((t) => currencyForExchange(t.exchange) === 'EUR')

    // Fetch required FX rates upfront (USD/PLN and/or EUR/PLN)
    let usdPlnRate = 1
    let eurPlnRate = 1

    if (needsUSD) {
      try {
        usdPlnRate = await eodhdProvider.fetchExchangeRate!('USD', 'PLN', apiKey)
      } catch (err) {
        console.error('[EODHD] Failed to fetch USD/PLN rate:', err)
        return tickers.map((t) => ({
          holdingId: t.holdingId,
          price: 0,
          currency: currencyForExchange(t.exchange),
          fetchedAt: now,
          error: 'Failed to fetch USD/PLN exchange rate',
        }))
      }
    }

    if (needsEUR) {
      try {
        eurPlnRate = await eodhdProvider.fetchExchangeRate!('EUR', 'PLN', apiKey)
      } catch (err) {
        console.error('[EODHD] Failed to fetch EUR/PLN rate:', err)
        return tickers.map((t) => ({
          holdingId: t.holdingId,
          price: 0,
          currency: currencyForExchange(t.exchange),
          fetchedAt: now,
          error: 'Failed to fetch EUR/PLN exchange rate',
        }))
      }
    }

    // Fetch each ticker individually
    const results = await Promise.all(
      tickers.map(async (t): Promise<PriceResult> => {
        const eodhdTicker = toEODHDTicker(t.ticker, t.exchange)
        const url = `${EODHD_BASE}/real-time/${eodhdTicker}?api_token=${apiKey}&fmt=json`
        const currency = currencyForExchange(t.exchange)
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
          const fxRate = currency === 'PLN' ? 1 : currency === 'EUR' ? eurPlnRate : usdPlnRate
          return {
            holdingId: t.holdingId,
            price: rawPrice * fxRate,
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
