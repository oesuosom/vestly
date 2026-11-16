/**
 * Shape validation for restored backups.
 *
 * A backup file is arbitrary user-supplied JSON. Writing it into localStorage
 * unchecked has three failure modes, in rising order of nastiness:
 *
 *   1. A wrong *type* (`{"accounts": "hello"}`) crashes the app on the reload
 *      that follows the restore, because the store expects an array.
 *   2. A wrong *shape* — array members missing required fields — does not
 *      crash. It propagates: a holding with no `quantity` makes value and P&L
 *      `NaN`, which spreads silently into totals, allocation and charts.
 *   3. A *partial* write leaves the store internally inconsistent — accounts
 *      from the backup, transactions from before it.
 *
 * `validateBackup` addresses 1 and 2; `applyBackup` addresses 3 by rolling
 * back every key it touched if any single write fails.
 */
import type { AccountType, AssetCategory, TransactionType } from '@/types'
import { KEYS } from './portfolioStore'

/** Keys a backup may carry, mapped to the localStorage key each restores to. */
export const BACKUP_KEY_MAP = {
  accounts: KEYS.ACCOUNTS,
  snapshots: KEYS.SNAPSHOTS,
  settings: KEYS.SETTINGS,
  contributions: KEYS.CONTRIBUTIONS,
  version: KEYS.VERSION,
  transactions: KEYS.TRANSACTIONS,
} as const

export type BackupField = keyof typeof BACKUP_KEY_MAP

