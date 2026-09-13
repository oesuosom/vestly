import {
  DEFAULT_SETTINGS,
  type Account,
  type ContributionTracking,
  type PortfolioStore,
  type SchemaVersion,
  type Settings,
  type Snapshot,
  type Transaction,
} from '@/types'
import { migrateIfNeeded } from './migrations'

/**
 * Every localStorage key the store owns. Exported so consumers that must know a
 * key by name — the multi-tab `storage` listener, backup restore — reference
 * this rather than repeating the literal.
 */
export const KEYS = {
  VERSION: 'ft_version',
  ACCOUNTS: 'ft_accounts',
  SNAPSHOTS: 'ft_snapshots',
  SETTINGS: 'ft_settings',
  CONTRIBUTIONS: 'ft_contribution',
  TRANSACTIONS: 'ft_transactions',
  PRICE_CACHE: 'ft_price_cache',
  INSIGHT_CACHE: 'ft_insight_cache',
  DIVIDEND_CACHE: 'ft_dividend_calendar_cache',
  NEWS_CACHE: 'ft_news_cache',
  NO_DIV_CACHE: 'ft_no_div_cache',
} as const

export type InsightCache = {
  summary: string
  cachedAt: string
  inputHash: string
}

export type DividendCacheEntry = {
  ticker: string
  name: string
  exDividendDate: string
  daysUntil: number
  estimatedPLN: number
}

export type DividendCache = {
  dividends: DividendCacheEntry[]
  cachedAt: string
}

export type NewsCacheEntry = {
  ticker: string
  name: string
  headlines: string[]
}

export type NewsCache = {
  entries: NewsCacheEntry[]
  cachedAt: string
}

/** Parse a JSON string from localStorage, returning the fallback on failure. */
function readKey<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Thrown when localStorage rejects a write because the origin's quota is full.
 *
 * Caught by the persist effects in `context/PortfolioContext.tsx`, which
 * surface the message rather than letting it unmount the app. The offending key
 * is interpolated into the message, so no separate field is needed.
 */
export class StorageQuotaError extends Error {
  constructor(key: string, options?: { cause?: unknown }) {
    super(
      `Browser storage is full — could not save "${key}". Export a backup, then clear cached data in Settings → Data Management.`,
      options
    )
    this.name = 'StorageQuotaError'
  }
}

function isQuotaError(err: unknown): boolean {
  // Chrome/Safari/Firefox all report quota exhaustion as a DOMException, but
  // under different names and legacy codes (22 / 1014).
  return (
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 ||
      err.code === 1014)
  )
}

/**
 * Write a value to localStorage as JSON.
 *
 * A failed write must never take the app down: an unhandled QuotaExceededError
 * thrown from a render-phase persist effect unmounts the whole tree. Quota
 * failures are rethrown as `StorageQuotaError` so callers can report them;
 * anything else (private-mode restrictions, disabled site data) is swallowed
 * after logging, leaving the in-memory state intact for the session.
 */
function writeKey<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    if (isQuotaError(err)) {
      console.error(`[storage] Quota exceeded writing "${key}"`, err)
      throw new StorageQuotaError(key, { cause: err })
    }
    console.error(`[storage] Failed to write "${key}"`, err)
  }
}

/**
 * Best-effort variant of `writeKey` for caches (prices, news, dividends,
 * insights). These are recomputable, so a full quota should degrade to a cache
 * miss rather than interrupt whatever the user was doing. `writeKey` already
 * swallows every non-quota failure, so the bare catch here only ever absorbs
 * `StorageQuotaError`.
 */
function writeCacheKey<T>(key: string, value: T): void {
  try {
    writeKey(key, value)
  } catch {
    // Cache writes are best-effort; a full quota just means a cache miss.
  }
}

