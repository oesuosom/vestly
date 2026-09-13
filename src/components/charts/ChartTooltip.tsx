import { formatPLN, formatTooltipDate } from '@/utils/formatters'

// recharts v3's TooltipProps no longer exposes payload/label generically;
// type the runtime-injected props explicitly instead.
type ChartTooltipProps = {
  active?: boolean
  payload?: ReadonlyArray<{
    dataKey?: string | number
    value?: number | string
    payload?: { date?: string }
  }>
  label?: unknown
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const portfolioEntry = payload.find((p) => p.dataKey === 'totalValue')

  // recharts v3 doesn't reliably pass `label` to a custom tooltip `content`
  // component, so prefer the date carried on the original data point and fall
  // back to `label` only when present. Snapshot dates are "yyyy-MM-dd".
  const rawDate =
    payload[0]?.payload?.date ?? (typeof label === 'string' ? label : undefined)
  const formattedLabel = rawDate
    ? (rawDate.length === 10 ? formatTooltipDate(rawDate) : rawDate)
    : ''

  return (
    <div className="bg-surface border border-border shadow-sm rounded-md px-3 py-2 flex items-baseline gap-2">
      {formattedLabel && (
        <span className="font-mono text-xs font-medium text-foregroundMuted">{formattedLabel}</span>
      )}
      {formattedLabel && portfolioEntry && (
        <span className="font-mono text-xs text-foregroundMuted">·</span>
      )}
      {portfolioEntry && (
        <span className="font-mono text-xs font-medium text-foreground">
          {formatPLN(portfolioEntry.value as number)}
        </span>
      )}
    </div>
  )
}
