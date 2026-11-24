/**
 * CSVImportFlow — the mapping → preview → import steps of the CSV holdings import.
 *
 * The upload step and Modal wrapper are handled by UnifiedImportModal. Each step renders
 * as a self-contained white card (form body + bordered actions footer) so it sits
 * inside the modal's `card` chrome; the done step is a full-bleed success card.
 */
import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown'
import { exchangeOptions } from '@/domain/exchanges'
import { usePortfolio, type ImportAction } from '@/context/PortfolioContext'
import {
  applyMapping,
  matchHoldings,
  type ColumnMapping,
  type KnownFormat,
} from '@/importers/csvParser'
import { formatPLN, formatPLNDetail } from '@/utils/formatters'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Checkbox } from '@/components/ui/Checkbox'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { findMissingHoldings, wholeHolding, type MissingHolding } from '@/domain/missingHoldings'
import type { AccountType, AssetCategory, Holding } from '@/types'
import { AlertTriangle, CircleInfo } from '@/generated/icons'
import { buildSyncSummary, type SyncStats } from './doneSummary'
import { ImportDoneCard } from './ImportCards'
import { NotInFile, WrongAccountNote } from './NotInFile'
import { soldChoiceCloses, soldChoiceErrors, type SoldChoices } from './soldChoices'
import type { DevSeed } from './devSeed'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type CSVImportFlowProps = {
  accountId: string
  accountName: string
  accountType: AccountType
  headers: string[]
  rawRows: Record<string, string>[]
  detectedFormat: KnownFormat | null
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step, so
   *  the modal can drop its header for the full-bleed success card. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, CSVImportFlowDevState>
}

/** Dev-only seedable state for the `/dev` showcase. */
export type CSVImportFlowDevState = {
  category: AssetCategory
  previewRows: CSVPreviewRow[]
  missingHoldings: MissingHolding[]
  parseErrors: { row: number; reason: string }[]
  doneStats: SyncStats
}

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const CATEGORY_OPTIONS: { value: AssetCategory; label: string }[] = [
  { value: 'bond', label: 'Bond' },
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'cash', label: 'Cash' },
]

/**
 * Tint for the "Format detected" alert — mirrors the holding colour of the
 * mapped asset category (bonds = blue, equities = purple, …).
 */
const CATEGORY_ALERT: Record<AssetCategory, { bg: string; text: string }> = {
  bond:   { bg: 'bg-blueForeground',    text: 'text-blue' },
  stock:  { bg: 'bg-purpleForeground',  text: 'text-purple' },
  etf:    { bg: 'bg-purpleForeground',  text: 'text-purple' },
  crypto: { bg: 'bg-orangeForeground',  text: 'text-orange' },
  cash:   { bg: 'bg-neutralForeground', text: 'text-neutral' },
}

function defaultCategoryForAccount(type: AccountType): AssetCategory {
  switch (type) {
    case 'ike':
      return 'bond'
    case 'ikze':
      return 'etf'
    case 'brokerage':
      return 'stock'
    case 'crypto':
      return 'crypto'
    case 'savings':
      return 'cash'
  }
}

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required: boolean }[] = [
  { key: 'ticker', label: 'Ticker', required: true },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'purchasePrice', label: 'Purchase Price', required: true },
  { key: 'currentPrice', label: 'Current Price', required: true },
  { key: 'purchaseDate', label: 'Purchase Date', required: false },
]

const EXCHANGE_OPTIONS: DropdownOption[] = exchangeOptions({
  US: 'US',
  PL: 'PL',
  UK: 'UK (LSE)',
  XETRA: 'XETRA',
  NL: 'NL (Amsterdam)',
})

type RowAction = 'update' | 'new'
type PreviewRow = {
  action: RowAction
  holding: Holding
  existing?: Holding
}

/** Exported for dev fixtures. */
export type CSVPreviewRow = PreviewRow

