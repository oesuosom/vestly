import { addDays, addMonths, format, parseISO, startOfMonth, subMonths } from 'date-fns'
import type { Account, DateRange, HistoricalPricesCache, Snapshot, Transaction } from '@/types'
import { getHoldingValue, getTotalValue } from '@/domain/calculations'
import { buildHistoriesMap, computePortfolioAt } from '@/domain/portfolioValue'
import type { HistoryCoverage } from '@/domain/historyCoverage'
import { todayISO } from '@/utils/today'

export type ChartPoint = { date: string; totalValue: number | undefined }

export type ChartDataInput = {
  snapshots: Snapshot[]
  accounts: Account[]
  transactions: Transaction[]
  dateRange: DateRange
  historicalPrices?: HistoricalPricesCache
  /** See PortfolioAreaChart's `coverage` prop. */
  coverage?: HistoryCoverage
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

/**
 * What the chart says when it has nothing to draw: no points at all, or a
 * single one (a line needs two). Null when there's a line to draw.
 */
export function emptyChartMessage(points: ChartPoint[]): { title: string; body: string } | null {
  if (points.length === 0) {
    return {
      title: 'No chart data yet',
      body: 'Add transactions or open the app daily to start building your portfolio history.',
    }
  }
  if (points.length < 2) {
    return {
      title: 'Not enough history yet',
      body: 'Your chart will appear once you have more than one data point.',
    }
  }
  return null
}

export function isShortRange(range: DateRange): boolean {
  return range === '1M' || range === '3M' || range === '6M'
}

/**
 * Build a sorted, deduplicated list of dates from `startDate` through today,
 * then merge in any snapshot dates.
 *
 * For 1M/3M/6M/1Y: daily ticks so the chart has a continuous line even on days
 * the app was never opened. For ALL: monthly ticks to keep the view clean,
 * plus the start date and today, so the line starts on the first day with data
 * and ends today (and draws as soon as the history spans two days).
 */
function buildTimeline(startDate: string, dateRange: DateRange): string[] {
  const dates = new Set<string>()
  const today = new Date()

  if (dateRange === 'ALL') {
    const start = parseISO(startDate)
    if (start <= today) {
      dates.add(format(start, 'yyyy-MM-dd'))
      dates.add(todayISO())
    }
    // Monthly ticks on the 1st, none before the start date (no data there yet)
    let cursor = startOfMonth(start)
    while (cursor <= today) {
      if (cursor >= start) dates.add(format(cursor, 'yyyy-MM-dd'))
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

/** The points PortfolioAreaChart draws, oldest first, ending today. */
export function buildChartData({
  snapshots,
  accounts,
  transactions,
  dateRange,
  historicalPrices,
  coverage,
}: ChartDataInput): ChartPoint[] {
  const snapshotsSorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const snapshotMap = new Map(snapshotsSorted.map((s) => [s.date, s.totalValue]))

  const today = new Date()
  const todayStr = todayISO()
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

  // Timeline starts from the earliest holding purchase date (or first snapshot),
  // closed holdings included. This preserves the full pre-snapshot history via
  // computePortfolioAt.
  const allHoldings = accounts.flatMap((a) => [...a.holdings, ...(a.closedHoldings ?? [])])
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

  const historiesMap = historicalPrices && coverage ? coverage.historiesMap : buildHistoriesMap(historicalPrices)

  // Holdings without price history are left out of every point, today's
  // included, so the line doesn't jump at the end. Snapshots and anchors hold
  // full portfolio values, so they can't be used for the line either.
  // Every holding's history failed to load (nothing is off): no line, so the
  // chart shows its usual empty state.
  if (historicalPrices && coverage?.allFailed) return []
  const skip = new Set(coverage?.missing.map((m) => m.holding.id) ?? [])
  if (skip.size > 0) {
    const skippedToday = accounts
      .flatMap((a) => a.holdings)
      .filter((h) => skip.has(h.id))
      .reduce((sum, h) => sum + getHoldingValue(h), 0)
    return filtered.map((date) => ({
      date,
      totalValue: date === todayStr
        ? liveTotal - skippedToday
        : computePortfolioAt(date, accounts, transactions, historiesMap ?? new Map(), today, skip),
    }))
  }

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
}
