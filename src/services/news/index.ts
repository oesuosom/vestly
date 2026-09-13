import type { Holding } from '@/types'
import type { NewsCacheEntry } from '@/storage/portfolioStore'
import { fetchYahooNews } from './yahooNews'
import { fetchBankierNews } from './bankierNews'

export type { NewsCacheEntry }

export async function fetchNewsHeadlines(
  topHoldings: Pick<Holding, 'ticker' | 'name' | 'exchange' | 'category'>[],
): Promise<NewsCacheEntry[]> {
  const usHoldings = topHoldings.filter(
    (h) => h.ticker && h.exchange === 'US'
  ).map((h) => ({ ticker: h.ticker!, name: h.name }))

  const plHoldings = topHoldings.filter(
    (h) => h.ticker && h.exchange === 'PL'
  ).map((h) => ({ ticker: h.ticker!, name: h.name }))

  const [usNews, plNews] = await Promise.all([
    usHoldings.length > 0 ? fetchYahooNews(usHoldings) : Promise.resolve([]),
    plHoldings.length > 0 ? fetchBankierNews(plHoldings) : Promise.resolve([]),
  ])

  return [...usNews, ...plNews]
}
