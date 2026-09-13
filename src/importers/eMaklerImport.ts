// ─────────────────────────────────────────
// eMakler Import — combined matching & cost-basis logic
// ─────────────────────────────────────────

import { getNBPRate, getNBPRateRange, getNBPRateToday } from '@/services/nbp'
import type { EMaklerOrderRow, EMaklerPortfolioRow } from './eMaklerParser'
import type { Settings } from '@/types'

// ─────────────────────────────────────────
// localStorage helpers for order deduplication
// ─────────────────────────────────────────

const EMAKLER_KEYS_STORAGE = 'ft_emakler_order_keys'

export function loadEMaklerOrderKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(EMAKLER_KEYS_STORAGE)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

export function saveEMaklerOrderKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(EMAKLER_KEYS_STORAGE, JSON.stringify([...keys]))
  } catch {
    // Ignore storage errors
  }
}

// ─────────────────────────────────────────
// Public result types
// ─────────────────────────────────────────

export type EMaklerHoldingResult = {
  name: string
  exchange: string
  quantity: number
  currentPrice: number          // PLN
  purchasePrice: number         // PLN — 0 if no order match / rate unavailable
  purchaseDate: string          // ISO date (YYYY-MM-DD) — today if no order match
  priceCurrency: string         // original currency of the instrument
  originalPurchasePrice: number // price in priceCurrency — 0 if no order match
  nbpRateUsed: number           // FX rate applied — 1 if PLN, 0 if unknown
  status: 'complete' | 'missing_cost_basis'
  category: 'stock' | 'etf'    // default 'stock'; user can change in modal
}

export type EMaklerTransactionData = {
  deduplicationKey: string
  date: string              // ISO datetime
  name: string
  exchange: string
  side: 'buy' | 'sell'
  quantity: number
  pricePerUnitPLN: number
  /** Signed cash impact: negative for a buy (money out), positive for a sell (proceeds in). */
  amountPLN: number
  originalCurrency: string
  pricePerUnitOriginal: number
}

export type EMaklerImportResult = {
  holdings: EMaklerHoldingResult[]
  transactions: EMaklerTransactionData[]
  duplicatesSkipped: number
  warnings: string[]
}

// ─────────────────────────────────────────
// NBP rate resolution with fallback chain
// ─────────────────────────────────────────

/** Infer asset category from the holding name. 'etf' if "ETF" appears in the name, else 'stock'. */
function inferCategory(name: string): 'stock' | 'etf' {
  return /\betf\b/i.test(name) ? 'etf' : 'stock'
}

/**
 * Memoised per (currency, date). An import resolves the same handful of
 * currency/date pairs once per holding *and* once per order row, and each miss
 * can cost up to three chained NBP requests (single-date 404 → 14-day range →
 * today). Caching the promise rather than the value also means concurrent
 * callers share one in-flight request.
 */
const rateCache = new Map<string, Promise<{ rate: number; resolved: boolean }>>()

function resolveRate(
  currency: string,
  purchaseDate: string,
  settings?: Settings,
): Promise<{ rate: number; resolved: boolean }> {
  if (currency === 'PLN') return Promise.resolve({ rate: 1, resolved: true })
  const key = `${currency}|${purchaseDate.slice(0, 10)}`
  const hit = rateCache.get(key)
  if (hit) return hit
  const pending = resolveRateUncached(currency, purchaseDate, settings)
  rateCache.set(key, pending)
  return pending
}

