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

const holding = {
  id: 'h1', accountId: 'a1', name: 'Example Corp', category: 'stock',
  quantity: 10, purchasePrice: 100, currentPrice: 120, purchaseDate: '2025-03-01',
  createdAt: '2025-03-01T09:00:00.000Z', updatedAt: '2025-03-01T09:00:00.000Z',
}
const account = { id: 'a1', name: 'XTB', type: 'brokerage', holdings: [] }
const transaction = {
  id: 't1', accountId: 'a1', type: 'buy', date: '2026-02-10', amountPLN: -100,
}
const snapshot = {
  id: 's1', date: '2026-02-10', totalValue: 1000,
  allocation: { bonds: 0, stocks: 1000, cash: 0, crypto: 0 },
  accountValues: { a1: 1000 },
}
const goodBackup = {
  version: { version: '5.0.0' },
  accounts: [account],
  transactions: [transaction],
  snapshots: [snapshot],
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
    if (!r.ok) expect(r.error).toBe('Transaction 1 (2026-02-10) has an invalid amount.')
  })

  it('rejects settings sent as an array', () => {
    const r = validateBackup({ ...goodBackup, settings: [] })
    expect(r.ok).toBe(false)
  })
})

/** Validate a backup expected to fail and return its message. */
function errorFor(backup: unknown): string {
  const r = validateBackup(backup)
  if (r.ok) throw new Error('expected the backup to be rejected')
  return r.error
}

