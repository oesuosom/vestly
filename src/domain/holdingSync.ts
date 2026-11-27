import type { Account, Holding, Transaction } from '@/types'
import { positionKey } from './calculations'
import { findSharedPositionHolding, holdingPositionKey, moveToClosed, planCloseFromSales } from './closePosition'
import { walkPosition, walkSales } from './position'
import { pairTradeFees } from './tradeFees'

/**
 * Trades update the holdings they belong to.
 *
 * After an import that brings trades (XTB Cash Operations, XTB confirmations,
 * the Revolut statement), every open holding the file has trades for is walked again
 * (`walkPosition`) with the new rows. Where the walk's quantity differs from
 * the holding's, the import proposes the change: a new quantity and average
 * cost, or — when nothing is left — closing the holding with the sales the
 * file brought (`planCloseFromSales`). Nothing changes until the person
 * confirms.
 *
 * A holding is only touched when the log explained its quantity before the
 * import: otherwise (bought before the first import, entered by hand, edited
 * since) the walk would overwrite a number it can't account for, so the
 * holding is left alone and flagged instead.
 */

export type HoldingSyncRow =
  | {
      kind: 'update'
      holding: Holding
      /** Units held after the import, rounded to 8 decimals. */
      quantity: number
      /** Average cost of those units, from the walk. */
      averageCostPLN: number
    }
  | {
      kind: 'close'
      holding: Holding
      /** Day of the last sale or transfer out, `yyyy-MM-dd`. */
      date: string
      /** What the file's sales of it brought in, after fees. 0 when it was only sent away. */
      proceedsPLN: number
      /** The file's rows for the holding, handed to `planCloseFromSales` when applied. */
      sales: Transaction[]
    }
  | {
      kind: 'unexplained'
      holding: Holding
      /**
       * `history`: the log didn't explain the holding's quantity before the
       * import. `shared`: another open holding has the same ticker, so the
       * trades can't be pinned on one of them.
       */
      reason: 'history' | 'shared'
      /** Units the log says are held after the import (for `history`). */
      quantity: number
    }

/** Below this many units, quantities are equal (crypto goes down to 1e-8). */
const QUANTITY_EPSILON = 1e-9

const TRADE_TYPES = new Set<Transaction['type']>(['buy', 'sell', 'send', 'receive'])

/** Quantities are stored to 8 decimals, so 0.1 + 0.2 doesn't keep its float noise. */
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

/**
 * What an import's trades change in the account's open holdings.
 *
 * @param account      The account as the import left it (new holdings included).
 * @param transactions The whole log after the import.
 * @param imported     The rows the import added. Rows the import skipped as
 *                     duplicates are ignored (they aren't in `transactions`).
 * @returns One row per open holding the import traded whose quantity changed,
 *          or that can't be updated. Holdings already matching are left out.
 */
export function planHoldingSync(account: Account, transactions: Transaction[], imported: Transaction[]): HoldingSyncRow[] {
  const logIds = new Set(transactions.map((t) => t.id))
  const added = imported.filter((t) => t.accountId === account.id && logIds.has(t.id))
  const addedIds = new Set(added.map((t) => t.id))
  const tradedKeys = new Set(
    added.flatMap((t) => {
      const key = TRADE_TYPES.has(t.type) && t.quantity ? positionKey(t) : undefined
      return key ? [key] : []
    }),
  )
  if (tradedKeys.size === 0) return []

  const tradeFees = pairTradeFees(transactions)
  const rows: HoldingSyncRow[] = []
  for (const holding of account.holdings) {
    if (holding.isSynthetic) continue
    const key = holdingPositionKey(holding)
    if (!tradedKeys.has(key)) continue

    const positionRows = transactions.filter((t) => t.accountId === account.id && positionKey(t) === key)
    const after = walkPosition(positionRows, tradeFees)
    const quantity = round8(after.quantity)
    if (Math.abs(quantity - holding.quantity) < QUANTITY_EPSILON) continue

    if (findSharedPositionHolding(holding, account)) {
      rows.push({ kind: 'unexplained', holding, reason: 'shared', quantity })
      continue
    }

    const before = walkPosition(positionRows.filter((t) => !addedIds.has(t.id)), tradeFees)
    const explained =
      Math.abs(before.quantity - holding.quantity) < QUANTITY_EPSILON &&
      after.unexplainedQuantity <= before.unexplainedQuantity + QUANTITY_EPSILON
    if (!explained) {
      rows.push({ kind: 'unexplained', holding, reason: 'history', quantity })
      continue
    }

    if (quantity > 0) {
      rows.push({ kind: 'update', holding, quantity, averageCostPLN: after.averageCostPLN })
      continue
    }

    const fileRows = added.filter((t) => positionKey(t) === key)
    const plan = planCloseFromSales(holding, account, transactions, fileRows)
    if (!plan) {
      rows.push({ kind: 'unexplained', holding, reason: 'history', quantity })
      continue
    }
    const results = walkSales(positionRows, tradeFees)
    const proceedsPLN = plan.sales.reduce((sum, t) => sum + (results.get(t.id)?.proceedsPLN ?? 0), 0)
    rows.push({ kind: 'close', holding, date: plan.date, proceedsPLN, sales: fileRows })
  }
  return rows
}

/** The rows a confirm applies: updates and closes, not the flagged ones. */
export function actionableSyncRows(rows: HoldingSyncRow[]): Exclude<HoldingSyncRow, { kind: 'unexplained' }>[] {
  return rows.filter((r): r is Exclude<HoldingSyncRow, { kind: 'unexplained' }> => r.kind !== 'unexplained')
}

/**
 * The accounts once the rows are applied: updated quantities and average
 * costs, closed holdings moved to Closed positions. For a later step that
 * works from a snapshot (the purchase-price step), so it sees what was applied.
 */
export function accountsAfterSync(accounts: Account[], rows: HoldingSyncRow[], now: string): Account[] {
  let next = accounts
  for (const row of actionableSyncRows(rows)) {
    if (row.kind === 'update') {
      next = next.map((a) =>
        a.id !== row.holding.accountId
          ? a
          : {
              ...a,
              holdings: a.holdings.map((h) =>
                h.id === row.holding.id ? { ...h, quantity: row.quantity, purchasePrice: row.averageCostPLN, updatedAt: now } : h,
              ),
              lastUpdated: now,
            },
      )
    } else {
      next = moveToClosed(next, row.holding.id, row.date, now)
    }
  }
  return next
}
