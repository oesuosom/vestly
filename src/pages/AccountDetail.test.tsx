// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountDetail } from '@/pages/AccountDetail'
import type { Account, Holding } from '@/types'

const now = '2026-01-01T00:00:00.000Z'
const stock: Holding = {
  id: 'h1', accountId: 'a1', name: 'Example Corp', category: 'stock', quantity: 10,
  purchasePrice: 100, currentPrice: 100, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
}
// What upsertSyntheticCashHolding builds: 2 000 deposited, 1 000 spent.
const cash: Holding = {
  id: 'cash_a1', accountId: 'a1', name: 'Cash', category: 'cash', quantity: 1,
  purchasePrice: 1000, currentPrice: 1000, purchaseDate: '2026-01-01', isSynthetic: true, createdAt: now, updatedAt: now,
}
const account: Account = {
  id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [stock, cash],
}

const portfolio = {
  accounts: [account],
  snapshots: [],
  transactions: [],
  replaceAccounts: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  addHolding: vi.fn(),
  updateHolding: vi.fn(),
  deleteHolding: vi.fn(),
  closePosition: vi.fn(),
  reopenPosition: vi.fn(),
}
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))
vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({ claudeApiKey: '', coinGeckoApiKey: '', priceProvider: { enabled: false, apiKey: '' } }),
}))
vi.mock('@/hooks/useHistoricalPrices', () => ({ useHistoricalPrices: () => ({ historicalPrices: {} }) }))
vi.mock('@/hooks/useAccountInsight', () => ({
  useAccountInsight: () => ({ summary: null, isLoading: false, error: null, cachedAt: null, regenerate: vi.fn() }),
}))
vi.mock('@/components/charts/PortfolioAreaChart', () => ({ PortfolioAreaChart: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounts/test-broker']}>
      <Routes>
        <Route path="/accounts/:accountSlug" element={<AccountDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

/** The holdings-table row whose first cell names the holding. */
function row(name: string) {
  const cell = screen.getAllByRole('cell').find((c) => c.textContent === name)!
  return cell.closest('tr')!
}

describe('AccountDetail — row actions', () => {
  it('gives a real holding Edit, Close position and Delete', () => {
    renderPage()
    const stockRow = row('Example Corp')
    fireEvent.click(within(stockRow).getByRole('button'))

    // The menu opens inside the row's actions cell.
    expect(within(stockRow).getByText('Edit')).toBeTruthy()
    expect(within(stockRow).getByText('Close position')).toBeTruthy()
    expect(within(stockRow).getByText('Delete')).toBeTruthy()
  })

  it('gives the Cash row no actions', () => {
    renderPage()
    expect(within(row('Cash')).queryByRole('button')).toBeNull()
  })
})
