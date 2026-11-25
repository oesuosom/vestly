import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types'
import { migrateSettings } from '@/context/SettingsContext'
import { isProviderOn } from '@/services/providers'

describe('provider defaults', () => {
  it('starts Yahoo Finance, NBP and CoinGecko on, and Anthropic and EODHD off, for a new install', () => {
    expect(DEFAULT_SETTINGS.exchangeRateProvider.enabled).toBe(true)
    expect(DEFAULT_SETTINGS.nbpEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.coinGeckoEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.anthropicEnabled).toBe(false)
    expect(DEFAULT_SETTINGS.priceProvider.enabled).toBe(false)
  })
})

describe('migrateSettings', () => {
  it('keeps switches that were saved off', () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      exchangeRateProvider: { id: 'yahoo', enabled: false },
      nbpEnabled: false,
      coinGeckoEnabled: false,
    }
    const s = migrateSettings(JSON.stringify(saved))
    expect(s.exchangeRateProvider.enabled).toBe(false)
    expect(s.nbpEnabled).toBe(false)
    expect(s.coinGeckoEnabled).toBe(false)
  })

  it('keeps switches that were saved on', () => {
    const saved = {
      ...DEFAULT_SETTINGS,
      anthropicEnabled: true,
      claudeApiKey: 'sk-fake',
      priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd', enabled: true },
    }
    const s = migrateSettings(JSON.stringify(saved))
    expect(isProviderOn(s, 'anthropic')).toBe(true)
    expect(isProviderOn(s, 'eodhd')).toBe(true)
  })

  it('gives missing switches their defaults', () => {
    const s = migrateSettings(JSON.stringify({ rebalancingThreshold: 5 }))
    expect(s.exchangeRateProvider).toEqual({ id: 'yahoo', apiKey: undefined, enabled: true })
    expect(s.nbpEnabled).toBe(true)
    expect(s.coinGeckoEnabled).toBe(true)
    expect(s.anthropicEnabled).toBe(false)
    expect(s.priceProvider.enabled).toBe(false)
    expect(s.rebalancingThreshold).toBe(5)
  })

  it('keeps AI off for someone who saved a key but never switched AI on', () => {
    const s = migrateSettings(JSON.stringify({ claudeApiKey: 'sk-fake' }))
    expect(s.anthropicEnabled).toBe(false)
    expect(isProviderOn(s, 'anthropic')).toBe(false)
  })

  it('fills a provider object saved without its switch', () => {
    const s = migrateSettings(JSON.stringify({ priceProvider: { id: 'eodhd', apiKey: 'fake-eodhd' } }))
    expect(s.priceProvider).toEqual({ id: 'eodhd', apiKey: 'fake-eodhd', enabled: false })
  })

  it('loads settings saved with the old time zone setting, dropping it (#71)', () => {
    const saved = { ...DEFAULT_SETTINGS, theme: 'dark', timezone: 'Europe/Warsaw' }
    const s = migrateSettings(JSON.stringify(saved))
    expect(s.theme).toBe('dark')
    expect('timezone' in s).toBe(false)
  })
})
