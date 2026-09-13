import { formatPLN, formatPLNDetail, formatPercent } from '@/utils/formatters'

type PnLSize = 'sm' | 'md' | 'lg'

type PnLValueProps = {
  value: number
  /** When omitted the percentage is not rendered (e.g. when a sibling column already shows it). */
  percent?: number
  size?: PnLSize
  /** Use high-precision formatting (2 decimal places) for detail/drawer views */
  detail?: boolean
}

const sizeClasses: Record<PnLSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
}

export function PnLValue({ value, percent, size = 'sm', detail = false }: PnLValueProps) {
  if (value === 0) {
    return (
      <span className={`font-mono text-accent ${sizeClasses[size]}`}>
        —
      </span>
    )
  }

  const colorClass = value > 0 ? 'text-positive' : 'text-negative'
  const sign = value > 0 ? '+' : ''
  const fmt = detail ? formatPLNDetail : formatPLN

  return (
    <span className={`font-mono ${colorClass} ${sizeClasses[size]}`}>
      {sign}{fmt(value)}
      {percent !== undefined && (
        <>{' '}<span className="opacity-70">{formatPercent(percent, true)}</span></>
      )}
    </span>
  )
}
