import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { AssetCategory, Holding, Transaction } from '@/types'
import {
  getHoldingValue,
  getHoldingPnL,
  getTotalReturn,
  getDividendIncomeForHolding,
  resolveTransactionTicker,
} from '@/domain/calculations'
import { formatPLNDetail, formatQuantity } from '@/utils/formatters'
import { usePortfolio } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import { fetchAllPrices } from '@/services/market-data/priceFetcher'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { readCloseDuration } from '@/components/ui/panelTiming'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { HoldingForm } from './HoldingForm'
import { AlertTriangle, CircleCheck, Loader, SidebarRightBold } from '@/generated/icons'
import { useScrollLock } from '@/hooks/useScrollLock'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

type HoldingSlidePanelProps = {
  holding: Holding | null
  isOpen: boolean
  onClose: () => void
}

// ─────────────────────────────────────────
// Purchase lot helpers
// ─────────────────────────────────────────

type BuyLot = {
  id: string
  date: string
  quantity: number
  pricePerUnitPLN: number
  totalPLN: number
}

/**
 * Build purchase lots for a holding, including ticker-less transactions resolved
 * via `resolveTransactionTicker` (covers ETFs imported before the static-lookup fix).
 */
function buildBuyLots(transactions: Transaction[], ticker: string, accountId: string): BuyLot[] {
  const tickerUpper = ticker.toUpperCase()
  return transactions
    .filter(t => t.type === 'buy' && t.accountId === accountId && resolveTransactionTicker(t) === tickerUpper)
    .map(t => {
      const qty = t.quantity ?? 0
      const total = Math.abs(t.amountPLN)
      return {
        id: t.id,
        date: t.date.slice(0, 10),
        quantity: qty,
        pricePerUnitPLN: t.pricePerUnitPLN ?? (qty > 0 ? total / qty : 0),
        totalPLN: total,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─────────────────────────────────────────
// Dividend history helpers
// ─────────────────────────────────────────

type DividendRow = {
  id: string
  date: string
  gross: number
  tax: number
  net: number
}

function buildDividendRows(transactions: Transaction[], holdingId: string): DividendRow[] {
  // Pair each dividend with its same-date withholding_tax row (by relatedHoldingId)
  const related = transactions.filter(t => t.relatedHoldingId === holdingId)
  const dividends = related.filter(t => t.type === 'dividend')
  const taxByDate = new Map<string, number>()
  for (const t of related) {
    if (t.type === 'withholding_tax') {
      const day = t.date.slice(0, 10)
      taxByDate.set(day, (taxByDate.get(day) ?? 0) + t.amountPLN)
    }
  }

  return dividends
    .map(t => {
      const day = t.date.slice(0, 10)
      const tax = taxByDate.get(day) ?? 0
      return { id: t.id, date: day, gross: t.amountPLN, tax, net: t.amountPLN + tax }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

// ─────────────────────────────────────────
// Stat cell — reusable within this panel
// ─────────────────────────────────────────

function StatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted rounded-lg p-3 flex flex-col gap-1 items-start">
      <p className="text-sm text-accent tracking-[-0.35px] [font-feature-settings:'lnum'_1,'tnum'_1]">{label}</p>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────
// Main component
// ─────────────────────────────────────────

export function HoldingSlidePanel({ holding: holdingProp, isOpen, onClose }: HoldingSlidePanelProps) {
  const { accounts, transactions, updateHolding, deleteHolding, replaceAccounts } = usePortfolio()
  const settings = useSettings()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [priceStatus, setPriceStatus] = useState<'idle' | 'fetching' | 'ok' | 'no-provider' | 'error'>('idle')
  const [open, setOpen] = useState(false)
  // Track the scroll lock separately from `isOpen`: it must be held through the
  // close animation. Releasing it on `isOpen=false` lets the page scrollbar
  // reappear immediately, which shifts this `fixed right-0` panel left by the
  // scrollbar width (fixed overlays ignore the body's padding compensation),
  // producing a visible "jump left" before the panel slides out.
  const [locked, setLocked] = useState(false)

  useScrollLock(locked)

  useEffect(() => {
    if (isOpen) {
      setLocked(true)
      const id = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(id)
    }
    setOpen(false)
    const id = setTimeout(() => setLocked(false), readCloseDuration())
    return () => clearTimeout(id)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Reset sub-modals and price status when panel closes or holding changes
  useEffect(() => {
    if (!isOpen) {
      setEditOpen(false)
      setDeleteConfirmOpen(false)
      setPriceStatus('idle')
    }
  }, [isOpen])

  useEffect(() => {
    setPriceStatus('idle')
  }, [holdingProp?.id])

  // Keep the last non-null holding so panel content stays rendered during the
  // CSS close transition (holdingProp clears at the same time isOpen → false).
  // Adjusting state during render is React's sanctioned "store previous value"
  // pattern — re-renders synchronously before paint, so there's no flicker.
  const [holding, setHolding] = useState(holdingProp)
  const [prevProp, setPrevProp] = useState(holdingProp)
  if (holdingProp && holdingProp !== prevProp) {
    setPrevProp(holdingProp)
    setHolding(holdingProp)
  }
  if (!holding) return null

  // ── Derived values ────────────────────
  const value              = getHoldingValue(holding)
  const { pnl, pnlPercent } = getHoldingPnL(holding)
  const { totalPLN, totalPercent } = getTotalReturn(holding, transactions)
  const dividendIncome     = getDividendIncomeForHolding(transactions, holding.id)
  const dividendRows       = buildDividendRows(transactions, holding.id)
  const priceIsPlaceholder = holding.currentPrice === holding.purchasePrice
  const buyLots            = holding.ticker ? buildBuyLots(transactions, holding.ticker, holding.accountId) : []

  // ── Handlers ─────────────────────────
  async function handleEdit(data: {
    name: string
    ticker: string
    exchange: string
    category: AssetCategory
    quantity: number
    purchasePrice: number
    currentPrice: number
    purchaseDate: string
  }) {
    updateHolding(holding!.id, {
      name: data.name,
      ticker: data.ticker || undefined,
      exchange: data.exchange || undefined,
      category: data.category,
      quantity: data.quantity,
      purchasePrice: data.purchasePrice,
      currentPrice: data.currentPrice,
      purchaseDate: data.purchaseDate,
    })
    setEditOpen(false)

    // Auto-refresh price when a ticker+exchange is set and the price is unknown (0)
    // or the ticker/exchange was just added or changed.
    const prevTicker    = holding!.ticker   ?? ''
    const prevExchange  = holding!.exchange ?? ''
    const tickerChanged = data.ticker !== prevTicker || data.exchange !== prevExchange
    const hasTicker     = !!(data.ticker && data.exchange)

    if (hasTicker && (data.currentPrice === 0 || tickerChanged)) {
      // Guard: price provider must be configured (mirrors Dashboard behaviour)
      if (!settings.priceProvider.enabled || !settings.priceProvider.apiKey) {
        setPriceStatus('no-provider')
        return
      }

      setPriceStatus('fetching')

      // Build the updated holding+accounts in memory — React state from updateHolding
      // hasn't flushed yet, so we need to construct the updated snapshot ourselves.
      const updatedHolding: Holding = {
        ...holding!,
        name:          data.name,
        ticker:        data.ticker || undefined,
        exchange:      data.exchange || undefined,
        category:      data.category,
        quantity:      data.quantity,
        purchasePrice: data.purchasePrice,
        currentPrice:  data.currentPrice,
        purchaseDate:  data.purchaseDate,
      }
      const patchedAccounts = accounts.map((account) => ({
        ...account,
        holdings: account.holdings.map((h) =>
          h.id === holding!.id ? updatedHolding : h,
        ),
      }))

      try {
        const result = await fetchAllPrices(patchedAccounts, settings, { forceRefresh: true })
        if (result.updatedAccounts) {
          // Check whether our specific holding received a price update
          const updated = result.updatedAccounts
            .flatMap((a) => a.holdings)
            .find((h) => h.id === holding!.id)
          if (updated && updated.currentPrice > 0) {
            setPriceStatus('ok')
          } else {
            setPriceStatus('error')
          }
          replaceAccounts(result.updatedAccounts)
        } else {
          setPriceStatus('error')
        }
      } catch {
        setPriceStatus('error')
      }
    }
  }

  function handleDelete() {
    deleteHolding(holding!.id)
    setDeleteConfirmOpen(false)
    onClose()
  }

  async function handleRefreshPrice() {
    if (!settings.priceProvider.enabled || !settings.priceProvider.apiKey) {
      setPriceStatus('no-provider')
      return
    }
    setPriceStatus('fetching')
    // Pass only this holding so we make exactly one API call
    const singleHoldingAccounts = accounts
      .map((a) => ({ ...a, holdings: a.holdings.filter((h) => h.id === holding!.id) }))
      .filter((a) => a.holdings.length > 0)
    try {
      const result = await fetchAllPrices(singleHoldingAccounts, settings, { forceRefresh: true, skipPersist: true })
      if (result.updatedAccounts) {
        const updatedPrice = result.updatedAccounts.flatMap((a) => a.holdings).find((h) => h.id === holding!.id)?.currentPrice
        if (updatedPrice && updatedPrice > 0) {
          replaceAccounts(accounts.map((a) => ({
            ...a,
            holdings: a.holdings.map((h) =>
              h.id === holding!.id ? { ...h, currentPrice: updatedPrice, updatedAt: new Date().toISOString() } : h,
            ),
          })))
          setPriceStatus('ok')
        } else {
          setPriceStatus('error')
        }
      } else {
        setPriceStatus('error')
      }
    } catch {
      setPriceStatus('error')
    }
  }

  // ── Colour helper for total return ────
  function returnColour(v: number) {
    return v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : 'text-accent'
  }

  return createPortal(
    <>
      {/* Backdrop — sits above account panel (z-panel) */}
      <div
        className={`fixed inset-0 bg-black/10 z-panel-nested-backdrop transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full w-[480px] z-panel-nested p-3 t-panel-slide"
        data-open={open}
      >
        <div className="h-full flex flex-col rounded-xl border border-borderLight shadow-md bg-surface overflow-hidden">
        {/* ── Header ── */}
        <div className="px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <HoldingIcon holding={holding} size={32} />
            <div className="flex flex-col min-w-0">
              {holding.ticker && (
                <span className="text-xs font-medium text-accent tracking-[-0.35px] [font-feature-settings:'lnum'_1,'tnum'_1] truncate">
                  {holding.ticker}
                </span>
              )}
              <span className="text-sm font-semibold text-foreground [font-feature-settings:'lnum'_1,'tnum'_1] truncate">
                {holding.name}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="ml-3 shrink-0 p-2 rounded-full hover:bg-muted flex items-center justify-center cursor-pointer">
            <SidebarRightBold size={20} className="text-accent" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-2 pb-6 flex flex-col gap-6">

          {/* ── Stats grid ── */}
          <div className="grid grid-cols-2 gap-2">
            <StatCell label="Current value">
              <p className="text-sm font-semibold text-foreground">
                {formatPLNDetail(value)}
              </p>
            </StatCell>

            <StatCell label="Quantity">
              <p className="text-sm font-semibold text-foreground">
                {formatQuantity(holding.quantity)}
              </p>
            </StatCell>

            <StatCell label="Avg cost / unit">
              <p className="text-sm font-semibold text-foreground">
                {formatPLNDetail(holding.purchasePrice)}
              </p>
            </StatCell>

            <StatCell label="Current price / unit">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {formatPLNDetail(holding.currentPrice)}
                </p>
                {priceStatus === 'fetching' && (
                  <Loader size={13} className="animate-spin text-accent shrink-0" />
                )}
                {priceStatus === 'ok' && (
                  <CircleCheck size={13} className="text-positive shrink-0" />
                )}
                {priceStatus === 'error' && (
                  <span title="Price fetch failed — check ticker, exchange and EODHD key in Settings">
                    <AlertTriangle size={13} className="text-warning shrink-0 cursor-help" />
                  </span>
                )}
                {priceStatus === 'no-provider' && (
                  <span title="Configure your price provider in Settings to enable auto-refresh">
                    <AlertTriangle size={13} className="text-warning shrink-0 cursor-help" />
                  </span>
                )}
              </div>
              {priceIsPlaceholder && priceStatus === 'idle' && (
                <p className="text-[10px] text-accent mt-0.5 leading-tight">
                  Not yet refreshed · equals avg cost
                </p>
              )}
              {priceStatus === 'error' && (
                <p className="text-[10px] text-warning mt-0.5 leading-tight">
                  Fetch failed — check ticker &amp; Settings
                </p>
              )}
              {priceStatus === 'no-provider' && (
                <p className="text-[10px] text-warning mt-0.5 leading-tight">
                  No price provider — configure in Settings
                </p>
              )}
            </StatCell>

            <StatCell label="Unrealised P&L">
              {priceIsPlaceholder ? (
                <span className="text-sm text-accent">—</span>
              ) : (
                <div className={`flex items-center gap-1 ${pnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                  <span className="text-sm font-semibold">
                    {pnl > 0 ? '+' : ''}{formatPLNDetail(pnl)}
                  </span>
                  <span className="text-sm font-normal">
                    ({pnl > 0 ? '+' : ''}{pnlPercent.toFixed(2).replace('.', ',')}%)
                  </span>
                </div>
              )}
            </StatCell>

            <StatCell label="Total return">
              {priceIsPlaceholder ? (
                <span className="text-sm text-accent">—</span>
              ) : (
                <div className={`flex items-center gap-1 ${returnColour(totalPLN)}`}>
                  <span className="text-sm font-semibold">
                    {totalPLN > 0 ? '+' : ''}{formatPLNDetail(totalPLN)}
                  </span>
                  <span className="text-sm font-normal">
                    ({totalPLN > 0 ? '+' : ''}{totalPercent.toFixed(2).replace('.', ',')}%)
                  </span>
                </div>
              )}
            </StatCell>
          </div>

          {/* ── Purchase history ── */}
          {buyLots.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-foreground tracking-[-0.35px] mb-3">
                Purchase History
              </h3>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-accent">Date</th>
                      <th className="text-right px-3 py-2 font-semibold text-accent">Qty</th>
                      <th className="text-right px-3 py-2 font-semibold text-accent">Price / unit</th>
                      <th className="text-right px-3 py-2 font-semibold text-accent">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buyLots.map(lot => (
                      <tr key={lot.id} className="border-t border-borderLight">
                        <td className="px-3 py-2 text-foregroundMuted">{lot.date.split('-').reverse().join('/')}</td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {formatQuantity(lot.quantity)}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {formatPLNDetail(lot.pricePerUnitPLN)}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {formatPLNDetail(lot.totalPLN)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {buyLots.length > 1 && (
                    <tfoot>
                      <tr className="border-t border-borderLight bg-muted">
                        <td className="px-3 py-2 text-xs font-semibold text-accent">
                          Total
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">
                          {formatQuantity(holding.quantity)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-accent">
                          ~{formatPLNDetail(holding.purchasePrice)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-foreground">
                          {formatPLNDetail(buyLots.reduce((s, l) => s + l.totalPLN, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ── Dividend history ── */}
          {(holding.category === 'stock' || holding.category === 'etf') && (
          <div>
            <h3 className="text-sm font-medium text-foreground tracking-[-0.35px] mb-3">
              Dividend History
            </h3>

            {dividendRows.length === 0 ? (
              <p className="text-xs text-accent py-4 text-center">
                No dividends recorded for this holding.
              </p>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-accent">Date</th>
                      <th className="text-right px-3 py-2 font-semibold text-accent">Gross</th>
                      <th className="text-right px-3 py-2 font-semibold text-accent">Tax</th>
                      <th className="text-right px-3 py-2 font-semibold text-accent">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dividendRows.map(row => (
                      <tr key={row.id} className="border-t border-borderLight">
                        <td className="px-3 py-2 text-foregroundMuted">
                          {row.date.split('-').reverse().join('/')}
                        </td>
                        <td className="px-3 py-2 text-right text-positive">
                          +{formatPLNDetail(row.gross)}
                        </td>
                        <td className="px-3 py-2 text-right text-negative">
                          {row.tax !== 0 ? formatPLNDetail(row.tax) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-positive">
                          +{formatPLNDetail(row.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Totals row */}
                  <tfoot>
                    <tr className="border-t border-borderLight bg-muted">
                      <td className="px-3 py-2 text-xs font-semibold text-accent">
                        Total ({dividendRows.length})
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-positive">
                        +{formatPLNDetail(dividendIncome.gross)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-negative">
                        {dividendIncome.tax !== 0 ? formatPLNDetail(dividendIncome.tax) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-positive">
                        +{formatPLNDetail(dividendIncome.net)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div className="px-6 py-6 flex items-center gap-2 shrink-0">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          {holding.ticker && holding.exchange && (
            <Button
              variant="secondary"
              onClick={handleRefreshPrice}
              disabled={priceStatus === 'fetching'}
            >
              Refresh Price
            </Button>
          )}
          <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
            Delete
          </Button>
        </div>
        </div>
      </div>

      {/* Edit holding modal */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Holding"
        size="md"
        variant="card"
      >
        <HoldingForm
          defaultValues={{
            name:          holding.name,
            ticker:        holding.ticker ?? '',
            exchange:      holding.exchange ?? '',
            category:      holding.category,
            quantity:      holding.quantity,
            purchasePrice: holding.purchasePrice,
            currentPrice:  holding.currentPrice,
            purchaseDate:  holding.purchaseDate,
          }}
          transactionBacked={buyLots.length > 0}
          onSubmit={handleEdit}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>

      {/* Delete confirmation modal */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Holding"
        message={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-foreground">{holding.name}</span>? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
      />
    </>,
    document.body
  )
}
