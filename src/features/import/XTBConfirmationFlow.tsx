/**
 * XTBConfirmationFlow — parse → preview → importing → [reconcile] → done
 *
 * Imports XTB daily order confirmations ("Potwierdzenie zleceń wykonanych",
 * `<account>_<YYYYMMDD>_DailyStatement.pdf`). Several statements can be dropped
 * at once, so a folder of dailies imports in one pass.
 *
 * Two things make this preview richer than the other transaction flows:
 *
 *   • **Direction may need confirming.** The Kupno/Sprzedaż cell is a raster
 *     badge, not text. The parser reads it from the badge's hue and leaves
 *     `direction: null` when it can't — those rows must be set by hand before
 *     import, because guessing would invert a trade.
 *
 *   • **Duplicates cross document types.** A trade here can already be in the
 *     store from the Cash Operations export, which shares no id with these
 *     statements. Likely duplicates are listed and unticked by default; see
 *     @/importers/tradeDedup.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dropdown } from '@/components/ui/Dropdown'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { formatDate, formatPLN, formatQuantity } from '@/utils/formatters'
import {
  parseXTBConfirmations,
  signedAmountPLN,
  tradesToTransactions,
  type ConfirmationParseResult,
  type ParsedTrade,
} from '@/importers/xtbConfirmationParser'
import { findDuplicateTrades } from '@/importers/tradeDedup'
import { usePortfolio } from '@/context/PortfolioContext'
import { CircleCheck, CircleCross, Skip } from '@/generated/icons'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import { useXTBReconcile } from './useXTBReconcile'
import { buildImportSummary, joinDoneParts } from './doneSummary'
import type { DevSeed } from './devSeed'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type XTBConfirmationFlowProps = {
  accountId: string
  files: File[]
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, XTBConfirmationFlowDevState>
}

export type XTBConfirmationFlowDevState = {
  parseResult: ConfirmationParseResult | null
  doneParts: string[]
  doneDetail: string
  /** Seeded direction overrides, keyed by trade id. */
  directions: Map<string, Direction>
}

type Step = 'parsing' | 'preview' | 'importing' | 'done'

type Direction = 'buy' | 'sell'

