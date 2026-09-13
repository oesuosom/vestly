import { useState } from 'react'
import eodhdIcon from '@/assets/providers/eodhd.png'
import yahooIcon from '@/assets/providers/yahoo-finance.png'
import nbpIcon from '@/assets/providers/narodowy-bank-polski.png'
import coinGeckoIcon from '@/assets/providers/coin-gecko.png'
import { Synchronize, ChevronTopSmall, Eye, Loader, Nut } from '@/generated/icons'
import { Button } from '@/components/ui/Button'

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
    try {
      const result = await fetchAllPrices(accounts, settings, { forceRefresh: true })
      if (result.updatedAccounts) {
        replaceAccounts(result.updatedAccounts)
      }
    } catch {
      // no error UI defined for this screen
    } finally {
      setIsUpdating(false)
    }
  }

  async function handleRebuild() {
    setIsRebuilding(true)
    try {
      clearHistoricalPricesCache()
      const newCache = await buildHistoricalPricesCache(
        accounts,
        coinGeckoApiKey,
        null,
        priceProvider.apiKey,
      )
      saveHistoricalPricesCache(newCache)
    } catch {
      // silently fail — rebuild will retry on next portfolio load
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
    </div>
  )
}
