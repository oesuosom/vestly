import { v4 as uuidv4 } from 'uuid'
import { calculateAverageCostBasis } from '@/domain/calculations'
import { holdingPositionKey } from '@/domain/closePosition'
import {
  applyStatementPrices,
  currencyForRate,
  isHoldingsCheckRow,
  lotExternalId,
  type HoldingDifference,
  type HoldingMatch,
  type HoldingsCheck,
  type HoldingsStatement,
  type PriceCurrency,
  type StatementHolding,
  type StatementLot,
} from '@/domain/holdingsCheck'
import { currencyFromStatement, rateCurrency, unitsPerRateUnit } from '@/domain/priceCurrency'
import { getNBPRateRange, getNBPTable } from '@/services/nbp'
import { isProviderOn, type ProviderSettings } from '@/services/providers'
import type { Account, Holding, Transaction } from '@/types'
import { formatQuantity } from '@/utils/formatters'

/**
 * Apply the rows checked in the holdings-check step (see `domain/holdingsCheck.ts`):
 *
 * - **Add at cost 0** (free shares): a `receive` per lot, at 0 PLN, with the
 *   note below, so the position walk explains the shares from now on.
 * - **Add N shares at XTB's open price**: a `buy` per missing lot, at its open
 *   price and open date, converted to PLN with NBP's rate from the last
 *   business day before it (the rule for a purchase's cost in PLN). The instrument's currency comes from the statement's
 *   own PLN rate, matched against NBP's table for the report date.
 * - Then the holding: its quantity and average cost from the walk, its
 *   category and price from the statement. Created when there is none.
 *
 * Neither row moves the Cash row: the money for them never passed through the
 * transactions Vestly has. Close position is not applied here: the step opens
 * the Close position dialog for those holdings.
 */

/** The note on shares received without a purchase. */
export const FREE_SHARES_NOTE = 'Received without a purchase (free shares or a spin-off)'


export type RateSource = {
  /** NBP's table A on the day (or the last day before it): code → PLN. */
  table: (date: string) => Promise<ReadonlyMap<string, number>>
  /** PLN per unit of `currency`: NBP's rate from the last business day before `date`. */
  rate: (currency: string, date: string) => Promise<number>
}

/** NBP, through the switch-respecting service. Never called while NBP is off. */
export function nbpRates(settings: ProviderSettings): RateSource {
  return {
    table: (date) => getNBPTable(date, settings),
    rate: async (currency, date) => {
      // The day before, and the 14 before that: NBP publishes no rates on weekends and holidays.
      const to = new Date(`${date.slice(0, 10)}T00:00:00Z`)
      to.setUTCDate(to.getUTCDate() - 1)
      const from = new Date(to)
      from.setUTCDate(from.getUTCDate() - 14)
      const day = to.toISOString().slice(0, 10)
      const rates = await getNBPRateRange(currency, from.toISOString().slice(0, 10), day, settings)
      const latest = [...rates.keys()].sort().pop()
      if (!latest) throw new Error(`NBP has no ${currency} rate up to ${day}`)
      return rates.get(latest)!
    },
  }
}

/** A rate within this share of 1 is PLN: no table needed. */
const PLN_TOLERANCE = 0.04

/**
 * The statement with each instrument's price currency worked out from its PLN
 * rate (`currencyFromStatement`): PLN without asking anyone, the rest with
 * NBP's table for the report date, fetched once. With NBP off (`rates` null)
 * or its table unavailable, only PLN instruments get one; the rest stay
 * unknown, and their holdings keep what they have (the market's default).
 */
export async function withStatementCurrencies(statement: HoldingsStatement, rates: RateSource | null): Promise<HoldingsStatement> {
  const isPLN = (r: number | undefined) => r !== undefined && Math.abs(r - 1) < PLN_TOLERANCE
  let table: ReadonlyMap<string, number> | null = null
  if (rates && statement.holdings.some((h) => h.rateToPLN !== undefined && !isPLN(h.rateToPLN))) {
    try {
      table = await rates.table(statement.asOf)
    } catch (err) {
      console.warn('[XTB import] NBP table unavailable; statement currencies left unknown:', err)
    }
  }
  return {
    ...statement,
    holdings: statement.holdings.map((h) => {
      const currency = isPLN(h.rateToPLN) ? 'PLN' : table ? currencyFromStatement(h.rateToPLN, table) : undefined
      return currency ? { ...h, currency } : h
    }),
  }
}

