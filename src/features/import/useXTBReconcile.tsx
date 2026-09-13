/**
 * useXTBReconcile — the post-import reconciliation state machine shared by the
 * XTB Cash Operations and daily-confirmation import flows.
 *
 * Sequences the two steps rendered by XTBReconcileSteps.tsx: create holdings for
 * unmatched instruments, then offer to recalculate cost bases. See that file for
 * why each step exists.
 */
import { useState, type ReactElement } from 'react'
import { recalculateCostBases } from '@/domain/calculations'
import { resolveDividendLinks } from '@/domain/transactions'
import {
  computeCostBasisDiff,
  computeUnmatchedInstruments,
  type CostBasisDiffRow,
  type UnmatchedRow,
  type UnresolvedRow,
} from '@/importers/xtbPostProcessing'
import { usePortfolio } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import type { Account, AssetCategory, Transaction } from '@/types'
import { holdingClause } from './doneSummary'
import {
  CostBasisStep,
  UnmatchedStep,
  type UnmatchedConfirmPayload,
} from './XTBReconcileSteps'

// ─────────────────────────────────────────
// Reconciliation hook
// ─────────────────────────────────────────

/** Which reconciliation step, if any, is currently showing. */
export type ReconcileStage = 'idle' | 'unmatched' | 'cost_basis'

/** Dev-only seed so the `/dev` showcase can freeze a reconciliation step. */
export type ReconcileSeed = {
  stage: ReconcileStage
  unmatchedRows?: UnmatchedRow[]
  unresolvedRows?: UnresolvedRow[]
  costBasisRows?: CostBasisDiffRow[]
}

export type UseXTBReconcile = {
  /**
   * Start reconciliation against the post-import state. Returns true when a
   * step is now showing, false when there was nothing to reconcile (in which
   * case the caller should go straight to its done screen).
   */
  begin: (mergedTransactions: Transaction[], nextAccounts: Account[]) => boolean
  /** The current step's UI, or null when {@link stage} is 'idle'. */
  render: () => ReactElement | null
}

/**
 * Drive the unmatched → cost-basis sequence.
 *
 * @param onFinish Called once both steps are resolved (or skipped), with the
 *                 summary clauses they produced — e.g. ["KRU holding created"].
 */
