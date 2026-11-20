import type { Account, Holding, Transaction } from '@/types'
import { earliestCloseDate, findSharedPositionHolding } from './closePosition'

/**
 * Holdings missing from a holdings file.
 *
 * Only a file that lists everything an account holds (eMakler portfolio, PKO
 * IKE and other holdings CSVs) can say a holding is gone. Even then an import
 * never deletes it: the preview lists it under "Not in this file", kept by
 * default, and the person can mark it as sold, which closes it (#28). Files
 * that list only some instruments (order history, trade files) never list
 * missing holdings at all.
 */

export type MissingHoldings = {
  /** Open holdings the file doesn't list, oldest first as in the account. */
  missing: Holding[]
  /**
   * The file lists holdings, the account has some, and none are the same: it
   * is probably the wrong account's file, so nothing is listed as missing.
   */
  noOverlap: boolean
}

/**
 * The account's open holdings a full holdings file doesn't list.
 *
 * @param existing   The account's open, non-synthetic holdings.
 * @param matchedIds Ids of the holdings the file lists (its update rows).
 * @param fileHasRows Whether the file lists any holding at all.
 * @param statementDate The day the file was produced, `yyyy-MM-dd`, when it
 *   says. Holdings bought after it can't be in it, so they aren't listed.
 */
export function findMissingHoldings(
  existing: Holding[],
  matchedIds: ReadonlySet<string>,
  fileHasRows: boolean,
  statementDate?: string,
): MissingHoldings {
  const open = existing.filter((h) => !h.isSynthetic)
  if (fileHasRows && open.length > 0 && !open.some((h) => matchedIds.has(h.id))) {
    return { missing: [], noOverlap: true }
  }
  const missing = open.filter(
    (h) => !matchedIds.has(h.id) && (statementDate === undefined || h.purchaseDate.slice(0, 10) <= statementDate),
  )
  return { missing, noOverlap: false }
}

/** What "Mark as sold" fills in: the last known value, on the statement date or today. */
export function markAsSoldDefaults(
  holding: Holding,
  today: string,
  statementDate?: string,
): { date: string; amount: string } {
  const value = Math.round(holding.quantity * holding.currentPrice * 100) / 100
  return { date: statementDate ?? today, amount: String(value) }
}

/** Parse an amount typed with a comma or a dot. NaN when it isn't a number. */
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.')
  return cleaned === '' ? NaN : Number(cleaned)
}

export type MarkAsSoldErrors = {
  date?: 'required' | 'future' | 'beforePurchase'
  amount?: 'required' | 'negative'
  /** Another open holding in the account shares the ticker (see `findSharedPositionHolding`). */
  sharedWith?: Holding
  /** The earliest valid date, for the `beforePurchase` message. */
  earliest: string
}

/**
 * Why a "Mark as sold" row can't be closed as entered, with the rules of the
 * Close position dialog: a date from the last purchase to today, an amount of
 * 0 or more, and no other open holding with the same ticker. Empty when valid.
 */
export function markAsSoldErrors(
  holding: Holding,
  account: Account,
  transactions: Transaction[],
  input: { date: string; amount: string },
  today: string,
): MarkAsSoldErrors {
  const earliest = earliestCloseDate(holding, account, transactions)
  const errors: MarkAsSoldErrors = { earliest }
  const shared = findSharedPositionHolding(holding, account)
  if (shared) errors.sharedWith = shared
  if (!input.date) errors.date = 'required'
  else if (input.date > today) errors.date = 'future'
  else if (input.date < earliest) errors.date = 'beforePurchase'
  const amount = parseAmount(input.amount)
  if (!Number.isFinite(amount)) errors.amount = 'required'
  else if (amount < 0) errors.amount = 'negative'
  return errors
}

export function hasErrors(errors: MarkAsSoldErrors): boolean {
  return Boolean(errors.date || errors.amount || errors.sharedWith)
}