async function resolveRateUncached(
  currency: string,
  purchaseDate: string,
  settings?: Settings,
): Promise<{ rate: number; resolved: boolean }> {

  // 1. Historical NBP rate for the purchase date
  try {
    const rate = await getNBPRate(currency, purchaseDate)
    return { rate, resolved: true }
  } catch { /* fall through */ }

  // 2. Nearest prior trading day — NBP 404s on single-date queries for
  //    weekends/holidays. Ask for the preceding two weeks and take the
  //    latest published rate; falling back to today's rate here would
  //    misprice the cost basis of anything bought on a non-trading day.
  try {
    const dateOnly = purchaseDate.slice(0, 10)
    const from = new Date(dateOnly)
    from.setDate(from.getDate() - 14)
    const rates = await getNBPRateRange(currency, from.toISOString().slice(0, 10), dateOnly)
    const latest = [...rates.keys()].sort().pop()
    if (latest) return { rate: rates.get(latest)!, resolved: true }
  } catch { /* fall through */ }

  // 3. Today's NBP rate (last resort, e.g. NBP range endpoint unavailable)
  try {
    const rate = await getNBPRateToday(currency)
    return { rate, resolved: true }
  } catch { /* fall through */ }

  // 4. EODHD historical forex (via Vite proxy — requires API key)
  const eodhdKey = settings?.priceProvider.id === 'eodhd' ? settings.priceProvider.apiKey : ''
  if (eodhdKey) {
    try {
      const dateOnly = purchaseDate.slice(0, 10)
      const pair = `${currency}PLN.FOREX`
      const url = `/api/eodhd/eod/${pair}?api_token=${eodhdKey}&from=${dateOnly}&to=${dateOnly}&fmt=json`
      const res = await fetch(url)
      if (res.ok) {
        const data = (await res.json()) as { close: number }[]
        const rate = Array.isArray(data) && data.length > 0 ? data[0].close : 0
        if (rate && !isNaN(rate)) return { rate, resolved: true }
      }
    } catch { /* fall through */ }
  }

  return { rate: 0, resolved: false }
}

// ─────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────

/**
 * Build the full import result by matching portfolio rows against order rows.
 *
 * Scenarios:
 *   portfolio + orders → full data; purchasePrice from most-recent buy order
 *   portfolio only    → all holdings get status = 'missing_cost_basis'
 *   orders only       → holdings built from buy orders; currentPrice = purchasePrice (placeholder)
 *
 * @param portfolioRows         Parsed portfolio snapshot rows (may be empty)
 * @param orderRows             Parsed order-history rows (may be empty)
 * @param existingOrderKeys     Previously processed deduplicationKeys (for skip logic)
 * @param settings              Optional — used for the EODHD NBP fallback
 */
