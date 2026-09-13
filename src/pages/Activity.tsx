import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { DatePickerInput } from '@/components/ui/DatePickerInput'
import type { DateRange } from '@/components/ui/DatePickerInput'
import { DropdownItem, DropdownMenu, DropdownMenuGroup } from '@/components/ui/Dropdown'
import { z } from '@/utils/tokens'
import { Toast } from '@/components/ui/Toast'
import { PageHeader } from '@/components/layout/PageHeader'
import { FilterItem } from '@/components/ui/FilterItem'
import { ColorDot } from '@/components/ui/ColorDot'
import { Badge } from '@/components/ui/Badge'
import { StatCardGroup } from '@/components/ui/StatCardGroup'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatPLNDetail, formatQuantity } from '@/utils/formatters'
import { usePortfolio } from '@/context/PortfolioContext'
import { useFilterShortcut } from '@/hooks/useFilterShortcut'
import type { Account, Holding, Transaction, TransactionType } from '@/types'
import { staticLookupInstrument } from '@/domain/instrumentLookup'
import {
  Trash,
  Filter, ReceiptBill, BanknoteStack, ChartBarsWide, Elements,
  ProjectsBold, ComponentsBold, Wallet2Bold,
} from '@/generated/icons'

// ─────────────────────────────────────────
// Badge config per transaction type
// ─────────────────────────────────────────

type BadgeVariant = 'positive' | 'negative' | 'warning' | 'neutral' | 'blue'

type TypeMeta = {
  label: string
  variant: BadgeVariant
}

const TYPE_META: Record<TransactionType, TypeMeta> = {
  buy:             { label: 'Buy',      variant: 'neutral'   },
  sell:            { label: 'Sell',     variant: 'neutral'   },
  deposit:         { label: 'Deposit',  variant: 'blue'      },
  withdrawal:      { label: 'Withdraw', variant: 'warning'   },
  dividend:        { label: 'Dividend', variant: 'positive'  },
  withholding_tax: { label: 'Tax',              variant: 'negative'  },
  interest:        { label: 'Interest',        variant: 'positive'  },
  interest_tax:    { label: 'Interest Tax',    variant: 'negative'  },
  fee:             { label: 'Fee',      variant: 'negative'  },
  send:            { label: 'Send',     variant: 'warning'   },
  receive:         { label: 'Receive',  variant: 'positive'  },
}


// ─────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────

