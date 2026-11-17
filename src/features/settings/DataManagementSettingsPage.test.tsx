// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecoveryScreen } from '@/components/layout/RecoveryScreen'
import { DataManagementSettingsPage } from '@/features/settings/DataManagementSettingsPage'
import { DEFAULT_SETTINGS, type Settings } from '@/types'
import { downloadJson } from '@/utils/download'

vi.mock('@/utils/download', () => ({ downloadJson: vi.fn() }))

const reload = vi.fn()
const alert = vi.fn()

const now = '2026-02-10T09:00:00.000Z'
const holding = {
  id: 'h1', accountId: 'a1', name: 'Example Corp', category: 'stock',
  quantity: 10, purchasePrice: 100, currentPrice: 120, purchaseDate: '2025-03-01',
}
const accounts = [{ id: 'a1', name: 'Broker', type: 'brokerage', holdings: [holding] }]
const transactions = [{ id: 't1', accountId: 'a1', type: 'buy', date: '2025-03-01', amountPLN: -1000 }]
const snapshots = [{
  id: 's1', date: '2026-02-10', totalValue: 1200,
  allocation: { bonds: 0, stocks: 1200, cash: 0, crypto: 0 }, accountValues: { a1: 1200 },
}]

/** Settings with every API key filled in, so nothing is blank by accident. */
const settingsWithKeys: Settings = {
  ...DEFAULT_SETTINGS,
  theme: 'dark',
  claudeApiKey: 'sk-ant-PLACEHOLDER',
  coinGeckoApiKey: 'CG-PLACEHOLDER',
  priceProvider: { id: 'eodhd', apiKey: 'EODHD-PLACEHOLDER', enabled: true },
  exchangeRateProvider: { id: 'yahoo', apiKey: 'FX-PLACEHOLDER', enabled: true },
}

function seed(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
}

function stored(key: string): unknown {
  const raw = localStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

function appKeys(): Record<string, string | null> {
  return Object.fromEntries(
    Object.keys(localStorage).filter((k) => k.startsWith('ft_')).map((k) => [k, localStorage.getItem(k)]),
  )
}

/** The data the last `downloadJson` call would have saved. */
function lastDownload(): Record<string, unknown> {
  return vi.mocked(downloadJson).mock.lastCall![1] as Record<string, unknown>
}

/** Download a recovery file from the recovery screen, as a user would. */
function downloadRecoveryFile(): Record<string, unknown> {
  render(<RecoveryScreen title="Your portfolio data couldn't be read" description="" />)
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
  cleanup()
  return lastDownload()
}

/** Pick `file` in Restore Backup and wait for it to be accepted or refused. */
async function chooseFile(file: unknown) {
  const { container } = render(<DataManagementSettingsPage />)
  const input = container.querySelector('input[type="file"]')!
  const json = new File([JSON.stringify(file)], 'backup.json', { type: 'application/json' })
  fireEvent.change(input, { target: { files: [json] } })
  await waitFor(() => {
    if (alert.mock.calls.length === 0 && !screen.queryByRole('button', { name: 'Import' })) {
      throw new Error('file not read yet')
    }
  })
}

async function restore(file: unknown) {
  await chooseFile(file)
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('location', { ...window.location, reload })
  vi.stubGlobal('alert', alert)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(downloadJson).mockClear()
  reload.mockClear()
  alert.mockClear()
})

describe('API keys in backups', () => {
  it('are blanked identically by Export Backup and the recovery screen', () => {
    // The recovery screen keeps its own copy of the field list (it may not
    // import the settings page); this fails if either list gains a field.
    // Every text setting is filled in, so a key field added to `Settings`
    // later is non-blank here too.
    const fillText = (value: unknown): unknown =>
      typeof value === 'string' ? 'PLACEHOLDER'
        : Array.isArray(value) ? value.map(fillText)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillText(v)]))
            : value
    seed({ ft_settings: fillText(settingsWithKeys) })

    render(<DataManagementSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Export Backup' }))
    const exported = JSON.parse(JSON.stringify(lastDownload().settings))
    cleanup()

    expect(downloadRecoveryFile().ft_settings).toEqual(exported)
    expect(exported).toMatchObject({ claudeApiKey: '', priceProvider: { apiKey: '' } })
  })
})

