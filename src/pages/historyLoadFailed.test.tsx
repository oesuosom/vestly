// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Holding } from '@/types'
import { saveHistoricalPricesCache } from '@/storage/historicalPriceStorage'
import { AccountDetail } from '@/pages/AccountDetail'
import { Overview } from '@/pages/Overview'

// Synthetic data only. Yahoo, NBP and CoinGecko are on (the defaults); both
// holdings' history has already been fetched and came back empty.
const now = '2026-01-01T00:00:00.000Z'
const stock: Holding = {
  id: 'h1', accountId: 'a1', name: 'Przykład SA', ticker: 'PRZK', exchange: 'PL', category: 'stock',
  quantity: 10, purchasePrice: 100, currentPrice: 110, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
const coin: Holding = {
  id: 'h2', accountId: 'a1', name: 'Bitcoin', ticker: 'BTC', exchange: 'CC', category: 'crypto',
  quantity: 0.01, purchasePrice: 300000, currentPrice: 350000, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
const account: Account = { id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [stock, coin] }

vi.mock('@/context/SettingsContext', () => ({ useSettings: () => DEFAULT_SETTINGS }))
vi.mock('@/context/PortfolioContext', () => ({
  usePortfolio: () => ({
    accounts: [account], snapshots: [], transactions: [], isLoading: false,
    replaceAccounts: vi.fn(), addAccount: vi.fn(), updateAccount: vi.fn(), deleteAccount: vi.fn(),
    addHolding: vi.fn(), updateHolding: vi.fn(),
  }),
}))
vi.mock('@/components/charts/PortfolioAreaChart', () => ({ PortfolioAreaChart: () => <div data-testid="chart" /> }))

const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 503 }))
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', fetchMock)
  const fetchedAt = new Date()
  saveHistoricalPricesCache({
    histories: [{ holdingId: 'h1', prices: [] }, { holdingId: 'h2', prices: [] }],
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + 7 * 864e5).toISOString(),
    providers: 'yahoo,nbp,coingecko',
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})
const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))

const pages = {
  'account page': () => (
    <MemoryRouter initialEntries={['/accounts/test-broker']}>
      <Routes><Route path="/accounts/:accountSlug" element={<AccountDetail />} /></Routes>
    </MemoryRouter>
  ),
  Overview: () => <MemoryRouter><Overview /></MemoryRouter>,
}

describe.each(Object.entries(pages))('%s: every holding’s history failed to load', (_name, page) => {
  it('replaces the chart and range picker with a message, not the "off" message', async () => {
    render(page())
    await flush()
    expect(screen.getByText("Couldn't load price history")).toBeTruthy()
    expect(screen.getByText("Price history couldn't be loaded just now. Values today are still correct.")).toBeTruthy()
    expect(screen.queryByText('No price history')).toBeNull()
    expect(screen.queryByText('No chart data yet')).toBeNull()
    expect(screen.queryByTestId('chart')).toBeNull()
    expect(screen.queryByRole('button', { name: '1Y' })).toBeNull()
    // Nothing was refetched on its own.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Try again refetches the history, showing the chart while it loads', async () => {
    render(page())
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // Loading: the chart is back while the retry runs.
    expect(screen.getByTestId('chart')).toBeTruthy()
    await flush()
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/api/yahoo/v8/finance/chart/PRZK'))).toBe(true)
    expect(urls.some((u) => u.includes('/api/coingecko/'))).toBe(true)
  })
})
