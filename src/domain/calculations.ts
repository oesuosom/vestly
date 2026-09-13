import type { Account, AllocationGroup, AllocationTargets, CategoryAllocation, Holding, Transaction, TransactionType } from '@/types'
import { staticLookupInstrument } from './instrumentLookup'

/** Calculate the current market value of a single holding. */
export function getHoldingValue(holding: Holding): number {
  return holding.quantity * holding.currentPrice
}

/** Calculate the P&L for a single holding in PLN and as a percentage. */
export function getHoldingPnL(holding: Holding): { pnl: number; pnlPercent: number } {
  const value = holding.quantity * holding.currentPrice
  const costBasis = holding.quantity * holding.purchasePrice
  const pnl = value - costBasis
  const pnlPercent = costBasis === 0 ? 0 : (pnl / costBasis) * 100
  return { pnl, pnlPercent }
}

/** Calculate the total value of an account by summing all its holdings. */
export function getAccountValue(account: Account): number {
  return account.holdings.reduce((sum, h) => sum + getHoldingValue(h), 0)
}

/** Calculate a map of account IDs to their total values. */
export function getAccountValues(accounts: Account[]): { [accountId: string]: number } {
  const result: { [accountId: string]: number } = {}
  for (const account of accounts) {
    result[account.id] = getAccountValue(account)
  }
  return result
}

/** Calculate the total portfolio value across all accounts. */
export function getTotalValue(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + getAccountValue(a), 0)
}

/** Calculate the current asset allocation as percentages across all accounts. */
export function getCurrentAllocation(accounts: Account[]): AllocationTargets {
  const c = getCategoryAllocation(accounts)
  return {
    bonds:  c.bond,
    stocks: c.stock + c.etf,
    cash:   c.cash,
    crypto: c.crypto,
  }
}

/** Calculate per-category allocation keeping etf separate from stocks. Used for the donut chart. */
export function getCategoryAllocation(accounts: Account[]): CategoryAllocation {
  const total = getTotalValue(accounts)
  if (total === 0) {
    return { bond: 0, stock: 0, etf: 0, cash: 0, crypto: 0 }
  }

  let bond = 0, stock = 0, etf = 0, cash = 0, crypto = 0

  for (const account of accounts) {
    for (const holding of account.holdings) {
      const value = getHoldingValue(holding)
      switch (holding.category) {
        case 'bond':   bond   += value; break
        case 'stock':  stock  += value; break
        case 'etf':    etf    += value; break
        case 'cash':   cash   += value; break
        case 'crypto': crypto += value; break
      }
    }
  }

  return {
    bond:   (bond   / total) * 100,
    stock:  (stock  / total) * 100,
    etf:    (etf    / total) * 100,
    cash:   (cash   / total) * 100,
    crypto: (crypto / total) * 100,
  }
}

/** Calculate per-group current allocation and drift against each group's target. */
export function getGroupDrift(
  groups: AllocationGroup[],
  catAlloc: CategoryAllocation
): Array<{ group: AllocationGroup; current: number; drift: number }> {
  return groups.map((group) => {
    const current = group.categories.reduce((sum, cat) => sum + catAlloc[cat], 0)
    return { group, current, drift: current - group.target }
  })
}

/** Check if any allocation category has drifted beyond the given threshold. */
export function needsRebalancing(
  driftItems: Array<{ drift: number }>,
  threshold: number
): boolean {
  return driftItems.some((d) => Math.abs(d.drift) > threshold)
}


/**
 * Sum all transaction amounts for a given account.
 * All transaction types contribute their signed amountPLN:
 *   deposits (+), dividends (+), interest (+)
 *   buys (-), taxes (-), fees (-)
 * Result = uninvested cash balance in PLN.
 */
export function computeAccountCashBalance(
  transactions: Transaction[],
  accountId: string
): number {
  return transactions
    .filter((t) => t.accountId === accountId && t.source !== 'bond_holding' && t.source !== 'emakler_import')
    .reduce((sum, t) => sum + t.amountPLN, 0)
}

// ─────────────────────────────────────────
// Transaction-derived calculations
// ─────────────────────────────────────────

/** Sum amountPLN for all transactions of a given type. */
function sumByType(transactions: Transaction[], type: TransactionType): number {
  return transactions
    .filter((t) => t.type === type)
    .reduce((acc, t) => acc + t.amountPLN, 0)
}

