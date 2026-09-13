// ─────────────────────────────────────────
// CoinGecko API — crypto prices & history
//
// Free tier: no API key, ~10-30 req/min, CORS-friendly via Vite proxy.
// Proxy: /api/coingecko → https://api.coingecko.com
// Prices are returned directly in PLN — no FX conversion needed.
// ─────────────────────────────────────────

import { format, subDays } from 'date-fns'

const CG_BASE = '/api/coingecko/api/v3'
const CG_PRO_BASE = '/api/coingeckopro/api/v3'

// ─────────────────────────────────────────
// Ticker → CoinGecko ID mapping
// ─────────────────────────────────────────

const COINGECKO_IDS: Record<string, string> = {
  BTC:   'bitcoin',
  ETH:   'ethereum',
  SOL:   'solana',
  BNB:   'binancecoin',
  XRP:   'ripple',
  ADA:   'cardano',
  DOGE:  'dogecoin',
  DOT:   'polkadot',
  MATIC: 'matic-network',
  POL:   'matic-network',
  AVAX:  'avalanche-2',
  LINK:  'chainlink',
  UNI:   'uniswap',
  ATOM:  'cosmos',
  LTC:   'litecoin',
  NEAR:  'near',
  ALGO:  'algorand',
  FTM:   'fantom',
  CRO:   'crypto-com-chain',
  SAND:  'the-sandbox',
  MANA:  'decentraland',
  SHIB:  'shiba-inu',
  PEPE:  'pepe',
  TON:   'the-open-network',
  TRX:   'tron',
  XLM:   'stellar',
  VET:   'vechain',
  FIL:   'filecoin',
  AAVE:  'aave',
  MKR:   'maker',
  COMP:  'compound-governance-token',
  SUSHI: 'sushi',
  CRV:   'curve-dao-token',
  SUI:   'sui',
  APT:   'aptos',
}

/** Returns the CoinGecko coin ID for a ticker symbol, or null if unknown. */
export function getCoinGeckoId(ticker: string): string | null {
  // Handle "BTC-USD" format from XTB/Revolut imports
  const base = ticker.toUpperCase().replace(/-USD$/, '')
  return COINGECKO_IDS[base] ?? null
}

// ─────────────────────────────────────────
// Spot prices
// ─────────────────────────────────────────

/**
 * Fetch current PLN prices for a list of tickers via CoinGecko's simple/price endpoint.
 * Returns a map of ticker → PLN price. Tickers with no CoinGecko ID are omitted.
 */
export async function fetchCoinGeckoSpotPrices(
  tickers: string[],
  apiKey?: string,
): Promise<Map<string, number>> {
  const idToTicker = new Map<string, string>()
  for (const t of tickers) {
    const id = getCoinGeckoId(t)
    if (id) idToTicker.set(id, t.toUpperCase().replace(/-USD$/, ''))
  }

  if (idToTicker.size === 0) return new Map()

  const ids = [...idToTicker.keys()].join(',')
  // Key travels in a header, not the query string — URLs end up in proxy
  // logs and browser history.
  const headers: HeadersInit = apiKey ? { 'x-cg-demo-api-key': apiKey } : {}
  const url = `${CG_BASE}/simple/price?ids=${ids}&vs_currencies=pln`
  let res = await fetch(url, { headers })
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000))
    res = await fetch(url, { headers })
  }
  if (!res.ok) throw new Error(`CoinGecko spot price failed: ${res.status}`)

  const data = await res.json() as Record<string, { pln?: number }>
  const result = new Map<string, number>()

  for (const [id, prices] of Object.entries(data)) {
    const ticker = idToTicker.get(id)
    if (ticker && prices.pln != null) {
      result.set(ticker, prices.pln)
    }
  }

  return result
}

// ─────────────────────────────────────────
// Historical prices
// ─────────────────────────────────────────

export type CoinGeckoPricePoint = { date: string; pricePLN: number }

/**
 * Fetch full PLN price history for a crypto ticker via CoinGecko's market_chart endpoint.
 * Returns one data point per calendar month (first observation in each month).
 * Free tier returns daily granularity for ranges > 90 days — we down-sample to monthly.
 */
export async function fetchCoinGeckoHistory(ticker: string, apiKey?: string): Promise<CoinGeckoPricePoint[]> {
  const coinId = getCoinGeckoId(ticker)
  if (!coinId) throw new Error(`No CoinGecko ID for ticker: ${ticker}`)

  // Try in order (keys travel in headers, never in the URL):
  //   1. Demo key + 365 days  (Demo plan supports /market_chart but not days=max → 401)
  //   2. Pro key  + max days  (Pro plan on pro-api.coingecko.com)
  //   3. Keyless  + 365 days  (last resort — no credits consumed)
  const attempts: { url: string; headers: HeadersInit }[] = apiKey
    ? [
        { url: `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=pln&days=365`, headers: { 'x-cg-demo-api-key': apiKey } },
        { url: `${CG_PRO_BASE}/coins/${coinId}/market_chart?vs_currency=pln&days=max`, headers: { 'x-cg-pro-api-key': apiKey } },
        { url: `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=pln&days=365`, headers: {} },
      ]
    : [{ url: `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=pln&days=365`, headers: {} }]

  let res: Response | null = null
  for (const { url, headers } of attempts) {
    res = await fetch(url, { headers })
    if (res.ok) break
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      continue
    }
    break
  }

  if (!res || !res.ok) throw new Error(`CoinGecko history failed: ${res?.status ?? 'no response'}`)

  const data = await res.json() as { prices?: [number, number][] }
  const prices = data.prices ?? []

  // Keep daily granularity for the last 365 days so the chart shows accurate
  // prices across the full 1Y view (which uses daily timeline ticks).
  // For older data, downsample to one point per calendar month to keep storage small.
  const cutoffStr = format(subDays(new Date(), 365), 'yyyy-MM-dd')

  const result: CoinGeckoPricePoint[] = []
  let lastMonthKey = ''

  for (const [ts, price] of prices) {
    const d = new Date(ts)
    const dateStr = d.toISOString().slice(0, 10)
    if (dateStr >= cutoffStr) {
      // Recent: keep every daily data point
      result.push({ date: dateStr, pricePLN: price })
    } else {
      // Older: one point per calendar month (first observation)
      const monthKey = dateStr.slice(0, 7)
      if (monthKey !== lastMonthKey) {
        result.push({ date: `${monthKey}-01`, pricePLN: price })
        lastMonthKey = monthKey
      }
    }
  }

  return result
}