/** Whether "Add N shares at XTB's open price" can be applied: it needs NBP to convert the price. */
export function canConvertOpenPrice(settings: ProviderSettings): boolean {
  return isProviderOn(settings, 'nbp')
}

/** Whether a row has a change to apply (and so a checkbox). */
export function isApplicable(d: HoldingDifference): boolean {
  if (d.kind === 'vestly_more') return false
  if (d.kind === 'gone') return d.holding !== undefined
  return true
}

/** Checked when the step opens: only free shares. The others change history, so the person opts in. */
export function initiallyChecked(differences: HoldingDifference[]): Set<string> {
  return new Set(differences.filter((d) => d.kind === 'free_shares').map((d) => d.key))
}

export type HoldingsCheckApplied = {
  accounts: Account[]
  transactions: Transaction[]
  /** Holdings the person chose to close: the Close position dialog opens for each. */
  toClose: Holding[]
  /** Done-screen clauses: "Spinco Example added at cost 0", "2 shares of Sample Holdings added". */
  parts: string[]
  /** Instruments that match the statement now, and took its price and category. */
  matching: number
}

const round8 = (n: number) => Math.round(n * 1e8) / 1e8
const fmt = (n: number) => String(round8(n))

/**
 * The accounts and log once the checked rows are applied, plus the statement's
 * prices and categories on every holding that matches (before or after).
 *
 * @param checked Keys (`HoldingDifference.key`) of the rows ticked.
 * @throws when a currency or rate can't be found; nothing is applied then.
 */
