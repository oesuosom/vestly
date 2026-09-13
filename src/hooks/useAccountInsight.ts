import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account } from '@/types'
import {
  generateAccountInsight,
  type AccountInsightInput,
  type AccountInsightHolding,
} from '@/services/claude'
import {
  getAccountInsightCache,
  saveAccountInsightCache,
  type AccountInsightCache,
} from '@/storage/portfolioStore'
import { getHoldingValue, getHoldingPnL } from '@/domain/calculations'

const INSIGHT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function isFresh(cachedAt: string, ttlMs: number): boolean {
  return Date.now() - new Date(cachedAt).getTime() < ttlMs
}

function getIsoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${weekNo}`
}

function buildInputHash(accountId: string, totalValue: number): string {
  return `${accountId}:${getIsoWeek(new Date())}:${Math.round(totalValue)}`
}

export type UseAccountInsightResult = {
  summary: string | null
  isLoading: boolean
  error: string | null
  cachedAt: string | null
  regenerate: () => void
}

type Props = {
  account: Account | undefined
  costBasisPLN: number
  totalReturnPLN: number
  totalReturnPercent: number
  currentValuePLN: number
  ikeLimitPLN?: number
  ikeRemainingPLN?: number
  ikzeLimitPLN?: number
  ikzeRemainingPLN?: number
  claudeApiKey: string
}

export function useAccountInsight({
  account,
  costBasisPLN,
  totalReturnPLN,
  totalReturnPercent,
  currentValuePLN,
  ikeLimitPLN,
  ikeRemainingPLN,
  ikzeLimitPLN,
  ikzeRemainingPLN,
  claudeApiKey,
}: Props): UseAccountInsightResult {
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
    if (!account || !claudeApiKey || currentValuePLN === 0) return
    if (isFetchingRef.current) return

    const inputHash = buildInputHash(account.id, currentValuePLN)

    if (!forceRefresh) {
      const cached = getAccountInsightCache(account.id)
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

    const holdings: AccountInsightHolding[] = account.holdings
      .filter((h) => !h.isSynthetic)
      .map((h) => {
        const value = getHoldingValue(h)
        const { pnl, pnlPercent } = getHoldingPnL(h)
        return {
          name: h.name,
          ticker: h.ticker,
          category: h.category,
          quantity: h.quantity,
          valuePLN: value,
          returnPLN: pnl,
          returnPercent: pnlPercent,
          allocationPercent: currentValuePLN > 0 ? (value / currentValuePLN) * 100 : 0,
        }
      })
      .sort((a, b) => b.valuePLN - a.valuePLN)

    const insightInput: AccountInsightInput = {
      accountName: account.name,
      accountType: account.type,
      totalValuePLN: currentValuePLN,
      costBasisPLN,
      totalReturnPLN,
      totalReturnPercent,
      holdings,
      ikeLimitPLN,
      ikeRemainingPLN,
      ikzeLimitPLN,
      ikzeRemainingPLN,
    }

    const run = async () => {
      const text = await generateAccountInsight(insightInput, claudeApiKey)
      const now = new Date().toISOString()
      const cache: AccountInsightCache = { summary: text, cachedAt: now, inputHash }
      saveAccountInsightCache(account.id, cache)
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
  // Deps are deliberately narrowed to the values that should trigger a new
  // insight. `account` and the contribution figures are read inside but left
  // out: `account` is a fresh object on most renders, so listing it would fire
  // a paid Anthropic request on every re-render. The cache key (`inputHash`)
  // already covers what actually changes the answer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeApiKey, account?.id, currentValuePLN, forceRefresh])

  return { summary, isLoading, error, cachedAt, regenerate }
}
