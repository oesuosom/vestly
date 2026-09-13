/**
 * XTBTransactionFlow — the parse → preview → import → unmatched → cost-basis
 * steps of the XTB Cash Operations import.
 *
 * The file upload and Modal wrapper are handled by UnifiedImportModal.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { parseXTBCashOperations, type ParseResult } from '@/importers/xtbParser'
import type {
  CostBasisDiffRow,
  UnmatchedRow,
  UnresolvedRow,
} from '@/importers/xtbPostProcessing'
import { usePortfolio } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import { ChevronDownSmall, CircleCheck, CircleCross, Skip } from '@/generated/icons'
import { joinDoneParts } from './doneSummary'
import { useXTBReconcile, type ReconcileStage } from './useXTBReconcile'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import type { DevSeed } from './devSeed'

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
  | 'cost_basis'
  | 'done'

/** Dev-only seedable state for the `/dev` showcase. */
export type XTBTransactionFlowDevState = {
  parseResult: ParseResult
  unmatchedRows: UnmatchedRow[]
  unresolvedRows: UnresolvedRow[]
  costBasisRows: CostBasisDiffRow[]
  doneParts: string[]
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

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
  const { instrumentAliases } = useSettings()

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

  // Unmatched-instruments and cost-basis steps, shared with XTBConfirmationFlow.
  const reconcile = useXTBReconcile({
    accountId,
    onFinish: (extraParts) => {
      setDoneParts((prev) => [...prev, ...extraParts])
      setStep('done')
    },
    seed: devSeed
      ? {
          stage: (devSeed.step === 'unmatched' || devSeed.step === 'cost_basis'
            ? devSeed.step
            : 'idle') as ReconcileStage,
          unmatchedRows: devSeed.state?.unmatchedRows,
          unresolvedRows: devSeed.state?.unresolvedRows,
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
        const result = await parseXTBCashOperations(file, accountId, existingIds, accounts, instrumentAliases, transactions)
        setParseResult(result)
        setStep('preview')
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err))
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

    // Nothing was added → nothing to reconcile.
    if (added === 0 || !reconcile.begin(mergedTransactions, nextAccounts)) {
      setStep('done')
    }
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
        message={`Failed to parse CSV: ${parseError}`}
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
    return (
      <ImportDoneCard
        message={joinDoneParts(doneParts)}
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
  const { transactions, skipped, crossFormatSkipped, warnings } = parseResult

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
            <div className="flex items-center gap-2">
              <Skip size={16} className="text-accent shrink-0" />
              <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                {crossFormatSkipped} skipped (already imported from a daily statement)
              </span>
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
          {dateRange && (
            <div className="flex justify-between text-sm">
              <span className="text-accent tracking-[-0.35px]">Date range</span>
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
