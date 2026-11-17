import { v4 as uuidv4 } from 'uuid'
import type { Account, Holding, Transaction } from '@/types'
import { affectsCash, positionKey, resolveTransactionTicker } from './calculations'
import { walkPosition, walkSales, type SaleResult } from './position'
import { pairTradeFees } from './tradeFees'

/**
 * Close position: record that a whole holding was sold.
 *
 * Closing adds one `sell` transaction for the holding's full quantity, moves the
 * holding from `Account.holdings` to `Account.closedHoldings`, and leaves every
 * other transaction alone. Reopen undoes exactly that. The rules live here so
 * the dialog's preview, the context action and the Closed positions row all
 * work them out the same way.
 */

/** What the person enters in the Close position dialog. */
export type CloseInput = {
  /** Day of the sale, `yyyy-MM-dd`. */
  date: string
  /** What the sale brought in before fees, in PLN. For bonds: the amount paid out. */
  saleAmountPLN: number
  /** Broker or early-redemption fee, in PLN. 0 when there was none. */
  feePLN: number
}

export type ClosePlan = {
  /** The rows to add to the log: the filled-in buy (if any), then the sale. */
  transactions: Transaction[]
  sale: Transaction
  /**
   * A buy for the units the log never recorded coming in (a holding entered by
   * hand), dated on the holding's purchase date at its average cost. Without
   * it the walk has nothing to sell from and realized profit skips the sale.
   */
  filledInBuy: Transaction | null
  /** Whether the proceeds go to the account's Cash row (see {@link closeAddsToCash}). */
  addsToCash: boolean
  /** What the sale realizes, as the position walk counts it. */
  result: SaleResult
}

/** Below this many units a shortfall is floating-point residue, as in `position.ts`. */
const QUANTITY_EPSILON = 1e-9

const saleExternalId = (holdingId: string) => `close-sell-${holdingId}`
const buyExternalId = (holdingId: string) => `close-buy-${holdingId}`

/**
 * The position a holding's trades belong to within its account — the same
 * `positionKey` its transactions get. A bond lot is always its own position
 * (its rows are `bond_holding`, linked to it). Anything else goes by its
 * ticker, or its name when that reads as one, or the holding itself when it
 * has neither.
 */
export function holdingPositionKey(holding: Holding): string {
  if (holding.category === 'bond') return `#${holding.id}`
  return resolveTransactionTicker({ ticker: holding.ticker, instrument: holding.name }) ?? `#${holding.id}`
}

/**
 * The source of the rows a close adds. A bond lot's rows are `bond_holding`,
 * like its buy, so the walk and the chart keep each lot separate from other
 * lots of the series; everything else is `manual`.
 */
function closeSource(holding: Holding): Transaction['source'] {
  return holding.category === 'bond' ? 'bond_holding' : 'manual'
}

/** The account's transactions in the holding's position, in any order. */
function positionRows(transactions: Transaction[], accountId: string, key: string): Transaction[] {
  return transactions.filter((t) => t.accountId === accountId && positionKey(t) === key)
}

/**
 * Another open holding in the account that shares this holding's position, if
 * any. Realized profit is worked out per account and ticker, not per holding,
 * so with two such holdings a sale can't be pinned on one of them. Closing is
 * blocked until they are one holding, and so is reopening a closed one while an
 * open one exists (the issue's rule for rebuys). Never true for a bond lot:
 * each is its own position.
 */
export function findSharedPositionHolding(holding: Holding, account: Account): Holding | undefined {
  const key = holdingPositionKey(holding)
  return account.holdings.find((h) => h.id !== holding.id && !h.isSynthetic && holdingPositionKey(h) === key)
}

/**
 * The earliest day the holding can be closed on: its purchase date, or the
 * last buy or transfer in of its position if that is later. A sale before
 * either would sell units the log says weren't held yet.
 */
export function earliestCloseDate(holding: Holding, account: Account, transactions: Transaction[]): string {
  const lastInflow = positionRows(transactions, account.id, holdingPositionKey(holding))
    .filter((t) => t.type === 'buy' || t.type === 'receive')
    .map((t) => t.date.slice(0, 10))
    .sort()
    .at(-1)
  return lastInflow && lastInflow > holding.purchaseDate ? lastInflow : holding.purchaseDate
}

/**
 * The cash rule: a sale's proceeds reach the Cash row only when the holding's
 * purchases were taken out of it, so the money is never counted twice — nor
 * credited for units whose cost was never debited.
 *
 * True when the account has a Cash row (not crypto), every buy and transfer in
 * of the position up to the sale moves cash (`affectsCash`: in practice
 * imported XTB trades), and they cover the whole quantity sold, so no buy had
 * to be filled in. Bonds, eMakler holdings, crypto and holdings entered by
 * hand — even inside an XTB account — leave Cash unchanged.
 */
export function closeAddsToCash(account: Account, positionInflows: Transaction[], filledInBuy: boolean): boolean {
  if (account.type === 'crypto' || filledInBuy) return false
  return positionInflows.length > 0 && positionInflows.every(affectsCash)
}

/**
 * Work out the transactions a close adds, without changing anything.
 *
 * Inputs are assumed valid: a non-synthetic open holding with no
 * {@link findSharedPositionHolding}, a date from {@link earliestCloseDate} to
 * today, and a fee no larger than the sale amount.
 */
