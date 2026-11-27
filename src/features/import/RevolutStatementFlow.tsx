/**
 * RevolutStatementFlow — Revolut's Crypto Account Statement:
 * parse → preview → import → holdings check → holding changes → done.
 *
 * One PDF holds every coin's buys, sells, sends and receives for a period
 * (`importers/revolutStatement.ts`). The rows are stored as described in
 * `importers/revolutStatementImport.ts`; then each coin's quantity, as of the
 * statement's end date, is compared with the statement's closing amount, and
 * a 0 PLN adjustment row is offered (ticked) for each coin that differs. New
 * coins become crypto holdings; holdings the account already had go through
 * the shared holding-changes step.
 */
import { useEffect, useMemo, useState } from 'react'
import { usePortfolio } from '@/context/PortfolioContext'
import { planHoldingSync, type HoldingSyncRow } from '@/domain/holdingSync'
import { extractPDFLayout } from '@/importers/pdfText'
import { parseRevolutStatement, type RevolutStatement } from '@/importers/revolutStatement'
import {
  adjustmentTransactions,
  buildStatementTransactions,
  checkStatementHoldings,
  closedCoinHoldings,
  newCoinHoldings,
  storedQuantity,
  planStatementRows,
  type PlannedRow,
  type StatementHoldingsCheck,
} from '@/importers/revolutStatementImport'
import { getCoinGeckoId } from '@/services/market-data/coinGecko'
import type { Account, Transaction } from '@/types'
import { HoldingSyncStep } from './HoldingSyncStep'
import { ImportDoneCard, ImportErrorCard, ImportSpinnerCard } from './ImportCards'
import { RevolutHoldingsCheckStep, RevolutStatementPreview } from './RevolutStatementSteps'
import { formatCost, parseCost, plural, statementDoneText, type StatementOutcome } from './revolutStatementText'
import { syncClause, useApplyHoldingSync } from './useApplyHoldingSync'
import type { DevSeed } from './devSeed'

export type RevolutStatementFlowProps = {
  accountId: string
  file: File
  onComplete: (message: string) => void
  onBack: () => void
  /** Notifies the parent when the flow enters/leaves the success (done) step. */
  onDoneChange?: (done: boolean) => void
  /** Dev-only: freeze the flow at a given step with seeded state. See devSeed.ts. */
  devSeed?: DevSeed<Step, RevolutStatementFlowDevState>
  /** The time zone the statement's local times are read in. Defaults to the browser's. */
  timeZone?: string
}

type Step = 'parsing' | 'preview' | 'importing' | 'holdings_check' | 'sync' | 'done'

/** Dev-only seedable state for the `/dev` showcase. */
export type RevolutStatementFlowDevState = {
  statement: RevolutStatement
  check: StatementHoldingsCheck
  syncRows: HoldingSyncRow[]
  outcome: StatementOutcome
}