/**
 * Resolve the effective ticker for a transaction, uppercased for comparison.
 * Priority:
 *   1. Stored ticker field (fastest path, covers everything imported cleanly)
 *   2. Static instrument lookup (covers ETFs imported before the lookup fix)
 *   3. Raw instrument name when it looks like a ticker — no spaces, ≤10 chars
 *      (covers stocks like "XTB" whose buy transactions were stored before the
 *      holding existed, leaving ticker: undefined but instrument: "XTB")
 */
export function resolveTransactionTicker(
  t: Pick<Transaction, 'ticker' | 'instrument'>
): string | undefined {
  if (t.ticker) return t.ticker.toUpperCase()
  if (t.instrument) {
    const fromLookup = staticLookupInstrument(t.instrument)?.ticker?.toUpperCase()
    if (fromLookup) return fromLookup
    // Short single-word instrument names are raw ticker symbols (e.g. "XTB", "KGH").
    if (!t.instrument.includes(' ') && t.instrument.length <= 10) return t.instrument.toUpperCase()
  }
  return undefined
}

/**
 * Weighted average cost basis from buy transactions for a given ticker.
 * Returns zeroes when no buy transactions are found.
 * Uses `resolveTransactionTicker` so ticker-less ETF transactions (imported
 * before the static-lookup fix) are matched via instrument name resolution.
 */
export function calculateAverageCostBasis(
  transactions: Transaction[],
  ticker: string
): { averageCostPLN: number; totalQuantity: number; totalCostPLN: number } {
  const tickerUpper = ticker.toUpperCase()
  const buys = transactions.filter(
    (t) => t.type === 'buy' && resolveTransactionTicker(t) === tickerUpper
  )
  const totalCostPLN = buys.reduce((sum, t) => sum + Math.abs(t.amountPLN), 0)
  const totalQuantity = buys.reduce((sum, t) => sum + (t.quantity ?? 0), 0)
  return {
    averageCostPLN: totalQuantity > 0 ? totalCostPLN / totalQuantity : 0,
    totalQuantity,
    totalCostPLN,
  }
}

/**
 * Net crypto quantity after all inflows (buy, receive) and outflows (sell, send).
 * Used for holdings where the quantity cannot be derived from buys alone,
 * e.g. BTC which may also have sells, sends, and receives.
 */
export function calculateNetCryptoQuantity(
  transactions: Transaction[],
  ticker: string,
): number {
  const upper = ticker.toUpperCase()
  return transactions
    .filter((t) => resolveTransactionTicker(t) === upper)
    .reduce((net, t) => {
      if (t.type === 'buy' || t.type === 'receive') return net + (t.quantity ?? 0)
      if (t.type === 'sell' || t.type === 'send') return net - (t.quantity ?? 0)
      return net
    }, 0)
}

/**
 * Total dividends received for a holding, gross and net of withholding tax.
 * withholdingTax is already negative in the transaction log.
 */
export function getDividendIncomeForHolding(
  transactions: Transaction[],
  holdingId: string
): { gross: number; tax: number; net: number } {
  const related = transactions.filter((t) => t.relatedHoldingId === holdingId)
  const gross = related
    .filter((t) => t.type === 'dividend')
    .reduce((sum, t) => sum + t.amountPLN, 0)
  const tax = related
    .filter((t) => t.type === 'withholding_tax')
    .reduce((sum, t) => sum + t.amountPLN, 0)  // already negative
  return { gross, tax, net: gross + tax }
}

/**
 * Total return for a holding = unrealised P&L + net dividends received.
 * totalPercent is relative to cost basis (quantity × purchasePrice).
 */
export function getTotalReturn(
  holding: Holding,
  transactions: Transaction[]
): { totalPLN: number; totalPercent: number } {
  const value = holding.quantity * holding.currentPrice
  const cost = holding.quantity * holding.purchasePrice
  const pnl = value - cost
  const income = getDividendIncomeForHolding(transactions, holding.id)
  const totalPLN = pnl + income.net
  const totalPercent = cost > 0 ? (totalPLN / cost) * 100 : 0
  return { totalPLN, totalPercent }
}

export type IncomeSummary = {
  dividendsGross: number
  withholdingTax: number   // negative
  dividendsNet: number
  interest: number
  interestTax: number      // negative
  interestNet: number
  totalNet: number
}

/**
 * Aggregate income and tax transactions for a given calendar year.
 * All amounts are in PLN; tax fields are negative.
 */
