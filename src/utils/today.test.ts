import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDateOf, todayISO } from '@/utils/today'

// Zone-independent checks. The midnight cases in Warsaw and New York are in
// today.warsaw.test.ts and today.newYork.test.ts, which pin the time zone.

afterEach(() => {
  vi.useRealTimers()
})

describe('todayISO', () => {
  it('returns the local calendar date as YYYY-MM-DD', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0)) // 5 Jan 2026, noon local
    expect(todayISO()).toBe('2026-01-05')
  })

  it('pads single-digit months and days', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 0, 0)) // 9 Sep 2026, local midnight
    expect(todayISO()).toBe('2026-09-09')
  })

  it('changes date at local midnight, not UTC midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 24, 23, 59, 59))
    expect(todayISO()).toBe('2026-11-24')
    vi.setSystemTime(new Date(2026, 10, 25, 0, 0, 0))
    expect(todayISO()).toBe('2026-11-25')
  })
})

describe('localDateOf', () => {
  it('gives the local calendar date of a timestamp', () => {
    const local = new Date(2026, 10, 25, 0, 30)
    expect(localDateOf(local.toISOString())).toBe('2026-11-25')
  })
})
