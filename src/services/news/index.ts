import type { Holding } from '@/types'
import type { NewsCacheEntry } from '@/storage/portfolioStore'
import { fetchYahooNews } from './yahooNews'
import { fetchBankierNews } from './bankierNews'
import { isProviderOn, type ProviderSettings } from '@/services/providers'

export type { NewsCacheEntry }

export async function fetchNewsHeadlines(
  topHoldings: Pick<Holding, 'ticker' | 'name' | 'exchange' | 'category'>[],
  settings: ProviderSettings,
): Promise<NewsCacheEntry[]> {
  // US headlines come from Yahoo, so they follow its switch.
  const usHoldings = topHoldings.filter(
    (h) => h.ticker && h.exchange === 'US' && isProviderOn(settings, 'yahoo')
  ).map((h) => ({ ticker: h.ticker!, name: h.name }))

  const plHoldings = topHoldings.filter(
    (h) => h.ticker && h.exchange === 'PL'
  ).map((h) => ({ ticker: h.ticker!, name: h.name }))

  const [usNews, plNews] = await Promise.all([
    usHoldings.length > 0 ? fetchYahooNews(usHoldings, settings) : Promise.resolve([]),
    plHoldings.length > 0 ? fetchBankierNews(plHoldings) : Promise.resolve([]),
  ])

  return [...usNews, ...plNews]
}
