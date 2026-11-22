// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types'
import { MarketDataSettingsPage } from './MarketDataSettingsPage'

const settings = {
  ...DEFAULT_SETTINGS,
  coinGeckoEnabled: false,
  coinGeckoApiKey: '',
  updatePriceProvider: vi.fn(),
  updateExchangeRateProvider: vi.fn(),
  updateNbpEnabled: vi.fn(),
  updateCoinGeckoEnabled: vi.fn(),
  updateCoinGeckoApiKey: vi.fn(),
}
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => settings }))
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => ({ accounts: [], replaceAccounts: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MarketDataSettingsPage', () => {
  it('says what each provider is used for', () => {
    render(<MarketDataSettingsPage />)
    expect(screen.getByText('Price updates, price history and dividends for AI insights.')).toBeTruthy()
    expect(screen.getByText('Price history and news for AI insights.')).toBeTruthy()
    expect(screen.getByText('Exchange rates for history and imports.')).toBeTruthy()
    expect(screen.getByText('Crypto prices and their history.')).toBeTruthy()
  })

  it('keeps the description for a provider without a key, and no extra lines', () => {
    render(<MarketDataSettingsPage />)
    expect(screen.queryByText('Add an API key to enable this provider.')).toBeNull()
    // EODHD needs a key, so its switch stays disabled without one.
    expect((screen.getByRole('switch', { name: 'EODHD' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets CoinGecko be switched on without a key (free tier)', () => {
    render(<MarketDataSettingsPage />)
    const toggle = screen.getByRole('switch', { name: 'CoinGecko' }) as HTMLButtonElement
    expect(toggle.disabled).toBe(false)
    fireEvent.click(toggle)
    expect(settings.updateCoinGeckoEnabled).toHaveBeenCalledWith(true)
  })
})