function formatDateTime(isoDate: string): string {
  const d = new Date(isoDate)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function formatAmountRaw(amount: number): string {
  const sign = amount > 0 ? '+' : ''
  return `${sign}${formatPLNDetail(amount).replace(/\s?PLN$/, '')}`
}


// ─────────────────────────────────────────
// Activity stat card (simple: label + icon + value + optional PLN)
// ─────────────────────────────────────────

type ActivityStatCardProps = {
  label: string
  value: number
  icon: React.ReactNode
  showUnit?: boolean
  showSign?: boolean
}

function ActivityStatCard({ label, value, icon, showUnit = true, showSign = false }: ActivityStatCardProps) {
  const display = showUnit
    ? Math.round(Math.abs(value)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    : String(value)
  const formatted = showSign && showUnit && value !== 0
    ? (value > 0 ? `+${display}` : `−${display}`)
    : display

  return (
    <div className="flex flex-col gap-2 p-6">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm leading-none text-accent tracking-[-0.35px]">{label}</span>
        <span className="shrink-0 text-accent">{icon}</span>
      </div>
      <div className="flex items-center gap-1.5 leading-none">
        <span
          className="text-xl leading-none font-bold text-foreground tabular-nums lining-nums"
          style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}
        >
          {formatted}
        </span>
        {showUnit && (
          <span className="text-sm text-accent">PLN</span>
        )}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────
// Activity filter panel
// ─────────────────────────────────────────

type View = 'root' | 'type' | 'instrument' | 'account'

const TYPE_GROUPS: { types: TransactionType[]; divider: boolean }[] = [
  { types: ['buy', 'sell'], divider: true },
  { types: ['deposit', 'withdrawal', 'dividend', 'withholding_tax', 'interest', 'interest_tax', 'fee'], divider: true },
  { types: ['send', 'receive'], divider: false },
]

type ActivityFilterPanelProps = {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  initialView?: View
  typeFilter: Set<TransactionType>
  onTypeChange: (v: Set<TransactionType>) => void
  accountFilter: string
  onAccountChange: (v: string) => void
  accountOptions: { value: string; label: string }[]
  instrumentFilter: Set<string>
  onInstrumentChange: (v: Set<string>) => void
  instrumentOptions: string[]
}

function ActivityFilterPanel({
  anchorEl, open, onClose, initialView,
  typeFilter, onTypeChange,
  accountFilter, onAccountChange, accountOptions,
  instrumentFilter, onInstrumentChange, instrumentOptions,
}: ActivityFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [view, setView] = useState<View>('root')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (open && anchorEl) {
      const r = anchorEl.getBoundingClientRect()
      setPos({ top: r.bottom + 8, left: r.left + r.width / 2 - 88 })
      setView(initialView ?? 'root')
    }
    if (!open) {
      setView('root')
      setSearch('')
    }
  }, [open, anchorEl, initialView])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (!panelRef.current?.contains(target) && !anchorEl?.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, anchorEl, onClose])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (view !== 'root') { setView('root'); setSearch('') }
        else onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, view])

  function toggleType(type: TransactionType) {
    const next = new Set(typeFilter)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onTypeChange(next)
  }

  function toggleInstrument(key: string) {
    const next = new Set(instrumentFilter)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onInstrumentChange(next)
  }

  if (!open || !pos) return null

  const rootCategories = [
    { key: 'type' as View, icon: <ProjectsBold size={16} />, label: 'Type' },
    { key: 'instrument' as View, icon: <ComponentsBold size={16} />, label: 'Instrument' },
    { key: 'account' as View, icon: <Wallet2Bold size={16} />, label: 'Account' },
  ].filter(c => !search || c.label.toLowerCase().includes(search.toLowerCase()))

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: z.popover }}
    >
      <DropdownMenu>
        {view === 'root' && (
          <>
            <DropdownMenuGroup divider>
              <DropdownItem type="search" placeholder="Add filter..." value={search} onChange={v => { setSearch(v) }} autoFocus />
            </DropdownMenuGroup>
            <DropdownMenuGroup>
              {rootCategories.map(c => (
                <DropdownItem
                  key={c.key}
                  type="default"
                  icon={c.icon}
                  label={c.label}
                  showArrow
                  onClick={() => { setView(c.key); setSearch('') }}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}

        {view === 'type' && (
          <>
            <DropdownMenuGroup divider>
              <DropdownItem type="search" placeholder="Filter..." value={search} onChange={setSearch} autoFocus />
            </DropdownMenuGroup>
            {TYPE_GROUPS.map((group, i) => {
              const items = group.types
                .filter(t => !search || TYPE_META[t].label.toLowerCase().includes(search.toLowerCase()))
              if (items.length === 0) return null
              return (
                <DropdownMenuGroup key={i} divider={group.divider && i < TYPE_GROUPS.length - 1}>
                  {items.map(t => (
                    <DropdownItem
                      key={t}
                      type="checkbox"
                      label={TYPE_META[t].label}
                      checked={typeFilter.has(t)}
                      onChange={() => toggleType(t)}
                    />
                  ))}
                </DropdownMenuGroup>
              )
            })}
          </>
        )}

        {view === 'instrument' && (
          <>
            <DropdownMenuGroup divider>
              <DropdownItem type="search" placeholder="Filter..." value={search} onChange={setSearch} autoFocus />
            </DropdownMenuGroup>
            <DropdownMenuGroup>
              {instrumentOptions
                .filter(k => !search || k.toLowerCase().includes(search.toLowerCase()))
                .map(k => (
                  <DropdownItem
                    key={k}
                    type="checkbox"
                    label={k}
                    checked={instrumentFilter.has(k)}
                    onChange={() => toggleInstrument(k)}
                  />
                ))}
            </DropdownMenuGroup>
          </>
        )}

        {view === 'account' && (
          <>
            <DropdownMenuGroup>
              {accountOptions
                .filter(o => o.value !== 'all')
                .filter(o => !search || o.label.toLowerCase().includes(search.toLowerCase()))
                .map(o => (
                  <DropdownItem
                    key={o.value}
                    type="radio"
                    label={o.label}
                    checked={accountFilter === o.value}
                    onChange={() => onAccountChange(accountFilter === o.value ? 'all' : o.value)}
                  />
                ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenu>
    </div>,
    document.body,
  )
}


// ─────────────────────────────────────────
// Activity Page
// ─────────────────────────────────────────

export function Activity() {
  const { transactions, accounts, deleteTransaction, deleteHolding, setTransactions, replaceAccounts } = usePortfolio()

  // ── Filter panel ──────────────────────
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterOpenView, setFilterOpenView] = useState<View>('root')
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)

  function openFilterAt(view: View, anchor?: HTMLElement) {
    setFilterAnchorEl(anchor ?? filterButtonRef.current)
    setFilterOpenView(view)
    setFilterOpen(true)
  }

  // ── Delete with undo ─────────────────
  // deleteHolding cascades to all transactions matching the holding's ticker/name
  // (dividends, taxes, …), so undo restores pre-delete snapshots of both stores
  // rather than re-adding just the one deleted row.
  const [undoTransaction, setUndoTransaction] = useState<Transaction | null>(null)
  const [undoSnapshot, setUndoSnapshot] = useState<{ transactions: Transaction[]; accounts: Account[] | null } | null>(null)

  function findOrphanedHolding(t: Transaction): Holding | null {
    if (t.type !== 'buy') return null

    const account = accounts.find(a => a.id === t.accountId)
    if (!account) return null

    const resolvedTicker = (
      t.ticker ?? (t.instrument ? staticLookupInstrument(t.instrument)?.ticker : undefined)
    )?.toUpperCase()

    if (resolvedTicker) {
      const remainingBuys = transactions.filter(tx => {
        if (tx.id === t.id || tx.type !== 'buy' || tx.accountId !== t.accountId) return false
        const txTicker = (
          tx.ticker ?? (tx.instrument ? staticLookupInstrument(tx.instrument)?.ticker : undefined)
        )?.toUpperCase()
        return txTicker === resolvedTicker
      })
      if (remainingBuys.length > 0) return null
      return account.holdings.find(
        h => !h.isSynthetic &&
             (h.ticker?.toUpperCase() === resolvedTicker ||
              h.name.toLowerCase() === t.instrument?.toLowerCase())
      ) ?? null
    }

    if (t.instrument) {
      const instrumentLower = t.instrument.toLowerCase()
      const remainingBuys = transactions.filter(
        tx => tx.id !== t.id && tx.type === 'buy' && tx.accountId === t.accountId &&
              tx.instrument?.toLowerCase() === instrumentLower
      )
      if (remainingBuys.length > 0) return null
      return account.holdings.find(
        h => !h.isSynthetic && h.name.toLowerCase() === instrumentLower
      ) ?? null
    }

    return null
  }

  function handleDelete(t: Transaction) {
    const orphan = findOrphanedHolding(t)
    setUndoTransaction(t)
    setUndoSnapshot({ transactions, accounts: orphan ? accounts : null })
    deleteTransaction(t.id)
    if (orphan) deleteHolding(orphan.id)
    setToast({ open: true, message: orphan ? 'Transaction and holding deleted' : 'Transaction deleted' })
  }

  function handleUndoDelete() {
    if (!undoSnapshot) return
    setTransactions(undoSnapshot.transactions)
    if (undoSnapshot.accounts) {
      replaceAccounts(undoSnapshot.accounts)
    }
    setUndoTransaction(null)
    setUndoSnapshot(null)
  }

  // ── Toast ─────────────────────────────
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  })

  // ── Filter state ──────────────────────
  const [typeFilter, setTypeFilter] = useState<Set<TransactionType>>(new Set())
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [instrumentFilter, setInstrumentFilter] = useState<Set<string>>(new Set())
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  // accountId → name
  const accountNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const acc of accounts) map[acc.id] = acc.name
    return map
  }, [accounts])

  const accountOptions = useMemo(() => [
    { value: 'all', label: 'All Accounts' },
    ...accounts.map(acc => ({ value: acc.id, label: acc.name })),
  ], [accounts])

  const instrumentOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const t of transactions) {
      const key = t.ticker?.toUpperCase() ?? t.instrument
      if (key) seen.add(key)
    }
    return [...seen].sort()
  }, [transactions])

  // Holding lookup by ticker / name for HoldingIcon.
  // Name entries prefer holdings that have a ticker set, so a no-ticker duplicate
  // (e.g. same stock imported via eMakler into a second account) never shadows
  // a ticker-bearing holding from an earlier account.
  const holdingByKey = useMemo(() => {
    const map = new Map<string, Holding>()
    for (const acc of accounts) {
      for (const h of acc.holdings) {
        if (h.ticker) map.set(h.ticker.toUpperCase(), h)
        const nameKey = h.name.toLowerCase()
        if (!map.has(nameKey) || !map.get(nameKey)!.ticker) {
          map.set(nameKey, h)
        }
      }
    }
    return map
  }, [accounts])

  const typeStackItems = useMemo(() =>
    [...typeFilter].map(t => (
      <ColorDot key={t} variant={TYPE_META[t].variant} size={12} />
    )),
  [typeFilter])

  const instrumentStackItems = useMemo(() =>
    [...instrumentFilter].map(key => {
      const holding = holdingByKey.get(key) ?? holdingByKey.get(key.toLowerCase()) ?? null
      return holding
        ? <HoldingIcon key={key} holding={holding} size={12} />
        : <div key={key} className="size-3 rounded-full bg-neutral" />
    }),
  [instrumentFilter, holdingByKey])

  // ── Filtered rows ─────────────────────
  const filteredRows = useMemo(() => {
    return [...transactions]
      .filter(t => {
        if (typeFilter.size > 0 && !typeFilter.has(t.type)) return false
        if (accountFilter !== 'all' && t.accountId !== accountFilter) return false
        if (instrumentFilter.size > 0) {
          const key = t.ticker?.toUpperCase() ?? t.instrument
          if (!key || !instrumentFilter.has(key)) return false
        }
        if (dateRange?.from && new Date(t.date) < dateRange.from) return false
        if (dateRange?.to && new Date(t.date) > new Date(dateRange.to.getTime() + 86399999)) return false
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [transactions, typeFilter, accountFilter, instrumentFilter, dateRange])

  // ── Summary (reflects filtered rows) ──
  const summary = useMemo(() => {
    let dividendsGross = 0, withholdingTax = 0, interestTax = 0, fees = 0, invested = 0
    for (const t of filteredRows) {
      switch (t.type) {
        case 'dividend':        dividendsGross += t.amountPLN; break
        case 'withholding_tax': withholdingTax += t.amountPLN; break
        case 'interest_tax':    interestTax    += t.amountPLN; break
        case 'fee':             fees           += t.amountPLN; break
        // Invested = capital deployed across the filtered rows: buys add (cash
        // out, amountPLN < 0) and sells return (cash in, amountPLN > 0), so
        // negating amountPLN gives net capital put to work. A pure per-row sum,
        // so it tracks every filter, type included. This is an activity-flow
        // figure — distinct from Overview's holdings cost-basis "Net invested".
        case 'buy':
        case 'sell':            invested       -= t.amountPLN; break
      }
    }
    return {
      feesAndTaxes: fees + withholdingTax + interestTax,
      dividendsNet: dividendsGross + withholdingTax,
      invested,
    }
  }, [filteredRows])

  const noTransactions = transactions.length === 0
  const hasActiveFilters =
    typeFilter.size > 0 || accountFilter !== 'all' || instrumentFilter.size > 0 || dateRange !== undefined

  // "F" toggles the filter panel (matches the filter button, which is disabled when empty)
  useFilterShortcut(useCallback(() => {
    if (noTransactions) return
    setFilterAnchorEl(filterButtonRef.current)
    setFilterOpen(v => !v)
  }, [noTransactions]))

  return (
    <div className="mx-auto max-w-[896px] w-full">
      <PageHeader
        title="Activity"
        action={
          <>
            {hasActiveFilters && (() => {
              const badges = [
                typeFilter.size > 0 && (
                  <FilterItem
                    key="type"
                    label="Type"
                    values={[...typeFilter].map(t => TYPE_META[t].label)}
                    valueLabel="types"
                    stackItems={typeStackItems}
                    onRemove={() => setTypeFilter(new Set())}
                    onEdit={el => openFilterAt('type', el)}
                  />
                ),
                accountFilter !== 'all' && (
                  <FilterItem
                    key="account"
                    label="Account"
                    values={[accountOptions.find(o => o.value === accountFilter)?.label ?? accountFilter]}
                    valueLabel="account"
                    onRemove={() => setAccountFilter('all')}
                    onEdit={el => openFilterAt('account', el)}
                  />
                ),
                instrumentFilter.size > 0 && (
                  <FilterItem
                    key="instrument"
                    label="Instrument"
                    values={[...instrumentFilter]}
                    valueLabel="instruments"
                    stackItems={instrumentStackItems}
                    onRemove={() => setInstrumentFilter(new Set())}
                    onEdit={el => openFilterAt('instrument', el)}
                  />
                ),
              ].filter(Boolean) as React.ReactElement[]
              return (
                <div className="flex items-center gap-2">
                  {badges.map((badge, i) => (
                    <Fragment key={badge.key}>
                      {badge}
                      {i < badges.length - 1 && (
                        <span className="text-sm text-accent select-none">·</span>
                      )}
                    </Fragment>
                  ))}
                </div>
              )
            })()}
            <Button
              ref={filterButtonRef}
              variant="secondary"
              iconPosition="only"
              icon={Filter}
              disabled={noTransactions}
              onClick={() => { setFilterAnchorEl(filterButtonRef.current); setFilterOpen(v => !v) }}
              aria-label="Filter transactions"
            />
            <DatePickerInput
              value={dateRange}
              onChange={setDateRange}
              triggerVariant="button"
              showPanel
              placeholder="All Time"
              disabled={noTransactions}
            />
          </>
        }
      />

      <ActivityFilterPanel
        anchorEl={filterAnchorEl}
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        initialView={filterOpenView}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        accountFilter={accountFilter}
        onAccountChange={setAccountFilter}
        accountOptions={accountOptions}
        instrumentFilter={instrumentFilter}
        onInstrumentChange={setInstrumentFilter}
        instrumentOptions={instrumentOptions}
      />

      {/* Stat Cards */}
      <div className="mb-6">
        <StatCardGroup>
          <ActivityStatCard
            label="Fees & Taxes"
            value={summary.feesAndTaxes}
            icon={<ReceiptBill size={16} />}
          />
          <ActivityStatCard
            label="Dividends earned"
            value={summary.dividendsNet}
            icon={<BanknoteStack size={16} />}
          />
          <ActivityStatCard
            label="Invested"
            value={summary.invested}
            icon={<ChartBarsWide size={16} />}
            showUnit
          />
          <ActivityStatCard
            label="Activities"
            value={filteredRows.length}
            icon={<Elements size={16} />}
            showUnit={false}
          />
        </StatCardGroup>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="h-14">
              <th className="w-[120px] text-left px-4 py-2 text-sm font-normal tracking-tight text-accent">Date</th>
              <th className="w-[120px] text-left px-4 py-2 text-sm font-normal tracking-tight text-accent">Type</th>
              <th className="text-left px-4 py-2 text-sm font-normal tracking-tight text-accent">Instrument</th>
              <th className="w-[120px] text-left px-4 py-2 text-sm font-normal tracking-tight text-accent">Account</th>
              <th className="w-[120px] text-right px-4 py-2 text-sm font-normal tracking-tight text-accent">Quantity</th>
              <th className="text-right pl-4 pr-0 py-2 text-sm font-normal tracking-tight text-accent">Amount</th>
              <th className="w-14 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <EmptyState
                    title={transactions.length === 0 ? 'No transactions yet' : 'No transactions match filters'}
                    description={transactions.length === 0
                      ? 'Import your transaction history to see it here.'
                      : 'Try changing or clearing the filters above.'}
                  />
                </td>
              </tr>
            ) : (
              filteredRows.map(t => {
                const meta = TYPE_META[t.type]
                const instrument = t.instrument ?? t.relatedInstrument
                const ticker = t.ticker ?? t.relatedTicker
                const holding = (ticker && holdingByKey.get(ticker.toUpperCase()))
                  ?? (instrument && holdingByKey.get(instrument.toLowerCase()))
                  ?? null
                const amountColor =
                  t.amountPLN > 0 ? 'text-positive'
                  : t.amountPLN < 0 ? 'text-negative'
                  : 'text-accent'

                return (
                  <tr
                    key={t.id}
                    className="border-t border-borderLight hover:bg-muted transition-colors group h-14"
                  >
                    <td className="w-[120px] px-4 py-2 text-sm tracking-tight text-foregroundMuted whitespace-nowrap">
                      {formatDateTime(t.date)}
                    </td>
                    <td className="w-[120px] px-4 py-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      {instrument ? (
                        <div className="flex items-center gap-2">
                          {holding && <HoldingIcon holding={holding} size={24} />}
                          <span className="text-sm tracking-tight text-foreground truncate max-w-[160px]">
                            {instrument}
                          </span>
                        </div>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                    <td className="w-[120px] px-4 py-2 text-sm tracking-tight text-foregroundMuted truncate">
                      {accountNames[t.accountId] ?? t.accountId}
                    </td>
                    <td className="w-[120px] px-4 py-2 text-right text-sm tracking-tight text-foregroundMuted tabular-nums lining-nums" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
                      {t.quantity != null ? formatQuantity(t.quantity, 3) : <span className="opacity-50">—</span>}
                    </td>
                    <td className="pl-4 pr-0 py-2 text-right whitespace-nowrap">
                      <span
                        className={`text-sm font-medium tracking-tight tabular-nums lining-nums ${amountColor}`}
                        style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}
                      >
                        {formatAmountRaw(t.amountPLN)} PLN
                      </span>
                    </td>
                    <td className="w-14 px-4 py-2">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => handleDelete(t)}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-accent hover:text-negative transition-all cursor-pointer"
                          aria-label="Delete transaction"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      <Toast
        isOpen={toast.open}
        onClose={() => { setToast(s => ({ ...s, open: false })); setUndoTransaction(null); setUndoSnapshot(null) }}
        message={toast.message}
        onUndo={undoTransaction ? handleUndoDelete : undefined}
      />
    </div>
  )
}
