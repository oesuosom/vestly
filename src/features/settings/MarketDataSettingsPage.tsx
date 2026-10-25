import { useState } from 'react'
import eodhdIcon from '@/assets/providers/eodhd.png'
import yahooIcon from '@/assets/providers/yahoo-finance.png'
import nbpIcon from '@/assets/providers/narodowy-bank-polski.png'
import coinGeckoIcon from '@/assets/providers/coin-gecko.png'
import { Synchronize, ChevronTopSmall, Eye, Loader, Nut } from '@/generated/icons'
import { Button } from '@/components/ui/Button'
import { Toast } from '@/components/ui/Toast'

/** Spinning variant of the Synchronize icon, for Button's `icon` prop while a refresh runs. */
function SynchronizeSpinning({ size, className }: { size?: number; className?: string }) {
  return <Synchronize size={size} className={`${className ?? ''} animate-spin`} />
}
import { Toggle } from '@/components/ui/Toggle'
import { useSettings } from '@/context/SettingsContext'
import { usePortfolio } from '@/context/PortfolioContext'
import { fetchAllPrices } from '@/services/market-data/priceFetcher'
import {
  clearHistoricalPricesCache,
  saveHistoricalPricesCache,
} from '@/storage/historicalPriceStorage'
import { buildHistoricalPricesCache } from '@/services/market-data/yahooHistorical'

type ProviderRowProps = {
  icon: string
  name: string
  description: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  hasApiKey?: boolean
  apiKeyMissing?: boolean
  isExpanded?: boolean
  onToggleExpand?: () => void
  isLast?: boolean
}

function ProviderRow({
  icon,
  name,
  description,
  enabled,
  onToggle,
  hasApiKey,
  apiKeyMissing,
  isExpanded,
  onToggleExpand,
  isLast,
}: ProviderRowProps) {
  return (
    <div
      className={`flex items-center gap-3 h-14 p-3 bg-muted shrink-0 ${!isLast ? 'border-b border-surface' : ''}`}
    >
      <img src={icon} alt={name} className="size-8 rounded-lg object-cover shrink-0" />
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground tracking-[-0.35px] leading-none">{name}</span>
        <span className="text-xs text-foregroundMuted tracking-[-0.3px] truncate leading-none">
          {apiKeyMissing && !enabled ? 'Add an API key to enable this provider.' : description}
        </span>
      </div>
      <div className="flex items-center gap-3 pr-1 shrink-0">
        {hasApiKey && (
          <Button
            variant="ghost"
            iconPosition="only"
            icon={isExpanded ? ChevronTopSmall : Nut}
            onClick={onToggleExpand}
          />
        )}
        <Toggle checked={enabled} onChange={onToggle} disabled={apiKeyMissing && !enabled} />
      </div>
    </div>
  )
}

type ApiKeyRowProps = {
  savedKey: string
  onSave: (key: string) => void
  isLast?: boolean
}

