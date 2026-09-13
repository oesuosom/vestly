import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_ALLOCATION_GROUPS,
  DEFAULT_SETTINGS,
  type AllocationGroup,
  type AllocationTargets,
  type ExchangeRateProviderId,
  type InstrumentAlias,
  type PriceProviderId,
  type Settings,
  type ThemeMode,
} from '@/types'
import { KEYS, saveSettings } from '@/storage/portfolioStore'

type SettingsActions = {
  updateAllocationGroups: (groups: AllocationGroup[]) => void
  updateRebalancingThreshold: (value: number) => void
  updateCoinGeckoApiKey: (key: string) => void
  updateClaudeApiKey: (key: string) => void
  updatePriceProvider: (id: PriceProviderId, apiKey: string, enabled: boolean) => void
  updateExchangeRateProvider: (id: ExchangeRateProviderId, apiKey: string | undefined, enabled: boolean) => void
  updateInstrumentAliases: (aliases: Record<string, InstrumentAlias>) => void
  updateUserName: (name: string) => void
  updateUserAvatar: (avatar: string | undefined) => void
  updateTheme: (theme: ThemeMode) => void
  updateTimezone: (tz: string) => void
  updateNbpEnabled: (enabled: boolean) => void
  updateCoinGeckoEnabled: (enabled: boolean) => void
  updateAnthropicEnabled: (enabled: boolean) => void
}

type SettingsContextValue = Settings & SettingsActions

const SettingsContext = createContext<SettingsContextValue | null>(null)

function migrateSettings(raw: string): Settings {
  const parsed = JSON.parse(raw) as Settings & { allocationTargets?: AllocationTargets }

  // Migrate old allocationTargets → allocationGroups
  const allocationGroups = parsed.allocationGroups ?? (
    parsed.allocationTargets
      ? [
          { id: 'bonds',  name: 'Bonds',  categories: ['bond']         as const, target: parsed.allocationTargets.bonds  },
          { id: 'equity', name: 'Equity', categories: ['stock', 'etf'] as const, target: parsed.allocationTargets.stocks },
          { id: 'cash',   name: 'Cash',   categories: ['cash']         as const, target: parsed.allocationTargets.cash   },
          { id: 'crypto', name: 'Crypto', categories: ['crypto']       as const, target: parsed.allocationTargets.crypto },
        ]
      : DEFAULT_ALLOCATION_GROUPS
  )

  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    allocationGroups,
    priceProvider: parsed.priceProvider ?? DEFAULT_SETTINGS.priceProvider,
    exchangeRateProvider: parsed.exchangeRateProvider ?? DEFAULT_SETTINGS.exchangeRateProvider,
    instrumentAliases: parsed.instrumentAliases ?? DEFAULT_SETTINGS.instrumentAliases,
    nbpEnabled: parsed.nbpEnabled ?? true,
    coinGeckoEnabled: parsed.coinGeckoEnabled ?? true,
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(KEYS.SETTINGS)
      if (raw) return migrateSettings(raw)
    } catch {
      // fall through
    }
    return DEFAULT_SETTINGS
  })

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // Multi-tab sync: adopt settings written by other tabs. The `storage` event
  // only fires in tabs that did not perform the write, so this cannot loop.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== KEYS.SETTINGS || e.newValue === null) return
      try {
        setSettings(migrateSettings(e.newValue))
      } catch {
        // Malformed payload from another tab — keep current settings
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const updateAllocationGroups = useCallback((groups: AllocationGroup[]) => {
    setSettings((prev) => ({
      ...prev,
      allocationGroups: groups,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateRebalancingThreshold = useCallback((value: number) => {
    setSettings((prev) => ({
      ...prev,
      rebalancingThreshold: value,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateCoinGeckoApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      coinGeckoApiKey: key,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateClaudeApiKey = useCallback((key: string) => {
    setSettings((prev) => ({
      ...prev,
      claudeApiKey: key,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updatePriceProvider = useCallback(
    (id: PriceProviderId, apiKey: string, enabled: boolean) => {
      setSettings((prev) => ({
        ...prev,
        priceProvider: { id, apiKey, enabled },
        updatedAt: new Date().toISOString(),
      }))
    },
    []
  )

  const updateExchangeRateProvider = useCallback(
    (id: ExchangeRateProviderId, apiKey: string | undefined, enabled: boolean) => {
      setSettings((prev) => ({
        ...prev,
        exchangeRateProvider: { id, apiKey, enabled },
        updatedAt: new Date().toISOString(),
      }))
    },
    []
  )

  const updateInstrumentAliases = useCallback((aliases: Record<string, InstrumentAlias>) => {
    setSettings((prev) => ({
      ...prev,
      instrumentAliases: aliases,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateUserName = useCallback((name: string) => {
    setSettings((prev) => ({
      ...prev,
      userName: name || undefined,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateUserAvatar = useCallback((avatar: string | undefined) => {
    setSettings((prev) => ({
      ...prev,
      userAvatar: avatar,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateTheme = useCallback((theme: ThemeMode) => {
    setSettings((prev) => ({
      ...prev,
      theme,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateTimezone = useCallback((tz: string) => {
    setSettings((prev) => ({
      ...prev,
      timezone: tz,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateNbpEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      nbpEnabled: enabled,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateCoinGeckoEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      coinGeckoEnabled: enabled,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  const updateAnthropicEnabled = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      anthropicEnabled: enabled,
      updatedAt: new Date().toISOString(),
    }))
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'dark') {
      root.classList.add('dark')
      return
    }
    if (settings.theme === 'light') {
      root.classList.remove('dark')
      return
    }
    // system
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        updateAllocationGroups,
        updateRebalancingThreshold,
        updateCoinGeckoApiKey,
        updateClaudeApiKey,
        updatePriceProvider,
        updateExchangeRateProvider,
        updateInstrumentAliases,
        updateUserName,
        updateUserAvatar,
        updateTheme,
        updateTimezone,
        updateNbpEnabled,
        updateCoinGeckoEnabled,
        updateAnthropicEnabled,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
