import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getStore } from '@/storage/portfolioStore'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { usePortfolio } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import { useHistoricalPrices } from '@/hooks/useHistoricalPrices'
import { useAccountInsight } from '@/hooks/useAccountInsight'
import { parseAccountInsightMarkup } from '@/services/claude'
import { getAccountValue, getHoldingValue, getHoldingPnL } from '@/domain/calculations'
import { formatPLN, formatPercent, formatDate, slugify, formatQuantity } from '@/utils/formatters'
import { fetchAllPrices } from '@/services/market-data/priceFetcher'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { DATE_RANGES } from '@/types'
import type { DateRange } from '@/types'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { DropdownMenu, DropdownMenuGroup, DropdownItem } from '@/components/ui/Dropdown'
import { PortfolioAreaChart } from '@/components/charts/PortfolioAreaChart'
import { AccountFormModal } from '@/features/accounts/AccountFormModal'
import { HoldingForm } from '@/features/accounts/HoldingForm'
import { HoldingSlidePanel } from '@/features/accounts/HoldingSlidePanel'
import { UnifiedImportModal } from '@/features/import/UnifiedImportModal'
import type { AssetCategory, Holding, AccountType, Snapshot } from '@/types'
import {
  Synchronize,
  EditSmall,
  MoreHorizontal,
  Plus,
  ArrowBoxOut,
  Trash,
} from '@/generated/icons'

// TanStack's ColumnMeta is augmented with { width?, align? } in Portfolio.tsx.
// That `declare module` is global, so this file's columns get the same typing
// without re-declaring it — re-declaring would be a duplicate-identifier error.

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  stock: 'Stock',
  etf: 'ETF',
  bond: 'Bond',
  crypto: 'Crypto',
  cash: 'Cash',
}

// ─────────────────────────────────────────
// Inline rich-text renderer for AI insight
// ─────────────────────────────────────────

function InsightText({ text }: { text: string }) {
  const parts = parseAccountInsightMarkup(text)
  return (
    <p className="text-[20px] leading-relaxed text-foreground tracking-[-0.5px]">
      {parts.map((part, i) => {
        if (typeof part === 'string') return <span key={i}>{part}</span>
        if (part.type === 'positive') return <span key={i} className="text-positive">{part.text}</span>
        if (part.type === 'negative') return <span key={i} className="text-negative">{part.text}</span>
        return (
          <span
            key={i}
            className="underline decoration-dotted decoration-border underline-offset-2"
          >
            {part.text}
          </span>
        )
      })}
    </p>
  )
}

// ─────────────────────────────────────────
// Inline stat block used in Card 2 bottom strip
// ─────────────────────────────────────────

