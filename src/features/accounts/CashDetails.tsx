import { useNavigate } from 'react-router-dom'
import type { Transaction, TransactionType } from '@/types'
import {
  buildCashLedger,
  latestCashChanges,
  uncountedCashTransactions,
  type UncountedSource,
} from '@/domain/cashLedger'
import { formatPLNDetail, formatQuantity } from '@/utils/formatters'
import { usePortfolio } from '@/context/PortfolioContext'
import { AlertTriangle, CircleInfo } from '@/generated/icons'

/** Cash is the sum of the account's cash-moving transactions (see `computeAccountCashBalance`). */
const CASH_NOTE = 'Calculated from this account’s deposits, withdrawals, trades, income, taxes and fees.'

const UNCOUNTED_NOTE: Record<UncountedSource, { one: string; many: string }> = {
  emakler_import: {
    one: 'It came from an eMakler import and was paid from a bank account outside Vestly.',
    many: 'They came from an eMakler import and were paid from a bank account outside Vestly.',
  },
  bond_holding: {
    one: 'It’s a bond purchase recorded with your bond holdings, paid from outside this account.',
    many: 'They’re bond purchases recorded with your bond holdings, paid from outside this account.',
  },
  other: {
    one: 'It was paid from outside this account, so it doesn’t change the balance.',
    many: 'They were paid from outside this account, so they don’t change its cash.',
  },
}

const CHANGE_LABELS: Partial<Record<TransactionType, string>> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  interest: 'Interest',
  withholding_tax: 'Withholding tax',
  interest_tax: 'Interest tax',
  fee: 'Fee',
}

const TABULAR = "[font-feature-settings:'lnum'_1,'tnum'_1]"