export async function applyHoldingsCheck({
  check,
  checked,
  accounts,
  transactions,
  accountId,
  rates,
  now = new Date().toISOString(),
}: {
  check: HoldingsCheck
  checked: ReadonlySet<string>
  accounts: Account[]
  transactions: Transaction[]
  accountId: string
  rates: RateSource | null
  now?: string
}): Promise<HoldingsCheckApplied> {
  const rows = check.differences.filter((d) => checked.has(d.key))
  const added: Transaction[] = []
  const parts: string[] = []
  const fixed: StatementHolding[] = []

  let table: ReadonlyMap<string, number> | null = null
  const currencyOf = async (s: StatementHolding): Promise<PriceCurrency> => {
    if (s.currency === 'PLN') return { currency: 'PLN', divisor: 1 }
    if (s.currency && rates) return { currency: rateCurrency(s.currency), divisor: unitsPerRateUnit(s.currency) }
    const rate = s.rateToPLN
    if (rate !== undefined && Math.abs(rate - 1) < 0.04) return { currency: 'PLN', divisor: 1 }
    if (!rates) throw new Error('NBP is off, so the open price can’t be converted to PLN.')
    table ??= await rates.table(check.asOf)
    const found = rate !== undefined ? currencyForRate(rate, table) : null
    if (!found) throw new Error(`Couldn’t tell which currency ${s.name} is priced in, so nothing was changed.`)
    return found
  }

  const base = (s: StatementHolding, lot: StatementLot): Omit<Transaction, 'type' | 'amountPLN'> => ({
    id: uuidv4(),
    accountId,
    date: lot.openDate,
    instrument: s.name,
    ticker: s.ticker,
    exchange: s.exchange,
    quantity: lot.quantity,
    externalId: lotExternalId(lot),
    source: 'xtb_import',
    affectsCash: false,
    createdAt: now,
  })

  for (const d of rows) {
    if (d.kind === 'free_shares') {
      for (const lot of d.statement.lots) {
        added.push({ ...base(d.statement, lot), type: 'receive', amountPLN: 0, pricePerUnitPLN: 0, comment: FREE_SHARES_NOTE })
      }
      fixed.push(d.statement)
    } else if (d.kind === 'broker_more') {
      const { currency, divisor } = await currencyOf(d.statement)
      for (const lot of d.lots) {
        const rate = currency === 'PLN' ? 1 : await rates!.rate(currency, lot.openDate)
        const unitPLN = (lot.openPrice / divisor) * rate
        const costPLN = Math.round(unitPLN * lot.quantity * 100) / 100
        added.push({
          ...base(d.statement, lot),
          type: 'buy',
          amountPLN: -costPLN,
          pricePerUnitPLN: unitPLN,
          originalCurrency: divisor === 100 ? 'GBX' : currency,
          pricePerUnitOriginal: lot.openPrice,
          comment: `Added from XTB’s Open Positions: ${fmt(lot.quantity)} @ ${lot.openPrice} ${divisor === 100 ? 'GBX' : currency}`,
        })
      }
      fixed.push(d.statement)
    }
  }

  const existingIds = new Set(transactions.map((t) => t.externalId))
  const fresh = added.filter((t) => !existingIds.has(t.externalId))
  const nextTransactions = fresh.length > 0 ? [...transactions, ...fresh] : transactions

  // Holdings for the instruments the new rows explain.
  let nextAccounts = accounts
  const matches: HoldingMatch[] = [...check.matching]
  for (const s of fixed) {
    const account = nextAccounts.find((a) => a.id === accountId)
    if (!account) break
    const position = calculateAverageCostBasis(nextTransactions, accountId, s.key)
    const same = account.holdings.filter((h) => !h.isSynthetic && h.category !== 'bond' && holdingPositionKey(h) === s.key)
    if (same.length > 1) continue // can't tell which one: left as it is
    const purchaseDate = [...s.lots].map((l) => l.openDate.slice(0, 10)).sort()[0]
    const holding: Holding = same[0]
      ? { ...same[0], quantity: round8(position.quantity), purchasePrice: position.averageCostPLN, updatedAt: now }
      : {
          id: uuidv4(),
          accountId,
          name: s.name,
          ticker: s.ticker,
          exchange: s.exchange,
          ...(s.currency && { currency: s.currency }),
          category: s.category ?? 'stock',
          quantity: round8(position.quantity),
          purchasePrice: position.averageCostPLN,
          currentPrice: s.currentPricePLN ?? position.averageCostPLN,
          purchaseDate,
          createdAt: now,
          updatedAt: now,
        }
    nextAccounts = nextAccounts.map((a) =>
      a.id !== accountId
        ? a
        : {
            ...a,
            holdings: same[0] ? a.holdings.map((h) => (h.id === holding.id ? holding : h)) : [...a.holdings, holding],
            lastUpdated: now,
          },
    )
    matches.push({ statement: s, holdings: [holding] })
  }
  nextAccounts = applyStatementPrices(nextAccounts, accountId, matches, now)

  const free = rows.filter((d) => d.kind === 'free_shares')
  if (free.length === 1) parts.push(`${free[0].statement.name} added at cost 0`)
  else if (free.length > 1) parts.push(`${free.length} holdings added at cost 0`)
  for (const d of rows) {
    if (d.kind === 'broker_more') parts.push(`${fmt(d.missing)} ${d.missing === 1 ? 'share' : 'shares'} of ${d.statement.name} added at XTB’s open price`)
  }

  const toClose = rows.flatMap((d: HoldingDifference) => (d.kind === 'gone' && d.holding ? [d.holding] : []))
  return { accounts: nextAccounts, transactions: nextTransactions, toClose, parts, matching: matches.length }
}

/**
 * The note Activity shows on a row the holdings check added, in its tooltip:
 * "Added from XTB’s Open Positions: 2 @ 2,4 USD" for shares bought at XTB's
 * open price, "…: 3 received at cost 0 (free shares or a spin-off)" for free
 * shares. Undefined for every other row.
 */
export function holdingsCheckNote(t: Transaction): string | undefined {
  if (!isHoldingsCheckRow(t)) return undefined
  const quantity = formatQuantity(t.quantity ?? 0)
  const lead = 'Added from XTB’s Open Positions:'
  if (t.type === 'receive') return `${lead} ${quantity} received at cost 0 (free shares or a spin-off)`
  if (t.type === 'buy' && t.pricePerUnitOriginal !== undefined) {
    return `${lead} ${quantity} @ ${formatQuantity(t.pricePerUnitOriginal)} ${t.originalCurrency ?? ''}`.trimEnd()
  }
  return t.comment
}
