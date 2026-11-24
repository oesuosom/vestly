import type { Account, AssetCategory, Holding, Transaction } from '@/types'
import { positionKey } from './calculations'
import { holdingPositionKey } from './closePosition'
import { walkPosition } from './position'
import { pairTradeFees } from './tradeFees'

/**
 * Check an account's holdings against what the broker says it holds.
 *
 * A broker statement (XTB's Open Positions) lists, per instrument, the
 * quantity held on the day the report was made, and the lots that make it up.
 * For each instrument, that quantity is compared with what Vestly holds in the
 * account: the position walk of its transactions (`walkPosition`), not a
 * holding's stored quantity. The comparison is per instrument, never per lot:
 * a broker can merge two lots of one instrument into one at a weighted-average
 * open price, and the total still adds up.
 *
 * Pure: reads its inputs and returns what differs. Nothing is changed here.
 */

/** One lot of an instrument, as the statement lists it. */
export type StatementLot = {
  /** The broker's position id. */
  positionId: string
  quantity: number
  /** Per unit, in the instrument's own currency. */
  openPrice: number
  /** When the lot was opened, UTC ISO timestamp (or `yyyy-MM-dd`). */
  openDate: string
}

/** One instrument the statement says is held. */
export type StatementHolding = {
  /** The `positionKey` its transactions get: the ticker without its market, uppercased ("ACME"). */
  key: string
  ticker: string
  exchange?: string
  name: string
  /** Stock or ETF, when the statement says which. */
  category?: Extract<AssetCategory, 'stock' | 'etf'>
  /** Units held: the sum of its lots. */
  quantity: number
  lots: StatementLot[]
  /** The statement's current price per unit, in PLN, when it has one. */
  currentPricePLN?: number
  /**
   * PLN per unit of the instrument's currency at report time, worked out from
   * the statement (value ÷ (quantity × current price)). 1 for PLN.
   */
  rateToPLN?: number
}

export type HoldingsStatement = {
  /** When the report was generated, UTC ISO timestamp. */
  asOf: string
  holdings: StatementHolding[]
}

/** An instrument both sides agree on. */
export type HoldingMatch = {
  statement: StatementHolding
  /** The account's open holdings in this position (usually one). */
  holdings: Holding[]
}

export type HoldingDifference =
  | {
      /** The broker holds it, no purchase explains it, and it cost about nothing: free shares or a spin-off. */
      kind: 'free_shares'
      key: string
      name: string
      vestlyQuantity: 0
      statement: StatementHolding
    }
  | {
      /** The broker holds more than the transactions explain. */
      kind: 'broker_more'
      key: string
      name: string
      vestlyQuantity: number
      statement: StatementHolding
      /** Units the transactions don't explain. */
      missing: number
      /** The lots to record those units from: see {@link missingLots}. */
      lots: StatementLot[]
      holding?: Holding
    }
  | {
      /** Vestly holds more than the broker: informational, nothing to apply. */
      kind: 'vestly_more'
      key: string
      name: string
      vestlyQuantity: number
      statement: StatementHolding
      extra: number
      holding?: Holding
    }
  | {
      /** Vestly holds it; the broker shows none. */
      kind: 'gone'
      key: string
      name: string
      vestlyQuantity: number
      /** The open holding to close, when there is exactly one. */
      holding?: Holding
    }

export type HoldingsCheck = {
  asOf: string
  matching: HoldingMatch[]
  differences: HoldingDifference[]
}

/** Differences are listed in this order, then by name: the ones with a change to apply first. */
const KIND_ORDER: Record<HoldingDifference['kind'], number> = { free_shares: 0, broker_more: 1, gone: 2, vestly_more: 3 }

/** Quantities closer than this are equal. Fractional shares go to a few decimals; float sums add noise. */
const QUANTITY_EPSILON = 1e-6
/** An average open price below this (in any currency) is "about 0". */
const FREE_PRICE = 0.005

/** Quantities are stored to 8 decimals, so 0.1 + 0.2 doesn't keep its float noise. */
const round8 = (n: number) => Math.round(n * 1e8) / 1e8

/** Weighted-average open price of some lots, in their currency. */
export function averageOpenPrice(lots: StatementLot[]): number {
  const quantity = lots.reduce((s, l) => s + l.quantity, 0)
  return quantity > 0 ? lots.reduce((s, l) => s + l.quantity * l.openPrice, 0) / quantity : 0
}

/**
 * The lots that hold the units no purchase explains. Every purchase is dated
 * at its lot's open time, so a lot with no purchase at that time is one the
 * transactions miss. When those lots add up to exactly the missing units,
 * they are the answer. Otherwise (lots merged by the broker, or a partial
 * sale) the missing units are taken as one lot at the weighted-average open
 * price of the unexplained lots — or of every lot when none stands out —
 * dated on the earliest of them.
 */
export function missingLots(statement: StatementHolding, purchases: Transaction[], missing: number): StatementLot[] {
  const purchaseTimes = new Set(purchases.map((t) => Date.parse(t.date)))
  const unexplained = statement.lots.filter((l) => !purchaseTimes.has(Date.parse(l.openDate)))
  const sum = unexplained.reduce((s, l) => s + l.quantity, 0)
  if (unexplained.length > 0 && Math.abs(sum - missing) < QUANTITY_EPSILON) return unexplained
  const from = unexplained.length > 0 ? unexplained : statement.lots
  const earliest = [...from].sort((a, b) => a.openDate.localeCompare(b.openDate))[0]
  return [{ positionId: earliest.positionId, quantity: round8(missing), openPrice: averageOpenPrice(from), openDate: earliest.openDate }]
}

