import { useId, useMemo, useState } from 'react'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { ChevronDownSmall } from '@/generated/icons'
import { closedPositionResult } from '@/domain/closePosition'
import { formatDate, formatPLN, formatPercent } from '@/utils/formatters'
import type { Holding, Transaction } from '@/types'

type ClosedPositionsProps = {
  holdings: Holding[]
  transactions: Transaction[]
  /** Open a closed holding in the (read-only) holding panel. */
  onSelect: (holdingId: string) => void
}

/**
 * Account detail's "Closed positions": holdings marked as sold, newest close
 * first, each with its realized profit. Collapsed by default; the caller
 * renders nothing when the account has none.
 */
export function ClosedPositions({ holdings, transactions, onSelect }: ClosedPositionsProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()

  const rows = useMemo(
    () =>
      [...holdings]
        .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
        .map((h) => ({ holding: h, closed: closedPositionResult(h, transactions) })),
    [holdings, transactions],
  )

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        className="self-start flex items-center gap-1.5 h-8 -ml-2 px-2 rounded-md text-sm font-medium text-foreground tracking-[-0.35px] hover:bg-muted transition-colors cursor-pointer"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDownSmall
          size={16}
          className={`text-accent transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
        />
        Closed positions
        <span className="text-accent font-normal tabular-nums">{holdings.length}</span>
      </button>

      {expanded && (
        <div id={listId} className="border border-border rounded-xl overflow-hidden">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className="h-14 px-4 border-b border-borderLight text-sm font-normal text-accent tracking-[-0.35px] text-left">
                  Instrument
                </th>
                <th className="h-14 px-4 border-b border-borderLight text-sm font-normal text-accent tracking-[-0.35px] text-left w-36">
                  Closed
                </th>
                <th className="h-14 px-4 border-b border-borderLight text-sm font-normal text-accent tracking-[-0.35px] text-right w-48">
                  Realized profit
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ holding, closed }, i) => {
                const isLast = i === rows.length - 1
                const cell = `h-14 px-4 ${isLast ? '' : 'border-b border-borderLight'}`
                const profit = closed?.result.profitPLN ?? 0
                const color = profit > 0 ? 'text-positive' : profit < 0 ? 'text-negative' : 'text-accent'
                return (
                  <tr
                    key={holding.id}
                    className="hover:bg-muted focus-visible:bg-muted focus-visible:outline-none transition-colors cursor-pointer"
                    tabIndex={0}
                    aria-label={`${holding.name}, closed ${formatDate(holding.closedAt!)}`}
                    onClick={() => onSelect(holding.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect(holding.id)
                      }
                    }}
                  >
                    <td className={cell}>
                      <div className="flex items-center gap-2 min-w-0">
                        <HoldingIcon holding={holding} size={24} />
                        <span className="text-sm tracking-tight text-foreground truncate">{holding.name}</span>
                      </div>
                    </td>
                    <td className={`${cell} text-sm tracking-tight text-foregroundMuted whitespace-nowrap`}>
                      {formatDate(holding.closedAt!)}
                    </td>
                    <td className={`${cell} text-right`}>
                      {closed ? (
                        <div className="flex flex-col items-end gap-1">
                          <p className={`text-sm leading-none tabular-nums whitespace-nowrap ${color}`}>
                            {profit > 0 ? '+' : ''}{formatPLN(profit)}
                          </p>
                          <p className="text-xs leading-none text-accent">
                            {formatPercent(closed.profitPercent, true, 1)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-accent opacity-50">—</p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
