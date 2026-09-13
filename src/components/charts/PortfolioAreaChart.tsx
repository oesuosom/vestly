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
import { getTotalValue } from '@/domain/calculations'
import { buildHistoriesMap, computePortfolioAt } from '@/domain/portfolioValue'
import type { DateRange } from '@/types'
import { ChartTooltip } from './ChartTooltip'
import { formatChartDate } from '@/utils/formatters'
import { colors } from '@/utils/tokens'
import { addDays, addMonths, format, parseISO, startOfMonth, subMonths } from 'date-fns'
import { EmptyState } from '@/components/ui/EmptyState'

type PortfolioAreaChartProps = {
  snapshots: Snapshot[]
  accounts: Account[]
  transactions: Transaction[]
  dateRange: DateRange
  historicalPrices?: HistoricalPricesCache
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

function getCutoffDate(range: DateRange): string | null {
  switch (range) {
    case '1M':
      return format(subMonths(new Date(), 1), 'yyyy-MM-dd')
    case '3M':
      return format(subMonths(new Date(), 3), 'yyyy-MM-dd')
    case '6M':
      return format(subMonths(new Date(), 6), 'yyyy-MM-dd')
    case '1Y':
      return format(subMonths(new Date(), 12), 'yyyy-MM-dd')
    case 'ALL':
      return null
  }
}

function isShortRange(range: DateRange): boolean {
  return range === '1M' || range === '3M' || range === '6M'
}

/**
 * Build a sorted, deduplicated list of dates from `startDate` through today,
 * then merge in any snapshot dates.
 *
 * For 1M/3M/6M/1Y: daily ticks so the chart has a continuous line even on days
 * the app was never opened. For ALL: monthly ticks to keep the view clean.
 */
function buildTimeline(startDate: string, dateRange: DateRange): string[] {
  const dates = new Set<string>()
  const today = new Date()

  if (dateRange === 'ALL') {
    // Monthly ticks — keeps the ALL view clean and consistent
    let cursor = startOfMonth(parseISO(startDate))
    while (cursor <= today) {
      dates.add(format(cursor, 'yyyy-MM-dd'))
      cursor = addMonths(cursor, 1)
    }
  } else {
    // Daily ticks — fills every calendar day for 1M / 3M / 6M / 1Y
    let cursor = parseISO(startDate)
    while (cursor <= today) {
      dates.add(format(cursor, 'yyyy-MM-dd'))
      cursor = addDays(cursor, 1)
    }
  }

  return [...dates].sort()
}

/**
 * Linearly interpolate a portfolio value for `date` between the two nearest
 * anchor points (snapshots + today's live value).
 *
 * Returns undefined when `date` is before all known anchors (no history yet).
 * Anchors must be sorted by date ascending.
 */
function interpolateAnchors(
  date: string,
  anchors: { date: string; value: number }[],
): number | undefined {
  if (anchors.length === 0) return undefined

  // Binary-search for the last anchor whose date <= date (the "before" anchor)
  let lo = 0
  let hi = anchors.length - 1
  let beforeIdx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (anchors[mid].date <= date) {
      beforeIdx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // No anchor on or before this date → no data yet (chart shows nothing)
  if (beforeIdx === -1) return undefined

  const before = anchors[beforeIdx]
  const after = beforeIdx + 1 < anchors.length ? anchors[beforeIdx + 1] : undefined

  // Date is on or after the last anchor → carry the last known value
  if (!after) return before.value

  // Linear interpolation between the two surrounding anchors
  const t0 = parseISO(before.date).getTime()
  const t1 = parseISO(after.date).getTime()
  const t = parseISO(date).getTime()
  if (t1 === t0) return before.value
  const ratio = (t - t0) / (t1 - t0)
  return before.value + (after.value - before.value) * ratio
}

export function PortfolioAreaChart({
  snapshots,
  accounts,
  transactions,
  dateRange,
  historicalPrices,
  minimal = false,
  simplified = false,
}: PortfolioAreaChartProps) {
  const chartData = useMemo(() => {
    const snapshotsSorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
    const snapshotMap = new Map(snapshotsSorted.map((s) => [s.date, s.totalValue]))

    const today = new Date()
    const todayStr = format(today, 'yyyy-MM-dd')
    const liveTotal = getTotalValue(accounts)

    // Anchor points: all snapshots + today's live value, sorted by date.
    // Between any two anchors the chart interpolates linearly, which eliminates
    // the false jumps that computePortfolioAt introduced for non-snapshot dates:
    //   • synthetic cash always projected the current balance into the past
    //   • crypto was excluded when no historical price existed → total < cost basis
    //   • a holding with a recent purchaseDate caused a hard step on that exact date
    const anchors: { date: string; value: number }[] = snapshotsSorted
      .filter((s) => s.date !== todayStr)
      .map((s) => ({ date: s.date, value: s.totalValue }))
    anchors.push({ date: todayStr, value: liveTotal })

    // Timeline starts from the earliest holding purchase date (or first snapshot).
    // This preserves the full pre-snapshot history via computePortfolioAt.
    const allHoldings = accounts.flatMap((a) => a.holdings)
    const firstPurchaseDate = allHoldings.length > 0
      ? allHoldings.map((h) => h.purchaseDate).sort()[0]
      : null
    const firstSnapshotDate = snapshotsSorted[0]?.date ?? null
    const timelineStart = [firstPurchaseDate, firstSnapshotDate]
      .filter(Boolean)
      .sort()[0] as string | undefined

    if (!timelineStart) return []

    const allDates = buildTimeline(timelineStart, dateRange)
    const cutoffStr = getCutoffDate(dateRange)
    const filtered = cutoffStr ? allDates.filter((d) => d >= cutoffStr) : allDates
    if (filtered.length === 0) return []

    const historiesMap = buildHistoriesMap(historicalPrices)

    return filtered.map((date) => {
      if (date === todayStr) {
        return { date, totalValue: liveTotal }
      }

      // When market price history is available, prefer computing from prices over
      // reading stored snapshot values. Snapshots can embed inconsistent price
      // sources (e.g. eMakler export FX rate one day, EODHD live prices the next),
      // which produces artificial spikes. Market prices give a consistent curve.
      if (historiesMap) {
        const computed = computePortfolioAt(date, accounts, transactions, historiesMap, today)
        if (computed !== undefined) {
          return { date, totalValue: computed }
        }
      }

      // Fallback: stored snapshot (used when no market price data is loaded)
      const snapshotValue = snapshotMap.get(date)
      if (snapshotValue !== undefined) {
        return { date, totalValue: snapshotValue }
      }

      // Fallback: linear interpolation between snapshot anchors
      const interpolated = interpolateAnchors(date, anchors)
      if (interpolated !== undefined) {
        return { date, totalValue: interpolated }
      }

      // Last resort: pre-anchor dates with no market prices
      return {
        date,
        totalValue: computePortfolioAt(date, accounts, transactions, null, today),
      }
    })
  }, [snapshots, accounts, transactions, dateRange, historicalPrices])

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

  if (chartData.length === 0) {
    return (
      <EmptyState
        title="No chart data yet"
        description="Add transactions or open the app daily to start building your portfolio history."
      />
    )
  }

  // Need at least 2 points to draw meaningful lines
  const hasEnoughData = chartData.length >= 2
  if (!hasEnoughData) {
    return (
      <EmptyState
        title="Not enough history yet"
        description="Your chart will appear once you have more than one data point."
      />
    )
  }

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