function ApiKeyRow({ savedKey, onSave, isLast }: ApiKeyRowProps) {
  const [value, setValue] = useState(savedKey)
  const [showKey, setShowKey] = useState(false)
  const isDirty = value !== savedKey

  return (
    <div
      className={`flex items-center gap-3 h-14 pl-4 pr-3 py-3 bg-muted shrink-0 ${!isLast ? 'border-b border-surface' : ''}`}
    >
      <input
        type={showKey ? 'text' : 'password'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter API Key"
        className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground tracking-[-0.35px] placeholder:text-accent outline-none"
      />
      <div className="flex items-center gap-3 pr-1 shrink-0">
        <Button
          variant="ghost"
          iconPosition="only"
          icon={Eye}
          onClick={() => setShowKey((v) => !v)}
        />
        <button
          onClick={() => isDirty && onSave(value)}
          className={`w-10 text-sm font-semibold text-foreground tracking-[-0.35px] transition-opacity ${isDirty ? 'opacity-100 cursor-pointer' : 'opacity-50 cursor-default'}`}
        >
          Save
        </button>
      </div>
    </div>
  )
}

// Empty histories are re-fetched on every portfolio load, so a failed rebuild
// does heal itself — but say so rather than stopping the spinner as if it worked.
const REBUILD_FAILED = "Couldn't rebuild quote history. It will retry on the next portfolio load."

export function MarketDataSettingsPage() {
  const settings = useSettings()
  const {
    priceProvider,
    exchangeRateProvider,
    nbpEnabled,
    coinGeckoEnabled,
    coinGeckoApiKey,
    updatePriceProvider,
    updateExchangeRateProvider,
    updateNbpEnabled,
    updateCoinGeckoEnabled,
    updateCoinGeckoApiKey,
  } = settings

  const { accounts, replaceAccounts } = usePortfolio()

  const [expandedProviders, setExpandedProviders] = useState<Set<'eodhd' | 'coingecko'>>(new Set())
  const [isUpdating, setIsUpdating] = useState(false)
  const [isRebuilding, setIsRebuilding] = useState(false)
  // Failure feedback. `retry` is absent when retrying can't help (e.g. no
  // eligible holdings). The Toast portals above the dialog (z-toast > z-dialog),
  // and React events from the portal still bubble through the dialog's
  // stopPropagation, so clicking it doesn't close Settings.
  const [failure, setFailure] = useState<{ message: string; retry?: () => void } | null>(null)

  function toggleExpand(provider: 'eodhd' | 'coingecko') {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  async function handleUpdate() {
    setIsUpdating(true)
    setFailure(null)
    try {
      const result = await fetchAllPrices(accounts, settings, { forceRefresh: true })
      if (result.updatedAccounts) {
        replaceAccounts(result.updatedAccounts)
        // Network and provider errors don't throw — they come back per ticker
        // as `results[].error`, with that holding's price left unchanged.
        const failed = result.results.filter((r) => r.error).length
        const total = result.results.length
        if (failed === total) {
          setFailure({
            message: "Couldn't update prices. Check your connection and API key.",
            retry: handleUpdate,
          })
        } else if (failed > 0) {
          setFailure({
            message: `Updated ${total - failed} of ${total} prices. ${failed} couldn't be fetched.`,
            retry: handleUpdate,
          })
        }
      } else if (result.warnings.length > 0) {
        // fetchAllPrices returns early with a warning instead of throwing when
        // there's nothing it can fetch (unknown provider, no eligible holdings).
        setFailure({ message: result.warnings[0] })
      }
    } catch {
      setFailure({
        message: "Couldn't update prices. Check your connection and API key.",
        retry: handleUpdate,
      })
    } finally {
      setIsUpdating(false)
    }
  }

  async function handleRebuild() {
    setIsRebuilding(true)
    setFailure(null)
    try {
      clearHistoricalPricesCache()
      const newCache = await buildHistoricalPricesCache(
        accounts,
        coinGeckoApiKey,
        null,
        priceProvider.apiKey,
      )
      saveHistoricalPricesCache(newCache)

      // Fetch errors don't throw either — a holding whose history couldn't be
      // fetched comes back with an empty series. Only holdings with a ticker
      // (or crypto) are fetched; the rest are interpolated and can't fail.
      const fetched = accounts
        .flatMap((a) => a.holdings)
        .filter((h) => (h.ticker && h.exchange) || h.category === 'crypto')
      const filled = new Set(
        newCache.histories.filter((h) => h.prices.length > 0).map((h) => h.holdingId),
      )
      const missing = fetched.filter((h) => !filled.has(h.id)).length
      if (missing > 0 && missing === fetched.length) {
        setFailure({ message: REBUILD_FAILED, retry: handleRebuild })
      } else if (missing > 0) {
        setFailure({
          message: `Rebuilt history for ${fetched.length - missing} of ${fetched.length} holdings. ${missing} couldn't be fetched.`,
          retry: handleRebuild,
        })
      }
    } catch {
      setFailure({ message: REBUILD_FAILED, retry: handleRebuild })
    } finally {
      setIsRebuilding(false)
    }
  }

  const eodhdKeyExpanded = expandedProviders.has('eodhd')
  const coinGeckoExpanded = expandedProviders.has('coingecko')

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto scrollbar-none p-6 bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)]">
      {/* Header */}
      <div className="flex flex-col gap-0 shrink-0">
        <div className="flex items-center h-9 gap-2">
          <h2 className="flex-1 text-[18px] font-medium text-foreground tracking-[-0.45px] leading-none">
            Market Data
          </h2>
          <Button
            variant="secondary"
            className="shrink-0"
            iconPosition="left"
            icon={isUpdating ? SynchronizeSpinning : Synchronize}
            onClick={handleUpdate}
            disabled={isUpdating}
          >
            Update
          </Button>
        </div>
        <p className="text-sm text-foregroundMuted tracking-[-0.35px] leading-none">
          Configure your market data providers.
        </p>
      </div>

      {/* Stocks & ETFs */}
      <div className="flex flex-col gap-4 shrink-0">
        <h3 className="text-sm font-medium text-foreground tracking-[-0.35px] leading-none">
          Stocks &amp; ETFs
        </h3>
        <div className="flex flex-col rounded-lg overflow-clip">
          <ProviderRow
            icon={eodhdIcon}
            name="EODHD"
            description="Real-time, historical, and end-of-day financial data."
            enabled={priceProvider.enabled}
            onToggle={(v) => updatePriceProvider('eodhd', priceProvider.apiKey, v)}
            hasApiKey
            apiKeyMissing={!priceProvider.apiKey}
            isExpanded={eodhdKeyExpanded}
            onToggleExpand={() => toggleExpand('eodhd')}
          />
          {eodhdKeyExpanded && (
            <ApiKeyRow
              savedKey={priceProvider.apiKey}
              onSave={(key) => updatePriceProvider('eodhd', key, priceProvider.enabled)}
            />
          )}
          <ProviderRow
            icon={yahooIcon}
            name="Yahoo Finance"
            description="A leading financial data provider for many markets."
            enabled={exchangeRateProvider.enabled}
            onToggle={(v) => updateExchangeRateProvider('yahoo', undefined, v)}
          />
          <ProviderRow
            icon={nbpIcon}
            name="Narodowy Bank Polski"
            description="Historical currency rates and gold prices."
            enabled={nbpEnabled}
            onToggle={updateNbpEnabled}
            isLast
          />
        </div>
      </div>

      {/* Crypto */}
      <div className="flex flex-col gap-4 shrink-0">
        <h3 className="text-sm font-medium text-foreground tracking-[-0.35px] leading-none">
          Crypto
        </h3>
        <div className="flex flex-col rounded-lg overflow-clip">
          <ProviderRow
            icon={coinGeckoIcon}
            name="CoinGecko"
            description="Cryptocurrency prices."
            enabled={coinGeckoEnabled}
            onToggle={updateCoinGeckoEnabled}
            hasApiKey
            apiKeyMissing={!coinGeckoApiKey}
            isExpanded={coinGeckoExpanded}
            onToggleExpand={() => toggleExpand('coingecko')}
            isLast={!coinGeckoExpanded}
          />
          {coinGeckoExpanded && (
            <ApiKeyRow
              savedKey={coinGeckoApiKey}
              onSave={(key) => {
                updateCoinGeckoApiKey(key)
                clearHistoricalPricesCache()
              }}
              isLast
            />
          )}
        </div>
      </div>

      {/* Rebuild history */}
      <div className="flex flex-col gap-4 shrink-0">
        <h3 className="text-sm font-medium text-foreground tracking-[-0.35px] leading-none">
          Rebuild history
        </h3>
        <div className="flex flex-col rounded-lg overflow-clip">
          <div className="flex items-center gap-3 h-14 p-3 bg-muted">
            <div className="flex-1 flex flex-col justify-center min-w-0 px-1">
              <p className="text-xs text-foregroundMuted tracking-[-0.3px] leading-none w-full">
                This will rebuild quote history from your first activity date and recalculate the portfolio. Use this to fix gaps or sync issues.
              </p>
            </div>
            <button
              onClick={handleRebuild}
              disabled={isRebuilding}
              className="flex items-center justify-center h-9 px-4 rounded-full text-sm font-semibold text-foreground tracking-[-0.35px] cursor-pointer disabled:opacity-50 shrink-0"
            >
              {isRebuilding ? <Loader size={16} className="animate-spin" /> : 'Rebuild'}
            </button>
          </div>
        </div>
      </div>

      <Toast
        isOpen={failure !== null}
        // Toast calls onClose 200ms after Retry; if the retry has already failed
        // again by then, keep the newer failure instead of clearing it.
        onClose={() => setFailure((f) => (f === failure ? null : f))}
        message={failure?.message ?? ''}
        action={failure?.retry && { label: 'Retry', onClick: failure.retry, variant: 'ghost' }}
      />
    </div>
  )
}
