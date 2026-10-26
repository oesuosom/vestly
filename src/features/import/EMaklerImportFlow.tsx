/**
 * EMaklerImportFlow — the processing → preview → import steps of the eMakler import.
 *
 * The upload step, file detection, and Modal wrapper are handled by
 * UnifiedImportModal.
 */
import { useEffect, useMemo, useState } from 'react'
import { usePortfolio, type ImportAction } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import {
  parseEMaklerOrderHistory,
  parseEMaklerPortfolio,
  type EMaklerOrderRow,
  type EMaklerPortfolioRow,
} from '@/importers/eMaklerParser'
import {
  buildEMaklerImport,
  loadEMaklerOrderKeys,
  saveEMaklerOrderKeys,
  type EMaklerHoldingResult,
  type EMaklerImportResult,
} from '@/importers/eMaklerImport'
import { formatPLN } from '@/utils/formatters'
import { staticLookupInstrument } from '@/domain/instrumentLookup'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Dropdown } from '@/components/ui/Dropdown'
import type { Holding, Settings, Transaction } from '@/types'
import { CircleInfo } from '@/generated/icons'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { buildSyncSummary } from './doneSummary'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import type { DevSeed } from './devSeed'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type EMaklerImportFlowProps = {
  accountId: string
  accountName: string
  /** Already-classified files. At least one must be portfolio or order_history. */
  files: { file: File; type: 'portfolio' | 'order_history' }[]
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step, so
   *  the modal can drop its header for the full-bleed success card. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, EMaklerImportFlowDevState>
}

type Step = 'processing' | 'preview' | 'done'

type RowAction = 'update' | 'add' | 'remove'

type PreviewRow = {
  action: RowAction
  importHolding?: EMaklerHoldingResult
  existingHolding?: Holding
}

/** Exported for dev fixtures. */
export type EMaklerPreviewRow = PreviewRow

/** Dev-only seedable state for the `/dev` showcase. */
export type EMaklerImportFlowDevState = {
  importResult: EMaklerImportResult
  previewRows: EMaklerPreviewRow[]
  ordersOnlyMode: boolean
  doneStats: { updated: number; added: number; removed: number }
}

const CATEGORY_OPTIONS: { value: 'stock' | 'etf'; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
]

/** Preview table column widths (px) — taken verbatim from Figma. Their sum
 *  exceeds the modal width, so the table scrolls horizontally. */
const PREVIEW_COLUMNS: { label: string; width: number; align?: 'right' }[] = [
  { label: 'Status', width: 112 },
  { label: 'Name', width: 176 },
  { label: 'Exchange', width: 64 },
  { label: 'Ticker', width: 112 },
  { label: 'Qty', width: 64 },
  { label: 'Purchase (PLN)', width: 128, align: 'right' },
  { label: 'Current (PLN)', width: 128, align: 'right' },
  { label: 'Category', width: 112 },
]
const PREVIEW_TABLE_WIDTH = PREVIEW_COLUMNS.reduce((sum, c) => sum + c.width, 0)

type ProcessOutcome =
  | { error: string }
  | { result: EMaklerImportResult; orderRows: EMaklerOrderRow[]; ordersOnlyMode: boolean }

/** Parses the selected files and builds the import. Never rejects — failures come back as `{ error }`. */
async function processEMaklerFiles(
  files: EMaklerImportFlowProps['files'],
  settings: Settings,
  forceFresh: boolean,
): Promise<ProcessOutcome> {
  try {
    const portfolioFile = files.find((f) => f.type === 'portfolio')?.file
    const orderFile = files.find((f) => f.type === 'order_history')?.file

    let portfolioRows: EMaklerPortfolioRow[] = []
    let orderRows: EMaklerOrderRow[] = []

    if (portfolioFile) {
      portfolioRows = await parseEMaklerPortfolio(portfolioFile)
    }
    if (orderFile) {
      orderRows = await parseEMaklerOrderHistory(orderFile)
    }

    if (portfolioRows.length === 0 && orderRows.length === 0) {
      return { error: 'No data could be parsed from the selected files. Please check the files and try again.' }
    }

    const existingKeys = forceFresh ? new Set<string>() : loadEMaklerOrderKeys()
    const result = await buildEMaklerImport(portfolioRows, orderRows, existingKeys, settings)
    return { result, orderRows, ordersOnlyMode: portfolioRows.length === 0 && orderRows.length > 0 }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred during processing.' }
  }
}

