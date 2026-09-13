import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { validateBackup, applyBackup, BACKUP_KEY_MAP } from './backupValidation'

// Tests run in the `node` environment (see vite.config.ts), which has no
// localStorage. A minimal in-memory stub is enough here and avoids adding jsdom
// for two suites — it is a real class so `Storage.prototype` can be spied on,
// which is how the rollback tests force a mid-write failure.
class MemoryStorage {
  #data = new Map<string, string>()
  getItem(key: string): string | null { return this.#data.get(key) ?? null }
  setItem(key: string, value: string): void { this.#data.set(key, String(value)) }
  removeItem(key: string): void { this.#data.delete(key) }
  clear(): void { this.#data.clear() }
}
Object.defineProperty(globalThis, 'Storage', { value: MemoryStorage, configurable: true })
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

const account = { id: 'a1', name: 'XTB', holdings: [] }
const transaction = {
  id: 't1', accountId: 'a1', type: 'buy', date: '2026-02-10', amountPLN: -100,
}
const goodBackup = {
  version: { version: '5.0.0' },
  accounts: [account],
  transactions: [transaction],
  snapshots: [{ date: '2026-02-10', totalValue: 1000 }],
  settings: { theme: 'dark' },
  contributions: { ike: [], ikze: [] },
}

describe('validateBackup — rejects non-backups', () => {
  it.each([
    ['a string', '"hello"'],
    ['a number', '42'],
    ['an array', '[]'],
    ['null', 'null'],
  ])('rejects %s', (_label, json) => {
    const r = validateBackup(JSON.parse(json))
    expect(r.ok).toBe(false)
  })

  it('rejects a valid JSON object with no recognised fields', () => {
    const r = validateBackup({ hello: 'world', nested: { a: 1 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no recognised data/i)
  })

  it('rejects a package.json, whose `version` string collides with ours', () => {
    // `version` is a real backup field, so this gets past the "recognised
    // fields" gate and is caught by the type check instead — either way the
    // wrong file cannot overwrite the store.
    const r = validateBackup({ name: 'vestly', version: '0.0.1', scripts: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/version/)
  })
})

describe('validateBackup — rejects wrong types', () => {
  it('rejects a string where accounts should be a list', () => {
    const r = validateBackup({ ...goodBackup, accounts: 'hello' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/accounts/)
  })

  it('rejects an account missing required fields', () => {
    const r = validateBackup({ ...goodBackup, accounts: [{ id: 'a1' }] })
    expect(r.ok).toBe(false)
  })

  it('rejects an account whose holdings is not a list', () => {
    const r = validateBackup({ ...goodBackup, accounts: [{ ...account, holdings: 'none' }] })
    expect(r.ok).toBe(false)
  })

  it('rejects a transaction with a non-numeric amountPLN — the silent-NaN case', () => {
    const r = validateBackup({
      ...goodBackup,
      transactions: [{ ...transaction, amountPLN: 'lots' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/amountPLN/)
  })

  it('rejects settings sent as an array', () => {
    const r = validateBackup({ ...goodBackup, settings: [] })
    expect(r.ok).toBe(false)
  })
})

describe('validateBackup — accepts real backups', () => {
  it('accepts a full backup and reports every field', () => {
    const r = validateBackup(goodBackup)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields.sort()).toEqual(
      ['accounts', 'contributions', 'settings', 'snapshots', 'transactions', 'version'].sort(),
    )
  })

  it('accepts a partial backup, reporting only the fields present', () => {
    const r = validateBackup({ accounts: [account] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields).toEqual(['accounts'])
  })

  it('ignores fields explicitly set to null', () => {
    const r = validateBackup({ accounts: [account], transactions: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.fields).toEqual(['accounts'])
  })
})

describe('applyBackup — atomicity', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('writes every validated field', () => {
    const r = validateBackup(goodBackup)
    if (!r.ok) throw new Error('fixture should validate')
    applyBackup(goodBackup, r.fields)

    expect(JSON.parse(localStorage.getItem(BACKUP_KEY_MAP.accounts)!)).toEqual([account])
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY_MAP.transactions)!)).toEqual([transaction])
  })

  it('applies the settings transform', () => {
    const r = validateBackup({ settings: { theme: 'dark' } })
    if (!r.ok) throw new Error('fixture should validate')
    applyBackup({ settings: { theme: 'dark' } }, r.fields, {
      settings: () => ({ theme: 'dark', claudeApiKey: 'kept' }),
    })

    expect(JSON.parse(localStorage.getItem(BACKUP_KEY_MAP.settings)!).claudeApiKey).toBe('kept')
  })

  it('rolls back every key when a later write fails', () => {
    localStorage.setItem(BACKUP_KEY_MAP.accounts, JSON.stringify(['ORIGINAL']))
    localStorage.setItem(BACKUP_KEY_MAP.transactions, JSON.stringify(['ORIGINAL_TX']))

    // Fail on the third write, after two have already committed.
    let calls = 0
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (++calls === 3) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, k, v)
    })

    const r = validateBackup(goodBackup)
    if (!r.ok) throw new Error('fixture should validate')
    expect(() => applyBackup(goodBackup, r.fields)).toThrow()

    vi.restoreAllMocks()
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY_MAP.accounts)!)).toEqual(['ORIGINAL'])
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY_MAP.transactions)!)).toEqual(['ORIGINAL_TX'])
  })

  it('removes keys that did not exist before a failed restore', () => {
    let calls = 0
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (++calls === 3) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, k, v)
    })

    const r = validateBackup(goodBackup)
    if (!r.ok) throw new Error('fixture should validate')
    expect(() => applyBackup(goodBackup, r.fields)).toThrow()

    vi.restoreAllMocks()
    expect(localStorage.getItem(BACKUP_KEY_MAP.accounts)).toBeNull()
  })
})
