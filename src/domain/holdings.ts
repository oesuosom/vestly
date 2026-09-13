import type { Account, Holding, Transaction } from '@/types'
import { computeAccountCashBalance } from './calculations'

/**
 * Compute the XTB cash balance for an account from its transactions and
 * upsert a synthetic cash holding reflecting that balance.
 *
 * The synthetic holding uses a stable ID (`cash_<accountId>`) so repeated
 * calls replace the previous value rather than accumulating duplicates.
 *
 * currentPrice === purchasePrice for cash (it doesn't appreciate), so the
 * holding shows zero P&L and contributes its face value to total wealth and
 * the Cash slice of asset allocation.
 */
export function upsertSyntheticCashHolding(
  accounts: Account[],
  transactions: Transaction[],
  accountId: string
): Account[] {
  // Crypto accounts hold assets, not fiat cash — synthetic cash doesn't apply.
  const account = accounts.find((a) => a.id === accountId)
  if (!account || account.type === 'crypto') return accounts

  const balance = computeAccountCashBalance(transactions, accountId)
  const syntheticId = `cash_${accountId}`
  const now = new Date().toISOString()

  // Use the earliest transaction date so the holding is included in historical
  // chart computations. Using today would cause a spike: the cash balance would
  // contribute 0 for all past dates but its full value on today's live total.
  const accountTransactions = transactions.filter((t) => t.accountId === accountId)
  const earliestDate = accountTransactions.length > 0
    ? accountTransactions.map((t) => t.date.slice(0, 10)).sort()[0]
    : now.split('T')[0]

  const cashHolding: Holding = {
    id: syntheticId,
    accountId,
    name: 'Cash',
    category: 'cash',
    quantity: 1,
    purchasePrice: balance,
    currentPrice: balance,
    purchaseDate: earliestDate,
    isSynthetic: true,
    createdAt: now,
    updatedAt: now,
  }

  return accounts.map((acc) => {
    if (acc.id !== accountId) return acc
    const withoutCash = acc.holdings.filter((h) => h.id !== syntheticId)
    return { ...acc, holdings: [...withoutCash, cashHolding] }
  })
}
