import { useId } from 'react'
import { DateField } from '@/components/ui/DateField'
import { Input } from '@/components/ui/Input'
import { RadioButton } from '@/components/ui/RadioButton'
import { latestCloseDate } from '@/domain/closePosition'
import { markAsSoldDefaults, type MarkAsSoldErrors, type MissingHolding } from '@/domain/missingHoldings'
import { formatDate, formatPLN, formatQuantity } from '@/utils/formatters'
import type { Holding } from '@/types'
import type { SoldChoice, SoldChoices } from './soldChoices'

/**
 * "Not in this file": the holdings a full holdings file doesn't list, shared by
 * the eMakler and CSV holdings previews. Every row starts on Keep, so importing
 * as usual leaves them as they are. "Mark as sold" closes the holding (#28)
 * with the date and amount entered here.
 */

type NotInFileProps = {
  missing: MissingHolding[]
  choices: SoldChoices
  onChange: (next: SoldChoices) => void
  errors: Record<string, MarkAsSoldErrors>
  today: string
  /** The file's statement date, `yyyy-MM-dd`, when it has one. */
  statementDate?: string
}

export function NotInFile({ missing, choices, onChange, errors, today, statementDate }: NotInFileProps) {
  const headingId = useId()
  if (missing.length === 0) return null

  function setSold(row: MissingHolding, sold: boolean) {
    const { holding } = row
    const next = { ...choices }
    if (sold) next[holding.id] = markAsSoldDefaults(row, today, statementDate)
    else delete next[holding.id]
    onChange(next)
  }

  function edit(holding: Holding, patch: Partial<SoldChoice>) {
    onChange({ ...choices, [holding.id]: { ...choices[holding.id], ...patch } })
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className="text-sm font-medium text-foreground tracking-[-0.35px]">
          Not in this file
        </h3>
        <p className="text-xs text-accent leading-normal">
          These stay as they are unless you mark them as sold.
        </p>
      </div>
      <ul className="border border-border rounded-lg divide-y divide-borderLight">
        {missing.map((row) => {
          const { holding } = row
          const isBond = holding.category === 'bond'
          const choice = choices[holding.id]
          const rowErrors = errors[holding.id]
          const shared = rowErrors?.sharedWith
          return (
            <li key={holding.id} className="p-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm text-foreground truncate tracking-[-0.35px]">{holding.name}</p>
                  <p className="text-xs text-accent tabular-nums">
                    {formatQuantity(row.quantity, holding.category === 'crypto' ? 8 : 4)} units · {formatPLN(row.quantity * holding.currentPrice)}
                  </p>
                  {row.priorSales.length > 0 && (
                    <p className="text-xs text-accent">
                      {formatQuantity(holding.quantity - row.quantity)} sold in this upload
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4" role="radiogroup" aria-label={`${holding.name}`}>
                  <RadioButton
                    name={`missing-${holding.id}`}
                    label="Keep"
                    checked={!choice}
                    onChange={() => setSold(row, false)}
                  />
                  <RadioButton
                    name={`missing-${holding.id}`}
                    label="Mark as sold"
                    checked={!!choice}
                    onChange={() => setSold(row, true)}
                  />
                </div>
              </div>
              {choice && (
                shared ? (
                  <p className="text-xs text-negative leading-normal">
                    {shared.name} has the same ticker, so Vestly can’t tell which one you sold. Combine them
                    into one holding first, or keep this one.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DateField
                      id={`missing-date-${holding.id}`}
                      label="Date sold"
                      value={choice.date}
                      max={rowErrors ? latestCloseDate(rowErrors.earliest, today) : today}
                      min={rowErrors?.earliest}
                      onChange={(e) => edit(holding, { date: e.target.value })}
                      error={dateError(rowErrors)}
                    />
                    <Input
                      id={`missing-amount-${holding.id}`}
                      label={isBond ? 'Amount received (PLN)' : 'Sale amount (PLN)'}
                      inputMode="decimal"
                      value={choice.amount}
                      onChange={(e) => edit(holding, { amount: e.target.value.replace(/[^0-9.,]/g, '') })}
                      error={rowErrors?.amount === 'required' ? 'Required' : rowErrors?.amount === 'negative' ? 'Min 0' : undefined}
                    />
                    {isBond && (
                      <p className="sm:col-span-2 -mt-1 text-xs text-accent leading-normal">
                        What PKO paid out, after any tax and early-redemption fee.
                      </p>
                    )}
                  </div>
                )
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function dateError(errors: MarkAsSoldErrors | undefined): string | undefined {
  switch (errors?.date) {
    case 'required':
      return 'Pick the day of the sale'
    case 'future':
      return 'The sale can’t be in the future'
    case 'beforePurchase':
      return `Pick ${formatDate(errors.earliest)} or later`
    default:
      return undefined
  }
}

/** The warning shown instead of missing holdings when the file shares none with the account. */
export function WrongAccountNote({ accountName }: { accountName: string }) {
  return (
    <>
      None of the holdings in this file are in {accountName}. Check it’s the right account: nothing will be
      marked as missing.
    </>
  )
}
