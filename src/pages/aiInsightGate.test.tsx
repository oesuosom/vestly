// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Holding, type Settings } from '@/types'
import { AccountDetail } from '@/pages/AccountDetail'
import { Overview } from '@/pages/Overview'

// Synthetic data only.
const now = '2026-01-01T00:00:00.000Z'
const bond: Holding = {
  id: 'h1', accountId: 'a1', name: 'Example Bond', category: 'bond', quantity: 10,
  purchasePrice: 100, currentPrice: 105, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
const account: Account = { id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [bond] }

let settings: Settings
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => settings }))
vi.mock('@/context/PortfolioContext', () => ({
  usePortfolio: () => ({
    accounts: [account], snapshots: [], transactions: [], isLoading: false,
    replaceAccounts: vi.fn(), addAccount: vi.fn(), updateAccount: vi.fn(), deleteAccount: vi.fn(),
    addHolding: vi.fn(), updateHolding: vi.fn(),
  }),
}))
vi.mock('@/components/charts/PortfolioAreaChart', () => ({ PortfolioAreaChart: () => null }))

const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 401 }))
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  settings = { ...DEFAULT_SETTINGS, claudeApiKey: 'sk-fake', anthropicEnabled: false }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})
const anthropicCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/anthropic'))
const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))

function accountPage() {
  return (
    <MemoryRouter initialEntries={['/accounts/test-broker']}>
      <Routes><Route path="/accounts/:accountSlug" element={<AccountDetail />} /></Routes>
    </MemoryRouter>
  )
}

describe('AI insights and the Anthropic switch', () => {
  it('account page: AI off with a key saved sends nothing and says AI is off', async () => {
    render(accountPage())
    await flush()
    expect(screen.getByText('AI insights are off')).toBeTruthy()
    expect(anthropicCalls()).toEqual([])
  })

  it('account page: switching AI on works without a reload, and an error is explained', async () => {
    const { rerender } = render(accountPage())
    await flush()
    settings = { ...settings, anthropicEnabled: true }
    rerender(accountPage())
    await flush()
    expect(anthropicCalls()).toHaveLength(1)
    expect(screen.getByText('Couldn’t generate an insight')).toBeTruthy()
    expect(screen.getByText(/invalid API key \(401\)/)).toBeTruthy()
  })

  it('account page: AI on without a key asks for one, and sends nothing', async () => {
    settings = { ...settings, anthropicEnabled: true, claudeApiKey: '' }
    render(accountPage())
    await flush()
    expect(screen.getByText('Add an API key to get insights')).toBeTruthy()
    expect(anthropicCalls()).toEqual([])
  })

  it('Overview: the insight card is hidden and nothing is sent while AI is off', async () => {
    render(<MemoryRouter><Overview /></MemoryRouter>)
    await flush()
    expect(screen.queryByText('Portfolio Insight')).toBeNull()
    expect(anthropicCalls()).toEqual([])
  })

  it('Overview: the insight card is hidden while AI is on without a key', async () => {
    settings = { ...settings, anthropicEnabled: true, claudeApiKey: '' }
    render(<MemoryRouter><Overview /></MemoryRouter>)
    await flush()
    expect(screen.queryByText('Portfolio Insight')).toBeNull()
    expect(anthropicCalls()).toEqual([])
  })
})