/** Read the full portfolio store from all localStorage keys. */
export function getStore(): PortfolioStore {
  return {
    version: readKey<SchemaVersion>(KEYS.VERSION, {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    accounts: readKey<Account[]>(KEYS.ACCOUNTS, []),
    snapshots: readKey<Snapshot[]>(KEYS.SNAPSHOTS, []),
    settings: readKey<Settings>(KEYS.SETTINGS, DEFAULT_SETTINGS),
    contributions: readKey<ContributionTracking>(KEYS.CONTRIBUTIONS, {
      ikze: [],
      ike: [],
      updatedAt: new Date().toISOString(),
    }),
    transactions: readKey<Transaction[]>(KEYS.TRANSACTIONS, []),
  }
}

/** Persist the accounts array to localStorage. */
export function saveAccounts(accounts: Account[]): void {
  writeKey(KEYS.ACCOUNTS, accounts)
}

/** Persist the snapshots array to localStorage. */
export function saveSnapshots(snapshots: Snapshot[]): void {
  writeKey(KEYS.SNAPSHOTS, snapshots)
}

/** Persist the settings object to localStorage. */
export function saveSettings(settings: Settings): void {
  writeKey(KEYS.SETTINGS, settings)
}

/** Persist contribution tracking data to localStorage. */
export function saveContributions(contributions: ContributionTracking): void {
  writeKey(KEYS.CONTRIBUTIONS, contributions)
}

/** Persist the transactions array to localStorage. */
export function saveTransactions(transactions: Transaction[]): void {
  writeKey(KEYS.TRANSACTIONS, transactions)
}

/** Read the price cache from localStorage. */
export function getPriceCache<T>(): T | null {
  return readKey<T | null>(KEYS.PRICE_CACHE, null)
}

/** Persist the price cache to localStorage. */
export function savePriceCache<T>(cache: T): void {
  writeCacheKey(KEYS.PRICE_CACHE, cache)
}

/** Clear the price cache from localStorage. */
export function clearPriceCache(): void {
  localStorage.removeItem(KEYS.PRICE_CACHE)
}

/** Read the schema version from localStorage. */
export function getSchemaVersion(): SchemaVersion {
  return readKey<SchemaVersion>(KEYS.VERSION, {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

/** Write the schema version to localStorage. */
export function saveSchemaVersion(version: SchemaVersion): void {
  writeKey(KEYS.VERSION, version)
}

/**
 * Migrate legacy snapshots:
 * 1. Remove the `realEstate` key from allocation (old schema remnant).
 * 2. Drop empty snapshots (totalValue === 0 AND accountValues is empty).
 *
 * Reads from localStorage, cleans in memory, writes back only if changed.
 */
export function migrateSnapshots(): void {
  const raw = localStorage.getItem(KEYS.SNAPSHOTS)
  if (!raw) return

  let snapshots: Snapshot[]
  try {
    snapshots = JSON.parse(raw) as Snapshot[]
  } catch {
    return
  }

  if (!Array.isArray(snapshots) || snapshots.length === 0) return

  let changed = false

  // Pass 1 — strip realEstate from allocation objects
  const cleaned = snapshots.map((s) => {
    const alloc = s.allocation as Record<string, number>
    if ('realEstate' in alloc) {
      changed = true
      const { realEstate: _removed, ...rest } = alloc
      return { ...s, allocation: rest as Snapshot['allocation'] }
    }
    return s
  })

  // Pass 2 — remove empty snapshots (totalValue === 0 AND no account values)
  const filtered = cleaned.filter((s) => {
    const isEmpty =
      s.totalValue === 0 && Object.keys(s.accountValues).length === 0
    if (isEmpty) changed = true
    return !isEmpty
  })

  if (changed) {
    saveSnapshots(filtered)
  }
}

export function getInsightCache(): InsightCache | null {
  return readKey<InsightCache | null>(KEYS.INSIGHT_CACHE, null)
}

export function saveInsightCache(cache: InsightCache): void {
  writeCacheKey(KEYS.INSIGHT_CACHE, cache)
}

export function getDividendCache(): DividendCache | null {
  return readKey<DividendCache | null>(KEYS.DIVIDEND_CACHE, null)
}

export function saveDividendCache(cache: DividendCache): void {
  writeCacheKey(KEYS.DIVIDEND_CACHE, cache)
}

export function getNewsCache(): NewsCache | null {
  return readKey<NewsCache | null>(KEYS.NEWS_CACHE, null)
}

export function saveNewsCache(cache: NewsCache): void {
  writeCacheKey(KEYS.NEWS_CACHE, cache)
}

export type AccountInsightCache = {
  summary: string
  cachedAt: string
  inputHash: string
}

export function getAccountInsightCache(accountId: string): AccountInsightCache | null {
  return readKey<AccountInsightCache | null>(`ft_account_insight_${accountId}`, null)
}

export function saveAccountInsightCache(accountId: string, cache: AccountInsightCache): void {
  writeCacheKey(`ft_account_insight_${accountId}`, cache)
}

export type NoDivCache = {
  tickers: Record<string, string> // eodhdTicker → ISO date when 404 was recorded
}

export function getNoDivCache(): NoDivCache {
  return readKey<NoDivCache>(KEYS.NO_DIV_CACHE, { tickers: {} })
}

export function saveNoDivCache(cache: NoDivCache): void {
  writeCacheKey(KEYS.NO_DIV_CACHE, cache)
}

/** Initialize the store with defaults if nothing exists in localStorage. */
export function initializeStore(): void {
  if (localStorage.getItem(KEYS.VERSION) === null) {
    const now = new Date().toISOString()
    const hasExistingData =
      localStorage.getItem(KEYS.ACCOUNTS) !== null ||
      localStorage.getItem(KEYS.TRANSACTIONS) !== null

    // Stamp 2.0.0 — NOT 1.0.0 — so the 1→2 migration, which resets the
    // transaction log, can never run here. This matters when the version key
    // was lost (partial localStorage corruption) while real data survived;
    // stamping 1.0.0 would wipe ft_transactions on the next launch. The
    // idempotent 2→3 settings backfill still applies below.
    saveSchemaVersion({ version: '2.0.0', createdAt: now, updatedAt: now })

    if (!hasExistingData) {
      saveAccounts([])
      saveSnapshots([])
      saveSettings(DEFAULT_SETTINGS)
      saveContributions({
        ikze: [],
        ike: [],
        updatedAt: now,
      })
    }
  }

  // Run migrations on existing data
  migrateSnapshots()

  // Run schema version migrations
  const store = getStore()
  const migrated = migrateIfNeeded(store)
  if (migrated.version.version !== store.version.version) {
    saveSchemaVersion(migrated.version)
    saveTransactions(migrated.transactions)
    saveSettings(migrated.settings)
    // Accounts are persisted too — the 3→4 iconId rename rewrites them, and
    // without this the migrated value is computed and then thrown away.
    saveAccounts(migrated.accounts)
  }
}