function formatPriceDelta(oldVal: number, newVal: number): string {
  const delta = newVal - oldVal
  const prefix = delta > 0 ? '+' : ''
  return `${prefix}${delta.toFixed(2).replace('.', ',')}`
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

type Step = 'mapping' | 'preview' | 'done'

export function CSVImportFlow({
  accountId,
  accountName,
  accountType,
  headers,
  rawRows,
  detectedFormat,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
}: CSVImportFlowProps) {
  const { accounts, transactions, importHoldings, closeImportedHoldings } = usePortfolio()
  const account = accounts.find((a) => a.id === accountId)
  const [today] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  const [step, setStep] = useState<Step>(devSeed?.step ?? 'mapping')

  // Mapping state
  const [category, setCategory] = useState<AssetCategory>(() => devSeed?.state?.category ?? defaultCategoryForAccount(accountType))
  const [mappingTicker, setMappingTicker] = useState(() => detectedFormat?.mapping.ticker ?? '')
  const [mappingQuantity, setMappingQuantity] = useState(() => detectedFormat?.mapping.quantity ?? '')
  const [mappingPurchasePrice, setMappingPurchasePrice] = useState(() => detectedFormat?.mapping.purchasePrice ?? '')
  const [mappingCurrentPrice, setMappingCurrentPrice] = useState(() => detectedFormat?.mapping.currentPrice ?? '')
  const [mappingPurchaseDate, setMappingPurchaseDate] = useState(() => detectedFormat?.mapping.purchaseDate ?? '')

  // Preview state
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>(devSeed?.state?.previewRows ?? [])
  const [parseErrors, setParseErrors] = useState<{ row: number; reason: string }[]>(devSeed?.state?.parseErrors ?? [])
  const [selected, setSelected] = useState<Set<number>>(() => new Set((devSeed?.state?.previewRows ?? []).map((_, i) => i)))
  const [exchangeOverrides, setExchangeOverrides] = useState<Record<number, string>>({})
  // Holdings the file doesn't list. Kept unless marked as sold; never deleted.
  const [missingHoldings, setMissingHoldings] = useState<MissingHolding[]>(devSeed?.state?.missingHoldings ?? [])
  const [noOverlap, setNoOverlap] = useState(false)
  const [soldChoices, setSoldChoices] = useState<SoldChoices>({})

  // Done state
  const [doneStats, setDoneStats] = useState<SyncStats>(devSeed?.state?.doneStats ?? { updated: 0, added: 0, closed: 0 })

  // Tell the parent modal when we're on the full-bleed success card (no header).
  useEffect(() => {
    onDoneChange?.(step === 'done')
  }, [step, onDoneChange])

  // ─── Mapping ──────────────────────────

  const requiredMapped =
    mappingTicker !== '' &&
    mappingQuantity !== '' &&
    mappingPurchasePrice !== '' &&
    mappingCurrentPrice !== ''

  function handlePreviewImport() {
    const userMapping: ColumnMapping = {
      ticker: mappingTicker,
      quantity: mappingQuantity,
      purchasePrice: mappingPurchasePrice,
      currentPrice: mappingCurrentPrice,
      purchaseDate: mappingPurchaseDate || undefined,
    }

    const isDetectedMapping = detectedFormat &&
      mappingTicker === detectedFormat.mapping.ticker &&
      mappingQuantity === detectedFormat.mapping.quantity &&
      mappingPurchasePrice === detectedFormat.mapping.purchasePrice &&
      mappingCurrentPrice === detectedFormat.mapping.currentPrice

    const transforms = isDetectedMapping ? detectedFormat?.transform : undefined
    const { holdings, errors } = applyMapping(rawRows, userMapping, transforms, category, accountId)
    setParseErrors(errors)

    // Synthetic holdings (e.g. the derived Cash row) are managed from the
    // transaction log and are never listed as missing.
    const existingHoldings = (account?.holdings ?? []).filter((h) => !h.isSynthetic)
    const result = matchHoldings(existingHoldings, holdings)
    // A holdings CSV lists everything held, so what it lacks may be sold. It
    // has no statement date, so nothing is ruled out by purchase date.
    const missing = findMissingHoldings(
      existingHoldings,
      new Set(result.toUpdate.map(({ existing }) => existing.id)),
      holdings.length > 0,
    )

    const rows: PreviewRow[] = [
      ...result.toUpdate.map(({ existing, parsed }) => ({ action: 'update' as const, holding: parsed, existing })),
      ...result.toAdd.map((h) => ({ action: 'new' as const, holding: h })),
    ]
    setPreviewRows(rows)
    setMissingHoldings(missing.missing.map(wholeHolding))
    setNoOverlap(missing.noOverlap)
    setSoldChoices({})
    setSelected(new Set(rows.map((_, i) => i)))
    setStep('preview')
  }

  // ─── Preview ──────────────────────────

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const selectedCount = selected.size
  const closeCount = Object.keys(soldChoices).length

  const showExchangeColumn = category !== 'bond'

  const soldErrors = useMemo(
    () => soldChoiceErrors(soldChoices, missingHoldings, account, transactions, today),
    [soldChoices, missingHoldings, account, transactions, today],
  )
  const soldInvalid = Object.values(soldErrors).some((e) => e.date || e.amount || e.sharedWith)

  const selectedCounts = useMemo(() => {
    let updates = 0, adds = 0
    previewRows.forEach((row, i) => {
      if (!selected.has(i)) return
      if (row.action === 'update') updates++
      else if (row.action === 'new') adds++
    })
    return { updates, adds }
  }, [previewRows, selected])

  const footerCounter = useMemo(() => {
    const parts: string[] = []
    if (selectedCounts.updates > 0) parts.push(`${selectedCounts.updates} update${selectedCounts.updates !== 1 ? 's' : ''}`)
    if (selectedCounts.adds > 0) parts.push(`${selectedCounts.adds} new`)
    if (closeCount > 0) parts.push(`${closeCount} to close`)
    return previewRows.length > 0 ? `${parts.join(', ')} — ${selectedCount} selected` : parts.join(', ')
  }, [selectedCounts, selectedCount, closeCount, previewRows.length])

  function handleImport() {
    const actions: ImportAction[] = []

    previewRows.forEach((row, i) => {
      if (!selected.has(i) || row.action !== 'update' || !row.existing) return
      actions.push({ type: 'update', existingId: row.existing.id, quantity: row.holding.quantity, currentPrice: row.holding.currentPrice })
    })
    previewRows.forEach((row, i) => {
      if (!selected.has(i) || row.action !== 'new') return
      // Bonds don't belong to an exchange — never store one for them.
      const exchange = row.holding.category === 'bond'
        ? undefined
        : (exchangeOverrides[i] ?? row.holding.exchange) || undefined
      actions.push({
        type: 'add',
        holding: {
          name: row.holding.name,
          ticker: row.holding.ticker || undefined,
          exchange,
          category: row.holding.category,
          quantity: row.holding.quantity,
          purchasePrice: row.holding.purchasePrice,
          currentPrice: row.holding.currentPrice,
          purchaseDate: row.holding.purchaseDate,
        },
      })
    })

    const stats = actions.length > 0 ? importHoldings(accountId, actions) : { updated: 0, added: 0 }
    const closed = closeImportedHoldings(accountId, soldChoiceCloses(soldChoices, missingHoldings), transactions)
    setDoneStats({ ...stats, closed: closed.length })
    setStep('done')
  }

  // ─── Done ─────────────────────────────

  const doneMessage = useMemo(
    () => buildSyncSummary(doneStats, accountName),
    [doneStats, accountName],
  )

  // ─── Render ───────────────────────────

  const allSelected = selectedCount === previewRows.length && previewRows.length > 0

  // ── Mapping Step ────────────────────────
  if (step === 'mapping') {
    return (
      <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
        <div className="p-5 flex flex-col gap-5">
          <Dropdown
            label="Asset Category"
            value={category}
            onChange={(v) => setCategory(v as AssetCategory)}
            options={CATEGORY_OPTIONS}
            portal
          />

          <FormatAlert detectedFormat={detectedFormat} category={category} />

          {/* Field → CSV column mapping table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="flex bg-muted border-b border-borderLight">
              <div className="w-36 h-11 flex items-center px-3 border-r border-borderLight">
                <span className="text-xs font-medium text-accent">Field</span>
              </div>
              <div className="flex-1 h-11 flex items-center px-3">
                <span className="text-xs font-medium text-accent">CSV Column</span>
              </div>
            </div>
            {MAPPING_FIELDS.map((field) => {
              const value =
                field.key === 'ticker' ? mappingTicker :
                field.key === 'quantity' ? mappingQuantity :
                field.key === 'purchasePrice' ? mappingPurchasePrice :
                field.key === 'currentPrice' ? mappingCurrentPrice :
                mappingPurchaseDate

              const setter =
                field.key === 'ticker' ? setMappingTicker :
                field.key === 'quantity' ? setMappingQuantity :
                field.key === 'purchasePrice' ? setMappingPurchasePrice :
                field.key === 'currentPrice' ? setMappingCurrentPrice :
                setMappingPurchaseDate

              return (
                <div key={field.key} className="flex border-b border-borderLight last:border-b-0">
                  <div className="w-36 h-11 flex items-center px-3 border-r border-borderLight">
                    <span className="text-xs font-medium text-foregroundMuted">
                      {field.label}
                      {field.required && <span className="text-blue ml-0.5">∗</span>}
                    </span>
                  </div>
                  <div className="flex-1 flex">
                    <Dropdown
                      variant="cell"
                      portal
                      placeholder="None"
                      value={value}
                      onChange={setter}
                      options={[
                        { value: '', label: 'None' },
                        ...headers.map((h): DropdownOption => ({ value: h, label: h })),
                      ]}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t border-borderLight p-5 flex items-center gap-2">
          <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">
            {rawRows.length} data row{rawRows.length !== 1 ? 's' : ''} found in CSV
          </p>
          <Button variant="secondary" onClick={onBack} className="w-20">Back</Button>
          <Button variant="primary" onClick={handlePreviewImport} disabled={!requiredMapped}>Preview Import</Button>
        </div>
      </div>
    )
  }

  // ── Preview Step ────────────────────────
  if (step === 'preview') {
    return (
      <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
        <div className="p-5 flex flex-col gap-3">
          {parseErrors.length > 0 && <ParseErrorAlert errors={parseErrors} />}

          {noOverlap && (
            <InlineAlert variant="warning"><WrongAccountNote accountName={accountName} /></InlineAlert>
          )}

          {previewRows.length === 0 && missingHoldings.length === 0 ? (
            <p className="text-sm text-accent text-center py-6">No changes detected. Your holdings are already up to date.</p>
          ) : previewRows.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Scrolls horizontally; the Details column hugs its widest cell
                  rather than wrapping. Fixed-width leading columns; the cell
                  selects are portalled so the scroll container can't clip them. */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted border-b border-borderLight">
                      <th className="w-11 h-11 p-0 align-middle border-r border-borderLight">
                        <div className="w-11 h-11 flex items-center justify-center">
                          <Checkbox
                            checked={allSelected}
                            onChange={() => {
                              if (allSelected) setSelected(new Set())
                              else setSelected(new Set(previewRows.map((_, i) => i)))
                            }}
                          />
                        </div>
                      </th>
                      <th className="w-28 h-11 px-3 align-middle border-r border-borderLight"><span className="text-xs font-medium text-accent">Status</span></th>
                      <th className="w-28 h-11 px-3 align-middle border-r border-borderLight"><span className="text-xs font-medium text-accent">Ticker</span></th>
                      {showExchangeColumn && (
                        <th className="w-28 h-11 px-3 align-middle border-r border-borderLight"><span className="text-xs font-medium text-accent">Exchange</span></th>
                      )}
                      <th className="h-11 px-3 align-middle"><span className="text-xs font-medium text-accent">Details</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr
                        key={`${row.action}-${row.holding.id}`}
                        className={`border-b border-borderLight last:border-b-0 ${!selected.has(i) ? 'opacity-40' : ''}`}
                      >
                        <td className="w-11 h-11 p-0 align-middle border-r border-borderLight">
                          <div className="w-11 h-11 flex items-center justify-center">
                            <Checkbox checked={selected.has(i)} onChange={() => toggleRow(i)} />
                          </div>
                        </td>
                        <td className="w-28 h-11 px-3 align-middle border-r border-borderLight"><StatusBadge action={row.action} /></td>
                        <td className="w-28 h-11 px-3 align-middle border-r border-borderLight">
                          <span className="text-xs text-foreground whitespace-nowrap">{row.holding.ticker || '—'}</span>
                        </td>
                        {showExchangeColumn && (
                          row.action === 'new' ? (
                            <td className="w-28 h-11 p-0 align-middle border-r border-borderLight">
                              <div className="h-11">
                                <Dropdown
                                  variant="cell"
                                  portal
                                  placeholder="—"
                                  value={exchangeOverrides[i] ?? row.holding.exchange ?? ''}
                                  onChange={(v) => setExchangeOverrides((prev) => ({ ...prev, [i]: v }))}
                                  options={EXCHANGE_OPTIONS}
                                />
                              </div>
                            </td>
                          ) : (
                            <td className="w-28 h-11 px-3 align-middle border-r border-borderLight">
                              <span className="text-xs text-accent whitespace-nowrap">{row.holding.exchange || '—'}</span>
                            </td>
                          )
                        )}
                        <td className="h-11 px-3 align-middle whitespace-nowrap"><RowDetails row={row} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <NotInFile
            missing={missingHoldings}
            choices={soldChoices}
            onChange={setSoldChoices}
            errors={soldErrors}
            today={today}
          />
        </div>

        <div className="border-t border-borderLight p-5 flex items-center gap-2">
          <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">{footerCounter}</p>
          <Button variant="secondary" onClick={() => setStep('mapping')} className="w-20">Back</Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={(selectedCount === 0 && closeCount === 0) || soldInvalid}
          >
            {selectedCount > 0 ? `Import ${selectedCount} Selected` : 'Import'}
          </Button>
        </div>
      </div>
    )
  }

  // ── Done Step ───────────────────────────
  return (
    <ImportDoneCard
      message={doneMessage}
      detail="Holdings have been synced with the latest CSV data."
      onDone={() => onComplete(doneMessage)}
    />
  )
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

/** "Format detected / not recognised" banner. The detected variant is tinted by
 *  the mapped asset category's holding colour. */
function FormatAlert({ detectedFormat, category }: { detectedFormat: KnownFormat | null; category: AssetCategory }) {
  if (detectedFormat) {
    const c = CATEGORY_ALERT[category]
    return (
      <div className={`flex items-center gap-3 p-3 rounded-lg ${c.bg}`}>
        <p className={`flex-1 text-sm tracking-[-0.35px] ${c.text}`}>Format detected: {detectedFormat.name}</p>
        <CircleInfo size={20} className={`shrink-0 ${c.text}`} />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-warningForeground">
      <p className="flex-1 text-sm text-warning tracking-[-0.35px]">Format not recognised. Please map columns manually.</p>
      <AlertTriangle size={20} className="shrink-0 text-warning" />
    </div>
  )
}

/** Stacked red banner listing rows that failed to parse. Each row is a solid
 *  negativeForeground band split by a 1px white (surface) divider. */
function ParseErrorAlert({ errors }: { errors: { row: number; reason: string }[] }) {
  return (
    <div className="rounded-lg overflow-hidden flex flex-col">
      <div className="flex items-center gap-3 bg-negativeForeground border-b border-surface p-3">
        <p className="flex-1 text-sm text-negative tracking-[-0.35px]">
          {errors.length} row{errors.length !== 1 ? 's' : ''} had errors
        </p>
        <CircleInfo size={20} className="shrink-0 text-negative" />
      </div>
      {errors.map((err) => (
        <div key={err.row} className="bg-negativeForeground border-b border-surface last:border-b-0 p-3">
          <p className="text-sm text-negative tracking-[-0.35px]">Row {err.row}: {err.reason}</p>
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ action }: { action: RowAction }) {
  switch (action) {
    case 'update':
      return <Badge variant="blue">Update</Badge>
    case 'new':
      return <Badge variant="positive">New</Badge>
  }
}

function RowDetails({ row }: { row: PreviewRow }) {
  const { action, holding, existing } = row

  if (action === 'new') {
    return (
      <span className="text-xs text-foregroundMuted tracking-[-0.35px]">
        {holding.quantity} units × {formatPLNDetail(holding.currentPrice)}
      </span>
    )
  }

  if (!existing) return null
  const qtyChanged = existing.quantity !== holding.quantity
  const priceDelta = holding.currentPrice - existing.currentPrice

  return (
    <span className="text-xs text-foregroundMuted tracking-[-0.35px]">
      Qty:{' '}
      {qtyChanged ? (
        <>
          {existing.quantity}
          <span className="text-accent mx-0.5">→</span>
          {holding.quantity}
        </>
      ) : (
        holding.quantity
      )}
      <span className="text-accent mx-1.5">·</span>
      Price: {formatPLN(existing.currentPrice)}
      <span className="text-accent mx-0.5">→</span>
      {formatPLN(holding.currentPrice)}
      {priceDelta !== 0 && (
        <span className={`ml-1 ${priceDelta > 0 ? 'text-positive' : 'text-negative'}`}>
          ({formatPriceDelta(existing.currentPrice, holding.currentPrice)})
        </span>
      )}
    </span>
  )
}
