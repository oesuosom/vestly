import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Account, HistoricalPricesCache, Snapshot, Transaction } from '@/types'
import type { HistoryCoverage } from '@/domain/historyCoverage'
import type { DateRange } from '@/types'
import { ChartTooltip } from './ChartTooltip'
import { buildChartData, emptyChartMessage, isShortRange, type ChartPoint } from './chartData'
import { formatChartDate } from '@/utils/formatters'
import { colors } from '@/utils/tokens'
import { EmptyState } from '@/components/ui/EmptyState'

type PortfolioAreaChartProps = {
  snapshots: Snapshot[]
  accounts: Account[]
  transactions: Transaction[]
  dateRange: DateRange
  historicalPrices?: HistoricalPricesCache
  /**
   * Which holdings have price history (getHistoryCoverage). Holdings in
   * `coverage.missing` are left out of the line rather than drawn as a straight
   * line from purchase to today, and series from providers that are off aren't used.
   */
  coverage?: HistoryCoverage
  /** Points already built with buildChartData from the same inputs, when the caller needs them too. */
  chartData?: ChartPoint[]
  minimal?: boolean
  simplified?: boolean
}


/**
 * Custom Tooltip cursor: a vertical line that fades out at the top and bottom
 * instead of the default hard-edged full-height line. Recharts clones this
 * element with `points` ([top, bottom] of the cursor line). The gradient uses
 * userSpaceOnUse so the stops map to actual y pixels (a vertical line has a
 * zero-width bounding box, which breaks objectBoundingBox gradients).
 */
function GradientCursor({
  points,
  color = colors.foreground,
  gradientId,
}: {
  points?: { x: number; y: number }[]
  color?: string
  gradientId: string
}) {
  if (!points || points.length < 2) return null
  const [top, bottom] = points
  return (
    <g>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={top.x}
          y1={top.y}
          x2={top.x}
          y2={bottom.y}
        >
          <stop offset="0%" stopColor={color} stopOpacity={0} />
          <stop offset="25%" stopColor={color} stopOpacity={1} />
          <stop offset="75%" stopColor={color} stopOpacity={1} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line
        x1={top.x}
        y1={top.y}
        x2={top.x}
        y2={bottom.y}
        stroke={`url(#${gradientId})`}
        strokeWidth={1}
        strokeDasharray="4 6"
      />
    </g>
  )
}

export function PortfolioAreaChart({
  snapshots,
  accounts,
  transactions,
  dateRange,
  historicalPrices,
  coverage,
  chartData: precomputed,
  minimal = false,
  simplified = false,
}: PortfolioAreaChartProps) {
  const chartData = useMemo(
    () => precomputed ?? buildChartData({ snapshots, accounts, transactions, dateRange, historicalPrices, coverage }),
    [precomputed, snapshots, accounts, transactions, dateRange, historicalPrices, coverage],
  )

  // Play the left-to-right reveal once on mount, then disable so window
  // resizes (which re-render the chart at a new width) don't replay it.
  const [animateOnce, setAnimateOnce] = useState(true)

  const yDomain = useMemo((): [number, number] => {
    const vals = chartData.map((d) => d.totalValue).filter((v): v is number => v != null && !isNaN(v))
    if (vals.length === 0) return [0, 1]
    const minVal = Math.min(...vals)
    const maxVal = Math.max(...vals)
    const range = maxVal - minVal || maxVal * 0.01
    const pad = range * 0.15
    return [Math.max(0, minVal - pad), maxVal + pad]
  }, [chartData])

  // Nothing to draw, or a single point (a line needs two).
  const empty = emptyChartMessage(chartData)
  if (empty) return <EmptyState title={empty.title} description={empty.body} />

  const short = isShortRange(dateRange)

  if (minimal) {
    return (
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 4, left: 0 }} accessibilityLayer={false}>
          <YAxis domain={yDomain} hide />
          <Tooltip
            isAnimationActive={false}
            cursor={<GradientCursor color={colors.accent} gradientId="cursorFadeMinimal" />}
            content={<ChartTooltip />}
          />
          <Area
            type="monotone"
            dataKey="totalValue"
            stroke={colors.positive}
            strokeWidth={1.5}
            fill="transparent"
            dot={false}
            activeDot={{ r: 3, fill: colors.positive }}
            connectNulls={true}
            isAnimationActive={animateOnce}
            onAnimationEnd={() => setAnimateOnce(false)}
          />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  if (simplified) {
    return (
      <ResponsiveContainer width="100%" height={384}>
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <YAxis domain={yDomain} hide />
          <Tooltip
            isAnimationActive={false}
            cursor={<GradientCursor color={colors.accent} gradientId="cursorFadeSimplified" />}
            content={<ChartTooltip />}
          />
          <Area
            type="monotone"
            dataKey="totalValue"
            stroke={colors.foreground}
            strokeWidth={1.5}
            fill="transparent"
            dot={false}
            activeDot={{ r: 3, fill: colors.foreground }}
            connectNulls={true}
            isAnimationActive={animateOnce}
            onAnimationEnd={() => setAnimateOnce(false)}
          />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <defs>
            <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.accent} stopOpacity={0.15} />
              <stop offset="100%" stopColor={colors.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: colors.accent }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) => formatChartDate(value, short)}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: colors.accent, fontFamily: 'Geist Mono, monospace' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => {
              if (value >= 1000) return `${Math.round(value / 1000)}k`
              return String(value)
            }}
            width={50}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={<GradientCursor color={colors.accent} gradientId="cursorFadeMain" />}
            content={<ChartTooltip />}
          />
          <Area
            type="monotone"
            dataKey="totalValue"
            stroke={colors.accent}
            strokeWidth={1.5}
            fill="url(#portfolioFill)"
            dot={false}
            activeDot={{ r: 3, fill: colors.accent }}
            connectNulls={true}
            isAnimationActive={animateOnce}
            onAnimationEnd={() => setAnimateOnce(false)}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
