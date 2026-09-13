import { useEffect, useMemo, useRef, useState } from 'react'
import { format, subMonths, subYears } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { slugify, formatDate, formatPLN, formatPercent, getDateRangeLabel } from '@/utils/formatters'
import { usePortfolio } from '@/context/PortfolioContext'
import { useSettings } from '@/context/SettingsContext'
import { fetchAllPrices } from '@/services/market-data/priceFetcher'
import { useHistoricalPrices } from '@/hooks/useHistoricalPrices'
import { usePortfolioInsight } from '@/hooks/usePortfolioInsight'
import {
  getAllTimeSummary,
  getCategoryAllocation,
  getTotalCostBasis,
  getRealizedPnL,
  getTotalValue,
  getUnrealizedPnL,
} from '@/domain/calculations'
import { StatCard } from '@/components/ui/StatCard'
import { StatCardGroup } from '@/components/ui/StatCardGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Tooltip } from '@/components/ui/Tooltip'
import { DATE_RANGES } from '@/types'
import type { DateRange } from '@/types'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { AccountCard } from '@/features/dashboard/AccountCard'
import { PortfolioInsightCard } from '@/features/dashboard/PortfolioInsightCard'
import { PortfolioAreaChart } from '@/components/charts/PortfolioAreaChart'
import { AccountFormModal } from '@/features/accounts/AccountFormModal'
import { PageHeader } from '@/components/layout/PageHeader'
import { ProgressiveBlur } from '@/components/ui/ProgressiveBlur'
import type { AccountType } from '@/types'
import { Plus, ArrowDownSquare, Elements, BanknoteStack, ChartBarsWide, History } from '@/generated/icons'


function getGreeting(name?: string): string {
  const displayName = name?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  if (hour < 12) return `Good morning, ${displayName}`
  if (hour < 18) return `Good afternoon, ${displayName}`
  return `Good evening, ${displayName}`
}

