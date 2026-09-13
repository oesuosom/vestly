/**
 * XTBReconcileSteps — the post-import reconciliation shared by every XTB import
 * flow (Cash Operations XLS/CSV and daily confirmation PDFs).
 *
 * After transactions land, two things may still need the user's decision:
 *
 *   1. **Unmatched instruments** — a buy arrived for a ticker with no holding,
 *      so the holding has to be created before the portfolio reflects it.
 *   2. **Cost basis** — the weighted average implied by the buy transactions
 *      differs from the holding's stored purchase price.
 *
 * This file holds the two step components; `useXTBReconcile` (in
 * useXTBReconcile.tsx) owns the state machine that sequences them. Both flows
 * drive the hook identically, so the reconciliation stays consistent no matter
 * which document the transactions came from.
 */
import { useEffect, useState } from 'react'
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { formatPLN, formatQuantity } from '@/utils/formatters'
import type {
  CostBasisDiffRow,
  UnmatchedRow,
  UnresolvedRow,
} from '@/importers/xtbPostProcessing'
import type { AssetCategory } from '@/types'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────


export type UnmatchedConfirmPayload = {
  checkedTickers: Set<string>
  checkedInstruments: Set<string>
  tickerOverrides: Map<string, string>
  exchangeOverrides: Map<string, string>
  matchedCategories: Map<string, AssetCategory>
  unresolvedCategories: Map<string, AssetCategory>
}
const ASSET_CATEGORIES: AssetCategory[] = ['stock', 'etf', 'bond', 'crypto', 'cash']

