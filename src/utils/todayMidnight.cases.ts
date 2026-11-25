import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, Holding } from '@/types'
import { localDateOf, todayISO } from '@/utils/today'
import { buildEMaklerImport } from '@/importers/eMaklerImport'
import { upsertTodaySnapshot } from '@/domain/snapshots'
import { buildChartData } from '@/components/charts/chartData'

/**
 * Shared midnight cases for #71, run by today.warsaw.test.ts and
 * today.newYork.test.ts with the time zone pinned. Synthetic data only.
 */
export type MidnightCase = {
  zone: string
  /** The fixed clock, as a UTC instant. */
  now: string
  /** Minutes from `Date#getTimezoneOffset` at `now` — proves the zone took effect. */
  offsetMinutes: number
  /** The local calendar date at `now`. */
  localDate: string
  /** The UTC calendar date at `now` — the wrong answer before the fix. */
  utcDate: string
}

export function runMidnightCases(c: MidnightCase, originalTZ: string | undefined): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(c.now))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  afterAll(() => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
    if (originalTZ === undefined) delete env.TZ
    else env.TZ = originalTZ
  })

  describe(`"today" in ${c.zone} at ${c.now}`, () => {
    it('really runs in that zone', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(c.zone)
      expect(new Date().getTimezoneOffset()).toBe(c.offsetMinutes)
      // The case is only meaningful when the local and UTC dates differ.
      expect(c.localDate).not.toBe(c.utcDate)
      expect(new Date().toISOString().slice(0, 10)).toBe(c.utcDate)
    })

    it('todayISO gives the local date', () => {
      expect(todayISO()).toBe(c.localDate)
    })

    it('an eMakler holding with no matching order, today\'s snapshot and the chart agree', async () => {
      // PLN-only, so no NBP call is made.
      const { holdings } = await buildEMaklerImport(
        [{ name: 'DEMO', exchange: 'PL', quantity: 10, currentPrice: 100, priceCurrency: 'PLN', totalValuePLN: 1000 }],
        [],
        new Set(),
      )
      expect(holdings).toHaveLength(1)
      const purchaseDate = holdings[0].purchaseDate

      const stamp = new Date().toISOString()
      const holding: Holding = {
        id: 'h1', accountId: 'a1', name: 'DEMO', category: 'stock', quantity: 10,
        purchasePrice: 100, currentPrice: 100, purchaseDate, createdAt: stamp, updatedAt: stamp,
      }
      const account: Account = {
        id: 'a1', name: 'Demo Broker', type: 'brokerage', createdAt: stamp, lastUpdated: stamp, holdings: [holding],
      }
      const [snapshot] = upsertTodaySnapshot([], [account])
      const points = buildChartData({ snapshots: [snapshot], accounts: [account], transactions: [], dateRange: '1M' })

      expect(purchaseDate).toBe(c.localDate)
      expect(snapshot.date).toBe(c.localDate)
      expect(points.at(-1)!.date).toBe(c.localDate)
    })

    it('a price cache fetched earlier on the same local day counts as today\'s', () => {
      // Fetched 20 minutes ago: same local day, even where the UTC date differs.
      const fetchedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
      expect(localDateOf(fetchedAt)).toBe(todayISO())
    })
  })
}
