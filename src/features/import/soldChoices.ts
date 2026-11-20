import { markAsSoldErrors, parseAmount, type MarkAsSoldErrors, type MissingHolding } from '@/domain/missingHoldings'
import type { ImportClose } from '@/context/PortfolioContext'
import type { Account, Transaction } from '@/types'

/** A row the person switched to "Mark as sold"; rows not in the map are kept. */
export type SoldChoice = { date: string; amount: string }
export type SoldChoices = Record<string, SoldChoice>

/** Each "Mark as sold" row's errors, keyed by holding id. Empty rows are valid. */
export function soldChoiceErrors(
  choices: SoldChoices,
  missing: MissingHolding[],
  account: Account | undefined,
  transactions: Transaction[],
  today: string,
): Record<string, MarkAsSoldErrors> {
  const errors: Record<string, MarkAsSoldErrors> = {}
  if (!account) return errors
  for (const m of missing) {
    const choice = choices[m.holding.id]
    if (choice) errors[m.holding.id] = markAsSoldErrors(m, account, transactions, choice, today)
  }
  return errors
}

/**
 * The close each "Mark as sold" row asks for. Rows not in `missing` are
 * ignored. `uploaded` replaces a row's `priorSales` with the rows the import
 * actually recorded (the preview's are stand-ins with other ids).
 */
export function soldChoiceCloses(choices: SoldChoices, missing: MissingHolding[], uploaded?: Transaction[]): ImportClose[] {
  return missing
    .filter((m) => choices[m.holding.id])
    .map((m) => ({
      holdingId: m.holding.id,
      input: { date: choices[m.holding.id].date, saleAmountPLN: parseAmount(choices[m.holding.id].amount), feePLN: 0 },
      ...(m.priorSales.length > 0 && { priorSales: uploaded ?? m.priorSales }),
    }))
}
