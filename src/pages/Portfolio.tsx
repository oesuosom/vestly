import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { FilterItem } from '@/components/ui/FilterItem'
import { DropdownItem, DropdownMenu, DropdownMenuGroup } from '@/components/ui/Dropdown'
import { z } from '@/utils/tokens'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { usePortfolio } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import { useFilterShortcut } from '@/hooks/useFilterShortcut'
import { getCategoryAllocation, getGroupDrift, getHoldingValue, getTotalReturn, getTotalValue, needsRebalancing } from '@/domain/calculations'
import { colors } from '@/utils/tokens'
import { formatPLN, formatPercent, formatQuantity } from '@/utils/formatters'
import { AllocationDonut } from '@/components/charts/AllocationDonut'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { EmptyState } from '@/components/ui/EmptyState'
import { HoldingSlidePanel } from '@/features/accounts/HoldingSlidePanel'
import type { AccountType, AssetCategory, Holding, Transaction } from '@/types'
import { Coins, ComponentsBold, Filter, PercentCircle, ProjectsBold, Wallet2Bold } from '@/generated/icons'
import { IconSwap } from '@/components/ui/IconSwap'

// ─────────────────────────────────────────
// TanStack column meta augmentation
// ─────────────────────────────────────────

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    width?: string
    align?: 'left' | 'right'
  }
}

// ─────────────────────────────────────────
// Group chart color map
// ─────────────────────────────────────────

const GROUP_COLORS: Record<string, string> = {
  bonds:  colors.chartGroupBonds,
  equity: colors.chartGroupEquity,
  cash:   colors.chartGroupCash,
  crypto: colors.chartGroupCrypto,
}
const FALLBACK_GROUP_COLOR = colors.chartGroupCash

// ─────────────────────────────────────────
// FlatHolding type — Holding enriched with account info
// ─────────────────────────────────────────

type FlatHolding = Holding & {
  accountName: string
  accountType: AccountType
}

// ─────────────────────────────────────────
// Label maps
// ─────────────────────────────────────────

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  stock: 'Stock',
  etf: 'ETF',
  bond: 'Bond',
  crypto: 'Crypto',
  cash: 'Cash',
}

// ─────────────────────────────────────────
// Table column definitions
// ─────────────────────────────────────────

const columnHelper = createColumnHelper<FlatHolding>()

function buildColumns(transactions: Transaction[]) {
  return [
    columnHelper.accessor('name', {
      header: 'Instrument',
      cell: (info) => {
        const holding = info.row.original
        return (
          <div className="flex items-center gap-2">
            <HoldingIcon holding={holding} size={24} />
            <span className="text-sm tracking-tight text-foreground truncate">
              {info.getValue()}
            </span>
          </div>
        )
      },
    }),

    columnHelper.accessor('accountName', {
      header: 'Account',
      meta: { width: 'w-32' },
      cell: (info) => (
        <span className="text-sm tracking-tight text-foregroundMuted truncate">
          {info.getValue()}
        </span>
      ),
    }),

    columnHelper.accessor('category', {
      header: 'Category',
      meta: { width: 'w-32' },
      cell: (info) => <Badge variant="neutral">{CATEGORY_LABELS[info.getValue()]}</Badge>,
    }),

    columnHelper.accessor('quantity', {
      header: 'Quantity',
      meta: { width: 'w-24', align: 'right' },
      cell: (info) => {
        const holding = info.row.original
        const qty = holding.category === 'cash'
          ? Math.round(getHoldingValue(holding))
          : info.getValue()
        return (
          <span
            className="text-sm tracking-tight text-foregroundMuted tabular-nums lining-nums"
            style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}
          >
            {formatQuantity(qty, 3)}
          </span>
        )
      },
    }),

    columnHelper.accessor(
      (row) => getHoldingValue(row),
      {
        id: 'value',
        header: 'Value',
        meta: { width: 'w-32', align: 'right' },
        cell: (info) => {
          const value = info.getValue()
          if (value === 0) {
            return (
              <div className="opacity-50">
                <span className="text-sm tracking-tight text-accent">—</span>
              </div>
            )
          }
          return (
            <span
              className="text-sm font-medium tracking-tight tabular-nums lining-nums text-foreground"
              style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}
            >
              {formatPLN(value)}
            </span>
          )
        },
      }
    ),

    columnHelper.accessor(
      (row) => getTotalReturn(row, transactions).totalPLN,
      {
        id: 'totalReturn',
        header: 'Total Return',
        meta: { width: 'w-32', align: 'right' },
        cell: (info) => {
          const holding = info.row.original
          const { totalPLN } = getTotalReturn(holding, transactions)
          if ((!holding.isSynthetic && holding.currentPrice === holding.purchasePrice) || totalPLN === 0) {
            return (
              <div className="opacity-50">
                <span className="text-sm tracking-tight text-accent">—</span>
              </div>
            )
          }
          const colorClass = totalPLN > 0 ? 'text-positive' : 'text-negative'
          const sign = totalPLN > 0 ? '+' : ''
          return (
            <span
              className={`text-sm font-medium tracking-tight tabular-nums lining-nums ${colorClass}`}
              style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}
            >
              {sign}{formatPLN(totalPLN)}
            </span>
          )
        },
      }
    ),
  ]
}