/** The statement's pages as lines of text. */
async function readStatement(file: File): Promise<RevolutStatement> {
  const pages = await extractPDFLayout(file)
  return parseRevolutStatement(pages.map((page) => page.lines.map((line) => line.cells.map((c) => c.text).join(' '))))
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone'

export function RevolutStatementFlow({
  accountId,
  file,
  onComplete,
  onBack,
  onDoneChange,
  devSeed,
  timeZone = browserTimeZone(),
}: RevolutStatementFlowProps) {
  const { transactions, accounts, importTransactions, replaceAccounts } = usePortfolio()
  const applyHoldingSync = useApplyHoldingSync()
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? 'this account'

  const [step, setStep] = useState<Step>(devSeed?.step ?? 'parsing')
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<RevolutStatement | null>(devSeed?.state?.statement ?? null)
  const [costs, setCosts] = useState<Record<string, string>>({})
  const [check, setCheck] = useState<StatementHoldingsCheck | null>(devSeed?.state?.check ?? null)
  const [syncRows, setSyncRows] = useState<HoldingSyncRow[]>(devSeed?.state?.syncRows ?? [])
  const [outcome, setOutcome] = useState<StatementOutcome | null>(devSeed?.state?.outcome ?? null)
  /** The log and accounts as the import left them, and the rows it added, for the later steps. */
  const [snapshot, setSnapshot] = useState<{ transactions: Transaction[]; accounts: Account[]; imported: Transaction[] } | null>(null)

  // Ids already in the log, frozen at parse time so the preview doesn't change under the person.
  const [existingIds] = useState(() => new Set(transactions.map((t) => t.externalId)))
  const rows: PlannedRow[] = useMemo(() => (statement ? planStatementRows(statement, existingIds) : []), [statement, existingIds])

  useEffect(() => {
    onDoneChange?.(step === 'done')
  }, [step, onDoneChange])

  // Received rows start at the statement's value on the day; `costs` holds what the person typed.
  const costTexts = useMemo(
    () => Object.fromEntries(rows.flatMap((r) => (r.type === 'receive' ? [[r.id, costs[r.id] ?? formatCost(r.value)]] : []))),
    [rows, costs],
  )

  useEffect(() => {
    if (devSeed) return
    readStatement(file)
      .then((s) => {
        if (s.rows.length === 0 && s.warnings.length === 0 && Object.keys(s.closing).length === 0) {
          setError('No transactions or holdings could be read from this statement.')
          return
        }
        setStatement(s)
        setStep('preview')
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Only coins still held after the import need a price: the statement's
  // closing amount, or what its rows leave when it has none.
  const noPriceSource = useMemo(() => {
    if (!statement) return []
    const coins = new Set([...rows.map((r) => r.symbol), ...Object.keys(statement.closing)])
    const held = (c: string) => {
      const closing = statement.closing[c]
      if (closing) return closing.quantity > 0
      const net = rows
        .filter((r) => r.symbol === c)
        .reduce((q, r) => q + (r.type === 'buy' || r.type === 'receive' ? 1 : -1) * storedQuantity(r, r.feeMethod), 0)
      return net > 1e-8
    }
    return [...coins].filter((c) => held(c) && !getCoinGeckoId(c)).sort()
  }, [rows, statement])

  const staking = statement ? Object.values(statement.staking).reduce((a, b) => a + b, 0) : 0
  const imported = rows.filter((r) => !r.duplicate).length

  /** New coins become holdings; changes to holdings the account had go to the shared step. */
  function finish(log: Transaction[], accountsNow: Account[], added: Transaction[], adjustments: number, checked: StatementHoldingsCheck | null, matchingAfter: number) {
    if (!statement) return
    const account = accountsNow.find((a) => a.id === accountId)
    const coins = [...new Set([...rows.map((r) => r.symbol), ...Object.keys(statement.closing)])]
    const created = account ? newCoinHoldings(account, log, statement, coins) : []
    // Coins sold or sent out completely become closed holdings, like any closed position.
    const closed = account ? closedCoinHoldings(account, log, statement, coins) : []
    let nextAccounts = accountsNow
    if (account && created.length + closed.length > 0) {
      const now = new Date().toISOString()
      nextAccounts = accountsNow.map((a) =>
        a.id !== accountId
          ? a
          : {
              ...a,
              holdings: [...a.holdings, ...created],
              ...(closed.length > 0 && { closedHoldings: [...(a.closedHoldings ?? []), ...closed] }),
              lastUpdated: now,
            },
      )
      replaceAccounts(nextAccounts)
    }
    const nextAccount = nextAccounts.find((a) => a.id === accountId)
    const changes = nextAccount ? planHoldingSync(nextAccount, log, added) : []

    setOutcome({
      imported,
      accountName,
      asOf: checked?.asOf ?? null,
      coins: checked ? checked.matching.length + checked.differences.length : 0,
      matching: matchingAfter,
      adjustments,
      staking,
      holdings: [
        ...(created.length > 0 ? [`${plural(created.length, 'holding')} created`] : []),
        ...(closed.length > 0 ? [`${plural(closed.length, 'sold-out coin')} kept as closed ${closed.length === 1 ? 'position' : 'positions'}`] : []),
      ],
    })
    if (changes.length > 0) {
      setSyncRows(changes)
      setSnapshot({ transactions: log, accounts: nextAccounts, imported: added })
      setStep('sync')
    } else {
      setStep('done')
    }
  }

  function handleContinue() {
    if (!statement) return
    setStep('importing')
    const receiveCosts = new Map(rows.flatMap((r) => (r.type === 'receive' ? [[r.id, parseCost(costTexts[r.id] ?? '') ?? r.value] as const] : [])))
    const txs = buildStatementTransactions({ rows, statement, accountId, receiveCosts })
    const { mergedTransactions, nextAccounts } = importTransactions(txs, accountId)
    const result = checkStatementHoldings(statement, mergedTransactions, accountId)
    if (result && result.differences.length > 0) {
      setCheck(result)
      setSnapshot({ transactions: mergedTransactions, accounts: nextAccounts, imported: txs })
      setStep('holdings_check')
      return
    }
    finish(mergedTransactions, nextAccounts, txs, 0, result, result?.matching.length ?? 0)
  }

  function handleApply(symbols: Set<string>) {
    if (!check || !snapshot) return
    const chosen = check.differences.filter((d) => symbols.has(d.symbol))
    const adjustments = adjustmentTransactions(chosen, accountId, check.asOf)
    const { mergedTransactions, nextAccounts } = importTransactions(adjustments, accountId)
    finish(mergedTransactions, nextAccounts, [...snapshot.imported, ...adjustments], chosen.length, check, check.matching.length + chosen.length)
  }

  function handleSkipCheck() {
    if (!check || !snapshot) return
    finish(snapshot.transactions, snapshot.accounts, snapshot.imported, 0, check, check.matching.length)
  }

  function handleConfirmSync() {
    if (snapshot) {
      const result = applyHoldingSync(accountId, syncRows, snapshot.transactions)
      setOutcome((o) => (o ? { ...o, holdings: [...o.holdings, ...syncClause(result)] } : o))
    }
    setStep('done')
  }

  const done = outcome ? statementDoneText(outcome) : null

  if (error) return <ImportErrorCard message={`Couldn’t read the statement: ${error}`} onBack={onBack} />

  if (step === 'parsing') return <ImportSpinnerCard message="Reading the statement…" />

  if ((step === 'preview' || step === 'importing') && statement) {
    return (
      <RevolutStatementPreview
        statement={statement}
        rows={rows}
        accountName={accountName}
        timeZone={timeZone}
        costs={costTexts}
        onCostChange={(id, text) => setCosts((prev) => ({ ...prev, [id]: text }))}
        noPriceSource={noPriceSource}
        isImporting={step === 'importing'}
        onBack={onBack}
        onContinue={handleContinue}
      />
    )
  }

  if (step === 'holdings_check' && check) {
    return <RevolutHoldingsCheckStep check={check} onApply={handleApply} onSkip={handleSkipCheck} />
  }

  if (step === 'sync') {
    return <HoldingSyncStep rows={syncRows} onConfirm={handleConfirmSync} onSkip={() => setStep('done')} />
  }

  if (step === 'done' && done) {
    return (
      <ImportDoneCard
        message={done.message}
        detail={done.detail || undefined}
        onDone={() => onComplete(done.detail ? `${done.message}. ${done.detail}` : `${done.message}.`)}
      />
    )
  }

  return null
}
