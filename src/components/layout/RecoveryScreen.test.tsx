// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecoveryScreen } from '@/components/layout/RecoveryScreen'
import { downloadJson } from '@/utils/download'

vi.mock('@/utils/download', () => ({ downloadJson: vi.fn() }))

const reload = vi.fn()

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('ft_accounts', '{')
  localStorage.setItem('ft_settings', JSON.stringify({ theme: 'dark' }))
  localStorage.setItem('unrelated', 'keep me')
  // jsdom does not implement navigation; swap in a spy-able location.
  vi.stubGlobal('location', { ...window.location, reload })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(downloadJson).mockClear()
  reload.mockClear()
})

function renderScreen() {
  return render(
    <RecoveryScreen title="Your portfolio data couldn't be read" description="Test description" details='Stored "ft_accounts" is unreadable' />
  )
}

describe('RecoveryScreen', () => {
  it('renders the given title, description and details', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: "Your portfolio data couldn't be read" })).toBeTruthy()
    expect(screen.getByText('Test description')).toBeTruthy()
    expect(screen.getByText('Stored "ft_accounts" is unreadable')).toBeTruthy()
  })

  it('offers the restore only on condition, since a file with unreadable data is refused', () => {
    renderScreen()
    expect(screen.getByText(/^If the file is readable, you can restore it later in Settings → Data Management\./)).toBeTruthy()
  })

  it('downloads every app key, keeping unreadable values as raw strings', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))

    expect(downloadJson).toHaveBeenCalledWith('vestly-recovery', {
      ft_accounts: '{',
      ft_settings: { theme: 'dark' },
    })
  })

  it('blanks every API key in the settings it downloads', () => {
    localStorage.setItem('ft_settings', JSON.stringify({
      theme: 'dark',
      claudeApiKey: 'sk-ant-PLACEHOLDER',
      coinGeckoApiKey: 'CG-PLACEHOLDER',
      priceProvider: { id: 'eodhd', apiKey: 'EODHD-PLACEHOLDER', enabled: true },
      exchangeRateProvider: { id: 'yahoo', apiKey: 'FX-PLACEHOLDER', enabled: true },
    }))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))

    const file = vi.mocked(downloadJson).mock.calls[0][1] as Record<string, unknown>
    expect(JSON.stringify(file)).not.toMatch(/PLACEHOLDER/)
    expect(file.ft_settings).toEqual({
      theme: 'dark',
      claudeApiKey: '',
      coinGeckoApiKey: '',
      priceProvider: { id: 'eodhd', apiKey: '', enabled: true },
      exchangeRateProvider: { id: 'yahoo', enabled: true },
    })
  })

  it('leaves out settings it cannot read, since the raw text may hold a key', () => {
    localStorage.setItem('ft_settings', '{"theme":"dark","claudeApiKey":"sk-ant-PLACEHOLDER"')
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))

    const file = vi.mocked(downloadJson).mock.calls[0][1] as Record<string, unknown>
    expect(file).toEqual({ ft_accounts: '{' })
    expect(JSON.stringify(file)).not.toMatch(/PLACEHOLDER/)
  })

  it('leaves out settings that parse to something other than an object', () => {
    localStorage.setItem('ft_settings', JSON.stringify('sk-ant-PLACEHOLDER'))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))

    expect(downloadJson).toHaveBeenCalledWith('vestly-recovery', { ft_accounts: '{' })
  })

  it('never writes to localStorage while rendering, downloading or reloading', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const clear = vi.spyOn(Storage.prototype, 'clear')

    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload the page' }))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it('only erases app data on the second click of the reset button', () => {
    renderScreen()

    fireEvent.click(screen.getByRole('button', { name: 'Reset all app data' }))
    expect(localStorage.getItem('ft_accounts')).toBe('{')
    expect(reload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Click again to erase everything' }))
    expect(localStorage.getItem('ft_accounts')).toBeNull()
    expect(localStorage.getItem('ft_settings')).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep me')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