export async function buildEMaklerImport(
  portfolioRows: EMaklerPortfolioRow[],
  orderRows: EMaklerOrderRow[],
  existingOrderKeys: Set<string>,
  settings?: Settings,
): Promise<EMaklerImportResult> {
  const warnings: string[] = []
  let duplicatesSkipped = 0
  const today = new Date().toISOString().slice(0, 10)

  // ── Filter out already-processed order rows ──────────────────────────────
  const freshOrderRows = orderRows.filter((o) => {
    if (existingOrderKeys.has(o.deduplicationKey)) {
      duplicatesSkipped++
      return false
    }
    return true
  })

  // ── Build lookup maps: "name|exchange" → orders ──────────────────────────
  // Cost basis is derived from buys only — that is deliberate, not an oversight:
  // a sale tells you nothing about what the position cost. Sells are tracked
  // separately because they still have to net out the quantity on the
  // orders-only path below, where there is no portfolio snapshot to trust.
  const buyMap = new Map<string, EMaklerOrderRow[]>()
  const sellQtyMap = new Map<string, number>()
  for (const order of freshOrderRows) {
    const key = `${order.name}|${order.exchange}`
    if (order.side === 'buy') {
      const arr = buyMap.get(key) ?? []
      arr.push(order)
      buyMap.set(key, arr)
    } else {
      sellQtyMap.set(key, (sellQtyMap.get(key) ?? 0) + order.quantityExecuted)
    }
  }

  // ── Case: orders only — no portfolio snapshot ────────────────────────────
  if (portfolioRows.length === 0) {
    const holdings: EMaklerHoldingResult[] = []

    for (const [key, orders] of buyMap) {
      // No portfolio snapshot here, so quantity has to be reconstructed from the
      // order history — net of anything sold, or a closed position would come
      // back as if it were still held.
      const bought = orders.reduce((s, o) => s + o.quantityExecuted, 0)
      const quantity = bought - (sellQtyMap.get(key) ?? 0)
      if (quantity <= 0) continue
      const mostRecent = orders.reduce((a, b) => (a.date > b.date ? a : b))
      const purchaseDateISO = mostRecent.date.slice(0, 10)

      const { rate, resolved } = await resolveRate(mostRecent.currency, purchaseDateISO, settings)

      if (!resolved) {
        warnings.push(
          `Could not resolve ${mostRecent.currency}/PLN rate for ${mostRecent.name} on ${purchaseDateISO}. Enter purchase price manually.`,
        )
      }

      const pricePLN = resolved ? mostRecent.price * rate : 0

      holdings.push({
        name: mostRecent.name,
        exchange: mostRecent.exchange,
        quantity,
        currentPrice: 0, // unknown — no portfolio snapshot; will be set by price refresh
        purchasePrice: pricePLN,
        purchaseDate: purchaseDateISO,
        priceCurrency: mostRecent.currency,
        originalPurchasePrice: mostRecent.price,
        nbpRateUsed: rate,
        status: resolved ? 'complete' : 'missing_cost_basis',
        category: inferCategory(mostRecent.name),
      })
    }

    const transactions = await buildTransactionData(freshOrderRows, settings)
    return { holdings, transactions, duplicatesSkipped, warnings }
  }

  // ── Case: portfolio (± orders) ───────────────────────────────────────────
  const holdings: EMaklerHoldingResult[] = []

  for (const row of portfolioRows) {
    const matchKey = `${row.name}|${row.exchange}`
    const buyOrders = buyMap.get(matchKey) ?? []

    // Current price in PLN — use totalValuePLN / quantity if foreign currency
    const currentPricePLN =
      row.priceCurrency === 'PLN'
        ? row.currentPrice
        : row.quantity > 0
          ? row.totalValuePLN / row.quantity
          : 0

    if (buyOrders.length === 0) {
      // Portfolio-only — no order history to derive cost basis
      holdings.push({
        name: row.name,
        exchange: row.exchange,
        quantity: row.quantity,
        currentPrice: currentPricePLN,
        purchasePrice: 0,
        purchaseDate: today,
        priceCurrency: row.priceCurrency,
        originalPurchasePrice: 0,
        nbpRateUsed: row.priceCurrency === 'PLN' ? 1 : 0,
        status: 'missing_cost_basis',
        category: inferCategory(row.name),
      })
      continue
    }

    // Use the most recent buy order for cost basis
    const mostRecent = buyOrders.reduce((a, b) => (a.date > b.date ? a : b))
    const purchaseDateISO = mostRecent.date.slice(0, 10)

    const { rate, resolved } = await resolveRate(mostRecent.currency, purchaseDateISO, settings)

    if (!resolved) {
      warnings.push(
        `Could not resolve ${mostRecent.currency}/PLN rate for ${row.name} on ${purchaseDateISO}. Enter purchase price manually.`,
      )
    }

    const purchasePricePLN = resolved ? mostRecent.price * rate : 0

    holdings.push({
      name: row.name,
      exchange: row.exchange,
      quantity: row.quantity,
      currentPrice: currentPricePLN,
      purchasePrice: purchasePricePLN,
      purchaseDate: purchaseDateISO,
      priceCurrency: mostRecent.currency,
      originalPurchasePrice: mostRecent.price,
      nbpRateUsed: rate,
      status: resolved ? 'complete' : 'missing_cost_basis',
      category: inferCategory(row.name),
    })
  }

  const transactions = await buildTransactionData(freshOrderRows, settings)
  return { holdings, transactions, duplicatesSkipped, warnings }
}

// ─────────────────────────────────────────
// Transaction data builder (shared by both paths)
// ─────────────────────────────────────────

async function buildTransactionData(
  orderRows: EMaklerOrderRow[],
  settings?: Settings,
): Promise<EMaklerTransactionData[]> {
  const result: EMaklerTransactionData[] = []
  for (const order of orderRows) {
    const orderDate = order.date.slice(0, 10)
    const { rate } = await resolveRate(order.currency, orderDate, settings)
    const pricePLN = rate ? order.price * rate : 0
    const gross = pricePLN * order.quantityExecuted
    result.push({
      deduplicationKey: order.deduplicationKey,
      date: order.date,
      name: order.name,
      exchange: order.exchange,
      side: order.side,
      quantity: order.quantityExecuted,
      pricePerUnitPLN: pricePLN,
      // Buys take cash out, sells put proceeds back in.
      amountPLN: order.side === 'buy' ? -gross : gross,
      originalCurrency: order.currency,
      pricePerUnitOriginal: order.price,
    })
  }
  return result
}
