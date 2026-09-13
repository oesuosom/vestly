import { formatPLN, formatPLNNumber, formatPercent } from '@/utils/formatters'

type StatCardProps = {
  label: string
  value: number
  delta?: number
  deltaPercent?: number
  period?: string
  icon?: React.ReactNode
  variant?: 'standalone' | 'inner'
  showCurrencyCode?: boolean
}

export function StatCard({ label, value, delta, deltaPercent, period, icon, variant = 'standalone', showCurrencyCode = false }: StatCardProps) {
  const showTrend = delta !== undefined && deltaPercent !== undefined && period !== undefined
  const isPositive = showTrend && delta > 0
  const isNeutral = showTrend && delta === 0
  const deltaColor = isPositive ? 'text-positive' : 'text-negative'

  return (
    <div className={`flex flex-col gap-2 p-6 bg-surface${variant === 'standalone' ? ' border border-border rounded-lg' : ''}`}>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm leading-none text-accent tracking-[-0.35px]">{label}</p>
        {icon && <div className="shrink-0">{icon}</div>}
      </div>
      {showCurrencyCode ? (
        <div className="flex items-baseline gap-1.5">
          <p className="text-xl leading-none font-bold text-foreground tabular-nums [font-feature-settings:'lnum'_1,'tnum'_1]">
            {formatPLNNumber(value)}
          </p>
          <p className="text-sm leading-none text-accent tracking-[-0.35px]">PLN</p>
        </div>
      ) : (
        <p className="text-xl leading-none font-bold text-foreground tabular-nums [font-feature-settings:'lnum'_1,'tnum'_1]">
          {formatPLN(value)}
        </p>
      )}
      {showTrend && (
        <div className="flex items-center gap-1">
          {!isNeutral && (
            <>
              <span className={`text-sm leading-none ${deltaColor}`}>
                {isPositive ? '+' : ''}
                {formatPLN(delta!)}
              </span>
              <span className={`text-sm leading-none ${deltaColor}`}>
                ({formatPercent(deltaPercent!, true)})
              </span>
            </>
          )}
          {isNeutral && (
            <span className="text-sm leading-none text-accent">—</span>
          )}
          <span className="text-sm leading-none text-accent">{period}</span>
        </div>
      )}
    </div>
  )
}
