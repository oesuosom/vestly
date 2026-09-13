/**
 * RevolutBtcFlow — parse → preview → [receive_cost] → importing → create_holding → done
 *
 * Handles Revolut BTC transaction PDFs:
 *   - transaction-statement_*.pdf  (buys and sells)
 *   - p2p-transaction-confirmation-report_*.pdf  (sends and receives)
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatPLN } from '@/utils/formatters'
import { parseRevolutBtcPDFs, type BtcParseResult } from '@/importers/revolutBtcParser'
import { calculateNetCryptoQuantity } from '@/domain/calculations'
import { usePortfolio } from '@/context/PortfolioContext'
import { CircleCheck, CircleCross, Skip } from '@/generated/icons'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { buildImportSummary, joinDoneParts } from './doneSummary'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import type { DevSeed } from './devSeed'

/** Footer source label shown on every step (left slot). */
const FOOTER_LABEL = 'Revolut BTC'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type RevolutBtcFlowProps = {
  accountId: string
  files: File[]
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, RevolutBtcFlowDevState>
}

type Step = 'parsing' | 'preview' | 'receive_cost' | 'importing' | 'create_holding' | 'done'

type BtcProposedHolding = {
  netQty: number
  avgCostPLN: number
  totalCostPLN: number
  earliestDate: string
  existingHoldingId: string | null
}