const DIRECTION_OPTIONS = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
]

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function XTBConfirmationFlow({
  accountId,
  files,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
}: XTBConfirmationFlowProps) {
  const { transactions, accounts, importTransactions } = usePortfolio()

  const accountName = useMemo(
    () => accounts.find((a) => a.id === accountId)?.name ?? 'Account',
    [accounts, accountId],
  )

  // ── Wizard state ───────────────────────
  const [step, setStep] = useState<Step>(devSeed?.step ?? 'parsing')
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ConfirmationParseResult | null>(
    devSeed?.state?.parseResult ?? null,
  )
  const [doneParts, setDoneParts] = useState<string[]>(devSeed?.state?.doneParts ?? [])
  /** Per-type breakdown shown under the lead line ("2 buys · 1 sell"). */
  const [doneDetail, setDoneDetail] = useState(devSeed?.state?.doneDetail ?? '')

  /** User-set direction per trade id, overriding whatever the badge said. */
  const [directions, setDirections] = useState<Map<string, Direction>>(
    () => devSeed?.state?.directions ?? new Map(),
  )
  /**
   * Explicit tick/untick per trade id. Absent means "follow the default", which
   * is "import unless it looks like a duplicate" — so the default tracks the
   * duplicate set as directions change without discarding the user's choices.
   */
  const [selectionOverrides, setSelectionOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  )

  const reconcile = useXTBReconcile({
    accountId,
    onFinish: (extraParts) => {
      setDoneParts((prev) => [...prev, ...extraParts])
      setStep('done')
    },
  })

  useEffect(() => {
    onDoneChange?.(step === 'done')
  }, [step, onDoneChange])

  // ── Auto-parse on mount ────────────────
  useEffect(() => {
    if (devSeed) return // dev showcase: state is pre-seeded, skip parsing
    async function parse() {
      try {
        const result = await parseXTBConfirmations(files)
        setParseResult(result)
        setStep('preview')
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err))
      }
    }
    void parse()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoised so `?? []`'s fresh array each render doesn't defeat the duplicate
  // memo below.
  const trades = useMemo(() => parseResult?.trades ?? [], [parseResult])

  /** Effective direction for a trade: user's choice, else the badge's reading. */
  function directionOf(trade: ParsedTrade): Direction | null {
    return directions.get(trade.id) ?? trade.direction
  }

  /**
   * Likely duplicates of trades already in the store. Recomputed as directions
   * change, since direction is part of the match.
   */
  // tradesToTransactions already drops trades with no resolved direction, so
  // there is nothing to pre-filter here.
  const duplicates = useMemo(
    () => findDuplicateTrades(tradesToTransactions(trades, accountId, directions), transactions),
    [trades, accountId, directions, transactions],
  )

  function isSelected(trade: ParsedTrade): boolean {
    return selectionOverrides.get(trade.id) ?? !duplicates.has(trade.id)
  }

  const selectedTrades = trades.filter(isSelected)
  const unresolvedCount = selectedTrades.filter((t) => directionOf(t) == null).length
  const canImport = selectedTrades.length > 0 && unresolvedCount === 0

  // ── Import confirm ─────────────────────
  function handleConfirmImport() {
    if (!canImport) return
    setStep('importing')

    const toImport = tradesToTransactions(selectedTrades, accountId, directions)
    const { added, mergedTransactions, nextAccounts } = importTransactions(toImport, accountId)

    const counts: Record<string, number> = {}
    for (const t of toImport) counts[t.type] = (counts[t.type] ?? 0) + 1
    const { lead, detail } = buildImportSummary(counts)

    setDoneParts(added > 0 ? [lead] : [])
    setDoneDetail(detail)

    if (added === 0 || !reconcile.begin(mergedTransactions, nextAccounts)) {
      setStep('done')
    }
  }

  function handleDone() {
    onComplete(joinDoneParts(doneParts))
  }

  // ─── Render ────────────────────────────

  if (step === 'parsing' && !parseError) {
    return (
      <ImportSpinnerCard
        message={`Reading ${files.length} XTB confirmation${files.length !== 1 ? 's' : ''}…`}
      />
    )
  }

  // Reconciliation owns its own stage; show it whenever it has a step pending.
  const reconcileUI = reconcile.render()
  if (reconcileUI) return reconcileUI

  if (parseError) {
    return (
      <ImportErrorCard
        message={`Failed to parse PDF: ${parseError}`}
        onBack={onBack}
      />
    )
  }

  if (step === 'done') {
    return (
      <ImportDoneCard
        message={joinDoneParts(doneParts)}
        detail={doneDetail || undefined}
        onDone={handleDone}
      />
    )
  }

  // Preview / importing
  return (
    <PreviewStep
      parseResult={parseResult}
      accountName={accountName}
      trades={trades}
      directionOf={directionOf}
      duplicates={duplicates}
      isSelected={isSelected}
      selectedCount={selectedTrades.length}
      unresolvedCount={unresolvedCount}
      canImport={canImport}
      isImporting={step === 'importing'}
      onToggle={(trade) =>
        setSelectionOverrides((prev) => new Map(prev).set(trade.id, !isSelected(trade)))
      }
      onSetDirection={(id, dir) =>
        setDirections((prev) => new Map(prev).set(id, dir))
      }
      onConfirm={handleConfirmImport}
      onBack={onBack}
    />
  )
}

// ─────────────────────────────────────────
// Preview sub-step
// ─────────────────────────────────────────