// ─────────────────────────────────────────
// PortfolioFilterPanel
// ─────────────────────────────────────────

type FilterView = 'root' | 'category' | 'instrument' | 'account'

type PortfolioFilterPanelProps = {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  initialView?: FilterView
  categoryFilter: Set<AssetCategory>
  onCategoryChange: (v: Set<AssetCategory>) => void
  instrumentFilter: Set<string>
  onInstrumentChange: (v: Set<string>) => void
  instrumentOptions: string[]
  accountFilter: string
  onAccountChange: (v: string) => void
  accountOptions: { value: string; label: string }[]
}

const CATEGORY_OPTIONS: { value: AssetCategory; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: 'Bond' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'cash', label: 'Cash' },
]

function PortfolioFilterPanel({
  anchorEl, open, onClose, initialView,
  categoryFilter, onCategoryChange,
  instrumentFilter, onInstrumentChange, instrumentOptions,
  accountFilter, onAccountChange, accountOptions,
}: PortfolioFilterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<FilterView>('root')
  const [search, setSearch] = useState('')

  // Reset the view when the panel opens (or is re-aimed while open), and the
  // search when it closes — adjusted during render, so a reopened panel never
  // paints a frame of its previous view.
  const [prevInputs, setPrevInputs] = useState({ open, anchorEl, initialView })
  if (open !== prevInputs.open || anchorEl !== prevInputs.anchorEl || initialView !== prevInputs.initialView) {
    setPrevInputs({ open, anchorEl, initialView })
    if (open && anchorEl) setView(initialView ?? 'root')
    if (!open) {
      setView('root')
      setSearch('')
    }
  }

  // Anchored under the trigger button. Measured while rendering the open panel
  // (the anchor is already on screen) rather than stored from an effect, which
  // painted one frame at the previous open's position first.
  const anchorRect = open ? anchorEl?.getBoundingClientRect() : undefined
  const pos = anchorRect ? { top: anchorRect.bottom + 8, left: anchorRect.right - 176 } : null

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

  if (!open || !pos) return null

  const navItems = [
    { key: 'category' as FilterView, icon: <ProjectsBold size={16} />, label: 'Category' },
    { key: 'instrument' as FilterView, icon: <ComponentsBold size={16} />, label: 'Instrument' },
    { key: 'account' as FilterView, icon: <Wallet2Bold size={16} />, label: 'Account' },
  ].filter((c) => !search || c.label.toLowerCase().includes(search.toLowerCase()))

  const allAccountOptions = [{ value: 'all', label: 'All Accounts' }, ...accountOptions]

  function toggleCategory(value: AssetCategory) {
    const next = new Set(categoryFilter)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onCategoryChange(next)
  }

  function toggleInstrument(name: string) {
    const next = new Set(instrumentFilter)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    onInstrumentChange(next)
  }

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: z.popover }}
    >
      <DropdownMenu>
        {view === 'root' && (
          <>
            <DropdownMenuGroup divider>
              <DropdownItem
                type="search"
                placeholder="Add filter..."
                value={search}
                onChange={setSearch}
                autoFocus
              />
            </DropdownMenuGroup>
            <DropdownMenuGroup>
              {navItems.map((c) => (
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

        {view === 'category' && (
          <DropdownMenuGroup>
            {CATEGORY_OPTIONS.map((o) => (
              <DropdownItem
                key={o.value}
                type="checkbox"
                label={o.label}
                checked={categoryFilter.has(o.value)}
                onChange={() => toggleCategory(o.value)}
              />
            ))}
          </DropdownMenuGroup>
        )}

        {view === 'instrument' && (
          <>
            <DropdownMenuGroup divider>
              <DropdownItem
                type="search"
                placeholder="Filter..."
                value={search}
                onChange={setSearch}
                autoFocus
              />
            </DropdownMenuGroup>
            <DropdownMenuGroup>
              {instrumentOptions
                .filter((name) => !search || name.toLowerCase().includes(search.toLowerCase()))
                .map((name) => (
                  <DropdownItem
                    key={name}
                    type="checkbox"
                    label={name}
                    checked={instrumentFilter.has(name)}
                    onChange={() => toggleInstrument(name)}
                  />
                ))}
            </DropdownMenuGroup>
          </>
        )}

        {view === 'account' && (
          <DropdownMenuGroup>
            {allAccountOptions.map((o) => (
              <DropdownItem
                key={o.value}
                type="radio"
                label={o.label}
                checked={accountFilter === o.value}
                onChange={() => onAccountChange(o.value)}
                name="portfolio-account"
                value={o.value}
              />
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenu>
    </div>,
    document.body,
  )
}

// ─────────────────────────────────────────
// Portfolio Page
// ─────────────────────────────────────────

export function Portfolio() {
  const { accounts, transactions } = usePortfolio()
  const settings = useSettings()

  const categoryAllocation = useMemo(() => getCategoryAllocation(accounts), [accounts])
  const totalPortfolioValue = useMemo(() => getTotalValue(accounts), [accounts])
  const [showAsPercent, setShowAsPercent] = useState(false)

  const groupDrift = useMemo(
    () => getGroupDrift(settings.allocationGroups, categoryAllocation),
    [settings.allocationGroups, categoryAllocation]
  )

  const showRebalancing = useMemo(
    () => needsRebalancing(groupDrift, settings.rebalancingThreshold),
    [groupDrift, settings.rebalancingThreshold]
  )

  const driftItems = useMemo(
    () => groupDrift
      .filter((d) => Math.abs(d.drift) > settings.rebalancingThreshold)
      .map((d) => ({ label: d.group.name, drift: d.drift })),
    [groupDrift, settings.rebalancingThreshold]
  )

  const donutGroups = useMemo(
    () => groupDrift
      .filter(({ current }) => current > 0)
      .map(({ group, current }) => ({
        name: group.name,
        value: current,
        color: GROUP_COLORS[group.id] ?? FALLBACK_GROUP_COLOR,
      })),
    [groupDrift]
  )

  // Filters
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<Set<AssetCategory>>(new Set())
  const [instrumentFilter, setInstrumentFilter] = useState<Set<string>>(new Set())

  // Filter panel
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterOpenView, setFilterOpenView] = useState<FilterView>('root')
  const [filterAnchorEl, setFilterAnchorEl] = useState<HTMLElement | null>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)

  function openFilterAt(view: FilterView, anchor?: HTMLElement) {
    setFilterAnchorEl(anchor ?? filterButtonRef.current)
    setFilterOpenView(view)
    setFilterOpen(true)
  }

  // "F" toggles the filter panel (matches the filter button)
  useFilterShortcut(useCallback(() => {
    setFilterAnchorEl(filterButtonRef.current)
    setFilterOpenView('root')
    setFilterOpen(v => !v)
  }, []))

  // Columns — rebuilt when transactions change
  const columns = useMemo(() => buildColumns(transactions), [transactions])

  // Holding detail panel state
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null)

  // Flatten all holdings across accounts
  const flatHoldings: FlatHolding[] = useMemo(() => {
    const result: FlatHolding[] = []
    for (const account of accounts) {
      for (const holding of account.holdings) {
        result.push({
          ...holding,
          accountName: account.name,
          accountType: account.type,
        })
      }
    }
    return result
  }, [accounts])

  // Unique instrument names for the filter panel
  const instrumentOptions = useMemo(() => {
    const seen = new Set<string>()
    return flatHoldings
      .filter((h) => { if (seen.has(h.name)) return false; seen.add(h.name); return true })
      .map((h) => h.name)
  }, [flatHoldings])

  // Apply filters, sorted by value descending
  const filteredHoldings = useMemo(() => {
    return flatHoldings
      .filter((h) => {
        if (getHoldingValue(h) === 0) return false
        if (accountFilter !== 'all' && h.accountId !== accountFilter) return false
        if (categoryFilter.size > 0 && !categoryFilter.has(h.category)) return false
        if (instrumentFilter.size > 0 && !instrumentFilter.has(h.name)) return false
        return true
      })
      .sort((a, b) => getHoldingValue(b) - getHoldingValue(a))
  }, [flatHoldings, accountFilter, categoryFilter, instrumentFilter])

  // Account options for filter panel
  const accountOptions = useMemo(() => {
    return accounts.map((a) => ({
      value: a.id,
      label: a.name,
    }))
  }, [accounts])

  // TanStack Table instance
  const table = useReactTable({
    data: filteredHoldings,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function handleRowClick(holding: FlatHolding) {
    setSelectedHoldingId(holding.id)
  }

  // Keep selected holding in sync with context (picks up edits made inside the panel)
  const liveSelectedHolding = selectedHoldingId
    ? accounts.flatMap((a) => a.holdings).find((h) => h.id === selectedHoldingId) ?? null
    : null

  const hasAccountFilter = accountFilter !== 'all'
  const hasCategoryFilter = categoryFilter.size > 0
  const hasInstrumentFilter = instrumentFilter.size > 0

  // No holdings at all
  if (flatHoldings.length === 0) {
    return (
      <div className="mx-auto max-w-[896px] w-full">
        <PageHeader
          title="Portfolio"
          action={
            <Button
              variant="secondary"
              iconPosition="only"
              icon={Filter}
              disabled
              aria-label="Filter holdings"
            />
          }
        />
        <EmptyState
          title="No holdings yet"
          description="Add holdings to your accounts to see them here as a unified list."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[896px] w-full">
      <PageHeader
        title="Portfolio"
        action={
          <>
            {hasCategoryFilter && (
              <FilterItem
                label="Category"
                values={[...categoryFilter].map((c) => CATEGORY_LABELS[c])}
                valueLabel="categories"
                onRemove={() => setCategoryFilter(new Set())}
                onEdit={(el) => openFilterAt('category', el)}
              />
            )}
            {hasInstrumentFilter && (
              <FilterItem
                label="Instrument"
                values={[...instrumentFilter]}
                valueLabel="instruments"
                onRemove={() => setInstrumentFilter(new Set())}
                onEdit={(el) => openFilterAt('instrument', el)}
              />
            )}
            {hasAccountFilter && (
              <FilterItem
                label="Account"
                values={[accountOptions.find((o) => o.value === accountFilter)?.label ?? accountFilter]}
                valueLabel="account"
                onRemove={() => setAccountFilter('all')}
                onEdit={(el) => openFilterAt('account', el)}
              />
            )}
            <Button
              ref={filterButtonRef}
              variant="secondary"
              iconPosition="only"
              icon={Filter}
              onClick={() => { setFilterAnchorEl(filterButtonRef.current); setFilterOpenView('root'); setFilterOpen((v) => !v) }}
              aria-label="Filter holdings"
            />
          </>
        }
      />

      <PortfolioFilterPanel
        anchorEl={filterAnchorEl}
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        initialView={filterOpenView}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        instrumentFilter={instrumentFilter}
        onInstrumentChange={setInstrumentFilter}
        instrumentOptions={instrumentOptions}
        accountFilter={accountFilter}
        onAccountChange={setAccountFilter}
        accountOptions={accountOptions}
      />

      {/* No results after filtering */}
      {filteredHoldings.length === 0 ? (
        <EmptyState
          title="No holdings match filters"
          description="Try changing or clearing the filters above."
          action={{
            label: 'Clear Filters',
            onClick: () => {
              setAccountFilter('all')
              setCategoryFilter(new Set())
              setInstrumentFilter(new Set())
            },
          }}
        />
      ) : (
        <>
          {/* Asset Allocation */}
          {groupDrift.length > 0 && (
            <div className="bg-surface border border-borderLight rounded-xl overflow-hidden flex h-56 mb-4">

              {/* Left: donut */}
              <div className="relative flex-1 flex items-center justify-center">
                <span className="absolute top-[21px] left-6 text-sm font-medium text-foreground tracking-[-0.35px]">
                  Allocation
                </span>
                <button
                  onClick={() => setShowAsPercent((p) => !p)}
                  className="absolute top-[18px] right-6 text-accent hover:text-foreground transition-colors"
                >
                  <IconSwap
                    state={showAsPercent ? 'b' : 'a'}
                    iconA={<PercentCircle className="size-5" />}
                    iconB={<Coins className="size-5" />}
                  />
                </button>
                <AllocationDonut
                  groups={donutGroups}
                  size={160}
                  totalValue={totalPortfolioValue}
                  showAsPercent={showAsPercent}
                />
              </div>

              {/* Divider */}
              <div className="w-px bg-borderLight self-stretch" />

              {/* Right: table */}
              <div className="flex-1 overflow-hidden">
                <table className="w-full table-fixed border-collapse h-full">
                  <tbody>
                    {groupDrift.map(({ group, current, drift }) => {
                      const color = GROUP_COLORS[group.id] ?? FALLBACK_GROUP_COLOR
                      const driftClass =
                        Math.abs(drift) > settings.rebalancingThreshold
                          ? 'text-warning'
                          : drift === 0
                          ? 'text-accent'
                          : 'text-foreground'
                      return (
                        <tr key={group.id} className="border-b border-borderLight h-14">
                          <td className="px-4">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-1 h-2.5 rounded-[2px] shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="text-sm text-foreground tracking-[-0.35px] truncate">
                                {group.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 text-sm text-foreground text-right" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
                            {formatPercent(current)}
                          </td>
                          <td className="px-4 text-sm text-accent text-right" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
                            {formatPercent(group.target)}
                          </td>
                          <td className={`px-4 text-sm text-right ${driftClass}`} style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
                            {formatPercent(drift, drift !== 0)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Rebalancing Alert */}
          {showRebalancing && driftItems.length > 0 && (
            <div className="mb-4">
              <InlineAlert variant="warning">
                {driftItems
                  .map(
                    (item) =>
                      `${item.label} ${formatPercent(Math.abs(item.drift))} ${item.drift > 0 ? 'above' : 'below'} target`
                  )
                  .join(', ')}{' '}
                — consider rebalancing
              </InlineAlert>
            </div>
          )}

          {/* Table */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="h-14">
                    {headerGroup.headers.map((header) => {
                      const meta = header.column.columnDef.meta
                      const isRight = meta?.align === 'right'
                      return (
                        <th
                          key={header.id}
                          className={`${meta?.width ?? ''} px-4 py-2 text-sm font-normal tracking-tight text-accent ${isRight ? 'text-right' : 'text-left'}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-borderLight hover:bg-muted transition-colors cursor-pointer group h-14"
                    onClick={() => handleRowClick(row.original)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleRowClick(row.original)
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta
                      return (
                        <td
                          key={cell.id}
                          className={`${meta?.width ?? ''} px-4 py-2 ${meta?.align === 'right' ? 'text-right' : ''}`}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}

      {/* Holding Detail Slide Panel */}
      <HoldingSlidePanel
        holding={liveSelectedHolding}
        isOpen={liveSelectedHolding !== null}
        onClose={() => setSelectedHoldingId(null)}
      />
    </div>
  )
}
