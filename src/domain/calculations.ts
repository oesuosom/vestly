import type { Account, AllocationGroup, AllocationTargets, CategoryAllocation, Holding, Transaction, TransactionType } from '@/types'
import { staticLookupInstrument } from './instrumentLookup'
import { walkPosition, type Position } from './position'
import { pairTradeFees } from './tradeFees'

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
 * Whether a transaction moves its account's Cash row.
 *
 * Cash counts the money that went through the account: deposits, dividends and
 * interest in; buys, taxes and fees out. Some rows record a trade whose money
 * never passed through it, so they don't count:
 * - `bond_holding` — the buy behind a bond holding, created by the app (and
 *   its sale, when the lot is closed).
 * - `emakler_import` — eMakler trades, paid from a bank account outside Vestly.
 * - Rows Close position creates carry `affectsCash` and say for themselves: a
 *   sale counts only when the holding's purchases were taken out of cash (see
 *   `closePosition.ts`), and a buy it fills in for a hand-entered holding never does.
 *
 * Crypto accounts have no Cash row at all (`upsertSyntheticCashHolding`).
 */
export function affectsCash(t: Transaction): boolean {
  if (t.affectsCash !== undefined) return t.affectsCash
  return t.source !== 'bond_holding' && t.source !== 'emakler_import'
}

/**
 * The uninvested cash in an account, in PLN: the signed sum of `amountPLN`
 * over the account's transactions that move cash (see `affectsCash`).
 *
 * With `onOrBefore` (`yyyy-MM-dd`), only transactions dated that day or
 * earlier count — the balance the chart shows for that day.
 */
export function computeAccountCashBalance(
  transactions: Transaction[],
  accountId: string,
  onOrBefore?: string,
): number {
  return transactions
    .filter(
      (t) =>
        t.accountId === accountId &&
        affectsCash(t) &&
        (onOrBefore === undefined || t.date.slice(0, 10) <= onOrBefore),
    )
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
 * Average cost of the units of `ticker` currently held in one account.
 *
 * Narrows the transactions to that account and ticker, then hands them to
 * `walkPosition` (see `position.ts` for the rules): sales remove units at the
 * running average, and a position that was sold out starts again from the
 * next buy. Returns an empty position when nothing is held.
 *
 * Transactions belonging to other accounts are never counted, even when the
 * caller passes the whole transaction log. Pass at least the account's whole
 * log rather than pre-filtering by ticker: Revolut fees are separate rows with
 * no ticker, and they are part of the cost (see `pairTradeFees`).
 *
 * Uses `resolveTransactionTicker` so ticker-less transactions (imported before
 * their ticker was known) are matched via their instrument name.
 */
export function calculateAverageCostBasis(
  transactions: Transaction[],
  accountId: string,
  ticker: string
): Position {
  const tickerUpper = ticker.toUpperCase()
  return walkPosition(
    transactions.filter(
      (t) => t.accountId === accountId && resolveTransactionTicker(t) === tickerUpper
    ),
    pairTradeFees(transactions)
  )
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

/** Transaction types that move units in or out of a position. */
const TRADE_TYPES: ReadonlySet<TransactionType> = new Set(['buy', 'sell', 'send', 'receive'])

/**
 * Which position a transaction belongs to within its account.
 *
 * - A bond lot's own rows (`bond_holding`: its buy, and its sale once closed)
 *   form that holding's position, `#` followed by its id. Lots of the same
 *   series share a ticker but were bought on different dates at different
 *   accrued values, so each is costed and sold on its own.
 * - Otherwise the ticker (`resolveTransactionTicker`).
 * - Failing that, a trade linked to a holding forms that holding's position.
 *
 * Rows with none of these belong to no position.
 */
export function positionKey(t: Transaction): string | undefined {
  if (t.source === 'bond_holding' && t.relatedHoldingId && TRADE_TYPES.has(t.type)) return `#${t.relatedHoldingId}`
  const ticker = resolveTransactionTicker(t)
  if (ticker) return ticker
  if (t.relatedHoldingId && TRADE_TYPES.has(t.type)) return `#${t.relatedHoldingId}`
  return undefined
}

/** One account's position in one ticker. */
export type AccountPosition = {
  accountId: string
  /** The `positionKey`: the ticker uppercased, or `#holdingId` for a ticker-less holding. */
  ticker: string
  position: Position
}

/**
 * Every position in the transaction log: one per account and ticker that has
 * at least one transaction, each walked on its own by `walkPosition` (see
 * `position.ts` for the rules), with Revolut fees paired to their trades.
 *
 * Rows are grouped by `positionKey`: tickers are resolved with
 * `resolveTransactionTicker`, so rows that carry only an instrument name are
 * matched, and a ticker-less trade linked to a holding forms that holding's own
 * position. Rows with no key belong to no position and are left out.
 *
 * A position with `unexplainedQuantity > 0` sold or sent more than the log
 * recorded coming in — its history is incomplete.
 */
export function getPositions(transactions: Transaction[]): AccountPosition[] {
  const groups = new Map<string, { accountId: string; ticker: string; rows: Transaction[] }>()
  for (const t of transactions) {
    const ticker = positionKey(t)
    if (!ticker) continue
    const key = `${t.accountId}\n${ticker}`
    const group = groups.get(key)
    if (group) group.rows.push(t)
    else groups.set(key, { accountId: t.accountId, ticker, rows: [t] })
  }

  const tradeFees = pairTradeFees(transactions)
  return [...groups.values()].map(({ accountId, ticker, rows }) => ({
    accountId,
    ticker,
    position: walkPosition(rows, tradeFees),
  }))
}

/**
 * Realized profit across the whole portfolio, in PLN: the sum of every
 * position's `realizedProfitPLN` (average-cost method; see `walkPosition`).
 *
 * Each account's position in a ticker is worked out on its own, so one
 * account's purchases never change the profit on another account's sale.
 */
export function getRealizedPnL(transactions: Transaction[]): number {
  return getPositions(transactions).reduce((sum, p) => sum + p.position.realizedProfitPLN, 0)
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
 * Recalculate purchasePrice for the holdings of one account from that
 * account's transactions. Every other account is returned untouched (the same
 * object), so the result can replace the full accounts array.
 *
 * Rules:
 * - Synthetic holdings (isSynthetic: true) are always skipped — they are
 *   managed by upsertSyntheticCashHolding, not the transaction log.
 * - Holdings without a ticker are skipped (no way to match transactions).
 * - Holdings whose ticker has no open position in the transaction log — no
 *   trades at all, or everything sold — are left unchanged, preserving any
 *   manually entered cost basis.
 * - Matched holdings get purchasePrice set to the average cost of the units
 *   still held (see calculateAverageCostBasis) and updatedAt bumped to now.
 */
export function recalculateCostBases(
  accounts: Account[],
  transactions: Transaction[],
  accountId: string
): Account[] {
  const now = new Date().toISOString()
  return accounts.map((acc) => {
    if (acc.id !== accountId) return acc
    return {
      ...acc,
      holdings: acc.holdings.map((h) => {
        if (h.isSynthetic) return h
        if (!h.ticker) return h
        const { averageCostPLN, quantity } = calculateAverageCostBasis(transactions, acc.id, h.ticker)
        if (quantity === 0) return h  // no open position in the log, leave unchanged
        return { ...h, purchasePrice: averageCostPLN, updatedAt: now }
      }),
    }
  })
}