function StatStrip({ label, valuePLN }: { label: string; valuePLN: number }) {
  const parts = formatPLN(valuePLN).split(' ')
  const amount = parts.slice(0, -1).join(' ')
  const unit = parts[parts.length - 1]
  return (
    <div className="flex flex-col gap-2 p-6 flex-1 min-w-0">
      <p className="text-sm leading-none text-accent tracking-[-0.35px]">{label}</p>
      <div className="flex items-baseline gap-1.5 leading-none">
        <span className="text-[20px] font-bold text-foreground tabular-nums" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
          {amount}
        </span>
        <span className="text-sm text-accent tracking-[-0.35px]">{unit}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────
// Per-row "more" menu
// ─────────────────────────────────────────

function HoldingMenuCell({
  onEdit,
  onDelete,
}: {
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center justify-center">
      <button
        className="flex items-center justify-center size-7 rounded-md text-accent hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20">
            <DropdownMenu>
              <DropdownMenuGroup>
                <DropdownItem
                  type="default"
                  icon={<EditSmall size={16} />}
                  label="Edit"
                  onClick={() => { setOpen(false); onEdit() }}
                />
                <DropdownItem
                  type="default"
                  icon={<Trash size={16} className="text-negative" />}
                  label="Delete"
                  onClick={() => { setOpen(false); onDelete() }}
                />
              </DropdownMenuGroup>
            </DropdownMenu>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────
// Main page
// ─────────────────────────────────────────

const columnHelper = createColumnHelper<Holding>()

export function AccountDetail() {
  const { accountSlug } = useParams<{ accountSlug: string }>()
  const navigate = useNavigate()
  const {
    accounts,
    snapshots,
    transactions,
    replaceAccounts,
    updateAccount,
    deleteAccount,
    addHolding,
    updateHolding,
    deleteHolding,
  } = usePortfolio()
  const contributions = getStore().contributions
  const settings = useSettings()
  const { historicalPrices } = useHistoricalPrices(accounts, settings.coinGeckoApiKey, settings.priceProvider.apiKey)

  const account = accounts.find((a) => slugify(a.name) === accountSlug)
  const accountId = account?.id

  // ── State ──────────────────────────────
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>('1Y')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [editAccountOpen, setEditAccountOpen] = useState(false)
  const [addHoldingOpen, setAddHoldingOpen] = useState(false)
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // ── Derived data ───────────────────────
  const accountTransactions = useMemo(
    () => transactions.filter((t) => t.accountId === accountId),
    [transactions, accountId]
  )

  const currentValuePLN = useMemo(
    () => (account ? getAccountValue(account) : 0),
    [account]
  )

  // Synthetic cash is uninvested balance, not cost basis — exclude it from both
  // sides of the return calculation (same rule as getTotalCostBasis).
  const { costBasisPLN, investedValuePLN } = useMemo(() => {
    const invested = (account?.holdings ?? []).filter((h) => !h.isSynthetic)
    return {
      costBasisPLN: invested.reduce((s, h) => s + h.purchasePrice * h.quantity, 0),
      investedValuePLN: invested.reduce((s, h) => s + getHoldingValue(h), 0),
    }
  }, [account])

  const totalReturnPLN = investedValuePLN - costBasisPLN
  const totalReturnPct = costBasisPLN > 0 ? (totalReturnPLN / costBasisPLN) * 100 : 0

  // Earliest purchase date for "since" label on trend line
  const earliestDate = useMemo(() => {
    if (!account || account.holdings.length === 0) return null
    return account.holdings.map((h) => h.purchaseDate).sort()[0]
  }, [account])

  // Map snapshots to account-specific totalValue
  const accountSnapshots: Snapshot[] = useMemo(() => {
    if (!accountId) return []
    return snapshots
      .filter((s) => s.accountValues[accountId] !== undefined)
      .map((s) => ({ ...s, totalValue: s.accountValues[accountId] }))
  }, [snapshots, accountId])

  // IKE / IKZE remaining limit — both figures come from the user's per-year
  // entry in contribution settings (limits change yearly per Polish tax law).
  const currentYear = new Date().getFullYear()
  const ikeEntry = useMemo(() => {
    if (account?.type !== 'ike') return undefined
    const entry = contributions.ike.find((e) => e.year === currentYear)
    return entry && entry.limit > 0 ? entry : undefined
  }, [account?.type, contributions.ike, currentYear])

  const ikzeEntry = useMemo(() => {
    if (account?.type !== 'ikze') return undefined
    const entry = contributions.ikze.find((e) => e.year === currentYear)
    return entry && entry.limit > 0 ? entry : undefined
  }, [account?.type, contributions.ikze, currentYear])

  // ── AI Insight ─────────────────────────
  const insight = useAccountInsight({
    account,
    costBasisPLN,
    totalReturnPLN,
    totalReturnPercent: totalReturnPct,
    currentValuePLN,
    ikeLimitPLN: ikeEntry?.limit,
    ikeRemainingPLN: ikeEntry ? Math.max(0, ikeEntry.limit - ikeEntry.contributed) : undefined,
    ikzeLimitPLN: ikzeEntry?.limit,
    ikzeRemainingPLN: ikzeEntry ? Math.max(0, ikzeEntry.limit - ikzeEntry.contributed) : undefined,
    claudeApiKey: settings.claudeApiKey,
  })

  // ── Table columns ──────────────────────
  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Instrument',
        cell: (info) => {
          const h = info.row.original
          return (
            <div className="flex items-center gap-2">
              <HoldingIcon holding={h} size={24} />
              <span className="text-sm tracking-tight text-foreground truncate">{h.name}</span>
            </div>
          )
        },
      }),

      columnHelper.accessor('category', {
        header: 'Category',
        meta: { width: 'w-28' },
        cell: (info) => <Badge variant="neutral">{CATEGORY_LABELS[info.getValue()]}</Badge>,
      }),

      columnHelper.accessor('quantity', {
        header: 'Quantity',
        meta: { width: 'w-28', align: 'right' },
        cell: (info) => {
          const h = info.row.original
          if (h.isSynthetic) {
            const cashValue = h.quantity * h.currentPrice
            if (cashValue === 0) {
              return (
                <div className="text-right opacity-50">
                  <p className="text-sm leading-none text-accent">—</p>
                </div>
              )
            }
            const parts = formatPLN(cashValue).split(' ')
            const amount = parts.slice(0, -1).join(' ')
            return (
              <div className="flex flex-col items-end gap-1">
                <p className="text-sm leading-none text-foregroundMuted tabular-nums" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
                  {amount}
                </p>
                <p className="text-xs leading-none text-accent">PLN</p>
              </div>
            )
          }
          return (
            <div className="flex flex-col items-end gap-1">
              <p className="text-sm leading-none text-foregroundMuted tabular-nums" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
                {formatQuantity(info.getValue())}
              </p>
              <p className="text-xs leading-none text-accent">{h.category === 'stock' || h.category === 'etf' ? 'shares' : h.category === 'crypto' ? 'coins' : 'units'}</p>
            </div>
          )
        },
      }),

      columnHelper.accessor((row) => getHoldingValue(row), {
        id: 'value',
        header: 'Value',
        meta: { align: 'right' },
        cell: (info) => {
          const value = info.getValue()
          if (value === 0) {
            return (
              <div className="text-right opacity-50">
                <p className="text-sm leading-none text-accent">—</p>
              </div>
            )
          }
          const allocationPct = currentValuePLN > 0 ? (value / currentValuePLN) * 100 : 0
          return (
            <div className="flex flex-col items-end gap-1">
              <p className="text-sm leading-none font-semibold text-foreground tabular-nums whitespace-nowrap">
                {formatPLN(value)}
              </p>
              <p className="text-xs leading-none text-accent">{allocationPct.toFixed(1).replace('.', ',')}%</p>
            </div>
          )
        },
      }),

      columnHelper.accessor((row) => getHoldingPnL(row), {
        id: 'return',
        header: 'Total Return',
        meta: { align: 'right' },
        cell: (info) => {
          const h = info.row.original
          if (h.isSynthetic || h.category === 'cash') {
            return (
              <div className="text-right opacity-50">
                <p className="text-sm text-accent">—</p>
              </div>
            )
          }
          const { pnl, pnlPercent } = info.getValue()
          const color = pnl > 0 ? 'text-positive' : pnl < 0 ? 'text-negative' : 'text-accent'
          const sign = pnl > 0 ? '+' : ''
          return (
            <div className="flex flex-col items-end gap-1">
              <p className={`text-sm leading-none tabular-nums whitespace-nowrap ${color}`}>
                {sign}{formatPLN(pnl)}
              </p>
              <p className="text-xs leading-none text-accent">
                {formatPercent(pnlPercent, true, 1)}
              </p>
            </div>
          )
        },
      }),

      columnHelper.display({
        id: 'actions',
        meta: { width: 'w-14' },
        header: () => null,
        cell: (info) => {
          const h = info.row.original
          return (
            <HoldingMenuCell
              onEdit={() => setEditingHolding(h)}
              onDelete={() => deleteHolding(h.id)}
            />
          )
        },
      }),
    ],
    [currentValuePLN, deleteHolding]
  )

  const table = useReactTable({
    data: account?.holdings ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    initialState: { sorting: [{ id: 'value', desc: true }] },
    getSortedRowModel: getSortedRowModel(),
  })

  // ── Handlers ───────────────────────────
  const refreshingRef = useRef(false)

  async function handleRefreshPrices() {
    if (!account || refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshing(true)
    try {
      // skipPersist: fetchAllPrices would write this single-account array over
      // ft_accounts; replaceAccounts below persists the full merged list instead.
      const result = await fetchAllPrices([account], settings, { forceRefresh: true, skipPersist: true })
      if (result.updatedAccounts) {
        // Merge the refreshed account back into the full accounts list
        const updatedAccount = result.updatedAccounts[0]
        if (updatedAccount) {
          replaceAccounts(accounts.map((a) => a.id === updatedAccount.id ? updatedAccount : a))
        }
      }
    } finally {
      refreshingRef.current = false
      setIsRefreshing(false)
    }
  }

  function handleEditAccount(data: { name: string; type: string; notes: string }) {
    if (!account) return
    updateAccount(account.id, {
      name: data.name,
      type: data.type as AccountType,
      notes: data.notes || undefined,
    })
    setEditAccountOpen(false)
  }

  function handleAddHolding(data: {
    name: string; ticker: string; exchange: string; category: AssetCategory
    quantity: number; purchasePrice: number; currentPrice: number; purchaseDate: string
  }) {
    if (!account) return
    addHolding(account.id, {
      name: data.name,
      ticker: data.ticker || undefined,
      exchange: data.exchange || undefined,
      category: data.category,
      quantity: data.quantity,
      purchasePrice: data.purchasePrice,
      currentPrice: data.currentPrice,
      purchaseDate: data.purchaseDate,
    })
    setAddHoldingOpen(false)
  }

  function handleEditHolding(data: {
    name: string; ticker: string; exchange: string; category: AssetCategory
    quantity: number; purchasePrice: number; currentPrice: number; purchaseDate: string
  }) {
    if (!editingHolding) return
    updateHolding(editingHolding.id, {
      name: data.name,
      ticker: data.ticker || undefined,
      exchange: data.exchange || undefined,
      category: data.category,
      quantity: data.quantity,
      purchasePrice: data.purchasePrice,
      currentPrice: data.currentPrice,
      purchaseDate: data.purchaseDate,
    })
    setEditingHolding(null)
  }

  function handleDeleteAccount() {
    if (!account) return
    deleteAccount(account.id)
    navigate('/')
  }

  // ── Guard ──────────────────────────────
  if (!account) {
    return (
      <EmptyState
        title="Account not found"
        description="This account does not exist."
        action={{ label: '← Overview', onClick: () => navigate('/') }}
      />
    )
  }

  const returnColor = totalReturnPLN > 0 ? 'text-positive' : totalReturnPLN < 0 ? 'text-negative' : 'text-accent'
  const returnSign = totalReturnPLN > 0 ? '+' : ''

  // ── Render ─────────────────────────────
  return (
    <div className="space-y-8 mx-auto max-w-[896px] w-full">
      {/* PageHeader */}
      <PageHeader
        title={account.name}
        parent={{ name: 'Overview', to: '/' }}
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              icon={EditSmall}
              iconPosition="left"
              onClick={() => setEditAccountOpen(true)}
            >
              Edit
            </Button>

            <div className="relative">
              <Button
                variant="secondary"
                icon={MoreHorizontal}
                iconPosition="only"
                onClick={() => setMoreMenuOpen((v) => !v)}
              />
              {moreMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                  <div className="absolute right-0 top-10 z-20">
                    <DropdownMenu>
                      <DropdownMenuGroup divider>
                        <DropdownItem
                          type="default"
                          icon={<Plus size={16} />}
                          label="Add holding"
                          onClick={() => { setMoreMenuOpen(false); setAddHoldingOpen(true) }}
                        />
                        <DropdownItem
                          type="default"
                          icon={<ArrowBoxOut size={16} />}
                          label="Import"
                          onClick={() => { setMoreMenuOpen(false); setImportOpen(true) }}
                        />
                      </DropdownMenuGroup>
                      <DropdownMenuGroup>
                        <DropdownItem
                          type="default"
                          icon={<Trash size={16} className="text-negative" />}
                          label="Delete account"
                          onClick={() => { setMoreMenuOpen(false); setDeleteAccountOpen(true) }}
                        />
                      </DropdownMenuGroup>
                    </DropdownMenu>
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      {/* Two-card summary row */}
      <div className="flex gap-4">
        {/* Card 1: Value + Chart */}
        <div className="bg-surface border border-borderLight rounded-xl w-[440px] h-[360px] flex flex-col overflow-hidden shrink-0">
          {/* Header */}
          <div className="flex items-start gap-2 p-6 shrink-0">
            <div className="flex-1 min-w-0 flex flex-col gap-1.5 leading-none">
              <p
                className="text-[20px] font-bold text-foreground"
                style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}
              >
                {formatPLN(currentValuePLN)}
              </p>
              {account.holdings.length > 0 && (
                <div className="flex items-center gap-1 text-sm tracking-[-0.35px] flex-wrap">
                  <span className={returnColor}>
                    {returnSign}{formatPLN(totalReturnPLN)} ({formatPercent(totalReturnPct, true, 2)})
                  </span>
                  {earliestDate && (
                    <span className="text-accent">since {formatDate(earliestDate)}</span>
                  )}
                </div>
              )}
            </div>
            <button
              className={`flex items-center justify-center size-9 rounded-full text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0 ${isRefreshing ? '[&_svg]:animate-spin' : ''}`}
              onClick={handleRefreshPrices}
              disabled={isRefreshing}
              title="Refresh prices"
            >
              <Synchronize size={20} />
            </button>
          </div>

          {/* Chart */}
          <div className="h-[180px] shrink-0">
            <PortfolioAreaChart
              snapshots={accountSnapshots}
              accounts={[account]}
              transactions={accountTransactions}
              dateRange={dateRange}
              historicalPrices={historicalPrices ?? undefined}
              minimal
            />
          </div>

          <div className="flex items-center justify-center p-4 shrink-0">
            <SegmentedControl options={DATE_RANGES} value={dateRange} onChange={setDateRange} />
          </div>
        </div>

        {/* Card 2: AI Insight + Stats */}
        <div className="bg-surface border border-borderLight rounded-xl w-[440px] h-[360px] flex flex-col overflow-hidden shrink-0">
          {/* Insight text */}
          <div className="flex-1 p-6 overflow-y-auto min-h-0">
            {!settings.claudeApiKey ? (
              <p className="text-sm text-accent">
                Add a Claude API key in Settings to enable AI insights.
              </p>
            ) : insight.isLoading && !insight.summary ? (
              <div className="flex items-center gap-2">
                <LoadingSpinner size="sm" />
                <span className="text-sm text-accent">Generating insight…</span>
              </div>
            ) : insight.summary ? (
              <InsightText text={insight.summary} />
            ) : insight.error ? (
              <p className="text-xs text-negative font-mono break-all">{insight.error}</p>
            ) : null}
          </div>

          {/* Stats strip */}
          <div className="border-t border-borderLight flex shrink-0">
            <StatStrip label="Total return" valuePLN={totalReturnPLN} />
            <div className="self-stretch border-l border-borderLight" />
            <StatStrip label="Net invested" valuePLN={costBasisPLN} />
          </div>
        </div>
      </div>

      {/* Holdings table */}
      {account.holdings.length > 0 ? (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full table-fixed border-collapse">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const meta = header.column.columnDef.meta
                    const align = meta?.align === 'right' ? 'text-right' : 'text-left'
                    return (
                      <th
                        key={header.id}
                        className={`h-14 px-4 border-b border-borderLight text-sm font-normal text-accent tracking-[-0.35px] ${align} ${meta?.width ?? ''}`}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, i) => {
                const isLast = i === table.getRowModel().rows.length - 1
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-muted transition-colors cursor-pointer"
                    onClick={() => setSelectedHoldingId(row.original.id)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta
                      const align = meta?.align === 'right' ? 'text-right' : 'text-left'
                      return (
                        <td
                          key={cell.id}
                          className={`h-14 px-4 ${isLast ? '' : 'border-b border-borderLight'} ${align} ${meta?.width ?? ''}`}
                          onClick={cell.column.id === 'actions' ? (e) => e.stopPropagation() : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="No holdings yet"
          description="Add your first holding to start tracking this account."
          action={{ label: 'Add holding', onClick: () => setAddHoldingOpen(true) }}
        />
      )}

      {/* Modals */}
      <AccountFormModal
        isOpen={editAccountOpen}
        onClose={() => setEditAccountOpen(false)}
        title="Edit Account"
        onSubmit={handleEditAccount}
        defaultValues={{ name: account.name, type: account.type, notes: account.notes ?? '' }}
        iconId={account.iconId}
      />

      <Modal isOpen={addHoldingOpen} onClose={() => setAddHoldingOpen(false)} title="Add Holding" variant="card">
        <HoldingForm onSubmit={handleAddHolding} onCancel={() => setAddHoldingOpen(false)} />
      </Modal>

      {editingHolding && (
        <Modal isOpen onClose={() => setEditingHolding(null)} title="Edit Holding" variant="card">
          <HoldingForm
            onSubmit={handleEditHolding}
            onCancel={() => setEditingHolding(null)}
            defaultValues={{
              name: editingHolding.name,
              ticker: editingHolding.ticker ?? '',
              exchange: editingHolding.exchange ?? '',
              category: editingHolding.category,
              quantity: editingHolding.quantity,
              purchasePrice: editingHolding.purchasePrice,
              currentPrice: editingHolding.currentPrice,
              purchaseDate: editingHolding.purchaseDate,
            }}
          />
        </Modal>
      )}

      <ConfirmDialog
        isOpen={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        onConfirm={handleDeleteAccount}
        title="Delete Account"
        message={
          <>
            Are you sure you want to delete <span className="font-medium text-foreground">{account.name}</span>? This
            will permanently remove the account and all its holdings.
          </>
        }
        confirmLabel="Delete Account"
      />

      <UnifiedImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        preselectedAccountId={account.id}
      />

      <HoldingSlidePanel
        holding={account.holdings.find((h) => h.id === selectedHoldingId) ?? null}
        isOpen={selectedHoldingId !== null}
        onClose={() => setSelectedHoldingId(null)}
      />
    </div>
  )
}
