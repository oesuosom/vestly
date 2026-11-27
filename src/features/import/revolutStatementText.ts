import type { CoinDifference } from '@/importers/revolutStatementImport'
import { formatDate, formatQuantity } from '@/utils/formatters'

/** "1 transaction", "48 transactions". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "180,00": a PLN amount as the cost cell shows it. */
export function formatCost(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

/** The cost cell's text as a number: "1 234,5" → 1234.5. Null when it isn't one. */
export function parseCost(text: string): number | null {
  const t = text.replace(/[\s\u00a0]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null
  return Number(t)
}

/** "Adjust: add 1,5 XRP at 0 PLN" */
export function adjustLabel(d: Pick<CoinDifference, 'delta' | 'symbol'>): string {
  return `Adjust: ${d.delta > 0 ? 'add' : 'remove'} ${formatQuantity(Math.abs(d.delta), 8)} ${d.symbol} at 0 PLN`
}

/** How the holdings compared with the statement, once the import is done. */
export type StatementOutcome = {
  /** Statement rows imported (their fee rows not counted). */
  imported: number
  accountName: string
  /** The statement's end day, or null when the holdings weren't checked. */
  asOf: string | null
  /** Coins checked against the statement. */
  coins: number
  /** Coins that match it now. */
  matching: number
  adjustments: number
  staking: number
  /** Extra clauses: holdings created or updated. */
  holdings: string[]
}

/**
 * The done screen: "Imported 48 transactions into Revolut Crypto" /
 * "All 5 coins match Revolut’s statement of 31 Dec 2025, with 2 adjustments.
 * 3 staking rewards were left out."
 */
export function statementDoneText(o: StatementOutcome): { message: string; detail: string } {
  const message =
    o.imported > 0 ? `Imported ${plural(o.imported, 'transaction')} into ${o.accountName}` : `No new transactions for ${o.accountName}`
  const parts: string[] = []
  if (o.asOf && o.coins > 0) {
    const date = formatDate(o.asOf)
    const adjusted = o.adjustments > 0 ? `, with ${plural(o.adjustments, 'adjustment')}` : ''
    if (o.matching === o.coins) {
      parts.push(
        o.coins === 1
          ? `Your coin matches Revolut’s statement of ${date}${adjusted}.`
          : `All ${o.coins} coins match Revolut’s statement of ${date}${adjusted}.`,
      )
    } else {
      parts.push(`${o.matching} of ${o.coins} coins match Revolut’s statement of ${date}${adjusted}; the others were left as they are.`)
    }
  }
  if (o.staking > 0) parts.push(`${plural(o.staking, 'staking reward')} ${o.staking === 1 ? 'was' : 'were'} left out.`)
  if (o.holdings.length > 0) parts.push(`${o.holdings.join(', ')}.`)
  return { message, detail: parts.join(' ') }
}
