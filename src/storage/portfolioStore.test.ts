import { describe, it, expect, beforeEach } from 'vitest'
import { KEYS, migrateSnapshots } from './portfolioStore'

// Tests run in the `node` environment, which has no localStorage.
class MemoryStorage {
  #data = new Map<string, string>()
  getItem(key: string): string | null { return this.#data.get(key) ?? null }
  setItem(key: string, value: string): void { this.#data.set(key, String(value)) }
  removeItem(key: string): void { this.#data.delete(key) }
  clear(): void { this.#data.clear() }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

const stored = () => JSON.parse(localStorage.getItem(KEYS.SNAPSHOTS)!)

describe('migrateSnapshots', () => {
  beforeEach(() => localStorage.clear())

  it('strips the legacy realEstate key from allocations', () => {
    localStorage.setItem(KEYS.SNAPSHOTS, JSON.stringify([
      { id: 's1', date: '2025-09-01', totalValue: 100, allocation: { stocks: 100, realEstate: 0 }, accountValues: { a1: 100 } },
    ]))
    migrateSnapshots()
    expect(stored()[0].allocation).toEqual({ stocks: 100 })
  })

  it('skips a snapshot without allocation instead of throwing (#15)', () => {
    const snapshots = [
      { id: 's1', date: '2025-09-01', totalValue: 100 },
      { id: 's2', date: '2025-10-01', totalValue: 100, allocation: { stocks: 100, realEstate: 0 }, accountValues: { a1: 100 } },
    ]
    localStorage.setItem(KEYS.SNAPSHOTS, JSON.stringify(snapshots))

    expect(() => migrateSnapshots()).not.toThrow()
    expect(stored()[0]).toEqual(snapshots[0])
    expect(stored()[1].allocation).toEqual({ stocks: 100 })
  })

  it('drops an empty snapshot even when it has no accountValues', () => {
    localStorage.setItem(KEYS.SNAPSHOTS, JSON.stringify([
      { id: 's1', date: '2025-09-01', totalValue: 0, allocation: {} },
      { id: 's2', date: '2025-10-01', totalValue: 100, allocation: {}, accountValues: { a1: 100 } },
    ]))
    expect(() => migrateSnapshots()).not.toThrow()
    expect(stored().map((s: { id: string }) => s.id)).toEqual(['s2'])
  })
})
