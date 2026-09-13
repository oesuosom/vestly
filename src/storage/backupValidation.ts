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

/** Every member of `arr` must be an object carrying all of `required`. */
function membersHave(arr: unknown[], required: string[]): boolean {
  return arr.every((item) => isPlainObject(item) && required.every((k) => k in item))
}

/**
 * Check a parsed backup before any of it is written.
 *
 * Deliberately structural, not exhaustive: it confirms each present field is
 * the right container with plausibly-shaped members, which is what stops a
 * crash or a silent `NaN`. It does not attempt to be a full schema — a backup
 * that passes here can still be semantically odd, and migrations remain
 * responsible for version drift.
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
      case 'accounts':
        if (!Array.isArray(value)) return { ok: false, error: '`accounts` must be a list.' }
        if (!membersHave(value, ['id', 'name', 'holdings'])) {
          return { ok: false, error: 'An account is missing `id`, `name` or `holdings`.' }
        }
        if (!value.every((a) => Array.isArray((a as Record<string, unknown>).holdings))) {
          return { ok: false, error: 'An account’s `holdings` is not a list.' }
        }
        break

      case 'transactions':
        if (!Array.isArray(value)) return { ok: false, error: '`transactions` must be a list.' }
        if (!membersHave(value, ['id', 'accountId', 'type', 'date', 'amountPLN'])) {
          return { ok: false, error: 'A transaction is missing a required field.' }
        }
        // A non-numeric amount is the classic silent-NaN source.
        if (!value.every((t) => typeof (t as Record<string, unknown>).amountPLN === 'number')) {
          return { ok: false, error: 'A transaction has a non-numeric `amountPLN`.' }
        }
        break

      case 'snapshots':
        if (!Array.isArray(value)) return { ok: false, error: '`snapshots` must be a list.' }
        if (!membersHave(value, ['date', 'totalValue'])) {
          return { ok: false, error: 'A snapshot is missing `date` or `totalValue`.' }
        }
        break

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