function PreviewStep({
  parseResult,
  accountName,
  trades,
  directionOf,
  duplicates,
  isSelected,
  selectedCount,
  unresolvedCount,
  canImport,
  isImporting,
  onToggle,
  onSetDirection,
  onConfirm,
  onBack,
}: {
  parseResult: ConfirmationParseResult | null
  accountName: string
  trades: ParsedTrade[]
  directionOf: (t: ParsedTrade) => Direction | null
  duplicates: Map<string, { date: string }>
  isSelected: (trade: ParsedTrade) => boolean
  selectedCount: number
  unresolvedCount: number
  canImport: boolean
  isImporting: boolean
  onToggle: (trade: ParsedTrade) => void
  onSetDirection: (id: string, dir: Direction) => void
  onConfirm: () => void
  onBack: () => void
}) {
  const warnings = parseResult?.warnings ?? []
  const duplicateCount = duplicates.size

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        {/* Stats */}
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-center gap-2">
            <CircleCheck size={16} className="text-positive shrink-0" />
            <span className="text-sm text-foreground tracking-[-0.35px]">
              {selectedCount} of {trades.length} trade{trades.length !== 1 ? 's' : ''} to import
            </span>
          </div>
          {duplicateCount > 0 && (
            <div className="flex items-center gap-2">
              <Skip size={16} className="text-accent shrink-0" />
              <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                {duplicateCount} look{duplicateCount === 1 ? 's' : ''} like a transaction you already have
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

        {unresolvedCount > 0 && (
          <InlineAlert variant="warning">
            XTB draws Kupno/Sprzedaż as an image, so {unresolvedCount} trade
            {unresolvedCount !== 1 ? 's' : ''} could not be read automatically. Set the direction
            before importing.
          </InlineAlert>
        )}

        {/* Trades */}
        <div className="border border-border rounded-lg divide-y divide-borderLight max-h-72 overflow-y-auto">
          {trades.map((trade) => {
            const direction = directionOf(trade)
            const duplicate = duplicates.get(trade.id)
            const amount = direction ? signedAmountPLN(trade, direction) : null

            return (
              <div key={trade.id} className="flex items-center gap-3 px-4 py-3">
                <Checkbox checked={isSelected(trade)} onChange={() => onToggle(trade)} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-foreground">{trade.ticker}</span>
                    <span className="truncate text-xs text-foregroundMuted">{trade.instrument}</span>
                  </div>
                  <p className="text-xs text-accent mt-0.5">
                    {formatQuantity(trade.quantity)} @ {formatPLN(trade.unitPriceOriginal)} ·{' '}
                    {formatDate(trade.date)}
                  </p>
                  {duplicate && (
                    <p className="text-xs text-warning mt-0.5">
                      Matches an existing transaction from {formatDate(duplicate.date)}
                    </p>
                  )}
                </div>

                <div className="w-24 shrink-0">
                  <Dropdown
                    variant="cell"
                    portal
                    placeholder="Set…"
                    value={direction ?? ''}
                    onChange={(v) => onSetDirection(trade.id, v as Direction)}
                    options={DIRECTION_OPTIONS}
                  />
                </div>

                <span
                  className={`w-24 shrink-0 text-right text-xs font-medium ${
                    amount == null ? 'text-accent' : amount < 0 ? 'text-negative' : 'text-positive'
                  }`}
                >
                  {amount == null ? '—' : formatPLN(amount)}
                </span>
              </div>
            )
          })}
        </div>

        {/* Meta */}
        <div className="border border-borderLight rounded-lg p-4 bg-background flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-accent tracking-[-0.35px]">Account</span>
            <span className="text-foreground font-medium tracking-[-0.35px]">{accountName}</span>
          </div>
          {parseResult?.statement.freeCash != null && (
            <div className="flex justify-between text-sm">
              <span className="text-accent tracking-[-0.35px]">Free cash on statement</span>
              <span className="text-foreground font-medium tracking-[-0.35px]">
                {formatPLN(parseResult.statement.freeCash)}
              </span>
            </div>
          )}
        </div>

        {warnings.length > 0 && (
          <div className="border border-border rounded-lg divide-y divide-borderLight max-h-32 overflow-y-auto">
            {warnings.map((w, i) => (
              <div key={i} className="px-4 py-3">
                <p className="text-xs text-accent mb-0.5">{w.fileName}</p>
                <p className="text-sm text-negative tracking-[-0.35px]">{w.message}</p>
              </div>
            ))}
          </div>
        )}

        {trades.length === 0 && (
          <p className="text-sm text-accent text-center py-2">
            No executed orders found in these statements.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-borderLight p-5 flex items-center justify-between">
        <Button variant="secondary" onClick={onBack} disabled={isImporting} className="w-20">
          Back
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={!canImport || isImporting}>
          {isImporting
            ? 'Importing…'
            : `Import ${selectedCount} trade${selectedCount !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}