export function Overview() {
  const { accounts, snapshots, transactions, isLoading, replaceAccounts, addAccount } = usePortfolio()
  const settings = useSettings()
  const navigate = useNavigate()
  const [dateRange, setDateRange] = useState<DateRange>('1Y')
  const [addModalOpen, setAddModalOpen] = useState(false)

  function handleAddAccount(data: { name: string; type: string; notes: string }) {
    addAccount({ name: data.name, type: data.type as AccountType, notes: data.notes || undefined })
    setAddModalOpen(false)
  }

  // Auto-refresh prices once on load if provider is configured and cache is stale
  const autoFetchDoneRef = useRef(false)
  useEffect(() => {
    if (isLoading || autoFetchDoneRef.current) return
    if (!settings.priceProvider.enabled || !settings.priceProvider.apiKey) return
    autoFetchDoneRef.current = true
    void fetchAllPrices(accounts, settings).then((result) => {
      if (result.updatedAccounts) {
        replaceAccounts(result.updatedAccounts)
      }
    })
  }, [isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const { historicalPrices } = useHistoricalPrices(accounts, settings.coinGeckoApiKey, settings.priceProvider.apiKey)

  const totalValue = useMemo(() => getTotalValue(accounts), [accounts])

  const categoryAllocation = useMemo(
    () => getCategoryAllocation(accounts),
    [accounts]
  )

  const unrealizedPnL = useMemo(() => getUnrealizedPnL(accounts), [accounts])

  const realizedPnL = useMemo(() => getRealizedPnL(transactions), [transactions])

  const allTimeSummary = useMemo(() => getAllTimeSummary(transactions), [transactions])

  const totalCostBasis = useMemo(() => getTotalCostBasis(accounts), [accounts])

  const totalReturn = useMemo(
    () => unrealizedPnL + realizedPnL + allTimeSummary.dividendsNet + allTimeSummary.interestNet,
    [unrealizedPnL, realizedPnL, allTimeSummary]
  )

  // Delta: find the snapshot closest to the start of the selected date range.
  // For ALL: use the earliest snapshot. For time ranges: use the last snapshot
  // at or before the cutoff date, falling back to the earliest if none exists.
  const { delta, deltaPercent, period } = useMemo(() => {
    if (snapshots.length === 0) return { delta: 0, deltaPercent: 0, period: '' }
    const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
    let ref: typeof snapshots[0]
    let fellBack = false
    if (dateRange === 'ALL') {
      ref = sorted[0]
    } else {
      const now = new Date()
      const cutoff = format(
        dateRange === '1M' ? subMonths(now, 1) :
        dateRange === '3M' ? subMonths(now, 3) :
        dateRange === '6M' ? subMonths(now, 6) :
        subYears(now, 1),
        'yyyy-MM-dd'
      )
      const beforeCutoff = sorted.filter((s) => s.date <= cutoff)
      if (beforeCutoff.length > 0) {
        ref = beforeCutoff[beforeCutoff.length - 1]
      } else {
        // No snapshot reaches back to the selected range, so we fall back to
        // the earliest snapshot. Flag it so the label reads "since inception"
        // rather than implying the full range is covered.
        ref = sorted[0]
        fellBack = true
      }
    }
    const d = totalValue - ref.totalValue
    const dp = ref.totalValue === 0 ? 0 : (d / ref.totalValue) * 100
    const period = fellBack
      ? `since inception (${formatDate(ref.date)})`
      : `since ${formatDate(ref.date)}`
    return { delta: d, deltaPercent: dp, period }
  }, [snapshots, totalValue, dateRange])

  // Last updated: find the most recently updated account
  const lastUpdated = useMemo(() => {
    return accounts.reduce<string | null>((latest, account) => {
      if (!latest || account.lastUpdated > latest) return account.lastUpdated
      return latest
    }, null)
  }, [accounts])

  const insightInput = useMemo(() => {
    const allHoldingsFlat = accounts.flatMap((a) => a.holdings)
    const topHoldings = accounts
      .flatMap((a) =>
        a.holdings
          .filter((h) => !h.isSynthetic)
          .map((h) => ({
            name: h.name,
            ticker: h.ticker,
            category: h.category,
            valuePercent: totalValue > 0 ? ((h.quantity * h.currentPrice) / totalValue) * 100 : 0,
            pnlPercent:
              h.purchasePrice > 0
                ? ((h.currentPrice - h.purchasePrice) / h.purchasePrice) * 100
                : 0,
          }))
      )
      .sort((a, b) => b.valuePercent - a.valuePercent)
      .slice(0, 5)

    // usePortfolioInsight expects the legacy 4-key shape (etf merged into stocks)
    const insightAllocation = {
      bonds:  categoryAllocation.bond,
      stocks: categoryAllocation.stock + categoryAllocation.etf,
      cash:   categoryAllocation.cash,
      crypto: categoryAllocation.crypto,
    }

    return {
      totalValue,
      delta,
      deltaPercent,
      period,
      currentAllocation: insightAllocation,
      unrealizedPnL,
      realizedPnL,
      topHoldings,
      allHoldings: allHoldingsFlat,
    }
  }, [accounts, totalValue, delta, deltaPercent, period, categoryAllocation, unrealizedPnL, realizedPnL])

  const insight = usePortfolioInsight(insightInput, settings.claudeApiKey, settings.priceProvider.apiKey)

  const earliestDate = useMemo(() => {
    const allHoldings = accounts.flatMap((a) => a.holdings)
    const firstPurchase = allHoldings.length > 0 ? allHoldings.map((h) => h.purchaseDate).sort()[0] : null
    const firstSnapshot = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? null
    return [firstPurchase, firstSnapshot].filter(Boolean).sort()[0] ?? null
  }, [accounts, snapshots])

  const showTrend = period !== ''
  const isNeutral = delta === 0
  const deltaColor = delta > 0 ? 'text-positive' : 'text-negative'

  if (isLoading) {
    return <LoadingSpinner size="page" />
  }

  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-[896px] w-full space-y-8">
        <PageHeader title={getGreeting(settings.userName)} />
        <EmptyState
          title="No portfolio data yet"
          description="Start by adding your first account."
          action={{
            label: '+ Add Account',
            onClick: () => setAddModalOpen(true),
          }}
        />
        <AccountFormModal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          title="Add Account"
          submitLabel="Add"
          onSubmit={handleAddAccount}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <ProgressiveBlur fixed position="left"  size="96px" className="left-24 top-0 bottom-0 z-[9]" />
      <ProgressiveBlur fixed position="right" size="96px" className="right-0 top-0 bottom-0 z-[9]" />
      <div className="mx-auto max-w-[896px] w-full -mb-8">
        <PageHeader
          title={getGreeting(settings.userName)}
          action={lastUpdated ? (
            <Tooltip label="Last manual edit" placement="bottom">
              <span className="flex items-center gap-1 text-sm text-foregroundMuted tracking-[-0.35px]">
                <History size={20} />
                {formatDate(lastUpdated)}
              </span>
            </Tooltip>
          ) : undefined}
        />
      </div>

      {/* Account Summary */}
      <div className="mx-auto max-w-[896px] w-full flex flex-col gap-2">
        <p className="text-[40px] font-bold leading-none text-foreground tabular-nums" style={{ fontFeatureSettings: "'lnum' 1, 'tnum' 1" }}>
          {formatPLN(totalValue)}
        </p>
        {showTrend && (
          <div className="flex items-center gap-1 text-sm leading-none tracking-[-0.35px]">
            {!isNeutral && (
              <span className={deltaColor}>
                {delta > 0 ? '+' : ''}{formatPLN(delta)} ({formatPercent(deltaPercent, true)})
              </span>
            )}
            <span className="text-accent">{period}</span>
          </div>
        )}
      </div>

      {/* Chart — true full viewport width: escapes ml-24 (left) and pr-24 (right) of <main> */}
      <div className="-mx-24 w-[calc(100%+12rem)]">
        <PortfolioAreaChart
          snapshots={snapshots}
          accounts={accounts}
          transactions={transactions}
          dateRange={dateRange}
          historicalPrices={historicalPrices ?? undefined}
          simplified
        />
      </div>

      {/* Chart Controls */}
      <div className="mx-auto max-w-[896px] w-full flex items-center justify-between">
        <SegmentedControl options={DATE_RANGES} value={dateRange} onChange={setDateRange} />
        <p className="text-sm leading-none text-[#626262] tracking-[-0.14px]">
          {getDateRangeLabel(dateRange, earliestDate ?? undefined)}
        </p>
      </div>

      {/* Portfolio Stats */}
      <div className="mx-auto max-w-[896px] w-full">
        <StatCardGroup>
          <StatCard variant="inner" showCurrencyCode label="Total return"     value={totalReturn}                 icon={<ArrowDownSquare size={16} className="text-accent" />} />
          <StatCard variant="inner" showCurrencyCode label="Realized return"  value={realizedPnL}                 icon={<Elements  size={16} className="text-accent" />} />
          <StatCard variant="inner" showCurrencyCode label="Dividends earned" value={allTimeSummary.dividendsNet} icon={<BanknoteStack size={16} className="text-accent" />} />
          <StatCard variant="inner" showCurrencyCode label="Net invested"     value={totalCostBasis}              icon={<ChartBarsWide    size={16} className="text-accent" />} />
        </StatCardGroup>
      </div>

      {/* Account Cards */}
      <div className="mx-auto max-w-[896px] w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm text-foregroundMuted tracking-[-0.14px]">Accounts</h2>
          <Button
            variant="secondary"
            icon={Plus}
            onClick={() => setAddModalOpen(true)}
          >
            Add Account
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              transactions={transactions}
              onClick={() => navigate(`/accounts/${slugify(account.name)}`)}
            />
          ))}
        </div>
      </div>

      {/* Portfolio Insight */}
      {settings.claudeApiKey && (
        <div className="mx-auto max-w-[896px] w-full">
          <PortfolioInsightCard
            summary={insight.summary}
            isLoading={insight.isLoading}
            error={insight.error}
            cachedAt={insight.cachedAt}
            onRegenerate={insight.regenerate}
          />
        </div>
      )}

      <AccountFormModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add Account"
        submitLabel="Add"
        onSubmit={handleAddAccount}
      />
    </div>
  )
}