/** Signed amount, as on the Activity page: "+" above zero, "−" below. */
function formatSignedPLN(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatPLNDetail(Math.abs(value))}`
}

/** Unsigned above zero, with a true minus ("−") below it. */
function formatBalancePLN(value: number): string {
  return `${value < 0 ? '−' : ''}${formatPLNDetail(Math.abs(value))}`
}

/** Amount colour, as on the Activity page. */
function amountColour(value: number): string {
  return value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-accent'
}

/** "Acme Corp · 3 units · 14/11/2026", leaving out parts with no data. */
function changeDetail(t: Transaction): string {
  const instrument = t.instrument ?? t.relatedInstrument
  const units =
    (t.type === 'buy' || t.type === 'sell') && t.quantity != null
      ? `${formatQuantity(t.quantity)} ${t.quantity === 1 ? 'unit' : 'units'}`
      : undefined
  const date = t.date.slice(0, 10).split('-').reverse().join('/')
  return [instrument, units, date].filter(Boolean).join(' · ')
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-foreground tracking-[-0.35px]">{children}</h3>
}

/** "View all →" and "Go to Activity →": Activity filtered to this account. */
function ActivityLink({ accountId, children }: { accountId: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(`/activity?account=${encodeURIComponent(accountId)}`)}
      className="text-xs font-medium text-accent text-left cursor-pointer hover:text-foregroundMuted transition-colors"
    >
      {children}
    </button>
  )
}

/** Transactions that don't move this account's cash, and why. */
function UncountedNote({ count, source }: { count: number; source: UncountedSource }) {
  const title = count === 1 ? '1 trade isn’t counted.' : `${count} trades aren’t counted.`
  return (
    <div className="rounded-lg overflow-hidden flex flex-col">
      <div className="bg-muted p-3 flex items-center justify-between gap-3">
        <p className={`text-xs font-medium text-foregroundMuted ${TABULAR}`}>{title}</p>
        <CircleInfo size={16} className="text-foregroundMuted shrink-0" aria-hidden="true" />
      </div>
      <p className="bg-muted border-t border-surface p-3 text-xs text-foregroundMuted leading-[1.5]">{UNCOUNTED_NOTE[source][count === 1 ? 'one' : 'many']}</p>
    </div>
  )
}

/**
 * The Cash row's panel body: the balance and how it adds up from the
 * account's cash-moving transactions. Read-only — Cash is rebuilt from the
 * log on every load, so there is nothing to edit, close or delete.
 */
export function CashDetails({ accountId }: { accountId: string }) {
  const { transactions } = usePortfolio()
  const ledger = buildCashLedger(transactions, accountId)
  const latest = latestCashChanges(transactions, accountId)
  const uncounted = uncountedCashTransactions(transactions, accountId)
  const balance = ledger.totalPLN
  const isEmpty = ledger.count === 0

  const balanceColour = isEmpty ? 'text-accent' : balance < 0 ? 'text-negative' : 'text-foreground'
  const uncountedNote = uncounted && <UncountedNote count={uncounted.count} source={uncounted.source} />

  return (
    <>
      {/* ── Balance ── */}
      <section className="flex flex-col">
        <p className="text-sm font-medium text-accent tracking-[-0.35px]">Available cash</p>
        <p className={`mt-4 text-[28px] font-bold leading-none ${TABULAR} ${balanceColour}`}>
          {formatBalancePLN(balance)}
        </p>
        <p className="mt-2 text-sm text-foregroundMuted leading-[1.5] tracking-[-0.35px]">{CASH_NOTE}</p>
        {balance < 0 && (
          <div className="mt-3 bg-warningForeground rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-warning shrink-0" aria-hidden="true" />
            <p className="text-xs text-foreground leading-[1.5]">
              <strong className="font-semibold">Cash is below zero.</strong> This usually means some of this
              account’s deposits haven’t been imported yet. Import them to see the real balance.
            </p>
          </div>
        )}
      </section>

      {isEmpty ? (
        <section className="flex flex-col gap-3">
          <div className="bg-muted rounded-lg p-3 flex flex-col gap-1">
            <p className="text-xs font-medium text-foregroundMuted">No cash transactions yet</p>
            <p className="text-xs text-foregroundMuted leading-[1.5]">
              Import a statement or add a deposit, and the balance will build up from there.
            </p>
            <div className="mt-2">
              <ActivityLink accountId={accountId}>Go to Activity →</ActivityLink>
            </div>
          </div>
          {uncountedNote}
        </section>
      ) : (
        <>
          {/* ── How it adds up ── */}
          <section className="flex flex-col gap-3">
            <SectionHeading>How it adds up</SectionHeading>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className={`w-full table-fixed text-xs font-medium ${TABULAR}`}>
                <thead>
                  <tr className="h-9">
                    <th scope="col" className="px-3 text-left font-medium text-accent">Kind</th>
                    <th scope="col" className="px-3 text-right font-medium text-accent">Count</th>
                    <th scope="col" className="px-3 text-right font-medium text-accent">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row) => (
                    <tr key={row.kind} className="h-9 border-t border-borderLight">
                      <th scope="row" className="px-3 text-left font-medium text-foregroundMuted whitespace-nowrap">{row.label}</th>
                      <td className="px-3 text-right text-foregroundMuted">{row.count}</td>
                      <td className={`px-3 text-right whitespace-nowrap ${amountColour(row.amountPLN)}`}>
                        {formatSignedPLN(row.amountPLN)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="h-9 border-t border-borderLight bg-muted">
                    <th scope="row" className="px-3 text-left font-medium text-accent">Cash</th>
                    <td className="px-3 text-right text-foreground">{ledger.count}</td>
                    <td className="px-3 text-right whitespace-nowrap text-foreground">{formatBalancePLN(balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {uncountedNote}
          </section>

          {/* ── Latest changes ── */}
          <section className="flex flex-col gap-3">
            <SectionHeading>Latest changes</SectionHeading>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className={`w-full table-fixed text-xs font-medium ${TABULAR}`}>
                <colgroup>
                  <col />
                  <col className="w-32" />
                </colgroup>
                <tbody>
                  {latest.map((t, i) => (
                    <tr key={t.id} className={`h-9 ${i > 0 ? 'border-t border-borderLight' : ''}`}>
                      <td className="px-3">
                        <div className="flex items-center gap-1 min-w-0 whitespace-nowrap">
                          <span className="shrink-0 text-foregroundMuted">{CHANGE_LABELS[t.type] ?? t.type}</span>
                          <span className="truncate text-accent">{changeDetail(t)}</span>
                        </div>
                      </td>
                      <td className={`px-3 text-right whitespace-nowrap ${amountColour(t.amountPLN)}`}>
                        {formatSignedPLN(t.amountPLN)}
                      </td>
                    </tr>
                  ))}
                  <tr className="h-9 border-t border-borderLight">
                    <td colSpan={2} className="px-3">
                      <ActivityLink accountId={accountId}>View all →</ActivityLink>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  )
}