export function planClose(
  holding: Holding,
  account: Account,
  transactions: Transaction[],
  input: CloseInput,
  now: string = new Date().toISOString(),
): ClosePlan {
  const key = holdingPositionKey(holding)
  const rows = positionRows(transactions, account.id, key)
  const tradeFees = pairTradeFees(transactions)
  const upToSale = rows.filter((t) => t.date.slice(0, 10) <= input.date)
  const held = walkPosition(upToSale, tradeFees).quantity
  const missing = holding.quantity - held

  const filledInBuy: Transaction | null =
    missing > QUANTITY_EPSILON
      ? {
          id: uuidv4(),
          accountId: account.id,
          type: 'buy',
          // Date-only, like XTB rows: the walk runs it before any same-day sale.
          date: holding.purchaseDate,
          amountPLN: -(holding.purchasePrice * missing),
          instrument: holding.name,
          ticker: holding.ticker,
          exchange: holding.exchange,
          quantity: missing,
          pricePerUnitPLN: holding.purchasePrice,
          relatedHoldingId: holding.id,
          externalId: buyExternalId(holding.id),
          source: closeSource(holding),
          affectsCash: false,
          createdAt: now,
        }
      : null

  const inflows = upToSale.filter((t) => t.type === 'buy' || t.type === 'receive')
  const addsToCash = closeAddsToCash(account, inflows, filledInBuy !== null)
  const proceedsPLN = input.saleAmountPLN - input.feePLN

  const sale: Transaction = {
    id: uuidv4(),
    accountId: account.id,
    type: 'sell',
    // Date-only: with the time unknown, the walk runs it after same-day buys.
    date: input.date,
    // Net of the fee, the way XTB confirmations store trades. The fee is kept
    // alongside for Activity only; nothing subtracts it a second time.
    amountPLN: proceedsPLN,
    instrument: holding.name,
    ticker: holding.ticker,
    exchange: holding.exchange,
    quantity: holding.quantity,
    pricePerUnitPLN: holding.quantity > 0 ? proceedsPLN / holding.quantity : 0,
    ...(input.feePLN > 0 && { feePLN: input.feePLN }),
    relatedHoldingId: holding.id,
    externalId: saleExternalId(holding.id),
    source: closeSource(holding),
    affectsCash: addsToCash,
    createdAt: now,
  }

  const added = filledInBuy ? [filledInBuy, sale] : [sale]
  const result = walkSales([...rows, ...added], pairTradeFees([...transactions, ...added])).get(sale.id)!
  return { transactions: added, sale, filledInBuy, addsToCash, result }
}

/** The sale Close position recorded for a closed holding, if it is still in the log. */
export function findCloseSale(holding: Holding, transactions: Transaction[]): Transaction | undefined {
  const externalId = saleExternalId(holding.id)
  return transactions.find((t) => t.externalId === externalId && t.accountId === holding.accountId)
}

/**
 * What a closed holding's sale realized: its own entry in the position walk,
 * so it adds up with every other sale to the realized total on Overview.
 * `null` when the sale is no longer in the log (deleted in Activity).
 */
export function closedPositionResult(
  holding: Holding,
  transactions: Transaction[],
): { sale: Transaction; result: SaleResult; profitPercent: number } | null {
  const sale = findCloseSale(holding, transactions)
  if (!sale) return null
  const key = positionKey(sale)
  if (!key) return null
  const result = walkSales(positionRows(transactions, sale.accountId, key), pairTradeFees(transactions)).get(sale.id)
  if (!result) return null
  const profitPercent = result.costPLN > 0 ? (result.profitPLN / result.costPLN) * 100 : 0
  return { sale, result, profitPercent }
}

/** The log after reopening: exactly the sale, and any buy, that closing added. */
export function removeCloseTransactions(holding: Holding, transactions: Transaction[]): Transaction[] {
  const ids = new Set([saleExternalId(holding.id), buyExternalId(holding.id)])
  return transactions.filter((t) => !(t.accountId === holding.accountId && ids.has(t.externalId)))
}

/** Move an open holding to the account's closed holdings, stamped with the close date. */
export function moveToClosed(accounts: Account[], holdingId: string, date: string, now: string): Account[] {
  return accounts.map((a) => {
    const holding = a.holdings.find((h) => h.id === holdingId)
    if (!holding) return a
    return {
      ...a,
      holdings: a.holdings.filter((h) => h.id !== holdingId),
      closedHoldings: [...(a.closedHoldings ?? []), { ...holding, closedAt: date, updatedAt: now }],
      lastUpdated: now,
    }
  })
}

/** Move a closed holding back to the account's open holdings, without its close date. */
export function moveToOpen(accounts: Account[], holdingId: string, now: string): Account[] {
  return accounts.map((a) => {
    const holding = a.closedHoldings?.find((h) => h.id === holdingId)
    if (!holding) return a
    const { closedAt: _closedAt, ...reopened } = holding
    const closedHoldings = a.closedHoldings!.filter((h) => h.id !== holdingId)
    const { closedHoldings: _all, ...rest } = a
    return {
      ...rest,
      ...(closedHoldings.length > 0 && { closedHoldings }),
      holdings: [...a.holdings, { ...reopened, updatedAt: now }],
      lastUpdated: now,
    }
  })
}
