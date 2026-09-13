/**
 * RevolutCryptoFlow — parse → preview → import → create_holding → done
 *
 * Handles multiple Revolut individual crypto transaction statement PDFs in one pass.
 * Produces one 'buy' + one 'fee' transaction per PDF, then optionally creates/updates
 * the ETH holding in the target account using the aggregated cost basis.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { formatPLN } from '@/utils/formatters'
import { parseRevolutCryptoPDFs, type ParseResult } from '@/importers/revolutCryptoParser'
import { calculateAverageCostBasis } from '@/domain/calculations'
import { usePortfolio } from '@/context/PortfolioContext'
import { CircleCheck, CircleCross, Skip } from '@/generated/icons'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { buildImportSummary, joinDoneParts } from './doneSummary'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import type { DevSeed } from './devSeed'

/** Footer source label shown on every step (left slot). */
const FOOTER_LABEL = 'Revolut ETH'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type RevolutCryptoFlowProps = {
  accountId: string
  files: File[]
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, RevolutCryptoFlowDevState>
}

type Step = 'parsing' | 'preview' | 'importing' | 'create_holding' | 'done'

/** The ETH holding state proposed after import. */
type ProposedHolding = {
  totalQty: number
  avgCostPLN: number
  totalCostPLN: number
  earliestDate: string
  existingHoldingId: string | null   // non-null if an ETH holding already exists
}