/**
 * Compare the account with the statement.
 *
 * @param account      The account as the import left it.
 * @param transactions The whole log after the import.
 * @returns The instruments that match, and one difference per instrument that
 *          doesn't: free shares, then the broker holding more, gone, and
 *          Vestly holding more, each by name. Positions that aren't instruments (bond
 *          lots, holdings with no ticker) are never compared.
 */
export function checkHoldings(statement: HoldingsStatement, account: Account, transactions: Transaction[]): HoldingsCheck {
  const tradeFees = pairTradeFees(transactions)
  const rowsByKey = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.accountId !== account.id) continue
    const key = positionKey(t)
    if (!key || key.startsWith('#')) continue
    const rows = rowsByKey.get(key)
    if (rows) rows.push(t)
    else rowsByKey.set(key, [t])
  }
  const held = (key: string) => {
    const rows = rowsByKey.get(key)
    return rows ? round8(walkPosition(rows, tradeFees).quantity) : 0
  }
  const holdingsFor = (key: string) =>
    account.holdings.filter((h) => !h.isSynthetic && h.category !== 'bond' && holdingPositionKey(h) === key)
  const nameFor = (key: string) =>
    holdingsFor(key)[0]?.name ?? rowsByKey.get(key)?.find((t) => t.instrument)?.instrument ?? key

  const matching: HoldingMatch[] = []
  const differences: HoldingDifference[] = []
  const statementKeys = new Set<string>()

  for (const s of statement.holdings) {
    statementKeys.add(s.key)
    const vestlyQuantity = held(s.key)
    const diff = s.quantity - vestlyQuantity
    const holdings = holdingsFor(s.key)
    const holding = holdings.length === 1 ? holdings[0] : undefined
    if (Math.abs(diff) < QUANTITY_EPSILON) {
      matching.push({ statement: s, holdings })
      continue
    }
    if (diff < 0) {
      differences.push({ kind: 'vestly_more', key: s.key, name: s.name, vestlyQuantity, statement: s, extra: round8(-diff), holding })
      continue
    }
    const purchases = (rowsByKey.get(s.key) ?? []).filter((t) => t.type === 'buy' || t.type === 'receive')
    if (vestlyQuantity === 0 && purchases.length === 0 && averageOpenPrice(s.lots) < FREE_PRICE) {
      differences.push({ kind: 'free_shares', key: s.key, name: s.name, vestlyQuantity: 0, statement: s })
      continue
    }
    const missing = round8(diff)
    differences.push({
      kind: 'broker_more', key: s.key, name: s.name, vestlyQuantity, statement: s, missing,
      lots: missingLots(s, purchases, missing), holding,
    })
  }

  for (const key of rowsByKey.keys()) {
    if (statementKeys.has(key)) continue
    const vestlyQuantity = held(key)
    if (vestlyQuantity < QUANTITY_EPSILON) continue
    const holdings = holdingsFor(key)
    differences.push({ kind: 'gone', key, name: nameFor(key), vestlyQuantity, holding: holdings.length === 1 ? holdings[0] : undefined })
  }

  differences.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
  return { asOf: statement.asOf, matching, differences }
}

/**
 * The accounts with the statement's current price and category saved on the
 * holdings that match it. The price becomes the holding's last known price,
 * which is what the app shows while price providers are off.
 */
export function applyStatementPrices(accounts: Account[], accountId: string, matches: HoldingMatch[], now: string): Account[] {
  const byId = new Map<string, StatementHolding>()
  for (const m of matches) for (const h of m.holdings) byId.set(h.id, m.statement)
  if (byId.size === 0) return accounts
  return accounts.map((a) => {
    if (a.id !== accountId) return a
    return {
      ...a,
      holdings: a.holdings.map((h) => {
        const s = byId.get(h.id)
        if (!s) return h
        return {
          ...h,
          ...(s.currentPricePLN !== undefined && s.currentPricePLN > 0 && { currentPrice: s.currentPricePLN }),
          ...(s.category && { category: s.category }),
          updatedAt: now,
        }
      }),
    }
  })
}

/** How a price in some currency becomes PLN: × `rate` ÷ `divisor` (100 for prices in pence). */
export type PriceCurrency = { currency: string; divisor: number }

/** A rate within this share of a currency's rate is that currency. */
const RATE_TOLERANCE = 0.04

/**
 * The currency an instrument is priced in, from its PLN rate at report time
 * (see {@link StatementHolding.rateToPLN}) and NBP's table for that day: the
 * table currency whose rate is closest, within 4%. A rate of about 1 is PLN;
 * about a hundredth of the pound's is pence. Null when nothing is that close.
 */
export function currencyForRate(rateToPLN: number, table: ReadonlyMap<string, number>): PriceCurrency | null {
  if (!(rateToPLN > 0)) return null
  const candidates: { currency: string; divisor: number; rate: number }[] = [{ currency: 'PLN', divisor: 1, rate: 1 }]
  for (const [currency, rate] of table) {
    candidates.push({ currency, divisor: 1, rate })
    if (currency === 'GBP') candidates.push({ currency, divisor: 100, rate: rate / 100 })
  }
  let best: (typeof candidates)[number] | null = null
  let bestError = Infinity
  for (const c of candidates) {
    const error = Math.abs(rateToPLN / c.rate - 1)
    if (error < bestError) {
      best = c
      bestError = error
    }
  }
  return best && bestError <= RATE_TOLERANCE ? { currency: best.currency, divisor: best.divisor } : null
}
