import type { ComponentType } from 'react'
import { TokenIcon } from '@web3icons/react/dynamic'
import type { Holding, AssetCategory } from '@/types'
import { colors } from '@/utils/tokens'
import { getTickerInitials, getInitialsColor } from '@/utils/holdingIcon'
import { LOGO_REGISTRY } from '@/generated/logos'
import { CoinsBold, MedalBold, SparkleBold } from '@/generated/icons'

const CATEGORY_COLORS: Record<AssetCategory, string> = {
  stock:  colors.chartGroupEquity,
  etf:    colors.chartGroupEquity,
  bond:   colors.chartGroupBonds,
  crypto: colors.chartGroupCrypto,
  cash:   colors.chartGroupCash,
}

const CATEGORY_ICONS: Record<AssetCategory, ComponentType<{ size?: number; className?: string }>> = {
  cash:   CoinsBold,
  bond:   MedalBold,
  stock:  SparkleBold,
  etf:    SparkleBold,
  crypto: SparkleBold,
}

type HoldingIconProps = {
  holding: Holding
  size?: number
}

function CategoryIcon({ holding, size }: { holding: Holding; size: number }) {
  const bg = CATEGORY_COLORS[holding.category]
  const Icon = CATEGORY_ICONS[holding.category]
  return (
    <div
      style={{ width: size, height: size, backgroundColor: bg }}
      className="rounded-full flex items-center justify-center shrink-0"
    >
      <Icon size={Math.round(size * 0.50)} className="text-white" />
    </div>
  )
}

function resolveLogoKey(holding: Holding): string | null {
  // Exact ticker.exchange match
  const tickerKey = holding.ticker
    ? holding.exchange ? `${holding.ticker}.${holding.exchange}` : holding.ticker
    : null
  if (tickerKey && LOGO_REGISTRY[tickerKey]) return tickerKey

  // ETF brand match — check if any brand key (no dot = not a ticker) is in the holding name
  if (holding.category === 'etf') {
    for (const key of Object.keys(LOGO_REGISTRY)) {
      if (!key.includes('.') && holding.name.includes(key)) return key
    }
  }

  return null
}

export function HoldingIcon({ holding, size = 24 }: HoldingIconProps) {
  // Crypto: delegate to web3icons — background variant with category circle fallback
  if (holding.category === 'crypto' && holding.ticker) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full overflow-hidden shrink-0"
      >
        <TokenIcon
          symbol={holding.ticker}
          size={size}
          variant="background"
          fallback={<CategoryIcon holding={holding} size={size} />}
        />
      </div>
    )
  }

  // Tier 1: local SVG logo by ticker.exchange or ETF brand name
  const logoKey = resolveLogoKey(holding)
  if (logoKey) {
    const Logo = LOGO_REGISTRY[logoKey]
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full overflow-hidden shrink-0"
      >
        <Logo size={size} />
      </div>
    )
  }

  // Tier 2: initials avatar — stocks and ETFs with a ticker
  if (holding.ticker && holding.category !== 'bond' && holding.category !== 'cash') {
    const letters = getTickerInitials(holding.ticker)
    const bg = getInitialsColor(holding.ticker)
    return (
      <div
        style={{ width: size, height: size, backgroundColor: bg }}
        className="rounded-full flex items-center justify-center shrink-0"
      >
        <span
          style={{ fontSize: Math.round(size * 0.35) }}
          className="font-bold text-white leading-none select-none"
        >
          {letters}
        </span>
      </div>
    )
  }

  // Tier 3: category circle
  return <CategoryIcon holding={holding} size={size} />
}
