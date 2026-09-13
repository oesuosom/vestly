import type { NewsCacheEntry } from '@/storage/portfolioStore'

type YahooNewsItem = {
  title: string
  providerPublishTime: number
  type: string
}

type YahooSearchResponse = {
  news?: YahooNewsItem[]
}

const DELAY_MS = 1200

async function fetchNewsForTicker(
  h: { ticker: string; name: string },
  sevenDaysAgo: number,
): Promise<NewsCacheEntry | null> {
  const url = `/api/yahoo/v1/finance/search?q=${encodeURIComponent(h.ticker)}&newsCount=5&quotesCount=0`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as { finance?: { result?: YahooSearchResponse[] } } | YahooSearchResponse

  // Yahoo returns either {finance: {result: [...]}} or direct {news: [...]}
  let newsItems: YahooNewsItem[] = []
  if ('finance' in data && data.finance?.result?.[0]?.news) {
    newsItems = data.finance.result[0].news
  } else if ('news' in data && Array.isArray(data.news)) {
    newsItems = data.news as YahooNewsItem[]
  }

  const headlines = newsItems
    .filter((n) => n.type === 'STORY' && n.providerPublishTime >= sevenDaysAgo)
    .slice(0, 3)
    .map((n) => n.title)

  if (headlines.length === 0) return null

  return { ticker: h.ticker, name: h.name, headlines } satisfies NewsCacheEntry
}

export async function fetchYahooNews(
  holdings: Array<{ ticker: string; name: string }>,
): Promise<NewsCacheEntry[]> {
  if (holdings.length === 0) return []

  const sevenDaysAgo = Date.now() / 1000 - 7 * 24 * 60 * 60
  const entries: NewsCacheEntry[] = []

  for (let i = 0; i < holdings.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS))
    try {
      const entry = await fetchNewsForTicker(holdings[i], sevenDaysAgo)
      if (entry) entries.push(entry)
    } catch {
      // Skip on error; news is non-critical
    }
  }

  return entries
}
