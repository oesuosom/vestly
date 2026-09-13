import type { Account, AssetCategory, Holding } from '@/types'
import { getHoldingValue, getAccountValue } from '@/domain/calculations'

const INITIALS_PALETTE = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B',
  '#10B981', '#14B8A6', '#0EA5E9', '#3B82F6', '#A855F7',
]

export function getTickerInitials(ticker: string): string {
  return ticker.slice(0, 4).toUpperCase()
}

export function getInitialsColor(ticker: string): string {
  let hash = 0
  for (let i = 0; i < ticker.length; i++) {
    hash = ticker.charCodeAt(i) + ((hash << 5) - hash)
  }
  return INITIALS_PALETTE[Math.abs(hash) % INITIALS_PALETTE.length]
}

export type AccountIconDisplay =
  | { type: 'single-badge'; category: AssetCategory }
  | { type: 'multi-logo'; holdings: Holding[]; overflow: number }

export function getAccountIconDisplay(account: Account): AccountIconDisplay {
  const { holdings } = account
  if (holdings.length === 0) return { type: 'single-badge', category: 'cash' }

  const totalValue = getAccountValue(account)
  if (totalValue === 0) return { type: 'single-badge', category: 'cash' }

  const valueByCategory: Partial<Record<AssetCategory, number>> = {}
  for (const holding of holdings) {
    const val = getHoldingValue(holding)
    valueByCategory[holding.category] = (valueByCategory[holding.category] ?? 0) + val
  }

  const categoryCount = Object.keys(valueByCategory).length
  if (categoryCount > 1) {
    for (const [category, value] of Object.entries(valueByCategory) as [AssetCategory, number][]) {
      if (value / totalValue >= 0.8) {
        return { type: 'single-badge', category }
      }
    }
  }

  const sorted = [...holdings].sort((a, b) => getHoldingValue(b) - getHoldingValue(a))
  if (sorted.length <= 5) {
    return { type: 'multi-logo', holdings: sorted, overflow: 0 }
  }
  return { type: 'multi-logo', holdings: sorted.slice(0, 5), overflow: sorted.length - 5 }
}