/** Dev-only seedable state for the `/dev` showcase. */
export type RevolutBtcFlowDevState = {
  parseResult: BtcParseResult
  proposed: BtcProposedHolding
  doneParts: string[]
  doneDetail?: string
  /** Seeds the receive_cost step (which transaction is being priced). */
  receiveIndex: number
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Round to 8 decimal places to avoid floating-point noise in checksum display. */
function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function RevolutBtcFlow({
  accountId,
  files,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
}: RevolutBtcFlowProps) {
  const { transactions, accounts, importTransactions, replaceAccounts } = usePortfolio()

  /** True when the existing BTC holding is missing its exchange field (needs CC patch). */
  const needsExchangePatch = useMemo(() => {
    const existingBtc = accounts
      .find((a) => a.id === accountId)
      ?.holdings.find((h) => h.ticker?.toUpperCase() === 'BTC' && h.category === 'crypto')
    return !!(existingBtc && !existingBtc.exchange)
  }, [accounts, accountId])

  // ── Wizard state ───────────────────────
  const [step, setStep] = useState<Step>(devSeed?.step ?? 'parsing')
  const [parseError, setParseError] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<BtcParseResult | null>(devSeed?.state?.parseResult ?? null)
  const [proposed, setProposed] = useState<BtcProposedHolding | null>(devSeed?.state?.proposed ?? null)
  const [doneParts, setDoneParts] = useState<string[]>(devSeed?.state?.doneParts ?? [])
  const [doneDetail, setDoneDetail] = useState<string>(devSeed?.state?.doneDetail ?? '')

  // receive_cost step state
  const [receiveCostInput, setReceiveCostInput] = useState('')
  const [receiveIndex, setReceiveIndex] = useState(devSeed?.state?.receiveIndex ?? 0)
  const [collectedReceiveCosts, setCollectedReceiveCosts] = useState<(number | null)[]>([])

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
        const result = await parseRevolutBtcPDFs(files, accountId, existingIds)
        setParseResult(result)
        setStep('preview')
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err))
      }
    }
    void parse()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Preview confirm → receive_cost or importing ──
  function handlePreviewConfirm() {
    if (!parseResult) return
    // Show receive_cost step if any receive transactions were parsed
    const hasReceive = parseResult.transactions.some((t) => t.type === 'receive')
    if (hasReceive) {
      setStep('receive_cost')
    } else {
      handleConfirmImport([])
    }
  }

  // ── Receive cost confirm ───────────────
  function advanceReceiveCost(cost: number | null) {
    if (!parseResult) return
    const receiveTxns = parseResult.transactions.filter((t) => t.type === 'receive')
    const newCosts = [...collectedReceiveCosts, cost]
    if (receiveIndex < receiveTxns.length - 1) {
      setCollectedReceiveCosts(newCosts)
      setReceiveIndex(receiveIndex + 1)
      setReceiveCostInput('')
    } else {
      handleConfirmImport(newCosts)
    }
  }

  function handleReceiveCostConfirm() {
    const cost = parseFloat(receiveCostInput.replace(/,/g, '.'))
    advanceReceiveCost(isNaN(cost) || cost < 0 ? null : cost)
  }

  function handleReceiveCostSkip() {
    advanceReceiveCost(null)
  }

  // ── Import confirm ─────────────────────
  function handleConfirmImport(receiveCosts: (number | null)[]) {
    if (!parseResult) return
    setStep('importing')

    // Patch each receive transaction with its individual cost basis
    let receiveCounter = 0
    const txnsToImport = parseResult.transactions.map((t) => {
      if (t.type !== 'receive') return t
      const cost = receiveCosts[receiveCounter++]
      return cost != null ? { ...t, amountPLN: cost } : t
    })

    const { added, mergedTransactions, nextAccounts } = importTransactions(txnsToImport, accountId)

    const accountTxns = mergedTransactions.filter((t) => t.accountId === accountId)

    const { lead, detail } = buildImportSummary({
      buy: parseResult.transactions.filter((t) => t.type === 'buy').length,
      sell: parseResult.transactions.filter((t) => t.type === 'sell').length,
      send: parseResult.transactions.filter((t) => t.type === 'send').length,
      receive: parseResult.transactions.filter((t) => t.type === 'receive').length,
    })
    const parts: string[] = lead ? [lead] : []
    setDoneParts(parts)
    setDoneDetail(detail)

    // Check if existing BTC holding needs exchange patch
    const currentAccount = nextAccounts.find((a) => a.id === accountId)
    const existingBtc = currentAccount?.holdings.find(
      (h) => h.ticker?.toUpperCase() === 'BTC' && h.category === 'crypto',
    )
    const patchNeeded = !!(existingBtc && !existingBtc.exchange)

    if (added > 0 || patchNeeded) {
      const netQty = calculateNetCryptoQuantity(accountTxns, 'BTC')

      if (netQty > 0) {
        // Compute total cost from buys + receives (abs amountPLN)
        const totalCostPLN = accountTxns
          .filter((t) => (t.type === 'buy' || t.type === 'receive') && t.ticker === 'BTC')
          .reduce((sum, t) => sum + Math.abs(t.amountPLN), 0)

        const avgCostPLN = totalCostPLN / netQty

        // Earliest date from buys and receives
        const inflows = accountTxns
          .filter((t) => (t.type === 'buy' || t.type === 'receive') && t.ticker === 'BTC')
          .sort((a, b) => a.date.localeCompare(b.date))
        const earliestDate = inflows[0]?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)

        setProposed({
          netQty,
          avgCostPLN,
          totalCostPLN,
          earliestDate,
          existingHoldingId: existingBtc?.id ?? null,
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
      nextHoldings = account.holdings.map((h) =>
        h.id === proposed.existingHoldingId
          ? {
              ...h,
              quantity: proposed.netQty,
              purchasePrice: proposed.avgCostPLN,
              exchange: 'CC',
              updatedAt: now,
            }
          : h,
      )
      setDoneParts((prev) => [...prev, 'BTC holding updated'])
    } else {
      nextHoldings = [
        ...account.holdings,
        {
          id: crypto.randomUUID(),
          accountId,
          name: 'Bitcoin',
          ticker: 'BTC',
          exchange: 'CC',
          category: 'crypto' as const,
          quantity: proposed.netQty,
          purchasePrice: proposed.avgCostPLN,
          currentPrice: proposed.avgCostPLN,
          purchaseDate: proposed.earliestDate,
          createdAt: now,
          updatedAt: now,
        },
      ]
      setDoneParts((prev) => [...prev, 'BTC holding created'])
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
        isImporting={step === 'importing'}
        needsExchangePatch={needsExchangePatch}
        onConfirm={handlePreviewConfirm}
        onBack={onBack}
      />
    )
  }

  if (step === 'receive_cost' && parseResult) {
    const receiveTxns = parseResult.transactions.filter((t) => t.type === 'receive')
    const currentReceive = receiveTxns[receiveIndex]
    return (
      <ReceiveCostStep
        btcQty={currentReceive?.quantity ?? 0}
        date={currentReceive?.date ?? ''}
        costInput={receiveCostInput}
        onCostChange={setReceiveCostInput}
        onConfirm={handleReceiveCostConfirm}
        onSkip={handleReceiveCostSkip}
        index={receiveIndex}
        total={receiveTxns.length}
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
  isImporting,
  needsExchangePatch,
  onConfirm,
  onBack,
}: {
  parseResult: BtcParseResult
  isImporting: boolean
  needsExchangePatch: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const { transactions, skipped, warnings, buyQty, sellQty, sendQty, receiveQty } = parseResult

  const newTxCount = transactions.length
  const netQty = round8(buyQty + receiveQty - sellQty - sendQty)
  const hasBreakdown = buyQty > 0 || sellQty > 0 || sendQty > 0 || receiveQty > 0

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
          {newTxCount > 0 && (
            <div className="flex items-center gap-2">
              <CircleCheck size={16} className="text-positive shrink-0" />
              <span className="text-sm text-foreground tracking-[-0.35px]">
                {newTxCount} transaction{newTxCount !== 1 ? 's' : ''} to import
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

        {/* Quantity breakdown */}
        {hasBreakdown && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '50%' }} />
                <col style={{ width: '50%' }} />
              </colgroup>
              <thead>
                <tr className="bg-muted border-b border-borderLight">
                  <th className="h-11 px-3 text-left align-middle border-r border-borderLight"><span className="block truncate text-xs font-medium text-accent">Type</span></th>
                  <th className="h-11 px-3 text-right align-middle"><span className="block truncate text-xs font-medium text-accent">BTC</span></th>
                </tr>
              </thead>
              <tbody>
                {buyQty > 0 && <QtyRow label="Bought" value={`+${formatQty(buyQty)}`} tone="positive" />}
                {receiveQty > 0 && <QtyRow label="Received" value={`+${formatQty(receiveQty)}`} tone="positive" />}
                {sellQty > 0 && <QtyRow label="Sold" value={`−${formatQty(sellQty)}`} tone="negative" />}
                {sendQty > 0 && <QtyRow label="Sent" value={`−${formatQty(sendQty)}`} tone="negative" />}
                <tr className="border-b border-borderLight last:border-b-0">
                  <td className="h-11 px-3 align-middle border-r border-borderLight">
                    <span className="block truncate text-xs font-medium text-foreground">Net (all PDFs)</span>
                  </td>
                  <td className="h-11 px-3 align-middle">
                    <span className="block truncate text-xs font-medium text-foreground text-right">{formatQty(netQty)} BTC</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {newTxCount === 0 && skipped > 0 && (
          <p className="text-sm text-accent text-center py-2">
            {needsExchangePatch
              ? 'All PDFs already imported. Proceed to update the BTC holding with price-refresh support.'
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
          disabled={(newTxCount === 0 && !needsExchangePatch) || isImporting}
        >
          {isImporting
            ? 'Importing…'
            : newTxCount === 0 && needsExchangePatch
              ? 'Update BTC holding'
              : `Import ${newTxCount} transaction${newTxCount !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </div>
  )
}

/** A single quantity-breakdown row (label + signed BTC amount). */
function QtyRow({ label, value, tone }: { label: string; value: string; tone: 'positive' | 'negative' }) {
  return (
    <tr className="border-b border-borderLight last:border-b-0">
      <td className="h-11 px-3 align-middle border-r border-borderLight">
        <span className="block truncate text-xs text-foregroundMuted">{label}</span>
      </td>
      <td className="h-11 px-3 align-middle">
        <span className={`block truncate text-xs text-right ${tone === 'positive' ? 'text-positive' : 'text-negative'}`}>{value}</span>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────
// Receive cost basis sub-step
// ─────────────────────────────────────────

function ReceiveCostStep({
  btcQty,
  date,
  costInput,
  onCostChange,
  onConfirm,
  onSkip,
  index,
  total,
}: {
  btcQty: number
  date: string
  costInput: string
  onCostChange: (v: string) => void
  onConfirm: () => void
  onSkip: () => void
  index: number
  total: number
}) {
  const parsedCost = parseFloat(costInput.replace(/,/g, '.'))
  const isValid = costInput === '' || (!isNaN(parsedCost) && parsedCost >= 0)

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        {total > 1 && (
          <p className="text-sm text-accent text-right tracking-[-0.35px]">
            Receive {index + 1} of {total}
          </p>
        )}

        <InlineAlert variant="warning">
          Received BTC has no cost basis in the transfer document. Entering a cost basis is
          important for accurate capital gains tax calculations.
        </InlineAlert>

        {/* Receive summary */}
        <div className="border border-borderLight rounded-lg p-4 bg-background flex items-center justify-between">
          <span className="text-sm text-accent tracking-[-0.35px]">{date ? formatDate(date) : ''}</span>
          <span className="text-sm font-medium text-foreground tracking-[-0.35px]">{formatQty(btcQty)} BTC received</span>
        </div>

        <Input
          label="Cost Basis (total PLN paid / market value at receipt)"
          placeholder="e.g. 56.50"
          value={costInput}
          onChange={(e) => onCostChange(e.target.value)}
          error={!isValid ? 'Enter a valid amount (e.g. 56.50)' : undefined}
          type="text"
          inputMode="decimal"
        />

        <p className="text-sm text-accent tracking-[-0.35px]">
          If you received this as a gift or don't have a purchase price, enter the market value
          at the time of receipt (PLN equivalent).
        </p>
      </div>

      <div className="border-t border-borderLight p-5 flex items-center gap-2">
        <p className="flex-1 min-w-0 truncate text-sm font-medium text-accent tracking-[-0.35px]">{FOOTER_LABEL}</p>
        <Button variant="secondary" onClick={onSkip}>Skip (record as 0)</Button>
        <Button variant="primary" onClick={onConfirm} disabled={costInput !== '' && !isValid}>
          {total > 1 && index < total - 1 ? 'Next' : 'Confirm'}
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
  proposed: BtcProposedHolding
  onConfirm: () => void
  onSkip: () => void
}) {
  const isUpdate = proposed.existingHoldingId !== null

  const fields: { label: string; value: string }[] = [
    { label: 'Net Quantity', value: `${formatQty(round8(proposed.netQty))} BTC` },
    { label: 'Avg Cost (per BTC)', value: formatPLN(proposed.avgCostPLN) },
    { label: 'Total Cost Basis', value: formatPLN(proposed.totalCostPLN) },
    ...(!isUpdate ? [{ label: 'Purchase Date', value: proposed.earliestDate }] : []),
  ]

  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5 flex flex-col gap-5">
        <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
          {isUpdate
            ? 'A BTC holding already exists in this account. Update it with the net quantity and weighted-average cost basis?'
            : 'Create a BTC holding using the net quantity and weighted-average cost basis from all transactions?'}
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
