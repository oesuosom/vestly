import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type HistoricalPricesCache, type Holding, type PortfolioStore, type Transaction } from '@/types'
import { migrateLegacyExchangeCodes } from './migrations'
import { initializeStore, KEYS } from './portfolioStore'
import { applyBackup, validateBackup } from './backupValidation'
import { HISTORICAL_PRICES_STORAGE_KEY } from './historicalPriceStorage'

// Issue #67: XTB imports stored XTB's raw "DE" as the exchange. Synthetic data only.

class MemoryStorage {
  #data = new Map<string, string>()
  getItem(key: string): string | null { return this.#data.get(key) ?? null }
  setItem(key: string, value: string): void { this.#data.set(key, String(value)) }
  removeItem(key: string): void { this.#data.delete(key) }
  clear(): void { this.#data.clear() }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })

const now = '2026-01-01T00:00:00.000Z'
const holding = (id: string, exchange: string, extra: Partial<Holding> = {}): Holding => ({
  id, accountId: 'a1', name: `Example ${id}`, ticker: id.toUpperCase(), exchange, category: 'etf',
  quantity: 1, purchasePrice: 40, currentPrice: 40, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now, ...extra,
})
const buy = (id: string, ticker: string, exchange: string): Transaction => ({
  id, accountId: 'a1', type: 'buy', date: '2026-01-02T10:00:00.000Z', amountPLN: -40, instrument: `Example ${ticker}`,
  ticker, exchange, quantity: 1, pricePerUnitPLN: 40, externalId: `x-${id}`, source: 'xtb_import', createdAt: now,
})
const account = (holdings: Holding[], closedHoldings?: Holding[]): Account => ({
  id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings,
  ...(closedHoldings && { closedHoldings }),
})
const legacyStore = (): PortfolioStore => ({
  version: { version: '5.0.0', createdAt: now, updatedAt: now },
  accounts: [account(
    [holding('exgl', 'DE'), holding('acme', 'US'), holding('vbld', 'NL')],
    [holding('must', 'DE', { closedAt: '2026-02-01' })],
  )],
  snapshots: [],
  settings: { ...DEFAULT_SETTINGS, instrumentAliases: { 'Example Global ETF': { ticker: 'EXGL', exchange: 'DE' } } },
  contributions: { ikze: [], ike: [], updatedAt: now },
  transactions: [buy('t1', 'EXGL', 'DE'), buy('t2', 'ACME', 'US'), buy('t3', 'MUST', 'DE')],
})

describe('migrateLegacyExchangeCodes', () => {
  it('rewrites DE to XETRA on holdings, closed holdings, transactions and aliases', () => {
    const { store, changedHoldingIds } = migrateLegacyExchangeCodes(legacyStore())
    expect(store.accounts[0].holdings.map((h) => h.exchange)).toEqual(['XETRA', 'US', 'NL'])
    expect(store.accounts[0].closedHoldings!.map((h) => h.exchange)).toEqual(['XETRA'])
    expect(store.transactions.map((t) => t.exchange)).toEqual(['XETRA', 'US', 'XETRA'])
    expect(store.settings.instrumentAliases['Example Global ETF'].exchange).toBe('XETRA')
    expect(changedHoldingIds).toEqual(['exgl', 'must'])
  })

  it('leaves everything else alone, and returns the same store when nothing is legacy', () => {
    const once = migrateLegacyExchangeCodes(legacyStore()).store
    const twice = migrateLegacyExchangeCodes(once)
    expect(twice.store).toBe(once)
    expect(twice.changedHoldingIds).toEqual([])
  })
})

const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value))
const read = <T>(key: string): T => JSON.parse(localStorage.getItem(key)!) as T
const historyFor = (ids: string[]): HistoricalPricesCache => ({
  histories: ids.map((holdingId) => ({ holdingId, prices: [{ date: '2026-01-05', pricePLN: 40 }] })),
  fetchedAt: now, expiresAt: '2099-01-01T00:00:00.000Z',
})

function seed(store: PortfolioStore) {
  write(KEYS.VERSION, store.version)
  write(KEYS.ACCOUNTS, store.accounts)
  write(KEYS.TRANSACTIONS, store.transactions)
  write(KEYS.SETTINGS, store.settings)
  write(KEYS.SNAPSHOTS, store.snapshots)
  write(KEYS.CONTRIBUTIONS, store.contributions)
}

describe('on start (initializeStore)', () => {
  beforeEach(() => localStorage.clear())

  it('migrates stored data and drops the moved holdings’ price history', () => {
    seed(legacyStore())
    write(HISTORICAL_PRICES_STORAGE_KEY, historyFor(['exgl', 'acme', 'must']))
    localStorage.setItem('ft_price_cache_v2', '{"entries":[],"cachedAt":"2026-01-01T00:00:00.000Z"}')

    initializeStore()

    expect(read<Account[]>(KEYS.ACCOUNTS)[0].holdings.map((h) => h.exchange)).toEqual(['XETRA', 'US', 'NL'])
    expect(read<Transaction[]>(KEYS.TRANSACTIONS).map((t) => t.exchange)).toEqual(['XETRA', 'US', 'XETRA'])
    expect(read<PortfolioStore['settings']>(KEYS.SETTINGS).instrumentAliases['Example Global ETF'].exchange).toBe('XETRA')
    // Only the holdings that moved are fetched again.
    expect(read<HistoricalPricesCache>(HISTORICAL_PRICES_STORAGE_KEY).histories.map((h) => h.holdingId)).toEqual(['acme'])
    // Prices cached under the old conversion are dropped.
    expect(localStorage.getItem('ft_price_cache_v2')).toBeNull()
  })

  it('writes nothing when there is nothing to migrate', () => {
    const store = migrateLegacyExchangeCodes(legacyStore()).store
    seed(store)
    const before = localStorage.getItem(KEYS.ACCOUNTS)
    initializeStore()
    expect(localStorage.getItem(KEYS.ACCOUNTS)).toBe(before)
  })
})

describe('restoring a backup made before the change', () => {
  beforeEach(() => localStorage.clear())

  /** What Data Management does: validate, write, then the app starts again. */
  function restore(backup: Record<string, unknown>) {
    const result = validateBackup(JSON.parse(JSON.stringify(backup)))
    if (!result.ok) throw new Error(result.error)
    applyBackup(result.backup, result.fields)
    initializeStore()
  }

  it('is accepted, and its DE data comes back as XETRA', () => {
    seed(migrateLegacyExchangeCodes(legacyStore()).store)
    initializeStore()
    const old = legacyStore()
    restore({ version: old.version, accounts: old.accounts, transactions: old.transactions, settings: old.settings })

    expect(read<Account[]>(KEYS.ACCOUNTS)[0].holdings.map((h) => h.exchange)).toEqual(['XETRA', 'US', 'NL'])
    expect(read<Account[]>(KEYS.ACCOUNTS)[0].closedHoldings!.map((h) => h.exchange)).toEqual(['XETRA'])
    expect(read<Transaction[]>(KEYS.TRANSACTIONS).map((t) => t.exchange)).toEqual(['XETRA', 'US', 'XETRA'])
  })

  it('is migrated even when it carries no version', () => {
    seed(migrateLegacyExchangeCodes(legacyStore()).store)
    initializeStore()
    const old = legacyStore()
    restore({ accounts: old.accounts, transactions: old.transactions })

    expect(read<Account[]>(KEYS.ACCOUNTS)[0].holdings[0].exchange).toBe('XETRA')
    expect(read<Transaction[]>(KEYS.TRANSACTIONS)[0].exchange).toBe('XETRA')
  })
})