/** Dev-only seedable state for the `/dev` showcase. */
export type RevolutCryptoFlowDevState = {
  parseResult: ParseResult
  proposed: ProposedHolding
  doneParts: string[]
  doneDetail?: string
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

function formatQty(n: number): string {
  const [intPart, decPart] = n.toFixed(8).split('.')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const trimmedDec = decPart.replace(/0+$/, '').padEnd(2, '0')
  return `${intFormatted},${trimmedDec}`
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

/** Round to 8 decimal places to avoid floating-point noise in checksum display. */
function roundEth(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function RevolutCryptoFlow({
  accountId,
  files,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
}: RevolutCryptoFlowProps) {
  const { transactions, accounts, importTransactions, replaceAccounts } = usePortfolio()

  const accountName = useMemo(
    () => accounts.find((a) => a.id === accountId)?.name ?? 'Account',
    [accounts, accountId],
  )

  /** True when the existing ETH holding is missing its exchange field (needs CC patch). */
  const needsExchangePatch = useMemo(() => {
    const existingEth = accounts
      .find((a) => a.id === accountId)
      ?.holdings.find((h) => h.ticker?.toUpperCase() === 'ETH' && h.category === 'crypto')
    return !!(existingEth && !existingEth.exchange)
  }, [accounts, accountId])

  // ── Wizard state ───────────────────────
  const [step, setStep] = useState<Step>(devSeed?.step ?? 'parsing')
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(devSeed?.state?.parseResult ?? null)
  const [proposed, setProposed] = useState<ProposedHolding | null>(devSeed?.state?.proposed ?? null)
  const [doneParts, setDoneParts] = useState<string[]>(devSeed?.state?.doneParts ?? [])
  const [doneDetail, setDoneDetail] = useState<string>(devSeed?.state?.doneDetail ?? '')

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
        const result = await parseRevolutCryptoPDFs(files, accountId, existingIds)
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

    const { lead, detail } = buildImportSummary({
      buy: parseResult.transactions.filter((t) => t.type === 'buy').length,
      fee: parseResult.transactions.filter((t) => t.type === 'fee').length,
    })
    const parts: string[] = lead ? [lead] : []
    setDoneParts(parts)
    setDoneDetail(detail)

    // Check if the existing ETH holding needs its exchange field patched.
    // This can happen when holdings were created before 'exchange: CC' support was added.
    const currentAccount = nextAccounts.find((a) => a.id === accountId)
    const existingEth = currentAccount?.holdings.find(
      (h) => h.ticker?.toUpperCase() === 'ETH' && h.category === 'crypto',
    )
    const needsExchangePatch = !!(existingEth && !existingEth.exchange)

    if (added > 0 || needsExchangePatch) {
      // Compute proposed holding from all ETH buy transactions in this account
      const { averageCostPLN, totalQuantity, totalCostPLN } = calculateAverageCostBasis(
        mergedTransactions.filter((t) => t.accountId === accountId),
        'ETH',
      )

      if (totalQuantity > 0) {
        // Find earliest ETH buy date
        const ethBuys = mergedTransactions
          .filter((t) => t.accountId === accountId && t.type === 'buy' && t.ticker === 'ETH')
          .sort((a, b) => a.date.localeCompare(b.date))
        const earliestDate = ethBuys[0]?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)

        setProposed({
          totalQty: totalQuantity,
          avgCostPLN: averageCostPLN,
          totalCostPLN,
          earliestDate,
          existingHoldingId: existingEth?.id ?? null,
        })
        setStep('create_holding')
        return
      }
    }

    setStep('done')
  }

  // ── Holding create/update confirm ──────
  function handleConfirmHolding() {
    if (!proposed) {
      setStep('done')
      return
    }

    const now = new Date().toISOString()
    const account = accounts.find((a) => a.id === accountId)
    if (!account) {
      setStep('done')
      return
    }

    let nextHoldings = account.holdings

    if (proposed.existingHoldingId) {
      // Update existing ETH holding's quantity and cost basis
      nextHoldings = account.holdings.map((h) =>
        h.id === proposed.existingHoldingId
          ? {
              ...h,
              quantity: proposed.totalQty,
              purchasePrice: proposed.avgCostPLN,
              exchange: 'CC',
              updatedAt: now,
            }
          : h,
      )
      const parts = [...doneParts, 'ETH holding updated']
      setDoneParts(parts)
    } else {
      // Create new ETH holding
      nextHoldings = [
        ...account.holdings,
        {
          id: crypto.randomUUID(),
          accountId,
          name: 'Ethereum',
          ticker: 'ETH',
          exchange: 'CC',
          category: 'crypto' as const,
          quantity: proposed.totalQty,
          purchasePrice: proposed.avgCostPLN,
          currentPrice: proposed.avgCostPLN,
          purchaseDate: proposed.earliestDate,
          createdAt: now,
          updatedAt: now,
        },
      ]
      const parts = [...doneParts, 'ETH holding created']
      setDoneParts(parts)
    }

    const nextAccounts = accounts.map((a) =>
      a.id === accountId ? { ...a, holdings: nextHoldings, lastUpdated: now } : a,
    )
    replaceAccounts(nextAccounts)
    setStep('done')
  }

  function handleSkipHolding() {
    setStep('done')
  }

  // ── Done ───────────────────────────────
  function handleDone() {
    const base = doneParts.length > 0 ? doneParts.join('. ') + '.' : 'No changes were made.'
    const msg = doneDetail ? `${base} (${doneDetail})` : base
    onComplete(msg)
  }

  // ─── Render ────────────────────────────

  if (step === 'parsing' && !parseError) {
    return (
      <ImportSpinnerCard
        message={`Parsing ${files.length} PDF${files.length !== 1 ? 's' : ''}…`}
      />
    )
  }

  if (parseError) {
    return (
      <ImportErrorCard
        message={`Failed to parse PDFs: ${parseError}`}
        onBack={onBack}
      />
    )
  }

  if ((step === 'preview' || step === 'importing') && parseResult) {
    return (
      <PreviewStep
        parseResult={parseResult}
        accountName={accountName}
        fileCount={files.length}
        isImporting={step === 'importing'}
        needsExchangePatch={needsExchangePatch}
        onConfirm={handleConfirmImport}
        onBack={onBack}
      />
    )
  }

  if (step === 'create_holding' && proposed) {
    return (
      <CreateHoldingStep
        proposed={proposed}
        onConfirm={handleConfirmHolding}
        onSkip={handleSkipHolding}
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

  return null
}

// ─────────────────────────────────────────
// Preview sub-step
// ─────────────────────────────────────────

function PreviewStep({
  parseResult,
  accountName,
  fileCount,
  isImporting,
  needsExchangePatch,
  onConfirm,
  onBack,
}: {
  parseResult: ParseResult
  accountName: string
  fileCount: number
  isImporting: boolean
  needsExchangePatch: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const { transactions, skipped, warnings, totalEthFromPDFs } = parseResult

  const buyTxs = transactions.filter((t) => t.type === 'buy')
  const feeTxs = transactions.filter((t) => t.type === 'fee')

  const dateRange = useMemo(() => {
    if (buyTxs.length === 0) return null
    const dates = buyTxs.map((t) => t.date).sort()
    return { from: dates[0], to: dates[dates.length - 1] }
  }, [buyTxs])

  const roundedTotal = roundEth(totalEthFromPDFs)

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        {/* Warnings */}
        {warnings.map((w, i) => (
          <InlineAlert key={i} variant="warning">
            <span className="font-medium">{w.fileName}:</span> {w.message}
          </InlineAlert>
        ))}

        {/* Stats */}
        <div className="flex flex-col gap-[7px]">
          {buyTxs.length > 0 && (
            <div className="flex items-center gap-2">
              <CircleCheck size={16} className="text-positive shrink-0" />
              <span className="text-sm text-foreground tracking-[-0.35px]">
                {buyTxs.length} buy + {feeTxs.length} fee transaction{buyTxs.length !== 1 ? 's' : ''} to import
              </span>
            </div>
          )}
          {skipped > 0 && (
            <div className="flex items-center gap-2">
              <Skip size={16} className="text-accent shrink-0" />
              <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
                {skipped} PDF{skipped !== 1 ? 's' : ''} already imported (skipped)
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
          <div className="flex justify-between text-sm">
            <span className="text-accent tracking-[-0.35px]">PDFs provided</span>
            <span className="text-foreground font-medium tracking-[-0.35px]">{fileCount}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-accent tracking-[-0.35px]">Total ETH (all PDFs)</span>
            <span className="text-foreground font-medium tracking-[-0.35px]">{formatQty(roundedTotal)} ETH</span>
          </div>
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

        {transactions.length === 0 && skipped === 0 && (
          <p className="text-sm text-accent text-center py-2">
            No transactions found in the provided PDFs. Check for warnings above.
          </p>
        )}
        {transactions.length === 0 && skipped > 0 && (
          <p className="text-sm text-accent text-center py-2">
            {needsExchangePatch
              ? 'All PDFs already imported. Proceed to update the ETH holding with price-refresh support.'
              : 'All PDFs were already imported — nothing new to add.'}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-borderLight p-5 flex items-center gap-2">
        <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">{FOOTER_LABEL}</p>
        <Button variant="secondary" onClick={onBack} disabled={isImporting} className="w-20">Back</Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={(transactions.length === 0 && !needsExchangePatch) || isImporting}
        >
          {isImporting
            ? 'Importing…'
            : transactions.length === 0 && needsExchangePatch
              ? 'Update ETH holding'
              : `Import ${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// Create/update holding sub-step
// ─────────────────────────────────────────

function CreateHoldingStep({
  proposed,
  onConfirm,
  onSkip,
}: {
  proposed: ProposedHolding
  onConfirm: () => void
  onSkip: () => void
}) {
  const isUpdate = proposed.existingHoldingId !== null

  const fields: { label: string; value: string }[] = [
    { label: 'Quantity', value: `${formatQty(roundEth(proposed.totalQty))} ETH` },
    { label: 'Avg Cost (per ETH)', value: formatPLN(proposed.avgCostPLN) },
    { label: 'Total Cost Basis', value: formatPLN(proposed.totalCostPLN) },
    ...(!isUpdate ? [{ label: 'Purchase Date', value: proposed.earliestDate }] : []),
  ]

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
          {isUpdate
            ? 'An ETH holding already exists in this account. Update it with the weighted-average cost basis from all buy transactions?'
            : 'Create an ETH holding using the weighted-average cost basis calculated from all buy transactions?'}
        </p>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '50%' }} />
              <col style={{ width: '50%' }} />
            </colgroup>
            <thead>
              <tr className="bg-muted border-b border-borderLight">
                <th className="h-11 px-3 text-left align-middle border-r border-borderLight"><span className="block truncate text-xs font-medium text-accent">Field</span></th>
                <th className="h-11 px-3 text-right align-middle"><span className="block truncate text-xs font-medium text-accent">Value</span></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.label} className="border-b border-borderLight last:border-b-0">
                  <td className="h-11 px-3 align-middle border-r border-borderLight">
                    <span className="block truncate text-xs text-foregroundMuted">{f.label}</span>
                  </td>
                  <td className="h-11 px-3 align-middle">
                    <span className="block truncate text-xs font-medium text-foreground text-right">{f.value}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-sm text-accent tracking-[-0.35px]">
          Current price is set to the average cost — update it manually or via price refresh.
        </p>
      </div>

      {/* Footer */}
      <div className="border-t border-borderLight p-5 flex items-center gap-2">
        <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">{FOOTER_LABEL}</p>
        <Button variant="secondary" onClick={onSkip} className="w-20">Skip</Button>
        <Button variant="primary" onClick={onConfirm}>
          {isUpdate ? 'Update holding' : 'Create holding'}
        </Button>
      </div>
    </div>
  )
}