describe('validateBackup — rejects records the app cannot read (#15)', () => {
  const withHolding = (h: unknown) => ({
    ...goodBackup,
    accounts: [{ ...account, name: 'Broker', holdings: [holding, holding, h] }],
  })

  it('rejects a holding with only an id, naming it and its account', () => {
    expect(errorFor(withHolding({ id: 'h3' }))).toBe('Holding 3 in “Broker” has no name.')
  })

  it.each<[keyof typeof holding, string]>([
    ['id', 'ID'],
    ['name', 'name'],
    ['category', 'category'],
    ['purchaseDate', 'purchase date'],
    ['quantity', 'quantity'],
    ['purchasePrice', 'purchase price'],
    ['currentPrice', 'current price'],
  ])('rejects a holding with no %s', (key, label) => {
    const { [key]: _omitted, ...rest } = holding
    expect(errorFor(withHolding(rest))).toMatch(new RegExp(`^Holding 3.* in “Broker” has no ${label}\\.$`))
  })

  it.each([
    ['quantity', '10', 'quantity'],
    ['purchasePrice', null, 'purchase price'],
    ['currentPrice', 'n/a', 'current price'],
    ['purchaseDate', 20250301, 'purchase date'],
  ])('rejects a holding whose %s is %j', (key, value, label) => {
    const error = errorFor(withHolding({ ...holding, [key]: value }))
    expect(error).toMatch(new RegExp(`^Holding 3 \\(“Example Corp”\\) in “Broker” has (no|an invalid) ${label}\\.$`))
  })

  it('rejects a holding that is not an object', () => {
    expect(errorFor(withHolding('h3'))).toBe('Holding 3 in “Broker” is not a valid holding.')
  })

  it('rejects an account whose name is not text, which the account page slugifies', () => {
    expect(errorFor({ accounts: [{ ...account, name: 42 }] })).toBe('Account 1 has an invalid name.')
  })

  it('rejects a snapshot without allocation, which stops startup', () => {
    const { allocation: _omitted, ...bad } = snapshot
    expect(errorFor({ snapshots: [snapshot, { ...bad, date: '2026-03-01' }] }))
      .toBe('Snapshot 2 (2026-03-01) has no allocation breakdown.')
  })

  it('rejects a snapshot without accountValues, which crashes the account page', () => {
    const { accountValues: _omitted, ...bad } = snapshot
    expect(errorFor({ snapshots: [bad] })).toBe('Snapshot 1 (2026-02-10) has no per-account values.')
  })

  it.each([
    ['totalValue', '1000', 'an invalid total value'],
    ['date', undefined, 'no date'],
    ['allocation', [], 'an invalid allocation breakdown'],
  ])('rejects a snapshot whose %s is %j', (key, value, problem) => {
    expect(errorFor({ snapshots: [{ ...snapshot, [key]: value }] })).toMatch(new RegExp(`has ${problem}\\.$`))
  })

  it('rejects a transaction with an unknown type, quoting it', () => {
    expect(errorFor({ transactions: [transaction, { ...transaction, type: 'transfer' }] }))
      .toBe('Transaction 2 (2026-02-10) has an unknown type “transfer”.')
  })

  it('rejects a transaction with no type', () => {
    const { type: _omitted, ...bad } = transaction
    expect(errorFor({ transactions: [bad] })).toBe('Transaction 1 (2026-02-10) has no type.')
  })

  it('rejects a transaction whose date is not text', () => {
    expect(errorFor({ transactions: [{ ...transaction, date: 20260210 }] }))
      .toBe('Transaction 1 has an invalid date.')
  })

  it.each(['soon', '', '10.02.2026', '2026-02'])(
    'rejects a transaction dated %j: it must start with yyyy-MM-dd, or Activity shows "Invalid Date"',
    (date) => {
      expect(errorFor({ transactions: [{ ...transaction, date }] })).toMatch(/^Transaction 1( \(2026-02\))? has an invalid date\.$/)
    },
  )

  it('rejects an account with no type, which crashes its icon on every page', () => {
    const { type: _omitted, ...bad } = account
    expect(errorFor({ accounts: [{ ...bad, name: 'Broker' }] })).toBe('Account 1 (“Broker”) has no type.')
  })

  it('rejects an account with an unknown type, quoting it', () => {
    expect(errorFor({ accounts: [account, { ...account, name: 'Pension', type: 'pension' }] }))
      .toBe('Account 2 (“Pension”) has an unknown type “pension”.')
  })

  it('rejects a holding with an unknown category, which crashes the account page and Portfolio', () => {
    expect(errorFor(withHolding({ ...holding, category: 'fund' })))
      .toBe('Holding 3 (“Example Corp”) in “Broker” has an unknown category “fund”.')
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

  it('accepts records without optional fields', () => {
    // ticker, exchange, notes, iconId, isSynthetic, createdAt… are all optional
    // or not read without a guard; a minimal record must still restore.
    const minimalHolding = {
      id: 'h1', name: 'Bond', category: 'bond',
      quantity: 1, purchasePrice: 100, currentPrice: 100, purchaseDate: '2025-01-01',
    }
    const r = validateBackup({
      accounts: [{ id: 'a1', name: 'Bonds', type: 'savings', holdings: [minimalHolding] }],
      transactions: [{ id: 't1', accountId: 'a1', type: 'deposit', date: '2025-01-01', amountPLN: 100 }],
      snapshots: [{ date: '2025-01-01', totalValue: 0, allocation: {}, accountValues: {} }],
    })
    expect(r.ok).toBe(true)
  })

  it('accepts every account type and holding category', () => {
    const types = ['brokerage', 'ikze', 'ike', 'crypto', 'savings']
    const categories = ['stock', 'etf', 'bond', 'crypto', 'cash']
    const r = validateBackup({
      accounts: types.map((type, i) => ({
        ...account,
        id: `a${i}`,
        type,
        holdings: categories.map((category) => ({ ...holding, category })),
      })),
    })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['a date-only string (XTB cash operations)', '2026-02-10'],
    ['a full ISO datetime (confirmations, eMakler, Revolut, bond buys)', '2026-02-10T09:02:54.000Z'],
  ])('accepts a transaction dated with %s', (_label, date) => {
    expect(validateBackup({ transactions: [{ ...transaction, date }] }).ok).toBe(true)
  })

  it('accepts every transaction type', () => {
    const types = [
      'buy', 'sell', 'deposit', 'withdrawal', 'dividend', 'withholding_tax',
      'interest', 'interest_tax', 'fee', 'send', 'receive',
    ]
    const r = validateBackup({ transactions: types.map((type) => ({ ...transaction, type })) })
    expect(r.ok).toBe(true)
  })

  it('accepts legacy shapes that startup migrates', () => {
    const r = validateBackup({
      accounts: [{ ...account, holdings: [{ ...holding, ticker: 'EXMP', exchange: 'US' }] }],
      // yyyy-MM dates and a realEstate allocation key predate the current schema.
      snapshots: [{
        ...snapshot,
        date: '2025-09',
        allocation: { ...snapshot.allocation, realEstate: 0 },
      }],
      // Fixed-bucket targets, converted into allocationGroups on load.
      settings: { allocationTargets: { bonds: 50, stocks: 40, cash: 5, crypto: 5 } },
    })
    expect(r.ok).toBe(true)
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