export function getIncomeSummary(
  transactions: Transaction[],
  year: number
): IncomeSummary {
  // Dates are stored either date-only ("2026-02-10") or as a full ISO datetime,
  // so compare the year prefix rather than constructing a Date per row.
  return getAllTimeSummary(transactions.filter((t) => t.date.slice(0, 4) === String(year)))
}

/**
 * Realized P&L from sell transactions using average cost basis method.
 * Processes transactions chronologically per ticker.
 * buy/receive → add to cost pool; sell → proceeds minus avg cost of sold units.
 */
export function getRealizedPnL(transactions: Transaction[]): number {
  type TickerState = { totalCost: number; totalQty: number }
  const state = new Map<string, TickerState>()
  let realized = 0

  const relevant = transactions
    .filter(
      (t) =>
        (t.type === 'buy' || t.type === 'sell' || t.type === 'receive') &&
        t.quantity != null &&
        resolveTransactionTicker(t) != null
    )
    .sort((a, b) => a.date.localeCompare(b.date))

  for (const t of relevant) {
    const ticker = resolveTransactionTicker(t)!
    if (!state.has(ticker)) state.set(ticker, { totalCost: 0, totalQty: 0 })
    const s = state.get(ticker)!

    if (t.type === 'buy' || t.type === 'receive') {
      s.totalCost += Math.abs(t.amountPLN)
      s.totalQty += t.quantity!
    } else if (t.type === 'sell' && s.totalQty > 0) {
      const avgCost = s.totalCost / s.totalQty
      const qtySold = Math.min(t.quantity!, s.totalQty)
      const proceeds = t.amountPLN // positive for sells
      realized += proceeds - avgCost * qtySold
      s.totalCost = Math.max(0, s.totalCost - avgCost * qtySold)
      s.totalQty = Math.max(0, s.totalQty - qtySold)
    }
  }

  return realized
}

/** Sum total unrealized P&L across all accounts. */
export function getUnrealizedPnL(accounts: Account[]): number {
  return accounts.reduce((sum, account) => {
    return sum + account.holdings.reduce((s, h) => {
      const { pnl } = getHoldingPnL(h)
      return s + pnl
    }, 0)
  }, 0)
}

/** All-time income summary (no year filter). */
export function getAllTimeSummary(transactions: Transaction[]): IncomeSummary {
  const dividendsGross = sumByType(transactions, 'dividend')
  const withholdingTax = sumByType(transactions, 'withholding_tax')
  const interest       = sumByType(transactions, 'interest')
  const interestTax    = sumByType(transactions, 'interest_tax')
  return {
    dividendsGross,
    withholdingTax,
    dividendsNet:  dividendsGross + withholdingTax,
    interest,
    interestTax,
    interestNet:   interest + interestTax,
    totalNet:      dividendsGross + withholdingTax + interest + interestTax,
  }
}

/** Total cost basis across all non-synthetic holdings: purchasePrice × quantity. Includes holdings with no transaction history (e.g. IKE bonds). */
export function getTotalCostBasis(accounts: Account[]): number {
  return accounts.reduce((sum, account) =>
    sum + account.holdings.reduce((s, h) => h.isSynthetic ? s : s + h.purchasePrice * h.quantity, 0), 0
  )
}

/**
 * Recalculate purchasePrice for all holdings that have matching buy transactions.
 *
 * Rules:
 * - Synthetic holdings (isSynthetic: true) are always skipped — they are
 *   managed by upsertSyntheticCashHolding, not the transaction log.
 * - Holdings without a ticker are skipped (no way to match buy transactions).
 * - Holdings whose ticker has no buy transactions are left unchanged
 *   (totalQuantity === 0 guard), preserving any manually entered cost basis.
 * - Matched holdings get purchasePrice set to the weighted average cost and
 *   updatedAt bumped to now.
 *
 * `resolveTransactionTicker` is used in calculateAverageCostBasis so ETF buy
 * transactions imported without a ticker are matched via the static lookup.
 */
export function recalculateCostBases(
  accounts: Account[],
  transactions: Transaction[]
): Account[] {
  const now = new Date().toISOString()
  return accounts.map((acc) => ({
    ...acc,
    holdings: acc.holdings.map((h) => {
      if (h.isSynthetic) return h
      if (!h.ticker) return h
      const { averageCostPLN, totalQuantity } = calculateAverageCostBasis(transactions, h.ticker)
      if (totalQuantity === 0) return h  // no buy transactions found, leave unchanged
      return { ...h, purchasePrice: averageCostPLN, updatedAt: now }
    }),
  }))
}
