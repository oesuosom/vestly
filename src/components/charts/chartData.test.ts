import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, DateRange, Holding, Snapshot, Transaction } from '@/types'
import { buildChartData, cashCountedTransactions, emptyChartMessage, rangeChange } from '@/components/charts/chartData'

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
    ], [])).toEqual({ delta: 200, deltaPercent: 25, sinceDate: '2026-10-25' })
  })

  it('reports a loss as a negative change', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 1000 },
      { date: TODAY, totalValue: 900 },
    ], [])).toEqual({ delta: -100, deltaPercent: -10, sinceDate: '2026-10-25' })
  })

  it('starts at the first point with a value, where the line starts', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: undefined },
      { date: '2026-10-26', totalValue: undefined },
      { date: '2026-11-01', totalValue: 500 },
      { date: TODAY, totalValue: 1000 },
    ], [])).toEqual({ delta: 500, deltaPercent: 100, sinceDate: '2026-11-01' })
  })

  it('is null without two points with a value', () => {
    expect(rangeChange([], [])).toBeNull()
    expect(rangeChange([{ date: TODAY, totalValue: 1000 }], [])).toBeNull()
    expect(rangeChange([
      { date: '2026-10-25', totalValue: undefined },
      { date: TODAY, totalValue: 1000 },
    ], [])).toBeNull()
  })

  it('has no percentage when the start value is 0', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 0 },
      { date: TODAY, totalValue: 1000 },
    ], [])).toEqual({ delta: 1000, deltaPercent: null, sinceDate: '2026-10-25' })
  })

  it('history imported today, only today\'s snapshot: ALL runs from the first day with data, not today', () => {
    // Bought 17 Mar 2023 for 800 PLN, worth 1,000 PLN today.
    const points = buildChartData({
      snapshots: [{ ...todaySnapshot, totalValue: 1000 }],
      accounts: [account([{ ...bond('2023-03-17'), quantity: 8, currentPrice: 125 }])],
      transactions: [],
      dateRange: 'ALL',
    })
    expect(rangeChange(points, [])).toEqual({ delta: 200, deltaPercent: 25, sinceDate: '2023-03-17' })
  })

  it('a range that starts before the history does: since the first day with data', () => {
    const points = chart('2026-11-05', '1Y')
    const change = rangeChange(points, [])
    expect(change?.sinceDate).toBe('2026-11-05')
    expect(change?.sinceDate).toBe(points.find((p) => p.totalValue !== undefined)!.date)
    expect(change?.delta).toBe(points.at(-1)!.totalValue! - points[0].totalValue!)
  })

  it('each range starts where its own line starts', () => {
    for (const range of ['1M', '3M', '6M', '1Y', 'ALL'] as const) {
      const points = chart('2023-03-17', range)
      expect(rangeChange(points, [])?.sinceDate, range).toBe(points[0].date)
    }
  })
})

