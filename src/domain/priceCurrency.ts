import type { Account, HoldingPriceHistory, Holding } from '@/types'
import { currencyForExchange } from '@/services/market-data/tickerUtils'
import { currencyForRate } from './holdingsCheck'

/**
 * The currency a holding's price is quoted in, and how a price in it becomes PLN.
 *
 * A market alone can't tell the currency: London lists in USD, GBP and pence,
 * and an XTB ".UK" ETF can be priced in USD. So each holding can carry its own
 * `currency` (an ISO code, or `GBX` for pence), filled from, in this order:
 *
 *   1. the broker's statement (XTB's Open Positions: Value ÷ (Volume × Current price)),
 *   2. the price data itself (Yahoo's chart response reports it),
 *   3. otherwise the market's default (`currencyForExchange`), as before.
 *
 * The first two write `Holding.currency`; a statement overwrites what price
 * data found, never the other way round (see {@link withReportedCurrency}).
 */

/** Pence sterling: prices quoted in pence are converted at the GBP rate ÷ 100. */
export const PENCE = 'GBX'

/** The currency to convert a holding's price from. */
export function holdingPriceCurrency(holding: Pick<Holding, 'currency' | 'exchange'>): string {
  return holding.currency ?? currencyForExchange(holding.exchange ?? 'US')
}

/** The currency whose PLN rate converts a price in `currency`: GBX → GBP. */
export function rateCurrency(currency: string): string {
  return currency === PENCE ? 'GBP' : currency
}

/** Units of `currency` in one unit of its rate currency: 100 for pence, else 1. */
export function unitsPerRateUnit(currency: string): number {
  return currency === PENCE ? 100 : 1
}

/**
 * A price in `currency` in PLN, given the PLN rate of its rate currency
 * ({@link rateCurrency}). 1 000 GBX at a GBP rate of 5 is 50 PLN.
 */
export function priceToPLN(price: number, currency: string, rateToPLN: number): number {
  if (currency === 'PLN') return price
  return (price / unitsPerRateUnit(currency)) * rateToPLN
}

/**
 * Our code for a currency as Yahoo's chart response reports it
 * (`chart.result[0].meta.currency`): "GBp" (pence) → GBX, three-letter ISO
 * codes as they are. Undefined for anything else (other minor units such as
 * "ZAc" or "ILA"), so the market default applies rather than a guess.
 */
export function currencyFromYahoo(reported: string | null | undefined): string | undefined {
  return currencyCode(reported)
}

/**
 * A currency as a source writes it, as our code: "GBp" or "GBX" (pence) → GBX,
 * three-letter upper-case ISO codes as they are. Undefined for anything else,
 * so nothing is guessed.
 */
export function currencyCode(raw: string | null | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  if (value === 'GBp' || value === 'GBX') return PENCE
  return /^[A-Z]{3}$/.test(value) ? value : undefined
}

/**
 * The currency an instrument in the statement is priced in, from its PLN rate
 * at report time and NBP's table for that day (`currencyForRate`): GBX for
 * pence. Undefined when no currency in the table is close enough.
 */
export function currencyFromStatement(rateToPLN: number | undefined, table: ReadonlyMap<string, number>): string | undefined {
  if (rateToPLN === undefined) return undefined
  const found = currencyForRate(rateToPLN, table)
  if (!found) return undefined
  return found.divisor === 100 ? PENCE : found.currency
}

/**
 * A holding with the currency its price data reported, when it has none yet.
 * A currency already set (from a statement, or earlier price data) stays: the
 * statement comes first, and price data never overrides it. Returns the same
 * object when nothing changes.
 */
export function withReportedCurrency<H extends Pick<Holding, 'currency'>>(holding: H, reported: string | undefined): H {
  if (!reported || holding.currency) return holding
  return { ...holding, currency: reported }
}

/**
 * The accounts with the currency each price series reported saved on open
 * holdings that have none yet ({@link withReportedCurrency}). Returns
 * `accounts` itself when nothing changes.
 */
export function withReportedCurrencies(accounts: Account[], histories: HoldingPriceHistory[]): Account[] {
  const reported = new Map<string, string>()
  for (const h of histories) if (h.reportedCurrency) reported.set(h.holdingId, h.reportedCurrency)
  if (reported.size === 0) return accounts
  let changed = false
  const next = accounts.map((a) => {
    let touched = false
    const holdings = a.holdings.map((h) => {
      const updated = withReportedCurrency(h, reported.get(h.id))
      if (updated !== h) touched = true
      return updated
    })
    if (!touched) return a
    changed = true
    return { ...a, holdings }
  })
  return changed ? next : accounts
}
