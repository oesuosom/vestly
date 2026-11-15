// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { StorageErrorBanner } from '@/components/layout/StorageErrorBanner'
import { KEYS } from '@/storage/portfolioStore'

type Ctx = ReturnType<typeof usePortfolio>

/** Captures the live context value so tests can call actions directly. */
let ctx: Ctx
function Probe() {
  const value = usePortfolio()
  useEffect(() => {
    ctx = value
  })
  return <p>portfolio children</p>
}

function renderProvider() {
  return render(
    // Same nesting as App: SettingsProvider writes on mount, so it must sit
    // inside the gate for the "no writes on a failed load" checks to mean anything.
    <PortfolioProvider>
      <SettingsProvider>
        <StorageErrorBanner />
        <Probe />
      </SettingsProvider>
    </PortfolioProvider>
  )
}

/** A valid, current-schema store, written with the real setItem before any spy. */
function seedValidStore() {
  const now = new Date().toISOString()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: now, updatedAt: now }))
  localStorage.setItem(KEYS.ACCOUNTS, '[]')
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, '[]')
}

const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

/** Make setItem throw a quota error for the given keys. */
function failWritesTo(keys: string[]) {
  const realSetItem = Storage.prototype.setItem
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (keys.includes(key)) throw quotaError()
    realSetItem.call(this, key, value)
  })
}

beforeEach(() => {
  localStorage.clear()
  // writeKey logs every failed write; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PortfolioProvider — unreadable stored data', () => {
  it.each([KEYS.ACCOUNTS, KEYS.SNAPSHOTS, KEYS.TRANSACTIONS])(
    'shows the recovery screen instead of the app when %s is unreadable',
    (key) => {
      seedValidStore()
      localStorage.setItem(key, '{')
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

      renderProvider()

      expect(screen.queryByText('portfolio children')).toBeNull()
      expect(screen.getByRole('button', { name: 'Download backup' })).toBeTruthy()
      expect(screen.getByText(new RegExp(key))).toBeTruthy()
      // The unreadable value must survive untouched so the backup can carry it.
      expect(localStorage.getItem(key)).toBe('{')
      expect(setItem).not.toHaveBeenCalled()
      expect(removeItem).not.toHaveBeenCalled()
    }
  )

  it('treats valid JSON of the wrong shape as unreadable', () => {
    seedValidStore()
    localStorage.setItem(KEYS.ACCOUNTS, '{}')

    renderProvider()

    expect(screen.queryByText('portfolio children')).toBeNull()
    expect(localStorage.getItem(KEYS.ACCOUNTS)).toBe('{}')
  })

  it('does not let a schema migration overwrite unreadable data', () => {
    // A lost version key makes initializeStore stamp 2.0.0 and migrate to the
    // current schema, which re-saves accounts. It must never get that far.
    seedValidStore()
    localStorage.removeItem(KEYS.VERSION)
    localStorage.setItem(KEYS.ACCOUNTS, '{')

    renderProvider()

    expect(screen.queryByText('portfolio children')).toBeNull()
    expect(localStorage.getItem(KEYS.ACCOUNTS)).toBe('{')
  })
})

describe('PortfolioProvider — failed saves', () => {
  it('shows the storage-full message when a save fails, and clears it after the next successful save', () => {
    seedValidStore()
    renderProvider()
    expect(screen.getByText('portfolio children')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    const setItem = failWritesTo([KEYS.ACCOUNTS])
    act(() => ctx.addAccount({ name: 'Lost', type: 'brokerage' }))

    expect(ctx.loadError).toBeNull()
    expect(ctx.saveError).toMatch(/Browser storage is full/)
    expect(screen.getByRole('alert').textContent).toMatch(/Browser storage is full — could not save "ft_accounts"/)
    // The snapshot write succeeded, but the accounts write is still failing.
    expect(JSON.parse(localStorage.getItem(KEYS.SNAPSHOTS)!)).toHaveLength(1)

    setItem.mockRestore()
    act(() => ctx.updateAccount(ctx.accounts[0].id, { name: 'Saved' }))

    expect(ctx.saveError).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(JSON.parse(localStorage.getItem(KEYS.ACCOUNTS)!)).toMatchObject([{ name: 'Saved' }])
  })

  it('keeps the app running with a save error when storage is full at startup', () => {
    seedValidStore()
    // Portfolio keys only: SettingsProvider's own save has the same unhandled
    // quota problem, which is outside this issue.
    failWritesTo([KEYS.ACCOUNTS, KEYS.SNAPSHOTS, KEYS.TRANSACTIONS])

    renderProvider()

    expect(screen.getByText('portfolio children')).toBeTruthy()
    expect(ctx.loadError).toBeNull()
    expect(ctx.saveError).toMatch(/Browser storage is full/)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
