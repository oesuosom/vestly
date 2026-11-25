import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, DateRange, Holding, Snapshot, Transaction } from '@/types'
import { buildChartData, emptyChartMessage, rangeChange } from '@/components/charts/chartData'

// Synthetic data only. "Today" is fixed so the timeline doesn't depend on the real date.
const TODAY = '2026-11-25'
const now = `${TODAY}T12:00:00.000Z`

const bond = (purchaseDate: string): Holding => ({
  id: 'h1', accountId: 'a1', name: 'Sample Bond', category: 'bond', quantity: 10,
  purchasePrice: 100, currentPrice: 100, purchaseDate, createdAt: now, updatedAt: now,
})
const account = (holdings: Holding[]): Account => ({
  id: 'a1', name: 'Demo Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings,
})
const todaySnapshot: Snapshot = {
  id: 's1', date: TODAY, totalValue: 1000, allocation: {} as Snapshot['allocation'],
  accountValues: { a1: 1000 }, createdAt: now,
}
const deposit = (date: string): Transaction => ({
  id: 't1', externalId: 't1', accountId: 'a1', type: 'deposit', date, amountPLN: 1000, source: 'manual', createdAt: now,
})

function chart(purchaseDate: string, dateRange: DateRange) {
  return buildChartData({
    snapshots: [todaySnapshot],
    accounts: [account([bond(purchaseDate)])],
    transactions: [deposit(purchaseDate)],
    dateRange,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('buildChartData — ALL range', () => {
  it('starts on the first day with data and ends today when the history started earlier this month', () => {
    const points = chart('2026-11-05', 'ALL')
    expect(points.length).toBeGreaterThanOrEqual(2)
    expect(points[0].date).toBe('2026-11-05')
    expect(points[0].totalValue).toBeDefined()
    expect(points.at(-1)!.date).toBe(TODAY)
    expect(points.some((p) => p.date === '2026-11-01')).toBe(false)
    expect(emptyChartMessage(points)).toBeNull()
  })

  it('draws a line whenever 1M does, for each start day this month', () => {
    for (let day = 1; day < 25; day++) {
      const start = `2026-11-${String(day).padStart(2, '0')}`
      expect(emptyChartMessage(chart(start, '1M')), start).toBeNull()
      expect(emptyChartMessage(chart(start, 'ALL')), start).toBeNull()
    }
  })

  it('still has one point when everything started today, like the other ranges', () => {
    expect(chart(TODAY, 'ALL').map((p) => p.date)).toEqual([TODAY])
    expect(chart(TODAY, '1M').map((p) => p.date)).toEqual([TODAY])
  })

  it('keeps a monthly grid for a multi-year history, plus the start date and today', () => {
    const dates = chart('2023-03-17', 'ALL').map((p) => p.date)
    expect(dates[0]).toBe('2023-03-17')
    expect(dates.at(-1)).toBe(TODAY)
    // 1 Apr 2023 through 1 Nov 2026: 44 monthly ticks, all on the 1st.
    const middle = dates.slice(1, -1)
    expect(middle).toHaveLength(44)
    expect(middle.every((d) => d.endsWith('-01'))).toBe(true)
    expect(middle[0]).toBe('2023-04-01')
    expect(middle.at(-1)).toBe('2026-11-01')
    expect([...dates].sort()).toEqual(dates)
  })

  it('does not double up when the history starts on the 1st', () => {
    const dates = chart('2026-09-01', 'ALL').map((p) => p.date)
    expect(dates).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', TODAY])
  })
})

describe('buildChartData — other ranges are unchanged', () => {
  it('1M still has a daily point for each day from the cutoff to today', () => {
    const dates = chart('2026-01-10', '1M').map((p) => p.date)
    expect(dates[0]).toBe('2026-10-25')
    expect(dates.at(-1)).toBe(TODAY)
    expect(dates).toHaveLength(32)
  })
})

describe('rangeChange', () => {
  it('compares the first point with the last one', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 800 },
      { date: '2026-11-01', totalValue: 900 },
      { date: TODAY, totalValue: 1000 },
    ])).toEqual({ delta: 200, deltaPercent: 25, sinceDate: '2026-10-25' })
  })

  it('reports a loss as a negative change', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 1000 },
      { date: TODAY, totalValue: 900 },
    ])).toEqual({ delta: -100, deltaPercent: -10, sinceDate: '2026-10-25' })
  })

  it('starts at the first point with a value, where the line starts', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: undefined },
      { date: '2026-10-26', totalValue: undefined },
      { date: '2026-11-01', totalValue: 500 },
      { date: TODAY, totalValue: 1000 },
    ])).toEqual({ delta: 500, deltaPercent: 100, sinceDate: '2026-11-01' })
  })

  it('is null without two points with a value', () => {
    expect(rangeChange([])).toBeNull()
    expect(rangeChange([{ date: TODAY, totalValue: 1000 }])).toBeNull()
    expect(rangeChange([
      { date: '2026-10-25', totalValue: undefined },
      { date: TODAY, totalValue: 1000 },
    ])).toBeNull()
  })

  it('has no percentage when the start value is 0', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 0 },
      { date: TODAY, totalValue: 1000 },
    ])).toEqual({ delta: 1000, deltaPercent: null, sinceDate: '2026-10-25' })
  })

  it('history imported today, only today\'s snapshot: ALL runs from the first day with data, not today', () => {
    // Bought 17 Mar 2023 for 800 PLN, worth 1,000 PLN today.
    const points = buildChartData({
      snapshots: [{ ...todaySnapshot, totalValue: 1000 }],
      accounts: [account([{ ...bond('2023-03-17'), quantity: 8, currentPrice: 125 }])],
      transactions: [],
      dateRange: 'ALL',
    })
    expect(rangeChange(points)).toEqual({ delta: 200, deltaPercent: 25, sinceDate: '2023-03-17' })
  })

  it('a range that starts before the history does: since the first day with data', () => {
    const points = chart('2026-11-05', '1Y')
    const change = rangeChange(points)
    expect(change?.sinceDate).toBe('2026-11-05')
    expect(change?.sinceDate).toBe(points.find((p) => p.totalValue !== undefined)!.date)
    expect(change?.delta).toBe(points.at(-1)!.totalValue! - points[0].totalValue!)
  })

  it('each range starts where its own line starts', () => {
    for (const range of ['1M', '3M', '6M', '1Y', 'ALL'] as const) {
      const points = chart('2023-03-17', range)
      expect(rangeChange(points)?.sinceDate, range).toBe(points[0].date)
    }
  })
})
