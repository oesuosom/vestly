import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { InlineAlert } from '@/components/ui/InlineAlert'
import type { HoldingDifference, HoldingsCheck } from '@/domain/holdingsCheck'
import { initiallyChecked, isApplicable } from './holdingsCheckApply'
import { formatDate, formatQuantity } from '@/utils/formatters'

/**
 * The last step of an XTB .xlsx import: the holdings that differ from what
 * XTB's Open Positions say it holds. One card per holding, with both
 * quantities and, in a muted row below, the change Apply makes, with a
 * checkbox. "Vestly holds more" has no change: it is only there to be seen.
 */

const shares = (n: number) => `${formatQuantity(n)} ${n === 1 ? 'share' : 'shares'}`

function describe(d: HoldingDifference, nbpOn: boolean): string {
  switch (d.kind) {
    case 'free_shares': return 'Free shares or a spin-off: no purchase'
    case 'broker_more':
      return nbpOn ? `No purchase in the file explains ${shares(d.missing)}` : 'Needs NBP (Settings › Market Data) to convert the price'
    case 'vestly_more': return `XTB holds ${formatQuantity(d.extra)} fewer ${d.extra === 1 ? 'share' : 'shares'}`
    case 'gone': return 'XTB shows none held'
  }
}

function change(d: HoldingDifference): string | null {
  switch (d.kind) {
    case 'free_shares': return 'Add at cost 0'
    case 'broker_more': return `Add ${shares(d.missing)} at XTB’s open price`
    case 'gone': return d.holding ? 'Close position' : null
    case 'vestly_more': return null
  }
}

function intro(check: HoldingsCheck): string {
  const m = check.matching.length
  const k = check.differences.length
  const matching = m === 0 ? 'None of your holdings match it.' : m === 1 ? '1 holding matches it.' : `${m} holdings match it.`
  return `${matching} ${k === 1 ? 'This one doesn’t:' : `These ${k} don’t:`}`
}

const HEAD = 'h-11 px-3 align-middle bg-muted border-b border-borderLight'
const LABEL = 'block truncate text-xs font-medium text-accent'
const COLS = (
  <colgroup>
    <col style={{ width: 144 }} />
    <col />
    <col style={{ width: 80 }} />
    <col style={{ width: 80 }} />
  </colgroup>
)

function Quantity({ value }: { value: number }) {
  return value > 0
    ? <span className="block truncate text-xs font-medium leading-4 text-foreground text-right tabular-nums">{formatQuantity(value)}</span>
    : <span className="block truncate text-xs font-medium leading-4 text-accent text-right">—</span>
}

export function HoldingsCheckStep({
  check,
  nbpOn,
  onApply,
  onSkip,
}: {
  check: HoldingsCheck
  /** NBP is switched on: "Add N shares at XTB's open price" can convert the price. */
  nbpOn: boolean
  /** Resolves when applied; rejects with a message to show, and nothing is applied. */
  onApply: (checked: Set<string>) => Promise<void>
  onSkip: () => void
}) {
  const [checked, setChecked] = useState(() => initiallyChecked(check.differences))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enabled = (d: HoldingDifference) => isApplicable(d) && (d.kind !== 'broker_more' || nbpOn)
  const count = check.differences.filter((d) => enabled(d) && checked.has(d.key)).length

  function toggle(key: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      await onApply(new Set(check.differences.filter((d) => enabled(d) && checked.has(d.key)).map((d) => d.key)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        <p className="text-sm leading-normal text-foregroundMuted tracking-[-0.35px]">
          XTB’s statement shows what you held on {formatDate(check.asOf.slice(0, 10))}.
          <br />
          {intro(check)}
        </p>

        <div className="flex flex-col gap-2">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full table-fixed border-collapse">
              {COLS}
              <thead>
                <tr>
                  <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Holding</span></th>
                  <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Description</span></th>
                  <th className={`${HEAD} text-right border-r`}><span className={LABEL}>Vestly</span></th>
                  <th className={`${HEAD} text-right`}><span className={LABEL}>XTB</span></th>
                </tr>
              </thead>
            </table>
          </div>

          {check.differences.map((d) => {
            const label = change(d)
            const disabled = !enabled(d)
            return (
              <div key={d.key} className="border border-border rounded-lg overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                  {COLS}
                  <tbody>
                    <tr className={label ? 'border-b border-borderLight' : ''}>
                      <th scope="row" className="h-11 px-3 text-left align-middle border-r border-borderLight font-normal">
                        <span className="block truncate text-xs font-medium text-foreground">{d.name}</span>
                      </th>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block py-2 text-xs leading-4 text-accent">{describe(d, nbpOn)}</span>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight"><Quantity value={d.vestlyQuantity} /></td>
                      <td className="h-11 px-3 align-middle"><Quantity value={'statement' in d ? d.statement.quantity : 0} /></td>
                    </tr>
                    {label && (
                      <tr className="bg-muted">
                        <td colSpan={3} className="h-11 px-3 align-middle">
                          <span className={`block truncate text-xs font-medium ${disabled ? 'text-accent' : 'text-foreground'}`}>{label}</span>
                        </td>
                        <td className="h-11 p-0 align-middle">
                          <div className="h-11 flex items-center justify-end pr-[14px]">
                            <Checkbox
                              checked={!disabled && checked.has(d.key)}
                              disabled={disabled}
                              onChange={(on) => toggle(d.key, on)}
                              ariaLabel={`${label}: ${d.name}`}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>

        {error && <InlineAlert variant="negative">{error}</InlineAlert>}
      </div>

      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onSkip} disabled={busy} className="w-20">Skip</Button>
        <Button variant="primary" onClick={() => void apply()} disabled={count === 0 || busy}>
          {busy ? 'Applying…' : `Apply ${count} change${count !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}
