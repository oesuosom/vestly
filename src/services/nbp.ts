// ─────────────────────────────────────────
// NBP (National Bank of Poland) Exchange Rate API
//
// Free, no authentication required.
// Note: single-date queries return 404 for weekends/holidays — callers must
// fall back to a range query (getNBPRateRange) to find the nearest prior rate.
// ─────────────────────────────────────────

const NBP_BASE = 'https://api.nbp.pl/api/exchangerates/rates/a'

type NBPResponse = { rates: { mid: number }[] }

/**
 * Fetch a historical exchange rate from NBP for a given date.
 * @param currency  ISO currency code, e.g. 'USD', 'GBP'
 * @param date      ISO date string — only the first 10 chars (YYYY-MM-DD) are used
 */
export async function getNBPRate(currency: string, date: string): Promise<number> {
  const dateOnly = date.slice(0, 10)
  const url = `${NBP_BASE}/${currency.toLowerCase()}/${dateOnly}/?format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`NBP: HTTP ${res.status} for ${currency}/${dateOnly}`)
  const data = (await res.json()) as NBPResponse
  const mid = data.rates?.[0]?.mid
  if (!mid || isNaN(mid)) throw new Error(`NBP: invalid rate for ${currency}/${dateOnly}`)
  return mid
}

/**
 * Fetch a range of historical exchange rates from NBP in a single call.
 * Returns a Map of effectiveDate → mid rate, sorted ascending.
 *
 * NBP limit: max 367 days per request. For longer ranges this function
 * splits into yearly chunks and merges the results.
 *
 * @param currency  ISO currency code, e.g. 'USD', 'EUR'
 * @param startDate yyyy-MM-dd
 * @param endDate   yyyy-MM-dd
 */
export async function getNBPRateRange(
  currency: string,
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  type NBPRangeResponse = { rates: { effectiveDate: string; mid: number }[] }

  const result = new Map<string, number>()
  const cur = currency.toLowerCase()

  // Split into ~360-day chunks to stay within NBP's 367-day limit
  let chunkStart = new Date(startDate)
  const end = new Date(endDate)

  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart)
    chunkEnd.setDate(chunkEnd.getDate() + 360)
    if (chunkEnd > end) chunkEnd.setTime(end.getTime())

    const from = chunkStart.toISOString().slice(0, 10)
    const to = chunkEnd.toISOString().slice(0, 10)

    try {
      const url = `${NBP_BASE}/${cur}/${from}/${to}/?format=json`
      const res = await fetch(url)
      if (res.ok) {
        const data = (await res.json()) as NBPRangeResponse
        for (const rate of data.rates ?? []) {
          result.set(rate.effectiveDate, rate.mid)
        }
      }
    } catch {
      // If a chunk fails, continue — partial data is better than nothing
    }

    chunkStart = new Date(chunkEnd)
    chunkStart.setDate(chunkStart.getDate() + 1)
  }

  return result
}

/**
 * Fetch today's exchange rate from NBP.
 * Useful as a fallback when the historical date is too recent or unavailable.
 * @param currency  ISO currency code, e.g. 'USD', 'GBP'
 */
export async function getNBPRateToday(currency: string): Promise<number> {
  const url = `${NBP_BASE}/${currency.toLowerCase()}/today/?format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`NBP today: HTTP ${res.status} for ${currency}`)
  const data = (await res.json()) as NBPResponse
  const mid = data.rates?.[0]?.mid
  if (!mid || isNaN(mid)) throw new Error(`NBP today: invalid rate for ${currency}`)
  return mid
}