export function useXTBReconcile({
  accountId,
  onFinish,
  seed,
}: {
  accountId: string
  onFinish: (extraParts: string[]) => void
  seed?: ReconcileSeed
}): UseXTBReconcile {
  const { replaceAccounts, setTransactions } = usePortfolio()
  const { instrumentAliases } = useSettings()

  const [stage, setStage] = useState<ReconcileStage>(seed?.stage ?? 'idle')

  const [unmatchedRows, setUnmatchedRows] = useState<UnmatchedRow[]>(seed?.unmatchedRows ?? [])
  const [unresolvedRows, setUnresolvedRows] = useState<UnresolvedRow[]>(seed?.unresolvedRows ?? [])
  const [accountsSnapshot, setAccountsSnapshot] = useState<Account[]>([])
  const [transactionsSnapshot, setTransactionsSnapshot] = useState<Transaction[]>([])

  const [costBasisRows, setCostBasisRows] = useState<CostBasisDiffRow[]>(seed?.costBasisRows ?? [])
  const [cbAccountsSnapshot, setCbAccountsSnapshot] = useState<Account[]>([])
  const [cbTransactionsSnapshot, setCbTransactionsSnapshot] = useState<Transaction[]>([])

  /** Clauses accumulated across the steps, handed back via onFinish. */
  const [extraParts, setExtraParts] = useState<string[]>([])

  function beginCostBasis(
    accountsNow: Account[],
    transactionsNow: Transaction[],
    parts: string[],
  ): boolean {
    const diffRows = computeCostBasisDiff(accountsNow, transactionsNow, accountId)
    if (diffRows.length === 0) return false
    setCostBasisRows(diffRows)
    setCbAccountsSnapshot(accountsNow)
    setCbTransactionsSnapshot(transactionsNow)
    setExtraParts(parts)
    setStage('cost_basis')
    return true
  }

  function begin(mergedTransactions: Transaction[], nextAccounts: Account[]): boolean {
    const { matched, unresolved } = computeUnmatchedInstruments(
      mergedTransactions,
      nextAccounts,
      accountId,
      instrumentAliases,
    )

    if (matched.length > 0 || unresolved.length > 0) {
      setUnmatchedRows(matched)
      setUnresolvedRows(unresolved)
      setAccountsSnapshot(nextAccounts)
      setTransactionsSnapshot(mergedTransactions)
      setExtraParts([])
      setStage('unmatched')
      return true
    }

    return beginCostBasis(nextAccounts, mergedTransactions, [])
  }

  function finish(parts: string[]) {
    setStage('idle')
    onFinish(parts)
  }

  function handleConfirmUnmatched(payload: UnmatchedConfirmPayload) {
    const now = new Date().toISOString()

    const matchedHoldings = unmatchedRows
      .filter((r) => payload.checkedTickers.has(r.ticker))
      .map((r) => ({
        id: crypto.randomUUID(),
        accountId,
        name: r.instrument,
        ticker: r.ticker,
        exchange: r.exchange,
        category: payload.matchedCategories.get(r.ticker) ?? ('stock' as AssetCategory),
        quantity: r.totalQuantity,
        purchasePrice: r.avgCostPLN,
        currentPrice: r.avgCostPLN,
        purchaseDate: r.earliestDate,
        createdAt: now,
        updatedAt: now,
      }))

    const unresolvedHoldings = unresolvedRows
      .filter((r) => payload.checkedInstruments.has(r.instrument))
      .map((r) => {
        const rawTicker = payload.tickerOverrides.get(r.instrument) ?? ''
        const ticker = rawTicker.trim().toUpperCase() || undefined
        const exchange = payload.exchangeOverrides.get(r.instrument) || undefined
        return {
          id: crypto.randomUUID(),
          accountId,
          name: r.instrument,
          ticker,
          exchange,
          category: payload.unresolvedCategories.get(r.instrument) ?? ('stock' as AssetCategory),
          quantity: r.totalQuantity,
          purchasePrice: r.avgCostPLN,
          currentPrice: r.avgCostPLN,
          purchaseDate: r.earliestDate,
          createdAt: now,
          updatedAt: now,
        }
      })

    const newHoldings = [...matchedHoldings, ...unresolvedHoldings]

    const nextAccounts = accountsSnapshot.map((a) =>
      a.id === accountId
        ? { ...a, holdings: [...a.holdings, ...newHoldings], lastUpdated: now }
        : a,
    )

    // Backfill ticker/exchange onto transactions that were stored with ticker: undefined
    // because the holding didn't exist when they were imported (e.g. first XTB import).
    const tickerBackfill = new Map<string, { ticker: string; exchange?: string }>()
    for (const h of unresolvedHoldings) {
      if (h.ticker) tickerBackfill.set(h.name, { ticker: h.ticker, exchange: h.exchange })
    }
    const backfilledTransactions = tickerBackfill.size > 0
      ? transactionsSnapshot.map((t) => {
          if (t.ticker || !t.instrument) return t
          const fill = tickerBackfill.get(t.instrument)
          return fill ? { ...t, ticker: fill.ticker, exchange: fill.exchange ?? t.exchange } : t
        })
      : transactionsSnapshot

    const relinked = resolveDividendLinks(backfilledTransactions, nextAccounts)
    replaceAccounts(nextAccounts)
    setTransactions(relinked)

    const parts = [...extraParts]
    if (newHoldings.length > 0) {
      parts.push(holdingClause(newHoldings.length, newHoldings[0]?.ticker))
    }

    if (!beginCostBasis(nextAccounts, relinked, parts)) finish(parts)
  }

  function handleSkipUnmatched() {
    if (!beginCostBasis(accountsSnapshot, transactionsSnapshot, extraParts)) finish(extraParts)
  }

  function handleConfirmCostBasis() {
    const recalculated = recalculateCostBases(cbAccountsSnapshot, cbTransactionsSnapshot)
    replaceAccounts(recalculated)

    const parts = [...extraParts]
    parts.push(
      `Purchase prices updated for ${costBasisRows.length} holding${costBasisRows.length !== 1 ? 's' : ''}`,
    )
    finish(parts)
  }

  function render(): ReactElement | null {
    if (stage === 'unmatched') {
      return (
        <UnmatchedStep
          rows={unmatchedRows}
          unresolvedRows={unresolvedRows}
          onConfirm={handleConfirmUnmatched}
          onSkip={handleSkipUnmatched}
        />
      )
    }
    if (stage === 'cost_basis') {
      return (
        <CostBasisStep
          diffRows={costBasisRows}
          onConfirm={handleConfirmCostBasis}
          onSkip={() => finish(extraParts)}
        />
      )
    }
    return null
  }

  return { begin, render }
}
