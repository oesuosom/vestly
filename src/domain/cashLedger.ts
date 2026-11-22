import type { Transaction, TransactionType } from '@/types'
import { affectsCash, computeAccountCashBalance } from './calculations'

/** The kinds the Cash panel's "How it adds up" table lists, in display order. */
export const CASH_LEDGER_KINDS = [
  { kind: 'deposits', label: 'Deposits', types: ['deposit'] },
  { kind: 'withdrawals', label: 'Withdrawals', types: ['withdrawal'] },
  { kind: 'buys', label: 'Buys', types: ['buy'] },
  { kind: 'sales', label: 'Sales', types: ['sell'] },
  { kind: 'income', label: 'Dividends & interest', types: ['dividend', 'interest'] },
  { kind: 'taxes', label: 'Taxes', types: ['withholding_tax', 'interest_tax'] },
  { kind: 'fees', label: 'Fees', types: ['fee'] },
] as const satisfies readonly { kind: string; label: string; types: readonly TransactionType[] }[]

export type CashLedgerKind = (typeof CASH_LEDGER_KINDS)[number]['kind']

export type CashLedgerRow = {
  kind: CashLedgerKind
  label: string
  count: number
  /** Signed sum of `amountPLN`. */
  amountPLN: number
}

export type CashLedger = {
  /** One row per kind with at least one transaction, in `CASH_LEDGER_KINDS` order. */
  rows: CashLedgerRow[]
  /** Transactions across all rows. */
  count: number
  /** The account's cash balance (`computeAccountCashBalance`). */
  totalPLN: number
}

/** The account's transactions that move its cash (see `affectsCash`). */
function cashTransactions(transactions: Transaction[], accountId: string): Transaction[] {
  return transactions.filter((t) => t.accountId === accountId && affectsCash(t))
}

/**
 * How an account's cash balance adds up: the count and signed sum of its
 * cash-moving transactions per kind. Kinds with no transactions are left out.
 */
export function buildCashLedger(transactions: Transaction[], accountId: string): CashLedger {
  const own = cashTransactions(transactions, accountId)
  const rows: CashLedgerRow[] = []
  for (const { kind, label, types } of CASH_LEDGER_KINDS) {
    const matching = own.filter((t) => (types as readonly TransactionType[]).includes(t.type))
    if (matching.length === 0) continue
    rows.push({
      kind,
      label,
      count: matching.length,
      amountPLN: matching.reduce((sum, t) => sum + t.amountPLN, 0),
    })
  }
  return {
    rows,
    count: rows.reduce((sum, r) => sum + r.count, 0),
    totalPLN: computeAccountCashBalance(transactions, accountId),
  }
}

/** The account's most recent cash-moving transactions, newest first. */
export function latestCashChanges(transactions: Transaction[], accountId: string, limit = 5): Transaction[] {
  return cashTransactions(transactions, accountId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

/** Where an account's uncounted transactions came from. */
export type UncountedSource = 'emakler_import' | 'bond_holding' | 'other'

/**
 * The account's transactions that don't move its cash (`affectsCash` is
 * false), and where they came from: one source when they all share it,
 * otherwise `other`. `null` when there are none.
 */
export function uncountedCashTransactions(
  transactions: Transaction[],
  accountId: string,
): { count: number; source: UncountedSource } | null {
  const uncounted = transactions.filter((t) => t.accountId === accountId && !affectsCash(t))
  if (uncounted.length === 0) return null
  const sources = new Set(uncounted.map((t) => t.source))
  const only = sources.size === 1 ? [...sources][0] : undefined
  const source: UncountedSource = only === 'emakler_import' || only === 'bond_holding' ? only : 'other'
  return { count: uncounted.length, source }
}
