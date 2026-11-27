/**
 * The screens of the Revolut Crypto Account Statement import: the preview
 * (counts per coin, the cost of received coins, warnings) and the holdings
 * check against the statement's closing amounts. Built from the same parts as
 * the XTB screens: status lines, the info box, bordered tables with 44 px
 * rows, the collapsible warnings and the holdings-check rows with a checkbox.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { ChevronDownSmall, CircleCheck, CircleCross, Skip } from '@/generated/icons'
import type { RevolutStatement } from '@/importers/revolutStatement'
import { countByCoin, type PlannedRow, type StatementHoldingsCheck } from '@/importers/revolutStatementImport'
import { adjustLabel, parseCost, plural } from './revolutStatementText'
import { transactionDay } from '@/domain/transactionDay'
import { formatDate, formatQuantity } from '@/utils/formatters'
import { ImportScrollBody } from './ImportScrollBody'
import { IMPORT_CARD } from './importLayout'

const HEAD = 'h-11 px-3 align-middle bg-muted border-b border-borderLight'
const LABEL = 'block truncate text-xs font-medium text-accent'
const CELL = 'h-11 px-3 align-middle border-b border-borderLight'

function StatusLine({ icon, children, strong = false }: { icon: 'check' | 'skip' | 'warning'; children: string; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {icon === 'check' && <CircleCheck size={16} className="text-positive shrink-0" />}
      {icon === 'skip' && <Skip size={16} className="text-accent shrink-0" />}
      {icon === 'warning' && <CircleCross size={16} className="text-warning shrink-0" />}
      <span className={`text-sm font-medium tracking-[-0.35px] tabular-nums ${strong ? 'text-foreground' : 'text-foregroundMuted'}`}>{children}</span>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-accent tracking-[-0.35px]">{label}</span>
      <span className="text-foreground font-medium tracking-[-0.35px] text-right">{value}</span>
    </div>
  )
}

function Count({ n }: { n: number }) {
  return n > 0
    ? <span className="block truncate text-xs font-medium leading-4 text-foreground text-right tabular-nums">{n}</span>
    : <span className="block truncate text-xs font-medium leading-4 text-accent text-right">—</span>
}

// ─────────────────────────────────────────
// Preview
// ─────────────────────────────────────────

export function RevolutStatementPreview({
  statement,
  rows,
  accountName,
  timeZone,
  costs,
  onCostChange,
  noPriceSource,
  isImporting,
  onBack,
  onContinue,
}: {
  statement: RevolutStatement
  rows: PlannedRow[]
  accountName: string
  /** The browser's time zone, which the statement's local times were converted from. */
  timeZone: string
  /** The cost cell's text per received row id. */
  costs: Record<string, string>
  onCostChange: (rowId: string, text: string) => void
  /** Coins with no price source (CoinGecko doesn't know them). */
  noPriceSource: string[]
  isImporting: boolean
  onBack: () => void
  onContinue: () => void
}) {
  const [warningsOpen, setWarningsOpen] = useState(false)
  const fresh = rows.filter((r) => !r.duplicate)
  const duplicates = rows.length - fresh.length
  const staking = Object.values(statement.staking).reduce((a, b) => a + b, 0)
  const { warnings, period } = statement
  const coins = countByCoin(rows)
  const receives = fresh.filter((r) => r.type === 'receive')
  const invalidCost = receives.some((r) => parseCost(costs[r.id] ?? '') === null)
  const unchecked = [...new Set(rows.map((r) => r.symbol))].filter((s) => !statement.closing[s])

  return (
    <div className={IMPORT_CARD}>
      <ImportScrollBody className="p-5 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <StatusLine icon="check" strong>{`${plural(fresh.length, 'transaction')} to import`}</StatusLine>
          {duplicates > 0 && <StatusLine icon="skip">{`${duplicates} already imported`}</StatusLine>}
          {staking > 0 && <StatusLine icon="skip">{`${plural(staking, 'staking reward')} left out`}</StatusLine>}
          {warnings.length > 0 && (
            <StatusLine icon="warning">{`${plural(warnings.length, 'row')} couldn’t be read`}</StatusLine>
          )}
        </div>

        <div className="border border-borderLight rounded-lg p-4 bg-background flex flex-col gap-2">
          <InfoRow label="Period" value={period ? `${formatDate(period.from)} – ${formatDate(period.to)}` : '—'} />
          <InfoRow label="Account" value={accountName} />
          <InfoRow label="Times" value={`Converted from your time zone (${timeZone})`} />
        </div>

        {!period && (
          <InlineAlert variant="warning">
            Couldn’t read the statement’s period, so your holdings can’t be checked against it.
          </InlineAlert>
        )}
        {unchecked.length > 0 && (
          <InlineAlert variant="warning">
            The statement shows no closing amount for {unchecked.join(', ')}, so {unchecked.length === 1 ? 'it isn’t' : 'they aren’t'} checked.
          </InlineAlert>
        )}
        {noPriceSource.length > 0 && (
          <InlineAlert variant="warning">
            No price source for {noPriceSource.join(', ')}: {noPriceSource.length === 1 ? 'its' : 'their'} value stays at Revolut’s price until you change it.
          </InlineAlert>
        )}

        {coins.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Coin</span></th>
                  <th className={`${HEAD} text-right border-r`}><span className={LABEL}>Buys</span></th>
                  <th className={`${HEAD} text-right border-r`}><span className={LABEL}>Sells</span></th>
                  <th className={`${HEAD} text-right border-r`}><span className={LABEL}>Sends</span></th>
                  <th className={`${HEAD} text-right`}><span className={LABEL}>Receives</span></th>
                </tr>
              </thead>
              <tbody>
                {coins.map(({ symbol, counts }) => (
                  <tr key={symbol} className="[&:last-child>*]:border-b-0">
                    <th scope="row" className={`${CELL} border-r text-left font-normal`}>
                      <span className="block truncate text-xs font-medium text-foreground">{symbol}</span>
                    </th>
                    <td className={`${CELL} border-r`}><Count n={counts.buy} /></td>
                    <td className={`${CELL} border-r`}><Count n={counts.sell} /></td>
                    <td className={`${CELL} border-r`}><Count n={counts.send} /></td>
                    <td className={CELL}><Count n={counts.receive} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {receives.length > 0 && (
          <>
            <p className="text-sm leading-normal text-foregroundMuted tracking-[-0.35px]">
              What did the received coins cost you? Revolut’s value on the day is filled in. Change it if you paid
              something else, e.g. coins moved in from another wallet.
            </p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col style={{ width: 80 }} />
                  <col />
                  <col style={{ width: 128 }} />
                  <col style={{ width: 128 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Coin</span></th>
                    <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Date</span></th>
                    <th className={`${HEAD} text-right border-r`}><span className={LABEL}>Qty</span></th>
                    <th className={`${HEAD} text-right`}><span className={LABEL}>Cost in PLN</span></th>
                  </tr>
                </thead>
                <tbody>
                  {receives.map((r) => {
                    const text = costs[r.id] ?? ''
                    const invalid = parseCost(text) === null
                    return (
                      <tr key={r.id} className="[&:last-child>*]:border-b-0">
                        <th scope="row" className={`${CELL} border-r text-left font-normal`}>
                          <span className="block truncate text-xs font-medium text-foreground">{r.symbol}</span>
                        </th>
                        <td className={`${CELL} border-r`}>
                          <span className="block truncate text-xs text-accent">{formatDate(transactionDay(r))}</span>
                        </td>
                        <td className={`${CELL} border-r`}>
                          <span className="block truncate text-xs text-foreground text-right tabular-nums">{formatQuantity(r.quantity, 8)}</span>
                        </td>
                        <td className={CELL}>
                          {/* The editable cell of the import tables (eMakler's purchase price). */}
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Enter"
                            aria-label={`Cost in PLN of ${formatQuantity(r.quantity, 8)} ${r.symbol} received on ${formatDate(transactionDay(r))}`}
                            aria-invalid={invalid}
                            value={text}
                            onChange={(e) => onCostChange(r.id, e.target.value.replace(/[^0-9.,\s]/g, ''))}
                            className={`w-full bg-transparent text-xs font-medium text-right tabular-nums placeholder:text-accent focus:outline-none ${invalid ? 'text-negative' : 'text-foreground'}`}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {warnings.length > 0 && (
          <div className="border border-borderLight rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setWarningsOpen((v) => !v)}
              aria-expanded={warningsOpen}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-foregroundMuted tracking-[-0.35px] hover:bg-muted transition-colors cursor-pointer"
            >
              <span>View warnings</span>
              <ChevronDownSmall size={16} className={`transition-transform text-accent ${warningsOpen ? 'rotate-180' : ''}`} />
            </button>
            {warningsOpen && (
              <div className="border-t border-borderLight divide-y divide-borderLight">
                {warnings.map((w, i) => (
                  <div key={i} className="px-4 py-4 flex flex-col gap-1">
                    <p className="text-xs font-medium text-accent tabular-nums">{w.row > 0 ? `Page ${w.page}, row ${w.row}` : `Page ${w.page}`}</p>
                    <p className="text-sm text-negative tracking-[-0.35px]">{w.message}</p>
                    <p className="text-xs font-medium text-accent truncate" title={w.raw}>{w.summary ?? w.raw}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {rows.length === 0 && (
          <p className="text-sm text-accent text-center py-2">The statement lists no transactions this import can read.</p>
        )}
        {rows.length > 0 && fresh.length === 0 && (
          <p className="text-sm text-accent text-center py-2">Every transaction was already imported. Continue to check your holdings.</p>
        )}
        {invalidCost && <InlineAlert variant="negative">Enter a cost in PLN for each received row (0 if it cost nothing).</InlineAlert>}
      </ImportScrollBody>

      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onBack} disabled={isImporting} className="w-20">Back</Button>
        <Button variant="primary" onClick={onContinue} disabled={isImporting || invalidCost || (rows.length === 0 && !period)}>
          {isImporting ? 'Importing…' : 'Continue'}
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// Holdings check
// ─────────────────────────────────────────

const COLS = (
  <colgroup>
    <col style={{ width: 112 }} />
    <col />
    <col style={{ width: 96 }} />
    <col style={{ width: 96 }} />
  </colgroup>
)

function Quantity({ value }: { value: number }) {
  return value > 0
    ? <span className="block truncate text-xs font-medium leading-4 text-foreground text-right tabular-nums">{formatQuantity(value, 8)}</span>
    : <span className="block truncate text-xs font-medium leading-4 text-accent text-right">—</span>
}

export function RevolutHoldingsCheckStep({
  check,
  onApply,
  onSkip,
}: {
  check: StatementHoldingsCheck
  /** Called with the symbols whose adjustment is ticked. */
  onApply: (symbols: Set<string>) => void
  onSkip: () => void
}) {
  const [checked, setChecked] = useState(() => new Set(check.differences.map((d) => d.symbol)))
  const date = formatDate(check.asOf)
  const m = check.matching.length
  const k = check.differences.length
  const matching = m === 0 ? 'None of your coins match it.' : m === 1 ? '1 coin matches it.' : `${m} coins match it.`

  function toggle(symbol: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(symbol)
      else next.delete(symbol)
      return next
    })
  }

  return (
    <div className={IMPORT_CARD}>
      <ImportScrollBody className="p-5 flex flex-col gap-5">
        <p className="text-sm leading-normal text-foregroundMuted tracking-[-0.35px]">
          Revolut’s statement shows what you held on {date}.
          <br />
          {matching} {k === 1 ? 'This one doesn’t:' : `These ${k} don’t:`}
        </p>

        <div className="flex flex-col gap-2">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full table-fixed border-collapse">
              {COLS}
              <thead>
                <tr>
                  <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Coin</span></th>
                  <th className={`${HEAD} text-left border-r`}><span className={LABEL}>Why</span></th>
                  <th className={`${HEAD} text-right border-r`}><span className={LABEL}>Vestly</span></th>
                  <th className={`${HEAD} text-right`}><span className={LABEL}>Revolut</span></th>
                </tr>
              </thead>
            </table>
          </div>

          {check.differences.map((d) => {
            const label = adjustLabel(d)
            return (
              <div key={d.symbol} className="border border-border rounded-lg overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                  {COLS}
                  <tbody>
                    <tr className="border-b border-borderLight">
                      <th scope="row" className="h-11 px-3 text-left align-middle border-r border-borderLight font-normal">
                        <span className="block truncate text-xs font-medium text-foreground">{d.symbol}</span>
                      </th>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs leading-4 text-accent" title={d.detail || undefined}>{d.reason}</span>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight"><Quantity value={d.vestly} /></td>
                      <td className="h-11 px-3 align-middle"><Quantity value={d.revolut} /></td>
                    </tr>
                    <tr className="bg-muted">
                      <td colSpan={3} className="h-11 px-3 align-middle">
                        <span className="block truncate text-xs font-medium text-foreground">{label}</span>
                      </td>
                      <td className="h-11 p-0 align-middle">
                        <div className="h-11 flex items-center justify-end pr-[14px]">
                          <Checkbox checked={checked.has(d.symbol)} onChange={(on) => toggle(d.symbol, on)} ariaLabel={label} />
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>

        <p className="text-sm leading-normal text-accent tracking-[-0.35px]">
          An adjustment is a 0 PLN row dated {date}, so it doesn’t change what you paid. It shows in Activity. Untick
          one to leave that coin as it is.
        </p>
      </ImportScrollBody>

      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onSkip} className="w-20">Skip</Button>
        <Button variant="primary" onClick={() => onApply(checked)} disabled={checked.size === 0}>
          {`Apply ${plural(checked.size, 'change')}`}
        </Button>
      </div>
    </div>
  )
}
