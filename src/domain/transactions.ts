import { v4 as uuidv4 } from 'uuid'
import type { Account, Holding, Transaction } from '@/types'

/**
 * Link dividend and withholding_tax transactions to their corresponding holdings
 * by matching relatedTicker to the ticker field on holdings.
 *
 * Run after import and after a holding is manually created/edited — in case the
 * holding didn't exist yet when transactions were first imported.
 *
 * Already-linked transactions are re-evaluated so ticker corrections propagate.
 * Transactions with no relatedTicker, or whose ticker has no matching holding,
 * are returned as-is (relatedHoldingId remains undefined).
 */
/** Build a synthetic buy transaction that backs a bond holding on the Activity page. */
export function buildBondBuyTransaction(holding: Holding): Transaction {
  return {
    id: uuidv4(),
    accountId: holding.accountId,
    type: 'buy',
    date: `${holding.purchaseDate}T00:00:00.000Z`,
    amountPLN: -(holding.purchasePrice * holding.quantity),
    instrument: holding.name,
    ticker: holding.ticker,
    quantity: holding.quantity,
    pricePerUnitPLN: holding.purchasePrice,
    source: 'bond_holding',
    externalId: `bond-buy-${holding.id}`,
    relatedHoldingId: holding.id,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Upsert a bond buy transaction for the given holding:
 * creates one if missing, updates fields if the holding changed.
 */
export function upsertBondBuyTransaction(
  transactions: Transaction[],
  holding: Holding
): Transaction[] {
  const externalId = `bond-buy-${holding.id}`
  const idx = transactions.findIndex(t => t.externalId === externalId)
  const updated: Transaction = idx >= 0
    ? {
        ...transactions[idx],
        amountPLN: -(holding.purchasePrice * holding.quantity),
        instrument: holding.name,
        ticker: holding.ticker,
        quantity: holding.quantity,
        pricePerUnitPLN: holding.purchasePrice,
        date: `${holding.purchaseDate}T00:00:00.000Z`,
      }
    : buildBondBuyTransaction(holding)
  return idx >= 0
    ? transactions.map((t, i) => (i === idx ? updated : t))
    : [...transactions, updated]
}

export function resolveDividendLinks(
  transactions: Transaction[],
  accounts: Account[]
): Transaction[] {
  // Build a map: "accountId:ticker" → holdingId — composite key prevents
  // one account's holding from overwriting another when the same ticker exists in both.
  const tickerMap = new Map<string, string>()
  for (const acc of accounts) {
    for (const h of acc.holdings) {
      if (h.ticker) tickerMap.set(`${acc.id}:${h.ticker.toUpperCase()}`, h.id)
    }
  }

  return transactions.map((t) => {
    if (!['dividend', 'withholding_tax', 'interest', 'interest_tax'].includes(t.type)) return t
    if (!t.relatedTicker) return t

    const holdingId = tickerMap.get(`${t.accountId}:${t.relatedTicker.toUpperCase()}`)
    return holdingId ? { ...t, relatedHoldingId: holdingId } : t
  })
}
