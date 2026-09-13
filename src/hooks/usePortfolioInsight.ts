import { useCallback, useEffect, useRef, useState } from 'react'
import type { Holding } from '@/types'
import { generateInsight, type InsightInput, type InsightTopHolding } from '@/services/claude'
import { fetchUpcomingDividends } from '@/services/market-data/eodhdDividends'
import { fetchNewsHeadlines } from '@/services/news'
import {
  getInsightCache,
  saveInsightCache,
  getDividendCache,
  saveDividendCache,
  getNewsCache,
  saveNewsCache,
  type InsightCache,
} from '@/storage/portfolioStore'
const INSIGHT_TTL_MS = 4 * 60 * 60 * 1000     // 4 hours
const DIVIDEND_TTL_MS = 24 * 60 * 60 * 1000   // 24 hours
const NEWS_TTL_MS = 60 * 60 * 1000            // 1 hour

function isFresh(cachedAt: string, ttlMs: number): boolean {
  return Date.now() - new Date(cachedAt).getTime() < ttlMs
}

function buildInputHash(totalValue: number, delta: number, topHolding?: InsightTopHolding): string {
  const today = new Date().toISOString().slice(0, 10)
  return `${today}:${Math.round(totalValue)}:${Math.round(delta)}:${topHolding?.ticker ?? ''}`
}

export type BaseInsightInput = {
  totalValue: number
  delta: number
  deltaPercent: number
  period: string
  currentAllocation: { bonds: number; stocks: number; cash: number; crypto: number }
  unrealizedPnL: number
  realizedPnL: number
  topHoldings: InsightTopHolding[]
  allHoldings: Holding[]
}

export type UsePortfolioInsightResult = {
  summary: string | null
  isLoading: boolean
  error: string | null
  cachedAt: string | null
  regenerate: () => void
}

export function usePortfolioInsight(
  baseInput: BaseInsightInput,
  claudeApiKey: string,
  eodhdApiKey: string,
): UsePortfolioInsightResult {
  const [summary, setSummary] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [forceRefresh, setForceRefresh] = useState(false)

  const isFetchingRef = useRef(false)

  const regenerate = useCallback(() => {
    setForceRefresh((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!claudeApiKey || baseInput.totalValue === 0) return
    if (isFetchingRef.current) return

    const inputHash = buildInputHash(baseInput.totalValue, baseInput.delta, baseInput.topHoldings[0])

    // Serve from cache if fresh and hash matches
    if (!forceRefresh) {
      const cached = getInsightCache()
      if (cached && isFresh(cached.cachedAt, INSIGHT_TTL_MS) && cached.inputHash === inputHash) {
        setSummary(cached.summary)
        setCachedAt(cached.cachedAt)
        return
      }
    }

    isFetchingRef.current = true
    // Cleared here, not in .finally(): `forceRefresh` is an effect dep, so the
    // reset re-runs this effect. Doing it now means that re-run hits the
    // in-flight guard above. Resetting on completion instead re-ran it after a
    // *failed* regenerate, when no cache had been written — firing a second
    // paid Anthropic request for the same input.
    setForceRefresh(false)
    setIsLoading(true)
    setError(null)

    const run = async () => {
      // Dividends — use cache if fresh
      let dividends = (() => {
        const dc = getDividendCache()
        return dc && isFresh(dc.cachedAt, DIVIDEND_TTL_MS) ? dc.dividends : null
      })()

      // News — use cache if fresh
      let news = (() => {
        const nc = getNewsCache()
        return nc && isFresh(nc.cachedAt, NEWS_TTL_MS) ? nc.entries : null
      })()

      // Fetch stale/missing data in parallel
      const [freshDividends, freshNews] = await Promise.all([
        dividends === null
          ? fetchUpcomingDividends(baseInput.allHoldings, eodhdApiKey)
          : Promise.resolve(null),
        news === null
          ? fetchNewsHeadlines(
              baseInput.allHoldings
                .filter((h) => !h.isSynthetic)
                .sort((a, b) => b.quantity * b.currentPrice - a.quantity * a.currentPrice)
                .slice(0, 10)
            )
          : Promise.resolve(null),
      ])

      if (freshDividends !== null) {
        dividends = freshDividends
        saveDividendCache({ dividends: freshDividends, cachedAt: new Date().toISOString() })
      }

      if (freshNews !== null) {
        news = freshNews
        saveNewsCache({ entries: freshNews, cachedAt: new Date().toISOString() })
      }

      const insightInput: InsightInput = {
        ...baseInput,
        upcomingDividends: dividends ?? [],
        newsHeadlines: news ?? [],
      }

      const text = await generateInsight(insightInput, claudeApiKey)
      const now = new Date().toISOString()

      const cache: InsightCache = { summary: text, cachedAt: now, inputHash }
      saveInsightCache(cache)
      setSummary(text)
      setCachedAt(now)
    }

    run()
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to generate insight'
        setError(msg)
      })
      .finally(() => {
        isFetchingRef.current = false
        setIsLoading(false)
      })
  // Deps are deliberately narrowed, as in useAccountInsight: `baseInput` is
  // rebuilt each render, so depending on the object would fire a paid Anthropic
  // request every time. Only the fields that change the answer are listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeApiKey, eodhdApiKey, baseInput.totalValue, baseInput.delta, forceRefresh])

  return { summary, isLoading, error, cachedAt, regenerate }
}
