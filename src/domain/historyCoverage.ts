import type { Account, HistoricalPricesCache, Holding, HoldingPricePoint } from '@/types'
import { currencyForExchange } from '@/services/market-data/tickerUtils'
import { describeOff, isProviderOn, type ProviderId, type ProviderSettings } from '@/services/providers'

// ─────────────────────────────────────────
// Which holdings the history chart can draw
//
// A holding with a ticker (or crypto) is drawn from its fetched price series.
// When there's no series it is left out of the line, not drawn as a straight
// line from purchase to today. Bonds and other holdings without a ticker are
// interpolated as before and always count.
// ─────────────────────────────────────────

export type MissingHistory = {
  holding: Holding
  /** Providers that would have to be switched on. Empty when they're on but there's no data (failed, or still loading). */
  off: ProviderId[]
}

export type HistoryCoverage = {
  /** Price series the chart may use: only those whose providers are on. */
  historiesMap: Map<string, HoldingPricePoint[]>
  /** Open holdings left out of the line. */
  missing: MissingHistory[]
  /** Every open invested holding is left out because providers are off. */
  noHistory: boolean
  /** The providers named in the chart's message, in Settings order. */
  offProviders: ProviderId[]
}

const PROVIDER_ORDER: ProviderId[] = ['yahoo', 'eodhd', 'nbp', 'coingecko']

/**
 * Whether a holding's price history can be fetched with the providers that are
 * on: CoinGecko for crypto; EODHD or Yahoo for tickers, plus NBP to convert a
 * foreign currency to PLN.
 */
export function canFetchHistory(holding: Holding, settings: ProviderSettings): boolean {
  if (holding.category === 'crypto') return isProviderOn(settings, 'coingecko')
  if (!holding.ticker || !holding.exchange) return true // interpolated, nothing to fetch
  const hasSource = isProviderOn(settings, 'eodhd') || isProviderOn(settings, 'yahoo')
  const needsFx = currencyForExchange(holding.exchange) !== 'PLN'
  return hasSource && (!needsFx || isProviderOn(settings, 'nbp'))
}

/** Holdings whose value the chart draws from a fetched price series. */
export function needsFetchedHistory(holding: Holding): boolean {
  if (holding.isSynthetic) return false
  return holding.category === 'crypto' || !!(holding.ticker && holding.exchange)
}

/** The providers that are off and keep this holding's history from being fetched. */
export function offProvidersFor(holding: Holding, settings: ProviderSettings): ProviderId[] {
  if (canFetchHistory(holding, settings)) return []
  if (holding.category === 'crypto') return ['coingecko']
  if (!isProviderOn(settings, 'eodhd') && !isProviderOn(settings, 'yahoo')) return ['yahoo', 'eodhd']
  if (holding.exchange && currencyForExchange(holding.exchange) !== 'PLN' && !isProviderOn(settings, 'nbp')) return ['nbp']
  return []
}

export function getHistoryCoverage(
  accounts: Account[],
  settings: ProviderSettings,
  historicalPrices: HistoricalPricesCache | null | undefined,
): HistoryCoverage {
  const cached = new Map((historicalPrices?.histories ?? []).map((h) => [h.holdingId, h.prices]))
  const historiesMap = new Map<string, HoldingPricePoint[]>()
  const missing: MissingHistory[] = []
  let invested = 0

  for (const account of accounts) {
    for (const holding of account.holdings) {
      if (holding.isSynthetic) continue
      invested++
      const prices = cached.get(holding.id)
      if (!needsFetchedHistory(holding)) {
        if (prices) historiesMap.set(holding.id, prices)
        continue
      }
      const off = offProvidersFor(holding, settings)
      if (off.length === 0 && prices && prices.length > 0) historiesMap.set(holding.id, prices)
      // Before any history has loaded, a holding whose provider is on is pending, not missing.
      else if (off.length > 0 || historicalPrices) missing.push({ holding, off })
    }
    // Closed holdings keep any series cached while they were open; they're never
    // fetched again, so no switch affects them.
    for (const holding of account.closedHoldings ?? []) {
      const prices = cached.get(holding.id)
      if (prices && prices.length > 0) historiesMap.set(holding.id, prices)
    }
  }

  const offSet = new Set(missing.flatMap((m) => m.off))
  const offProviders = PROVIDER_ORDER.filter((id) => offSet.has(id))
  const noHistory = invested > 0 && missing.length === invested && missing.every((m) => m.off.length > 0)
  return { historiesMap, missing, noHistory, offProviders }
}

/**
 * The chart's message when nothing has price history:
 * "Yahoo Finance and EODHD are off, so the chart can't show how prices moved. Values today are still correct."
 */
export function noHistoryMessage(off: ProviderId[]): string {
  return `${describeOff(off)}, so the chart can't show how prices moved. Values today are still correct.`
}

/**
 * The pill over a chart that leaves holdings out because their provider is off:
 * "Bitcoin isn't in this chart: CoinGecko is off."
 * "Bitcoin and Ethereum aren't in this chart: CoinGecko is off."
 * "5 coins aren't in this chart: CoinGecko is off." / "3 holdings aren't in this chart: …"
 * Returns null when nothing is left out for that reason.
 */
export function missingHistoryMessage(missing: MissingHistory[]): string | null {
  const named = missing.filter((m) => m.off.length > 0)
  if (named.length === 0) return null
  const offSet = new Set(named.flatMap((m) => m.off))
  const reason = describeOff(PROVIDER_ORDER.filter((id) => offSet.has(id)))
  const names = named.map((m) => m.holding.name)
  if (names.length === 1) return `${names[0]} isn't in this chart: ${reason}.`
  if (names.length === 2) return `${names[0]} and ${names[1]} aren't in this chart: ${reason}.`
  const noun = named.every((m) => m.holding.category === 'crypto') ? 'coins' : 'holdings'
  return `${names.length} ${noun} aren't in this chart: ${reason}.`
}