describe('rangeChange: money moved in or out', () => {
  const flow = (date: string, amountPLN: number, accountId = 'a1'): Transaction => ({
    id: `f-${date}-${amountPLN}-${accountId}`, externalId: `f-${date}-${amountPLN}-${accountId}`, accountId,
    type: amountPLN >= 0 ? 'deposit' : 'withdrawal', date, amountPLN, source: 'manual', createdAt: now,
  })
  // Cash only: one synthetic cash holding, valued from transactions on past days.
  const cashAccount = (transactions: Transaction[], id = 'a1'): Account => ({
    id, name: 'Demo Broker', type: 'brokerage', createdAt: now, lastUpdated: now,
    holdings: [{
      id: `cash_${id}`, accountId: id, name: 'Cash', category: 'cash', quantity: 1,
      purchasePrice: transactions.reduce((s, t) => s + t.amountPLN, 0),
      currentPrice: transactions.reduce((s, t) => s + t.amountPLN, 0),
      purchaseDate: transactions.map((t) => t.date.slice(0, 10)).sort()[0], isSynthetic: true, createdAt: now, updatedAt: now,
    }],
  })
  const cashChart = (transactions: Transaction[], dateRange: DateRange, snapshots: Snapshot[] = []) =>
    buildChartData({ snapshots, accounts: [cashAccount(transactions)], transactions, dateRange })

  it('a deposit inside the range with no price change is no change', () => {
    const txs = [flow('2026-09-01T10:00:00.000Z', 1000), flow('2026-11-10T10:00:00.000Z', 10_000)]
    for (const range of ['1M', '1Y', 'ALL'] as const) {
      const change = rangeChange(cashChart(txs, range), txs)
      expect(change?.delta, range).toBe(0)
    }
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 1000 },
      { date: '2026-11-10', totalValue: 11_000 },
      { date: TODAY, totalValue: 11_000 },
    ], [flow('2026-11-10', 10_000)])).toEqual({ delta: 0, deltaPercent: 0, sinceDate: '2026-10-25' })
  })

  it('a withdrawal inside the range with no price change is no change', () => {
    const txs = [flow('2026-09-01', 5000), flow('2026-11-15T09:30:00.000Z', -1000)]
    expect(rangeChange(cashChart(txs, '1M'), txs)?.delta).toBe(0)
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 5000 },
      { date: TODAY, totalValue: 4000 },
    ], [flow('2026-11-15', -1000)])).toEqual({ delta: 0, deltaPercent: 0, sinceDate: '2026-10-25' })
  })

  it('a flow on the start day is already in the start value, so it isn’t taken out again', () => {
    // The chart values a day with every transaction dated that day or earlier.
    const txs = [flow('2026-10-25T08:00:00.000Z', 3000)]
    const points = cashChart(txs, '1M')
    expect(points[0]).toMatchObject({ date: '2026-10-25', totalValue: 3000 })
    expect(rangeChange(points, txs)?.delta).toBe(0)
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 3000 },
      { date: TODAY, totalValue: 3100 },
    ], txs)).toEqual({ delta: 100, deltaPercent: expect.closeTo(3.333, 2), sinceDate: '2026-10-25' })
  })

  it('a flow before the range is ignored', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 1000 },
      { date: TODAY, totalValue: 1200 },
    ], [flow('2026-10-01', 1000)])).toEqual({ delta: 200, deltaPercent: 20, sinceDate: '2026-10-25' })
  })

  it('a price move plus a deposit: only the price move counts', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 800 },
      { date: TODAY, totalValue: 6000 },
    ], [flow('2026-11-18', 5000)])).toEqual({ delta: 200, deltaPercent: expect.closeTo(3.448, 2), sinceDate: '2026-10-25' })
  })

  it('has no percentage when the start value plus net flows is 0 or less', () => {
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 0 },
      { date: TODAY, totalValue: 0 },
    ], [])).toEqual({ delta: 0, deltaPercent: null, sinceDate: '2026-10-25' })
    // 500 at the start, 1,000 taken out (more than there was).
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 500 },
      { date: TODAY, totalValue: -400 },
    ], [flow('2026-11-01', -1000)])).toEqual({ delta: 100, deltaPercent: null, sinceDate: '2026-10-25' })
  })

  it('only deposits and withdrawals are flows', () => {
    const dividend: Transaction = { ...flow('2026-11-01', 50), type: 'dividend' }
    const fee: Transaction = { ...flow('2026-11-02', -5), type: 'fee' }
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 1000 },
      { date: TODAY, totalValue: 1045 },
    ], [dividend, fee])?.delta).toBe(45)
  })

  it('a transfer between two accounts nets to zero across both', () => {
    const txs = [flow('2026-11-10', -2000, 'a1'), flow('2026-11-10', 2000, 'a2')]
    expect(rangeChange([
      { date: '2026-10-25', totalValue: 10_000 },
      { date: TODAY, totalValue: 10_000 },
    ], txs)?.delta).toBe(0)
  })

  it('between snapshots, where the line is straight, a deposit is spread along it and still nets to zero', () => {
    // A snapshot on 1 Oct and today's value: no price history, so the days in
    // between are drawn as a straight line and the deposit ramps up along it.
    const txs = [flow('2026-09-01', 1000), flow('2026-11-10', 10_000)]
    const oct1: Snapshot = { ...todaySnapshot, id: 's-oct', date: '2026-10-01', totalValue: 1000, accountValues: { a1: 1000 } }
    for (const range of ['1M', '3M', '1Y', 'ALL'] as const) {
      const points = cashChart(txs, range, [oct1])
      expect(rangeChange(points, txs)?.delta, range).toBe(0)
    }
    const points = cashChart(txs, '1M', [oct1])
    expect(points[0].between).toMatchObject({ from: '2026-10-01', to: TODAY })
  })

  it('cashCountedTransactions keeps the rows the chart counts as cash', () => {
    const txs = [flow('2026-11-01', 100, 'a1'), flow('2026-11-01', 100, 'crypto'), { ...flow('2026-11-02', 100, 'a1'), source: 'emakler_import' as const }]
    const crypto: Account = { id: 'crypto', name: 'Demo Wallet', type: 'crypto', createdAt: now, lastUpdated: now, holdings: [] }
    expect(cashCountedTransactions([cashAccount([txs[0]]), crypto], txs)).toEqual([txs[0]])
  })
})