describe('Restore Backup with a recovery file', () => {
  const store = {
    ft_version: { version: '5.0.0', createdAt: now, updatedAt: now },
    ft_accounts: accounts,
    ft_transactions: transactions,
    ft_snapshots: snapshots,
    ft_settings: settingsWithKeys,
    ft_contribution: { ike: [], ikze: [], updatedAt: now },
    ft_news_cache: { items: [], cachedAt: now },
  }

  it('restores every backup key and keeps the current session’s API keys', async () => {
    seed(store)
    const file = downloadRecoveryFile()
    localStorage.clear()
    seed({ ft_settings: { ...DEFAULT_SETTINGS, claudeApiKey: 'SESSION-KEY' } })

    await restore(file)

    expect(alert).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(stored('ft_accounts')).toEqual(accounts)
    expect(stored('ft_transactions')).toEqual(transactions)
    expect(stored('ft_snapshots')).toEqual(snapshots)
    expect(stored('ft_version')).toEqual(store.ft_version)
    expect(stored('ft_contribution')).toEqual(store.ft_contribution)
    expect(stored('ft_settings')).toMatchObject({ theme: 'dark', claudeApiKey: 'SESSION-KEY' })
    // Caches are not part of a backup; they refill on their own.
    expect(localStorage.getItem('ft_news_cache')).toBeNull()
  })

  it('refuses a file saved while a key was unreadable, and writes nothing', async () => {
    // The scenario the recovery screen exists for: one unreadable key,
    // download the file, reset, then try to restore it.
    seed({ ...store, ft_accounts: '{' })
    const file = downloadRecoveryFile()
    localStorage.clear()
    seed({ ft_settings: DEFAULT_SETTINGS })
    const before = appKeys()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    await chooseFile(file)

    expect(alert).toHaveBeenCalledWith(
      'This file can’t be restored.\n\n'
      + 'The accounts entry (“ft_accounts”) was already unreadable when this recovery file was saved. '
      + 'Fix that entry in the file, or restore an earlier backup.',
    )
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
    expect(appKeys()).toEqual(before)
  })

  it('restores the same file once the unreadable entry is fixed by hand', async () => {
    seed({ ...store, ft_accounts: '{' })
    const file = { ...downloadRecoveryFile(), ft_accounts: accounts }
    localStorage.clear()

    await restore(file)

    expect(alert).not.toHaveBeenCalled()
    expect(stored('ft_accounts')).toEqual(accounts)
    expect(stored('ft_transactions')).toEqual(transactions)
  })

  it('restores without settings when they were unreadable and left out of the file', async () => {
    seed({ ...store, ft_settings: '{"claudeApiKey":"sk-ant-PLACEHOLDER"' })
    const file = downloadRecoveryFile()
    expect(file).not.toHaveProperty('ft_settings')
    localStorage.clear()
    seed({ ft_settings: { ...DEFAULT_SETTINGS, theme: 'dark' } })

    await restore(file)

    expect(alert).not.toHaveBeenCalled()
    expect(stored('ft_accounts')).toEqual(accounts)
    expect(stored('ft_settings')).toMatchObject({ theme: 'dark' })
  })
})

describe('Restore Backup with a normal backup', () => {
  it('still keeps the current session’s API keys when the file has none', async () => {
    seed({ ft_settings: { ...DEFAULT_SETTINGS, claudeApiKey: 'SESSION-KEY' } })

    await restore({ accounts, settings: { ...DEFAULT_SETTINGS, theme: 'dark' } })

    expect(stored('ft_accounts')).toEqual(accounts)
    expect(stored('ft_settings')).toMatchObject({ theme: 'dark', claudeApiKey: 'SESSION-KEY' })
  })

  it('still refuses a file with no recognised data, writing nothing', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await chooseFile({ hello: 'world' })

    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/no recognised data/))
    expect(setItem).not.toHaveBeenCalled()
  })
})