/** Pre-populate ticker inputs from the static instrument lookup, keyed by holding index. */
function initialTickerInputs(result: EMaklerImportResult): Record<number, string> {
  const initial: Record<number, string> = {}
  result.holdings.forEach((h, i) => {
    const resolved = staticLookupInstrument(h.name)
    if (resolved?.ticker) initial[i] = resolved.ticker
  })
  return initial
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function EMaklerImportFlow({
  accountId,
  accountName,
  files,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
}: EMaklerImportFlowProps) {
  const { accounts, importHoldings, importTransactions } = usePortfolio()
  const settings = useSettings()

  // Wizard state
  const [step, setStep] = useState<Step>(devSeed?.step ?? 'processing')
  const [processingError, setProcessingError] = useState<string | null>(null)

  // Import result
  const [importResult, setImportResult] = useState<EMaklerImportResult | null>(devSeed?.state?.importResult ?? null)
  const [allOrderRows, setAllOrderRows] = useState<EMaklerOrderRow[]>([])
  const [ordersOnlyMode, setOrdersOnlyMode] = useState(devSeed?.state?.ordersOnlyMode ?? false)

  // Per-row overrides
  const [categoryOverrides, setCategoryOverrides] = useState<Record<number, 'stock' | 'etf'>>({})
  const [purchasePriceInputs, setPurchasePriceInputs] = useState<Record<number, string>>({})
  const [tickerInputs, setTickerInputs] = useState<Record<number, string>>(() =>
    devSeed?.state?.importResult ? initialTickerInputs(devSeed.state.importResult) : {},
  )

  // Done
  const [doneStats, setDoneStats] = useState(devSeed?.state?.doneStats ?? { updated: 0, added: 0, removed: 0 })

  // Tell the parent modal when we're on the full-bleed success card (no header).
  useEffect(() => {
    onDoneChange?.(step === 'done')
  }, [step, onDoneChange])

  // ─── Processing ────────────────────────

  // Applies a processing outcome. Only ever called from a promise callback, so
  // the mount effect below never sets state synchronously.
  function applyProcessed(outcome: ProcessOutcome) {
    if ('error' in outcome) {
      setProcessingError(outcome.error)
      return
    }
    setAllOrderRows(outcome.orderRows)
    setOrdersOnlyMode(outcome.ordersOnlyMode)
    setImportResult(outcome.result)
    setTickerInputs(initialTickerInputs(outcome.result))
    setStep('preview')
  }

  function handleReimport() {
    setStep('processing')
    setProcessingError(null)
    void processEMaklerFiles(files, settings, true).then(applyProcessed)
  }

  // Auto-process on mount
  useEffect(() => {
    if (devSeed) return // dev showcase: state is pre-seeded, skip parsing
    void processEMaklerFiles(files, settings, false).then(applyProcessed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Preview rows (sync against existing) ─────────

  const existingHoldings = useMemo(() => {
    const account = accounts.find((a) => a.id === accountId)
    return (account?.holdings ?? []).filter((h) => !h.isSynthetic)
  }, [accounts, accountId])

  const computedPreviewRows = useMemo((): PreviewRow[] => {
    if (!importResult) return []

    const rows: PreviewRow[] = []
    const importedKeys = new Set<string>()

    for (const h of importResult.holdings) {
      const key = `${h.name.toLowerCase()}|${h.exchange}`
      importedKeys.add(key)

      const existing = existingHoldings.find(
        (e) =>
          e.name.toLowerCase() === h.name.toLowerCase() &&
          e.exchange === h.exchange,
      )

      rows.push({
        action: existing ? 'update' : 'add',
        importHolding: h,
        existingHolding: existing,
      })
    }

    for (const e of existingHoldings) {
      const key = `${e.name.toLowerCase()}|${e.exchange}`
      if (!importedKeys.has(key)) {
        rows.push({ action: 'remove', existingHolding: e })
      }
    }

    return rows
  }, [importResult, existingHoldings])

  // Dev showcase can inject a mixed add/update/remove preview directly.
  const previewRows = devSeed?.state?.previewRows ?? computedPreviewRows

  const counts = useMemo(() => {
    let updates = 0; let adds = 0; let removes = 0; let missingCostBasis = 0
    for (const row of previewRows) {
      if (row.action === 'update') updates++
      else if (row.action === 'add') adds++
      else if (row.action === 'remove') removes++
      if (row.importHolding?.status === 'missing_cost_basis') missingCostBasis++
    }
    return { updates, adds, removes, missingCostBasis }
  }, [previewRows])

  const footerCounter = useMemo(() => {
    const parts: string[] = []
    if (counts.updates > 0) parts.push(`${counts.updates} update${counts.updates !== 1 ? 's' : ''}`)
    if (counts.adds > 0) parts.push(`${counts.adds} new`)
    if (counts.removes > 0) parts.push(`${counts.removes} removal${counts.removes !== 1 ? 's' : ''}`)
    if (counts.missingCostBasis > 0) parts.push(`${counts.missingCostBasis} missing cost basis`)
    if (importResult && importResult.duplicatesSkipped > 0) {
      parts.push(`${importResult.duplicatesSkipped} duplicate order${importResult.duplicatesSkipped !== 1 ? 's' : ''} skipped`)
    }
    return parts.join(', ')
  }, [counts, importResult])

  // ─── Confirm import ───────────────────

  function handleConfirm() {
    if (!importResult) return

    const actions: ImportAction[] = []

    for (let i = 0; i < previewRows.length; i++) {
      const row = previewRows[i]

      if (row.action === 'remove' && row.existingHolding) {
        actions.push({ type: 'remove', holdingId: row.existingHolding.id })
        continue
      }

      if (!row.importHolding) continue

      const h = row.importHolding
      const category = categoryOverrides[i] ?? h.category

      let purchasePricePLN = h.purchasePrice
      if (h.status === 'missing_cost_basis' && purchasePriceInputs[i]) {
        const parsed = parseFloat(purchasePriceInputs[i].replace(',', '.'))
        if (!isNaN(parsed) && parsed > 0) purchasePricePLN = parsed
      }

      if (row.action === 'update' && row.existingHolding) {
        actions.push({
          type: 'update',
          existingId: row.existingHolding.id,
          quantity: h.quantity,
          currentPrice: h.currentPrice,
        })
      } else {
        const ticker = tickerInputs[i]?.trim().toUpperCase() || undefined
        actions.push({
          type: 'add',
          holding: {
            name: h.name,
            ticker,
            exchange: h.exchange,
            category,
            quantity: h.quantity,
            purchasePrice: purchasePricePLN,
            currentPrice: h.currentPrice,
            purchaseDate: h.purchaseDate,
          },
        })
      }
    }

    const stats = importHoldings(accountId, actions)
    setDoneStats(stats)

    // Create transaction records for executed orders (buys and sells)
    if (importResult.transactions.length > 0) {
      const txns: Transaction[] = importResult.transactions.map((t) => ({
        id: crypto.randomUUID(),
        accountId,
        type: t.side,
        date: t.date,
        amountPLN: t.amountPLN,
        instrument: t.name,
        exchange: t.exchange,
        quantity: t.quantity,
        pricePerUnitPLN: t.pricePerUnitPLN,
        originalCurrency: t.originalCurrency,
        pricePerUnitOriginal: t.pricePerUnitOriginal,
        externalId: t.deduplicationKey,
        source: 'emakler_import' as const,
        createdAt: new Date().toISOString(),
      }))
      importTransactions(txns, accountId)
    }

    // Persist processed order deduplication keys
    const stored = loadEMaklerOrderKeys()
    for (const order of allOrderRows) {
      stored.add(order.deduplicationKey)
    }
    saveEMaklerOrderKeys(stored)

    setStep('done')
  }

  // ─── Done close ────────────────────────

  function handleDoneClose() {
    onComplete(buildSyncSummary(doneStats, accountName))
  }

  // ─── Render ────────────────────────────

  // Processing error — show error with back button
  if (processingError) {
    return (
      <ImportErrorCard
        message={processingError}
        onBack={onBack}
      />
    )
  }

  // Step: Processing
  if (step === 'processing') {
    return (
      <ImportSpinnerCard
        message="Parsing files and fetching NBP exchange rates…"
        detail="This may take a few seconds for foreign-currency holdings."
      />
    )
  }

  // Step: Preview
  if (step === 'preview' && importResult) {
    return (
      <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
        <div className="p-5 flex flex-col gap-5">
          {/* Orders-only banner */}
          {ordersOnlyMode && (
            <InlineAlert variant="warning">
              Only order history was provided — current prices are unknown and will be set to 0.
              Use the price refresh on Home after import to populate them.
            </InlineAlert>
          )}

          {/* Warnings */}
          {importResult.warnings.map((w, i) => (
            <InlineAlert key={i} variant="warning">{w}</InlineAlert>
          ))}

          {/* Table */}
          {previewRows.length === 0 ? (
            <p className="text-sm text-accent text-center py-6">
              No changes detected — your holdings are already up to date.
            </p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Fixed Figma column widths (via colgroup); the table is wider than
                  the modal, so it scrolls horizontally. Headers/labels never wrap. */}
              <div className="overflow-x-auto">
                <table className="table-fixed border-collapse" style={{ width: PREVIEW_TABLE_WIDTH }}>
                  <colgroup>
                    {PREVIEW_COLUMNS.map((c) => (
                      <col key={c.label} style={{ width: c.width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-muted border-b border-borderLight">
                      {PREVIEW_COLUMNS.map((c, idx) => (
                        <th
                          key={c.label}
                          className={`h-11 px-3 align-middle ${c.align === 'right' ? 'text-right' : 'text-left'} ${idx < PREVIEW_COLUMNS.length - 1 ? 'border-r border-borderLight' : ''}`}
                        >
                          <span className="block truncate text-xs font-medium text-accent">{c.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => {
                      const h = row.importHolding
                      const fxTitle =
                        h && h.priceCurrency !== 'PLN' && h.nbpRateUsed > 0
                          ? `${h.originalPurchasePrice.toFixed(2).replace('.', ',')} ${h.priceCurrency} @ NBP ${h.nbpRateUsed.toFixed(4).replace('.', ',')} (${h.purchaseDate})`
                          : undefined
                      // Remove rows read as disabled: dim every cell but the status badge.
                      const dim = row.action === 'remove' ? 'opacity-50' : ''
                      return (
                        <tr key={i} className="border-b border-borderLight last:border-b-0">
                          {/* Status */}
                          <td className="h-11 px-3 align-middle border-r border-borderLight">
                            <StatusBadge action={row.action} />
                          </td>

                          {/* Name */}
                          <td className={`h-11 px-3 align-middle border-r border-borderLight ${dim}`}>
                            <div className="truncate text-xs text-foreground">
                              {row.action === 'remove' ? row.existingHolding?.name : h?.name}
                            </div>
                          </td>

                          {/* Exchange */}
                          <td className={`h-11 px-3 align-middle border-r border-borderLight ${dim}`}>
                            <span className={`block truncate text-xs ${row.action === 'remove' ? 'text-foreground' : 'text-accent'}`}>
                              {(row.action === 'remove' ? row.existingHolding?.exchange : h?.exchange) ?? '—'}
                            </span>
                          </td>

                          {/* Ticker */}
                          {row.action === 'add' ? (
                            <td className="h-11 px-3 align-middle border-r border-borderLight">
                              <input
                                type="text"
                                placeholder="e.g. AAA"
                                value={tickerInputs[i] ?? ''}
                                onChange={(e) => setTickerInputs((prev) => ({ ...prev, [i]: e.target.value }))}
                                maxLength={12}
                                className="w-full bg-transparent text-xs uppercase text-foreground placeholder:normal-case placeholder:text-accent focus:outline-none"
                              />
                            </td>
                          ) : (
                            <td className={`h-11 px-3 align-middle border-r border-borderLight ${dim}`}>
                              <span className={`block truncate text-xs ${row.action === 'remove' ? 'text-foreground' : 'text-accent'}`}>{row.existingHolding?.ticker ?? '—'}</span>
                            </td>
                          )}

                          {/* Qty */}
                          <td className={`h-11 px-3 align-middle border-r border-borderLight ${dim}`}>
                            <span className="block truncate text-xs text-foreground">
                              {row.action === 'remove' ? row.existingHolding?.quantity ?? '—' : h?.quantity}
                            </span>
                          </td>

                          {/* Purchase price */}
                          {row.action === 'remove' ? (
                            <td className={`h-11 px-3 align-middle border-r border-borderLight ${dim}`}>
                              <span className="block truncate text-xs text-foreground text-right">
                                {row.existingHolding ? formatPLN(row.existingHolding.purchasePrice) : '—'}
                              </span>
                            </td>
                          ) : h?.status === 'missing_cost_basis' ? (
                            <td className="h-11 px-3 align-middle border-r border-borderLight relative">
                              <CostBasisMarker />
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Enter"
                                  value={purchasePriceInputs[i] ?? ''}
                                  onChange={(e) =>
                                    setPurchasePriceInputs((prev) => ({
                                      ...prev,
                                      // Numbers only: digits and a single decimal separator.
                                      [i]: e.target.value.replace(/[^0-9.,]/g, ''),
                                    }))
                                  }
                                  className="min-w-0 flex-1 bg-transparent text-xs text-right text-foreground placeholder:text-accent focus:outline-none"
                                />
                                <span className="shrink-0 text-xs text-accent">PLN</span>
                              </div>
                            </td>
                          ) : (
                            <td className="h-11 px-3 align-middle border-r border-borderLight" title={fxTitle}>
                              <div className="flex items-center gap-1">
                                {fxTitle && <CircleInfo size={16} className="shrink-0 text-accent" />}
                                <span className="flex-1 min-w-0 truncate text-xs text-foreground text-right">
                                  {h ? formatPLN(h.purchasePrice) : '—'}
                                </span>
                              </div>
                            </td>
                          )}

                          {/* Current price */}
                          <td className={`h-11 px-3 align-middle border-r border-borderLight ${dim}`}>
                            <span className="block truncate text-xs text-foreground text-right">
                              {row.action === 'remove'
                                ? row.existingHolding ? formatPLN(row.existingHolding.currentPrice) : '—'
                                : ordersOnlyMode ? '—' : h ? formatPLN(h.currentPrice) : '—'}
                            </span>
                          </td>

                          {/* Category */}
                          {row.action === 'remove' ? (
                            <td className={`h-11 px-3 align-middle ${dim}`}>
                              <span className="block truncate text-xs text-foreground capitalize">{row.existingHolding?.category ?? '—'}</span>
                            </td>
                          ) : (
                            <td className="h-11 p-0 align-middle">
                              <div className="h-11">
                                <Dropdown
                                  variant="cell"
                                  portal
                                  value={categoryOverrides[i] ?? h?.category ?? 'stock'}
                                  onChange={(v) => setCategoryOverrides((prev) => ({ ...prev, [i]: v as 'stock' | 'etf' }))}
                                  options={CATEGORY_OPTIONS}
                                />
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Missing cost basis note */}
          {counts.missingCostBasis > 0 && (
            <p className="text-sm text-accent tracking-[-0.35px]">
              Marked holdings have no order-history match. Enter a purchase price in PLN, or leave
              blank to import with zero cost basis and update it later.
            </p>
          )}
        </div>

        <div className="border-t border-borderLight p-5 flex items-center gap-2">
          <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">{footerCounter}</p>
          {importResult.duplicatesSkipped > 0 && (
            <Button variant="secondary" onClick={handleReimport}>Reimport All</Button>
          )}
          <Button variant="secondary" onClick={onBack} className="w-20">Back</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={previewRows.length === 0}>
            Confirm Import
          </Button>
        </div>
      </div>
    )
  }

  // Step: Done
  if (step === 'done') {
    return (
      <ImportDoneCard
        message={buildSyncSummary(doneStats, accountName)}
        detail="eMakler holdings are now in sync."
        onDone={handleDoneClose}
      />
    )
  }

  return null
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

/** Small rounded-corner marker (Figma) flagging a missing-cost-basis cell. */
function CostBasisMarker() {
  return (
    <svg
      className="absolute left-1 top-1 text-negative"
      width="7"
      height="7"
      viewBox="0 0 6.58779 6.58779"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.58579 0H4C1.79086 0 0 1.79086 0 4V5.58579C0 6.47669 1.07714 6.92286 1.70711 6.29289L6.29289 1.70711C6.92286 1.07714 6.47669 0 5.58579 0Z"
        fill="currentColor"
      />
    </svg>
  )
}

function StatusBadge({ action }: { action: RowAction }) {
  switch (action) {
    case 'update':
      return <Badge variant="blue">Update</Badge>
    case 'add':
      return <Badge variant="positive">New</Badge>
    case 'remove':
      return <Badge variant="negative">Remove</Badge>
  }
}
