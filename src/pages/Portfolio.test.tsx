// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Portfolio } from '@/pages/Portfolio'
import { DEFAULT_SETTINGS, type Account } from '@/types'

const now = '2026-01-01T00:00:00.000Z'
const account: Account = {
  id: 'a1', name: 'Demo Broker', type: 'brokerage', createdAt: now, lastUpdated: now,
  holdings: [{
    id: 'h1', accountId: 'a1', name: 'Example Corp', category: 'stock', quantity: 10,
    purchasePrice: 100, currentPrice: 100, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now,
  }],
}
vi.mock('@/context/PortfolioContext', () => ({
  usePortfolio: () => ({ accounts: [account], transactions: [], updateHolding: vi.fn(), deleteHolding: vi.fn() }),
}))
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => DEFAULT_SETTINGS }))

afterEach(cleanup)

describe('Portfolio — allocation toggle', () => {
  it('is named after what it switches to', () => {
    render(<MemoryRouter><Portfolio /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Show percentages' }))
    expect(screen.getByRole('button', { name: 'Show amounts' })).toBeTruthy()
  })
})
