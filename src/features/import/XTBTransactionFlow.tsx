/**
 * XTBTransactionFlow — the parse → preview → import → unmatched → cost-basis
 * steps of the XTB Cash Operations import.
 *
 * The file upload and Modal wrapper are handled by UnifiedImportModal.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { parseXTBCashOperations, type ParseResult } from '@/importers/xtbParser'
import { StatementCurrencyError } from '@/importers/xtbStatement'
import type {
  CostBasisDiffRow,
  UnmatchedRow,
  UnresolvedRow,
} from '@/importers/xtbPostProcessing'
import { usePortfolio } from '@/context/PortfolioContext'
import { formatDate, formatQuantity } from '@/utils/formatters'
import { useSettings } from '@/context/SettingsContext'
import { ChevronDownSmall, CircleCheck, CircleCross, Skip } from '@/generated/icons'
import { doneMessage } from './doneSummary'
import { useXTBReconcile, type HoldingsCheckSummary, type ReconcileStage } from './useXTBReconcile'
import type { HoldingsCheck } from '@/domain/holdingsCheck'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import { canConvertOpenPrice, nbpRates, withStatementCurrencies } from './holdingsCheckApply'
import type { DevSeed } from './devSeed'
import type { HoldingSyncRow } from '@/domain/holdingSync'
import type { Transaction } from '@/types'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type XTBTransactionFlowProps = {
  accountId: string
  file: File
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step, so
   *  the modal can drop its header for the full-bleed success card. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, XTBTransactionFlowDevState>
}

type Step =
  | 'parsing'
  | 'preview'
  | 'importing'
  | 'unmatched'
  | 'sync'
  | 'cost_basis'
  | 'holdings_check'
  | 'done'

/** Dev-only seedable state for the `/dev` showcase. */
export type XTBTransactionFlowDevState = {
  parseResult: ParseResult
  unmatchedRows: UnmatchedRow[]
  unresolvedRows: UnresolvedRow[]
  syncRows: HoldingSyncRow[]
  costBasisRows: CostBasisDiffRow[]
  holdingsCheck?: HoldingsCheck
  doneParts: string[]
  doneSummary?: HoldingsCheckSummary
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

/** "ACME: 0,5 + 2 bought on 5 Jan 2026" — a trade, or the fills of one order. */
function tradeLabel(rows: Transaction[]): string {
  const first = rows[0]
  const quantities = rows.map((t) => formatQuantity(t.quantity ?? 0)).join(' + ')
  return `${first.ticker ?? first.instrument}: ${quantities} ${first.type === 'buy' ? 'bought' : 'sold'} on ${formatDate(first.date.slice(0, 10))}`
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function XTBTransactionFlow({
  accountId,
  file,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
}: XTBTransactionFlowProps) {
  const { transactions, accounts, importTransactions } = usePortfolio()
  const settings = useSettings()
  const { instrumentAliases } = settings

  const accountName = useMemo(
    () => accounts.find((a) => a.id === accountId)?.name ?? 'Account',
    [accounts, accountId],
  )

  // ── Wizard state ───────────────────────
  const [step, setStep] = useState<Step>(devSeed?.step ?? 'parsing')
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(devSeed?.state?.parseResult ?? null)

  // Done summary parts
  const [doneParts, setDoneParts] = useState<string[]>(devSeed?.state?.doneParts ?? [])
  const [addedCount, setAddedCount] = useState(0)

  // Unmatched-instruments and cost-basis steps, shared with XTBConfirmationFlow.
  const reconcile = useXTBReconcile({
    accountId,
    onFinish: (extraParts) => {
      setDoneParts((prev) => [...prev, ...extraParts])
      setStep('done')
    },
    seed: devSeed
      ? {
          stage: (devSeed.step === 'unmatched' || devSeed.step === 'sync' || devSeed.step === 'cost_basis' || devSeed.step === 'holdings_check'
            ? devSeed.step
            : 'idle') as ReconcileStage,
          holdingsCheck: devSeed.state?.holdingsCheck,
          unmatchedRows: devSeed.state?.unmatchedRows,
          unresolvedRows: devSeed.state?.unresolvedRows,
          syncRows: devSeed.state?.syncRows,
          costBasisRows: devSeed.state?.costBasisRows,
        }
      : undefined,
  })

  // Tell the parent modal when we're on the full-bleed success card (no header).
  useEffect(() => {
    onDoneChange?.(step === 'done')
  }, [step, onDoneChange])

  // ── Auto-parse on mount ────────────────
  useEffect(() => {
    if (devSeed) return // dev showcase: state is pre-seeded, skip parsing
    async function parse() {
      try {
        const existingIds = new Set(transactions.map((t) => t.externalId))
        const parsed = await parseXTBCashOperations(file, accountId, existingIds, accounts, instrumentAliases, transactions)
        // Each instrument's price currency, from its PLN rate in Open Positions (NBP's table; never asked while NBP is off).
        const result = parsed.openPositions
          ? { ...parsed, openPositions: await withStatementCurrencies(parsed.openPositions, canConvertOpenPrice(settings) ? nbpRates(settings) : null) }
          : parsed
        setParseResult(result)
        setStep('preview')
      } catch (err) {
        // A statement in another currency is refused on purpose: its message says so in full.
        if (err instanceof StatementCurrencyError) setParseError(err.message)
        else setParseError(`Failed to read the file: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    void parse()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Import confirm ─────────────────────
  function handleConfirmImport() {
    if (!parseResult) return
    setStep('importing')

    const { added, mergedTransactions, nextAccounts } = importTransactions(
      parseResult.transactions,
      accountId,
    )

    const parts: string[] = []
    if (added > 0) {
      parts.push(`${added} transaction${added !== 1 ? 's' : ''} imported`)
    }
    setDoneParts(parts)

    setAddedCount(added)
    // Nothing was added → only the holdings check (an .xlsx statement still says what XTB holds).
    const showing = added === 0
      ? reconcile.beginHoldingsCheck(mergedTransactions, nextAccounts, parseResult.openPositions)
      : reconcile.begin(mergedTransactions, nextAccounts, parseResult.transactions, parseResult.openPositions)
    if (!showing) setStep('done')
  }

  // ── Done ───────────────────────────────
  function handleDone() {
    const msg = doneParts.length > 0 ? doneParts.join('. ') + '.' : 'No changes were made.'
    onComplete(msg)
  }

  // ─── Render ────────────────────────────

  // Parsing
  if (step === 'parsing' && !parseError) {
    return (
      <ImportSpinnerCard
        message="Parsing XTB Cash Operations…"
      />
    )
  }

  // Parse error
  if (parseError) {
    return (
      <ImportErrorCard
        message={parseError}
        onBack={onBack}
      />
    )
  }

  // Unmatched holdings and cost basis. The hook tracks its own stage, so this
  // must be checked before the preview branch — after a confirmed import `step`
  // is still 'importing' while reconciliation runs.
  const reconcileUI = reconcile.render()
  if (reconcileUI) return reconcileUI

  // Preview
  if ((step === 'preview' || step === 'importing') && parseResult) {
    return (
      <PreviewStep
        parseResult={parseResult}
        accountName={accountName}
        isImporting={step === 'importing'}
        onConfirm={handleConfirmImport}
        onBack={onBack}
      />
    )
  }

  // Done
  if (step === 'done') {
    const done = doneMessage(doneParts, reconcile.holdingsCheckSummary ?? devSeed?.state?.doneSummary ?? null, addedCount, accountName)
    return (
      <ImportDoneCard
        message={done.message}
        detail={done.detail}
        onDone={handleDone}
      />
    )
  }

  return null
}

// ─────────────────────────────────────────
// Preview sub-step
// ─────────────────────────────────────────

function PreviewStep({
  parseResult,
  accountName,
  isImporting,
  onConfirm,
  onBack,
}: {
  parseResult: ParseResult
  accountName: string
  isImporting: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const [warningsOpen, setWarningsOpen] = useState(false)
  const { transactions, skipped, crossFormatSkipped, crossFormat, internalTransfersSkipped, closedByHand, warnings, period } = parseResult

  const dateRange = useMemo(() => {
    if (transactions.length === 0) return null
    const dates = transactions.map((t) => t.date).sort()
    return { from: dates[0], to: dates[dates.length - 1] }
  }, [transactions])

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        {/* Stats */}
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-center gap-2">
            <CircleCheck size={16} className="text-positive shrink-0" />
            <span className="text-sm text-foreground tracking-[-0.35px]">
              {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} to import
            </span>
          </div>
          {skipped > 0 && (
            <div className="flex items-center gap-2">
              <Skip size={16} className="text-accent shrink-0" />
              <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                {skipped} skipped (already imported)
              </span>
            </div>
          )}
          {crossFormatSkipped > 0 && (
            <div className="flex items-start gap-2">
              <Skip size={16} className="text-accent shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                  {crossFormatSkipped} skipped (already imported from a daily statement)
                </span>
                {crossFormat.map((d) => (
                  <span key={d.candidates[0].id} className="text-xs text-accent">
                    {tradeLabel(d.candidates)}
                    {d.candidateFees.length > 0 && ` + ${d.candidateFees.length === 1 ? 'its commission' : `${d.candidateFees.length} fees`}`}
                    , matches the statement's {formatQuantity(d.existing.reduce((q, t) => q + (t.quantity ?? 0), 0))} on {formatDate(d.existing[0].date.slice(0, 10))}
                  </span>
                ))}
              </div>
            </div>
          )}
          {internalTransfersSkipped > 0 && (
            <div className="flex items-center gap-2">
              <Skip size={16} className="text-accent shrink-0" />
              <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                {internalTransfersSkipped} transfer rows skipped (money moved within this XTB account, in and out)
              </span>
            </div>
          )}
          {closedByHand.length > 0 && (
            <div className="flex items-start gap-2">
              <Skip size={16} className="text-accent shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                  {closedByHand.length} sale{closedByHand.length !== 1 ? 's' : ''} skipped (likely already recorded with Close position)
                </span>
                {closedByHand.map(({ sale, existing }) => (
                  <span key={sale.id} className="text-xs text-accent">
                    {sale.ticker ?? sale.instrument}: {formatQuantity(sale.quantity ?? 0)} sold on {formatDate(sale.date.slice(0, 10))},
                    {' '}closed by hand on {formatDate(existing.date.slice(0, 10))}
                  </span>
                ))}
              </div>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="flex items-center gap-2">
              <CircleCross size={16} className="text-warning shrink-0" />
              <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Meta */}
        <div className="border border-borderLight rounded-lg p-4 bg-background flex flex-col gap-2">
          {period && (
            <div className="flex justify-between text-sm">
              <span className="text-accent tracking-[-0.35px]">Statement period</span>
              <span className="text-foreground font-medium tracking-[-0.35px]">
                {formatDate(period.from.slice(0, 10))} – {formatDate(period.to.slice(0, 10))}
              </span>
            </div>
          )}
          {dateRange && (
            <div className="flex justify-between text-sm">
              <span className="text-accent tracking-[-0.35px]">Transactions</span>
              <span className="text-foreground font-medium tracking-[-0.35px]">
                {formatMonthYear(dateRange.from)} – {formatMonthYear(dateRange.to)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-accent tracking-[-0.35px]">Account</span>
            <span className="text-foreground font-medium tracking-[-0.35px]">{accountName}</span>
          </div>
        </div>

        {/* Collapsible warnings */}
        {warnings.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setWarningsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-foregroundMuted tracking-[-0.35px] hover:bg-muted transition-colors cursor-pointer"
            >
              <span>View warnings</span>
              <ChevronDownSmall
                size={16}
                className={`transition-transform text-accent ${warningsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {warningsOpen && (
              <div className="border-t border-borderLight divide-y divide-borderLight max-h-48 overflow-y-auto">
                {warnings.map((w, i) => (
                  <div key={i} className="px-4 py-3">
                    <p className="text-xs text-accent mb-0.5">Row {w.row}</p>
                    <p className="text-sm text-negative tracking-[-0.35px]">{w.message}</p>
                    <p className="text-xs text-accent mt-0.5 truncate">{w.rawData}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {transactions.length === 0 && (
          <p className="text-sm text-accent text-center py-2">
            No new transactions found — all rows were already imported.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onBack} disabled={isImporting} className="w-20">
          Back
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={transactions.length === 0 || isImporting}
        >
          {isImporting
            ? 'Importing…'
            : `Import ${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}
