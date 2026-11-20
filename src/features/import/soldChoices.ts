import { markAsSoldErrors, parseAmount, type MarkAsSoldErrors } from '@/domain/missingHoldings'
import type { CloseInput } from '@/domain/closePosition'
import type { Account, Holding, Transaction } from '@/types'

/** A row the person switched to "Mark as sold"; rows not in the map are kept. */
export type SoldChoice = { date: string; amount: string }
export type SoldChoices = Record<string, SoldChoice>

/** Each "Mark as sold" row's errors, keyed by holding id. Empty rows are valid. */
export function soldChoiceErrors(
  choices: SoldChoices,
  holdings: Holding[],
  account: Account | undefined,
  transactions: Transaction[],
  today: string,
): Record<string, MarkAsSoldErrors> {
  const errors: Record<string, MarkAsSoldErrors> = {}
  if (!account) return errors
  for (const holding of holdings) {
    const choice = choices[holding.id]
    if (choice) errors[holding.id] = markAsSoldErrors(holding, account, transactions, choice, today)
  }
  return errors
}

/** The close each "Mark as sold" row asks for. Rows not in `holdings` are ignored. */
export function soldChoiceCloses(choices: SoldChoices, holdings: Holding[]): { holdingId: string; input: CloseInput }[] {
  return holdings
    .filter((h) => choices[h.id])
    .map((h) => ({
      holdingId: h.id,
      input: { date: choices[h.id].date, saleAmountPLN: parseAmount(choices[h.id].amount), feePLN: 0 },
    }))
}
