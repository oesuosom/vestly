import { addDays, addMonths, format, parseISO, startOfMonth, subMonths } from 'date-fns'
import type { Account, DateRange, HistoricalPricesCache, Snapshot, Transaction } from '@/types'
import { affectsCash, getHoldingValue, getTotalValue } from '@/domain/calculations'
import { buildHistoriesMap, computePortfolioAt } from '@/domain/portfolioValue'
import type { HistoryCoverage } from '@/domain/historyCoverage'
import { todayISO } from '@/utils/today'

export type ChartPoint = {
  date: string
  totalValue: number | undefined
  /**
   * Set when the value is a straight line between the values on two anchor
   * days (snapshots or today), `t` of the way from `from` to `to`. Money moved
   * in or out between them is spread along that line too, not a step, and
   * `rangeChange` needs to know that to leave it out.
   */
  between?: { from: string; to: string; t: number }
}

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
): Pick<ChartPoint, 'totalValue' | 'between'> | undefined {
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
  if (!after) return { totalValue: before.value, between: { from: before.date, to: before.date, t: 0 } }

  // Linear interpolation between the two surrounding anchors
  const t0 = parseISO(before.date).getTime()
  const t1 = parseISO(after.date).getTime()
  const t = parseISO(date).getTime()
  if (t1 === t0) return { totalValue: before.value, between: { from: before.date, to: before.date, t: 0 } }
  const ratio = (t - t0) / (t1 - t0)
  return {
    totalValue: before.value + (after.value - before.value) * ratio,
    between: { from: before.date, to: after.date, t: ratio },
  }
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
      return { date, ...interpolated }
    }

    // Last resort: pre-anchor dates with no market prices
    return {
      date,
      totalValue: computePortfolioAt(date, accounts, transactions, null, today),
    }
  })
}

export type RangeChange = {
  /** Last point's value minus the first point with a value, less money moved in or out in between. */
  delta: number
  /**
   * `delta` as a percentage of the start value plus the net money moved in
   * between; null when that base is 0 or less.
   */
  deltaPercent: number | null
  /** Date of the first point with a value: where the chart's line starts. */
  sinceDate: string
}

/**
 * The calendar day the chart files a transaction under. Matches
 * `computeAccountCashBalance`, which the chart uses for cash on past days:
 * the first 10 characters of `date` (date-only XTB rows are the date itself).
 */
const flowDay = (t: Transaction) => t.date.slice(0, 10)

/**
 * The transactions whose cash the chart's values include: those that move
 * cash (`affectsCash`) in an account with a synthetic cash holding. Accounts
 * without one (crypto accounts) don't count cash at all, so a deposit there
 * doesn't change the value and mustn't be taken out of the change.
 */
export function cashCountedTransactions(accounts: Account[], transactions: Transaction[]): Transaction[] {
  const withCash = new Set(
    accounts.filter((a) => a.holdings.some((h) => h.isSynthetic && h.category === 'cash')).map((a) => a.id),
  )
  return transactions.filter((t) => withCash.has(t.accountId) && affectsCash(t))
}

const round2 = (n: number) => Math.round(n * 100) / 100 || 0

/**
 * The change over the chart's range, read from its own points: from the first
 * point with a value to the last one (today), less the money moved in or out
 * in between, so a deposit or withdrawal isn't a gain or a loss. Null when
 * fewer than two points have a value, i.e. when there's no line to compare along.
 *
 * `transactions` are the ones that apply (all of them on Overview, so a
 * transfer between two of your accounts nets to zero; the account's own on its
 * page). Only `deposit` and `withdrawal` rows are flows, by their signed
 * `amountPLN`; dividends, interest, taxes, fees, buys and sells are part of
 * the performance. Crypto `send` / `receive` aren't flows either: coins
 * received from outside count as a gain, coins sent out as a loss.
 *
 * Which flows the start point already holds follows how the chart values a day:
 * - Computed days (`computePortfolioAt`) and snapshots hold the cash after
 *   every transaction dated that day or earlier, so a flow on the start day is
 *   already in the start value and isn't counted again.
 * - Today's value is the live total, which holds every transaction.
 * - A day drawn as a straight line between two anchors (`between`) holds the
 *   same share `t` of the flows between those anchors as of their values.
 * The flows held by a point are summed the same way, and the change is
 * (end value − start value) − (flows held at the end − flows held at the start).
 * Pass only transactions the values count (see `cashCountedTransactions`).
 */
export function rangeChange(points: ChartPoint[], transactions: Transaction[]): RangeChange | null {
  const valued = points.filter(
    (p): p is ChartPoint & { totalValue: number } => p.totalValue !== undefined && Number.isFinite(p.totalValue),
  )
  if (valued.length < 2) return null
  const start = valued[0]
  const end = valued[valued.length - 1]

  const flows = transactions.filter((t) => t.type === 'deposit' || t.type === 'withdrawal')
  // Net flows a value on `day` holds: everything up to that day, or every
  // flow on today's (the last point's) live value.
  const heldOn = (day: string) =>
    flows.reduce((sum, t) => (day >= end.date || flowDay(t) <= day ? sum + t.amountPLN : sum), 0)
  const held = (p: ChartPoint) =>
    p.between ? heldOn(p.between.from) + (heldOn(p.between.to) - heldOn(p.between.from)) * p.between.t : heldOn(p.date)

  const netFlows = held(end) - held(start)
  const delta = round2(end.totalValue - start.totalValue - netFlows)
  // Simple return on the money that was in play: the start value plus what was
  // paid in (less what was taken out) over the range. Not time-weighted. When
  // that base is 0 or below (nothing at the start and nothing paid in, or more
  // taken out than there was) a percentage means nothing, so there's none.
  const base = start.totalValue + netFlows
  return {
    delta,
    deltaPercent: base <= 0 ? null : (delta / base) * 100,
    sinceDate: start.date,
  }
}
