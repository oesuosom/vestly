import type { AssetCategory } from '@/types'
import { Badge } from './Badge'

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  stock:  'Stock',
  etf:    'ETF',
  bond:   'Bond',
  crypto: 'Crypto',
  cash:   'Cash',
}

export function CategoryBadge({ category }: { category: AssetCategory }) {
  return <Badge variant="neutral">{CATEGORY_LABELS[category]}</Badge>
}
