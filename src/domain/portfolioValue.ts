import { differenceInDays, parseISO } from 'date-fns'
import type { Account, HistoricalPricesCache, Holding, HoldingPricePoint, Transaction } from '@/types'
import { computeAccountCashBalance } from './calculations'
import { quantityAtDate } from './historicalQuantity'

function getPriceAt(prices: HoldingPricePoint[], date: string): number | undefined {
  let lo = 0
  let hi = prices.length - 1
  let result: number | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (prices[mid].date <= date) {
      result = prices[mid].pricePLN
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/**
 * Straight line from the purchase price on the purchase date to the current
 * price on `end` — today for an open holding, the close date for a closed one
 * (whose current price is the last one known before it was sold).
 */
function getInterpolatedPrice(
  holding: { purchasePrice: number; currentPrice: number; purchaseDate: string },
  date: string,
  end: Date,
): number {
  const purchaseDate = parseISO(holding.purchaseDate)
  const queryDate = parseISO(date)
  const totalDays = differenceInDays(end, purchaseDate)
  if (totalDays <= 0) return holding.currentPrice
  const daysSince = differenceInDays(queryDate, purchaseDate)
  const t = Math.max(0, Math.min(1, daysSince / totalDays))
  return holding.purchasePrice + (holding.currentPrice - holding.purchasePrice) * t
}

/**
 * Compute an estimated total portfolio value for a given date.
 * Uses cached market prices when available, falls back to linear interpolation per holding.
 * Crypto holdings are never interpolated (too volatile) — skipped when no historical price exists.
 * Closed holdings count on the days before their close date, the same way, except that
 * with no cached prices they are interpolated up to the close date, crypto included:
 * both ends of the line are known.
 * Returns undefined only when no holdings were active on that date.
 */
export function computePortfolioAt(
  date: string,
  accounts: Account[],
  transactions: Transaction[],
  historiesMap: Map<string, HoldingPricePoint[]> | null,
  today: Date,
): number | undefined {
  let total = 0
  let hasAny = false

  function addHolding(account: Account, holding: Holding) {
    if (date < holding.purchaseDate) return
    if (holding.closedAt && date >= holding.closedAt) return

    const qty = quantityAtDate(holding, account.id, transactions, date)
    if (qty === 0) return

    let price: number | undefined
    if (historiesMap) {
      const prices = historiesMap.get(holding.id)
      price = prices ? getPriceAt(prices, date) : undefined
    }
    if (price === undefined) {
      if (holding.closedAt) {
        price = getInterpolatedPrice(holding, date, parseISO(holding.closedAt))
      } else {
        if (holding.category === 'crypto') return
        price = getInterpolatedPrice(holding, date, today)
      }
    }

    total += price * qty
    hasAny = true
  }

  for (const account of accounts) {
    for (const holding of account.holdings) {
      // Synthetic cash: derive the balance from transactions up to this date so
      // historical values reflect the actual cash on that day, not the current balance.
      if (holding.isSynthetic && holding.category === 'cash') {
        const balance = computeAccountCashBalance(transactions, account.id, date)
        if (balance !== 0) {
          total += balance
          hasAny = true
        }
        continue
      }
      if (holding.isSynthetic) continue
      addHolding(account, holding)
    }
    for (const holding of account.closedHoldings ?? []) addHolding(account, holding)
  }
  return hasAny ? total : undefined
}

/** Build the historiesMap index expected by computePortfolioAt from a HistoricalPricesCache. */
export function buildHistoriesMap(
  historicalPrices: HistoricalPricesCache | null | undefined,
): Map<string, HoldingPricePoint[]> | null {
  return historicalPrices
    ? new Map(historicalPrices.histories.map((h) => [h.holdingId, h.prices]))
    : null
}