export type ValidationResult =
  | { ok: true; fields: BackupField[] }
  | { ok: false; error: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isText(v: unknown): v is string {
  return typeof v === 'string'
}

/** JSON has no NaN or Infinity, but `null` and numeric strings do turn up. */
function isAmount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** `yyyy-MM-dd`, alone or as the start of a full ISO datetime — what every importer writes. */
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/

function isDate(v: unknown): v is string {
  return isText(v) && DATE_PREFIX.test(v)
}

/*
 * The values the app looks up in tables keyed by these unions (account
 * colours and icons, holding icons, Activity labels); anything else crashes
 * the page that renders it. Typed as records so adding a member to a union
 * without listing it here is a compile error, not a backup that won't restore.
 */
const ACCOUNT_TYPES: Record<AccountType, true> = {
  brokerage: true,
  ikze: true,
  ike: true,
  crypto: true,
  savings: true,
}

const ASSET_CATEGORIES: Record<AssetCategory, true> = {
  stock: true,
  etf: true,
  bond: true,
  crypto: true,
  cash: true,
}

const TRANSACTION_TYPES: Record<TransactionType, true> = {
  buy: true,
  sell: true,
  deposit: true,
  withdrawal: true,
  dividend: true,
  withholding_tax: true,
  interest: true,
  interest_tax: true,
  fee: true,
  send: true,
  receive: true,
}

function oneOf(known: Record<string, true>): (v: unknown) => boolean {
  return (v) => isText(v) && Object.hasOwn(known, v)
}

/**
 * A field the app reads without a guard, with the plain-language name used in
 * error messages. `'unknown'` marks a field limited to a fixed set of values:
 * a failure then quotes the value ("has an unknown type “pension”"). Optional
 * fields (`ticker`, `notes`, `isSynthetic`…) are deliberately not listed:
 * older backups legitimately lack them.
 */
type FieldRule = readonly [
  key: string,
  label: string,
  check: (v: unknown) => boolean,
  failure?: 'unknown',
]

const ACCOUNT_RULES: FieldRule[] = [
  ['id', 'ID', isText],
  ['name', 'name', isText],
  ['type', 'type', oneOf(ACCOUNT_TYPES), 'unknown'],
]

// `purchaseDate` only has to be text: an empty or odd one shows no visible
// problem, and backups from manual entry may carry either.
const HOLDING_RULES: FieldRule[] = [
  ['id', 'ID', isText],
  ['name', 'name', isText],
  ['category', 'category', oneOf(ASSET_CATEGORIES), 'unknown'],
  ['purchaseDate', 'purchase date', isText],
  ['quantity', 'quantity', isAmount],
  ['purchasePrice', 'purchase price', isAmount],
  ['currentPrice', 'current price', isAmount],
]

// `id` is not required: snapshots are looked up by date, and older stores
// carry legacy `yyyy-MM` dates and a `realEstate` allocation key that startup
// migrates, so only the containers and the total are checked.
const SNAPSHOT_RULES: FieldRule[] = [
  ['date', 'date', isText],
  ['totalValue', 'total value', isAmount],
  ['allocation', 'allocation breakdown', isPlainObject],
  ['accountValues', 'per-account values', isPlainObject],
]

const TRANSACTION_RULES: FieldRule[] = [
  ['id', 'ID', isText],
  ['accountId', 'account', isText],
  ['type', 'type', oneOf(TRANSACTION_TYPES), 'unknown'],
  ['date', 'date', isDate],
  ['amountPLN', 'amount', isAmount],
]

/** First rule `record` breaks, phrased to follow its name ("… has no quantity."). */
function findProblem(record: Record<string, unknown>, rules: FieldRule[]): string | null {
  for (const [key, label, check, failure] of rules) {
    const value = record[key]
    if (value === undefined || value === null) return `has no ${label}`
    if (check(value)) continue
    if (failure === 'unknown') return `has an unknown ${label}${isText(value) ? ` “${value}”` : ''}`
    return `has an invalid ${label}`
  }
  return null
}

/** " (“Broker”)" when the record has a usable name, otherwise nothing. */
function quoted(v: unknown): string {
  return isText(v) && v.trim() !== '' ? ` (“${v}”)` : ''
}

/** " (2026-02-10)" or, for a legacy snapshot, " (2025-09)"; nothing for a non-date. */
function dateLabel(v: unknown): string {
  const match = isText(v) ? /^\d{4}-\d{2}(-\d{2})?/.exec(v) : null
  return match ? ` (${match[0]})` : ''
}

function checkAccounts(accounts: unknown[]): string | null {
  for (const [i, account] of accounts.entries()) {
    if (!isPlainObject(account)) return `Account ${i + 1} is not a valid account.`
    const accountLabel = `Account ${i + 1}${quoted(account.name)}`

    const problem = findProblem(account, ACCOUNT_RULES)
    if (problem) return `${accountLabel} ${problem}.`
    if (!Array.isArray(account.holdings)) return `${accountLabel} has no list of holdings.`

    for (const [j, holding] of account.holdings.entries()) {
      if (!isPlainObject(holding)) return `Holding ${j + 1} in “${account.name}” is not a valid holding.`
      const holdingLabel = `Holding ${j + 1}${quoted(holding.name)} in “${account.name}”`
      const holdingProblem = findProblem(holding, HOLDING_RULES)
      if (holdingProblem) return `${holdingLabel} ${holdingProblem}.`
    }
  }
  return null
}

function checkSnapshots(snapshots: unknown[]): string | null {
  for (const [i, snapshot] of snapshots.entries()) {
    if (!isPlainObject(snapshot)) return `Snapshot ${i + 1} is not a valid snapshot.`
    const problem = findProblem(snapshot, SNAPSHOT_RULES)
    if (problem) return `Snapshot ${i + 1}${dateLabel(snapshot.date)} ${problem}.`
  }
  return null
}

function checkTransactions(transactions: unknown[]): string | null {
  for (const [i, transaction] of transactions.entries()) {
    if (!isPlainObject(transaction)) return `Transaction ${i + 1} is not a valid transaction.`
    const problem = findProblem(transaction, TRANSACTION_RULES)
    if (problem) return `Transaction ${i + 1}${dateLabel(transaction.date)} ${problem}.`
  }
  return null
}

/**
 * Check a parsed backup before any of it is written.
 *
 * Checks each record for the fields the app reads without a guard — the ones
 * whose absence crashes a page or turns totals into `NaN` — and names the
 * first bad record in the error, since the message is shown to the user.
 * Optional fields stay optional, and legacy shapes that startup migrates
 * (`yyyy-MM` snapshot dates, a `realEstate` allocation key, `allocationTargets`
 * in settings) are accepted. It is not a full schema: a backup that passes can
 * still be semantically odd, and migrations remain responsible for version
 * drift.
 */
export function validateBackup(parsed: unknown): ValidationResult {
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Not a Vestly backup — expected a JSON object.' }
  }

  const present = (Object.keys(BACKUP_KEY_MAP) as BackupField[]).filter(
    (k) => parsed[k] !== undefined && parsed[k] !== null,
  )

  if (present.length === 0) {
    return {
      ok: false,
      error: 'Not a Vestly backup — no recognised data (accounts, transactions, settings…).',
    }
  }

  for (const field of present) {
    const value = parsed[field]

    switch (field) {
      case 'accounts': {
        if (!Array.isArray(value)) return { ok: false, error: '`accounts` must be a list.' }
        const error = checkAccounts(value)
        if (error) return { ok: false, error }
        break
      }

      case 'transactions': {
        if (!Array.isArray(value)) return { ok: false, error: '`transactions` must be a list.' }
        const error = checkTransactions(value)
        if (error) return { ok: false, error }
        break
      }

      case 'snapshots': {
        if (!Array.isArray(value)) return { ok: false, error: '`snapshots` must be a list.' }
        const error = checkSnapshots(value)
        if (error) return { ok: false, error }
        break
      }

      case 'settings':
        if (!isPlainObject(value)) return { ok: false, error: '`settings` must be an object.' }
        break

      case 'contributions':
        if (!isPlainObject(value)) return { ok: false, error: '`contributions` must be an object.' }
        break

      case 'version':
        if (!isPlainObject(value) || typeof value.version !== 'string') {
          return { ok: false, error: '`version` must be an object with a version string.' }
        }
        break
    }
  }

  return { ok: true, fields: present }
}

/**
 * Write the validated fields, rolling back if any write fails.
 *
 * localStorage has no transactions, so this snapshots the previous value of
 * every key it is about to touch and restores them on failure. Without this a
 * quota error partway through leaves a half-restored store, which is worse
 * than not restoring at all.
 */
export function applyBackup(
  parsed: Record<string, unknown>,
  fields: BackupField[],
  transform?: Partial<Record<BackupField, (value: unknown) => unknown>>,
): void {
  const writes = fields.map((field) => {
    const raw = transform?.[field] ? transform[field]!(parsed[field]) : parsed[field]
    return [BACKUP_KEY_MAP[field], JSON.stringify(raw)] as const
  })

  const previous = writes.map(([key]) => [key, localStorage.getItem(key)] as const)

  try {
    for (const [key, value] of writes) localStorage.setItem(key, value)
  } catch (err) {
    for (const [key, value] of previous) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
    throw err
  }
}
