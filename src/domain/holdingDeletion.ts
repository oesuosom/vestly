import type { Account, Holding, Transaction, TransactionType } from '@/types'
import { staticLookupInstrument } from '@/domain/instrumentLookup'
import { resolveDividendLinks } from '@/domain/transactions'

/** Row types whose `relatedHoldingId` `resolveDividendLinks` re-derives from `relatedTicker` on every load. */
const TICKER_LINKED_TYPES: ReadonlySet<TransactionType> = new Set(['dividend', 'withholding_tax', 'interest', 'interest_tax'])

/**
 * Which transactions go when a holding is deleted.
 *
 * Delete is for holdings that shouldn't exist (a mistake, a duplicate), so the
 * holding takes the transactions that clearly belong to it:
 *
 * 1. Transactions linked to it by `relatedHoldingId` — except a dividend, tax
 *    or interest row whose link only came from a ticker another holding in the
 *    account shares. `resolveDividendLinks` points those at whichever holding
 *    with the ticker comes last, so the link says nothing about which one
 *    earned it. They stay, and `deleteHoldingFromLog` re-links them.
 * 2. Unlinked transactions in the same account whose ticker or instrument name
 *    matches it — but only when no other holding in that account has the same
 *    ticker or name. With two Apple holdings, a buy of AAPL can't be told apart,
 *    so it stays.
 *
 * A transaction linked to a different, existing holding is never matched.
 * Synthetic holdings (the Cash row) own no transactions.
 *
 * Both the delete itself and the confirm dialog's count call this, so the
 * dialog can never promise something other than what is removed.
 */
export function findHoldingTransactions(
  holding: Holding,
  accounts: Account[],
  transactions: Transaction[],
): Transaction[] {
  if (holding.isSynthetic) return []

  const ticker = holding.ticker?.toUpperCase()
  const name = holding.name.toLowerCase()
  const account = accounts.find((a) => a.id === holding.accountId)
  const others = (account?.holdings ?? []).filter((h) => h.id !== holding.id)
  const tickerShared = ticker !== undefined && others.some((h) => h.ticker?.toUpperCase() === ticker)
  const ambiguous = tickerShared || others.some((h) => h.name.toLowerCase() === name)
  const holdingIds = new Set(accounts.flatMap((a) => a.holdings.map((h) => h.id)))

  return transactions.filter((t) => {
    if (t.relatedHoldingId === holding.id) {
      const tickerDerived =
        TICKER_LINKED_TYPES.has(t.type) &&
        t.accountId === holding.accountId &&
        t.relatedTicker?.toUpperCase() === ticker
      return !(tickerShared && tickerDerived)
    }
    if (t.relatedHoldingId && holdingIds.has(t.relatedHoldingId)) return false
    if (ambiguous || t.accountId !== holding.accountId) return false

    if (ticker) {
      if (resolveTicker(t.ticker, t.instrument) === ticker) return true
      if (resolveTicker(t.relatedTicker, t.relatedInstrument) === ticker) return true
    }
    return t.instrument?.toLowerCase() === name || t.relatedInstrument?.toLowerCase() === name
  })
}

/**
 * The transaction log after deleting `holding`: what `findHoldingTransactions`
 * matches is removed, and the rows that stay are re-linked against the
 * accounts without the holding, so a kept dividend points at the holding that
 * remains rather than at one that no longer exists.
 */
export function deleteHoldingFromLog(
  holding: Holding,
  accounts: Account[],
  transactions: Transaction[],
): Transaction[] {
  const removed = new Set(findHoldingTransactions(holding, accounts, transactions))
  const kept = removed.size > 0 ? transactions.filter((t) => !removed.has(t)) : transactions
  const remainingAccounts = accounts.map((a) =>
    a.id === holding.accountId ? { ...a, holdings: a.holdings.filter((h) => h.id !== holding.id) } : a,
  )
  return resolveDividendLinks(kept, remainingAccounts)
}

/** Deleting an account takes its whole transaction log with it. */
export function findAccountTransactions(accountId: string, transactions: Transaction[]): Transaction[] {
  return transactions.filter((t) => t.accountId === accountId)
}

function resolveTicker(ticker: string | undefined, instrument: string | undefined): string | undefined {
  return (ticker ?? (instrument ? staticLookupInstrument(instrument)?.ticker : undefined))?.toUpperCase()
}

const TYPE_NOUNS: Record<TransactionType, [singular: string, plural: string]> = {
  buy: ['buy', 'buys'],
  sell: ['sell', 'sells'],
  deposit: ['deposit', 'deposits'],
  withdrawal: ['withdrawal', 'withdrawals'],
  dividend: ['dividend', 'dividends'],
  withholding_tax: ['dividend tax', 'dividend taxes'],
  interest: ['interest payment', 'interest payments'],
  interest_tax: ['interest tax', 'interest taxes'],
  fee: ['fee', 'fees'],
  send: ['transfer out', 'transfers out'],
  receive: ['transfer in', 'transfers in'],
}

// Breakdown order follows the table above, so the same mix always reads the same way.
const TYPE_ORDER = Object.keys(TYPE_NOUNS) as TransactionType[]

/**
 * "3 transactions (2 buys, 1 dividend)" — or null when there are none.
 * A single type needs no breakdown: "2 buys".
 */
export function describeTransactions(transactions: Transaction[]): string | null {
  if (transactions.length === 0) return null

  const counts = new Map<TransactionType, number>()
  for (const t of transactions) counts.set(t.type, (counts.get(t.type) ?? 0) + 1)

  const parts = TYPE_ORDER.filter((type) => counts.has(type)).map((type) => {
    const n = counts.get(type)!
    return `${n} ${TYPE_NOUNS[type][n === 1 ? 0 : 1]}`
  })
  if (parts.length === 1) return parts[0]

  const total = `${transactions.length} transactions`
  return `${total} (${parts.join(', ')})`
}
