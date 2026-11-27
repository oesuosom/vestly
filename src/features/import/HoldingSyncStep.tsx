import { Button } from '@/components/ui/Button'
import { actionableSyncRows, type HoldingSyncRow } from '@/domain/holdingSync'
import { formatDate, formatPLN, formatQuantity } from '@/utils/formatters'
import type { Holding } from '@/types'
import { ImportScrollBody } from './ImportScrollBody'
import { IMPORT_CARD } from './importLayout'

/**
 * The step after an import that brings trades: the holdings those trades
 * change, for the person to confirm. "10 → 15 shares", or "Sold out → close"
 * with the sale's date and proceeds. Holdings whose history doesn't explain
 * what they hold are listed apart and left alone.
 *
 * Shared by the XTB imports and the Revolut statement import.
 */
export function HoldingSyncStep({
  rows,
  onConfirm,
  onSkip,
  footerLabel,
}: {
  rows: HoldingSyncRow[]
  onConfirm: () => void
  onSkip: () => void
  /** Source label in the footer's left slot, where the flow has one. */
  footerLabel?: string
}) {
  const actionable = actionableSyncRows(rows)
  const flagged = rows.filter((r) => r.kind === 'unexplained')

  return (
    <div className={IMPORT_CARD}>
      <ImportScrollBody className="p-5 flex flex-col gap-5">
        {actionable.length > 0 && (
          <>
            <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
              These trades change {actionable.length === 1 ? 'a holding' : `${actionable.length} holdings`} in this
              account. Nothing changes until you confirm.
            </p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted border-b border-borderLight">
                    <th className="h-11 px-3 text-left align-middle border-r border-borderLight">
                      <span className="block truncate text-xs font-medium text-accent">Holding</span>
                    </th>
                    <th className="h-11 px-3 text-right align-middle">
                      <span className="block truncate text-xs font-medium text-accent">Change</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {actionable.map((row) => (
                    <tr key={row.holding.id} className="border-b border-borderLight last:border-b-0">
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs text-foreground">{row.holding.name}</span>
                      </td>
                      <td className="h-11 px-3 align-middle text-right">
                        {row.kind === 'update' ? (
                          <span className="text-xs text-foreground tabular-nums whitespace-nowrap">
                            {qty(row.holding, row.holding.quantity)}
                            <span className="text-accent mx-1">→</span>
                            {qty(row.holding, row.quantity)} {unitLabel(row.holding)}
                          </span>
                        ) : (
                          <span className="text-xs text-foreground whitespace-nowrap">
                            {row.proceedsPLN > 0 ? 'Sold out' : 'All sent'}
                            <span className="text-accent mx-1">→</span>
                            close on {formatDate(row.date)}
                            {row.proceedsPLN > 0 && <span className="text-accent"> · {formatPLN(row.proceedsPLN)}</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {flagged.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
              {actionable.length > 0 ? 'Left as they are:' : 'These holdings are left as they are:'}
            </p>
            <ul className="flex flex-col gap-1.5">
              {flagged.map((row) => (
                <li key={row.holding.id} className="text-xs text-accent leading-normal">
                  <span className="text-foreground">{row.holding.name}</span> —{' '}
                  {row.kind === 'unexplained' && row.reason === 'shared'
                    ? 'another holding in this account has the same ticker, so these trades can’t be matched to one of them.'
                    : `its transactions don’t explain the ${qty(row.holding, row.holding.quantity)} ${unitLabel(row.holding)} you hold (for example, bought before your first import). Update it by hand if needed.`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ImportScrollBody>

      <div className="border-t border-borderLight p-5 flex items-center gap-2">
        <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">{footerLabel}</p>
        {actionable.length > 0 ? (
          <>
            <Button variant="secondary" onClick={onSkip} className="w-20">Skip</Button>
            <Button variant="primary" onClick={onConfirm}>Confirm</Button>
          </>
        ) : (
          <Button variant="primary" onClick={onSkip}>Continue</Button>
        )}
      </div>
    </div>
  )
}

/** Crypto quantities go to 8 decimals; shares and bonds to 4. */
function qty(holding: Holding, value: number): string {
  return formatQuantity(value, holding.category === 'crypto' ? 8 : 4)
}

function unitLabel(holding: Holding): string {
  if (holding.category === 'crypto') return holding.ticker ?? 'units'
  if (holding.category === 'bond') return 'bonds'
  return 'shares'
}