function formatQty(qty: number): string {
  return formatQuantity(qty)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Unmatched-instruments table column widths (px), verbatim from Figma. Sum = 588
 *  (the modal content width), so the table fits without scrolling. */
const UNMATCHED_COLS = [44, 80, 144, 64, 112, 64, 80]
const UNMATCHED_HEADERS: { label: string; align?: 'right' }[] = [
  { label: '' },
  { label: 'Ticker' },
  { label: 'Instrument' },
  { label: 'Exchange' },
  { label: 'Category' },
  { label: 'Qty', align: 'right' },
  { label: 'Avg Cost', align: 'right' },
]

// ─────────────────────────────────────────
// Unmatched holdings sub-step
// ─────────────────────────────────────────

export function UnmatchedStep({
  rows,
  unresolvedRows,
  onConfirm,
  onSkip,
}: {
  rows: UnmatchedRow[]
  unresolvedRows: UnresolvedRow[]
  onConfirm: (payload: UnmatchedConfirmPayload) => void
  onSkip: () => void
}) {
  const [checkedTickers, setCheckedTickers] = useState<Set<string>>(
    () => new Set(rows.map((r) => r.ticker)),
  )
  const [checkedInstruments, setCheckedInstruments] = useState<Set<string>>(
    () => new Set(unresolvedRows.map((r) => r.instrument)),
  )
  const [tickerOverrides, setTickerOverrides] = useState<Map<string, string>>(() => new Map())
  const [exchangeOverrides, setExchangeOverrides] = useState<Map<string, string>>(() => new Map())
  const [matchedCategories, setMatchedCategories] = useState<Map<string, AssetCategory>>(
    () => new Map(rows.filter((r) => r.suggestedCategory).map((r) => [r.ticker, r.suggestedCategory!])),
  )
  const [unresolvedCategories, setUnresolvedCategories] = useState<Map<string, AssetCategory>>(
    () => new Map(),
  )

  useEffect(() => {
    setCheckedTickers(new Set(rows.map((r) => r.ticker)))
    setCheckedInstruments(new Set(unresolvedRows.map((r) => r.instrument)))
    setTickerOverrides(new Map())
    setExchangeOverrides(new Map())
    setMatchedCategories(new Map(rows.filter((r) => r.suggestedCategory).map((r) => [r.ticker, r.suggestedCategory!])))
    setUnresolvedCategories(new Map())
  }, [rows, unresolvedRows])

  function toggleTicker(ticker: string) {
    setCheckedTickers((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  function toggleInstrument(instrument: string) {
    setCheckedInstruments((prev) => {
      const next = new Set(prev)
      if (next.has(instrument)) next.delete(instrument)
      else next.add(instrument)
      return next
    })
  }

  function toggleAllTickers() {
    setCheckedTickers((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.ticker))))
  }

  function toggleAllInstruments() {
    setCheckedInstruments((prev) =>
      prev.size === unresolvedRows.length ? new Set() : new Set(unresolvedRows.map((r) => r.instrument)),
    )
  }

  const allTickersChecked = rows.length > 0 && checkedTickers.size === rows.length
  const allInstrumentsChecked = unresolvedRows.length > 0 && checkedInstruments.size === unresolvedRows.length

  const checkedCount = checkedTickers.size + checkedInstruments.size
  const hasUnresolved = unresolvedRows.length > 0
  const hasMatched = rows.length > 0

  const categoryDropdownOptions: DropdownOption[] = ASSET_CATEGORIES.map((c) => ({
    value: c,
    label: capitalize(c),
  }))
  const exchangeDropdownOptions: DropdownOption[] = [
    { value: '', label: '—' },
    { value: 'US', label: 'US' },
    { value: 'PL', label: 'PL' },
    { value: 'Other', label: 'Other' },
  ]

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
          The following instruments have buy transactions but no matching holding. Select which ones
          to create as holdings. Quantity and cost will be calculated from the transaction history.
        </p>

        {/* Resolved section */}
        {hasMatched && (
          <div className="flex flex-col gap-2">
            {hasUnresolved && <p className="text-sm text-foregroundMuted tracking-[-0.35px]">Resolved Instruments</p>}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full table-fixed border-collapse">
                <colgroup>{UNMATCHED_COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <UnmatchedHead allChecked={allTickersChecked} onToggleAll={toggleAllTickers} />
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ticker} className="border-b border-borderLight last:border-b-0">
                      <td className="h-11 p-0 align-middle border-r border-borderLight">
                        <div className="h-11 flex items-center justify-center">
                          <Checkbox checked={checkedTickers.has(row.ticker)} onChange={() => toggleTicker(row.ticker)} />
                        </div>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs font-medium text-foregroundMuted">{row.ticker}</span>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs font-medium text-foreground">{row.instrument}</span>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs text-foreground">{row.exchange || '—'}</span>
                      </td>
                      <td className="h-11 p-0 align-middle border-r border-borderLight">
                        <div className="h-11">
                          <Dropdown
                            variant="cell"
                            portal
                            value={matchedCategories.get(row.ticker) ?? 'stock'}
                            onChange={(v) =>
                              setMatchedCategories((prev) => {
                                const next = new Map(prev)
                                next.set(row.ticker, v as AssetCategory)
                                return next
                              })
                            }
                            options={categoryDropdownOptions}
                          />
                        </div>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs text-foreground text-right">{formatQty(row.totalQuantity)}</span>
                      </td>
                      <td className="h-11 px-3 align-middle">
                        <span className="block truncate text-xs font-medium text-foreground text-right">{formatPLN(row.avgCostPLN)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Unresolved section */}
        {hasUnresolved && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm text-foregroundMuted tracking-[-0.35px]">Unresolved Instruments</p>
              <p className="text-sm text-accent tracking-[-0.35px]">
                No ticker could be determined from the CSV. Enter one manually, or leave blank.
              </p>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full table-fixed border-collapse">
                <colgroup>{UNMATCHED_COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
                <UnmatchedHead allChecked={allInstrumentsChecked} onToggleAll={toggleAllInstruments} />
                <tbody>
                  {unresolvedRows.map((row) => (
                    <tr key={row.instrument} className="border-b border-borderLight last:border-b-0">
                      <td className="h-11 p-0 align-middle border-r border-borderLight">
                        <div className="h-11 flex items-center justify-center">
                          <Checkbox checked={checkedInstruments.has(row.instrument)} onChange={() => toggleInstrument(row.instrument)} />
                        </div>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <input
                          type="text"
                          placeholder="e.g. AAA"
                          value={tickerOverrides.get(row.instrument) ?? ''}
                          onChange={(e) =>
                            setTickerOverrides((prev) => {
                              const next = new Map(prev)
                              next.set(row.instrument, e.target.value)
                              return next
                            })
                          }
                          maxLength={12}
                          className="w-full bg-transparent text-xs uppercase text-foreground placeholder:normal-case placeholder:text-accent focus:outline-none"
                        />
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs font-medium text-foreground">{row.instrument}</span>
                      </td>
                      <td className="h-11 p-0 align-middle border-r border-borderLight">
                        <div className="h-11">
                          <Dropdown
                            variant="cell"
                            portal
                            placeholder="—"
                            value={exchangeOverrides.get(row.instrument) ?? ''}
                            onChange={(v) =>
                              setExchangeOverrides((prev) => {
                                const next = new Map(prev)
                                next.set(row.instrument, v)
                                return next
                              })
                            }
                            options={exchangeDropdownOptions}
                          />
                        </div>
                      </td>
                      <td className="h-11 p-0 align-middle border-r border-borderLight">
                        <div className="h-11">
                          <Dropdown
                            variant="cell"
                            portal
                            value={unresolvedCategories.get(row.instrument) ?? 'stock'}
                            onChange={(v) =>
                              setUnresolvedCategories((prev) => {
                                const next = new Map(prev)
                                next.set(row.instrument, v as AssetCategory)
                                return next
                              })
                            }
                            options={categoryDropdownOptions}
                          />
                        </div>
                      </td>
                      <td className="h-11 px-3 align-middle border-r border-borderLight">
                        <span className="block truncate text-xs text-foreground text-right">{formatQty(row.totalQuantity)}</span>
                      </td>
                      <td className="h-11 px-3 align-middle">
                        <span className="block truncate text-xs font-medium text-foreground text-right">{formatPLN(row.avgCostPLN)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-sm text-accent tracking-[-0.35px]">
          Current price is set to the calculated average cost — update it manually after creation.
        </p>
      </div>

      {/* Footer */}
      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onSkip} className="w-20">Skip</Button>
        <Button
          variant="primary"
          disabled={checkedCount === 0}
          onClick={() =>
            onConfirm({
              checkedTickers,
              checkedInstruments,
              tickerOverrides,
              exchangeOverrides,
              matchedCategories,
              unresolvedCategories,
            })
          }
        >
          Create {checkedCount} holding{checkedCount !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  )
}

/** Shared header row for the two unmatched-instruments tables, with a master
 *  select-all checkbox in the first cell. */
function UnmatchedHead({ allChecked, onToggleAll }: { allChecked: boolean; onToggleAll: () => void }) {
  return (
    <thead>
      <tr className="bg-muted border-b border-borderLight">
        <th className="h-11 p-0 align-middle border-r border-borderLight">
          <div className="h-11 flex items-center justify-center">
            <Checkbox checked={allChecked} onChange={onToggleAll} />
          </div>
        </th>
        {UNMATCHED_HEADERS.slice(1).map((h, idx) => {
          const isLast = idx === UNMATCHED_HEADERS.length - 2
          return (
            <th
              key={idx}
              className={`h-11 px-3 align-middle ${h.align === 'right' ? 'text-right' : 'text-left'} ${!isLast ? 'border-r border-borderLight' : ''}`}
            >
              <span className="block truncate text-xs font-medium text-accent">{h.label}</span>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}

// ─────────────────────────────────────────
// Cost-basis sub-step
// ─────────────────────────────────────────

export function CostBasisStep({
  diffRows,
  onConfirm,
  onSkip,
}: {
  diffRows: CostBasisDiffRow[]
  onConfirm: () => void
  onSkip: () => void
}) {
  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
          Transaction data is available to calculate weighted-average cost bases for{' '}
          {diffRows.length} holding{diffRows.length !== 1 ? 's' : ''}. This will update their purchase prices.
        </p>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr className="bg-muted border-b border-borderLight">
                <th className="h-11 px-3 text-left align-middle border-r border-borderLight"><span className="block truncate text-xs font-medium text-accent">Holding</span></th>
                <th className="h-11 px-3 text-right align-middle border-r border-borderLight"><span className="block truncate text-xs font-medium text-accent">Current</span></th>
                <th className="h-11 px-3 text-right align-middle border-r border-borderLight"><span className="block truncate text-xs font-medium text-accent">Calculated</span></th>
                <th className="h-11 px-3 text-right align-middle"><span className="block truncate text-xs font-medium text-accent">Diff</span></th>
              </tr>
            </thead>
            <tbody>
              {diffRows.map((row) => {
                const diff = row.calculatedPricePLN - row.currentPricePLN
                const diffPct =
                  row.currentPricePLN > 0 ? (diff / row.currentPricePLN) * 100 : 0
                const diffColor =
                  diff > 0 ? 'text-positive' : diff < 0 ? 'text-negative' : 'text-accent'

                return (
                  <tr key={row.holdingId} className="border-b border-borderLight last:border-b-0">
                    <td className="h-11 px-3 align-middle border-r border-borderLight">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-10 shrink-0 text-xs font-medium text-foreground">{row.ticker}</span>
                        <span className="truncate text-xs text-foregroundMuted">{row.holdingName}</span>
                      </div>
                    </td>
                    <td className="h-11 px-3 align-middle border-r border-borderLight">
                      <span className="block truncate text-xs text-foregroundMuted text-right">{formatPLN(row.currentPricePLN)}</span>
                    </td>
                    <td className="h-11 px-3 align-middle border-r border-borderLight">
                      <span className="block truncate text-xs font-medium text-foreground text-right">{formatPLN(row.calculatedPricePLN)}</span>
                    </td>
                    <td className="h-11 px-3 align-middle">
                      <span className={`block truncate text-xs font-medium text-right ${diffColor}`}>
                        {diff > 0 ? '+' : ''}{formatPLN(diff)} ({diffPct > 0 ? '+' : ''}{diffPct.toFixed(1).replace('.', ',')}%)
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-sm text-accent tracking-[-0.35px]">
          Prices are per-unit, in PLN, weighted average across all buy transactions. Holdings
          without matching buy transactions are not affected.
        </p>
      </div>

      {/* Footer */}
      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onSkip} className="w-20">Skip</Button>
        <Button variant="primary" onClick={onConfirm}>
          Update {diffRows.length} holding{diffRows.length !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  )
}
