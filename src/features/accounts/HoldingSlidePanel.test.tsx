// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoldingSlidePanel } from '@/features/accounts/HoldingSlidePanel'
import type { Account, Holding, Transaction } from '@/types'

const portfolio = {
  accounts: [] as Account[],
  transactions: [] as Transaction[],
  updateHolding: vi.fn(),
  deleteHolding: vi.fn(),
  replaceAccounts: vi.fn(),
  reopenPosition: vi.fn(),
  closePosition: vi.fn(),
}
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({ priceProvider: { enabled: false, apiKey: '' } }),
}))

afterEach(() => {
  cleanup()
  portfolio.accounts = []
  portfolio.transactions = []
  vi.clearAllMocks()
})

const holding: Holding = {
  id: 'h1',
  accountId: 'a1',
  name: 'Test Holding',
  category: 'stock',
  quantity: 10,
  purchasePrice: 100,
  currentPrice: 120,
  purchaseDate: '2026-01-02',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

/** The panel and its backdrop: the two direct children the panel portals into <body>. */
function overlayRoots() {
  const panel = screen.getByText('Test Holding').closest('.t-panel-slide')!
  return { panel, backdrop: panel.previousElementSibling! }
}

describe('HoldingSlidePanel', () => {
  it('leaves the panel reachable while open', () => {
    render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    const { panel, backdrop } = overlayRoots()
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(backdrop.hasAttribute('inert')).toBe(false)
  })

  it('keeps the closed panel rendered but inert', () => {
    const { rerender } = render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    // The parent clears the holding and closes at the same time.
    rerender(<HoldingSlidePanel holding={null} isOpen={false} onClose={() => {}} />)

    const { panel, backdrop } = overlayRoots()
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(backdrop.hasAttribute('inert')).toBe(true)
  })
})

describe('HoldingSlidePanel — a closed holding', () => {
  const closed: Holding = { ...holding, ticker: 'TST', closedAt: '2026-03-10' }
  const now = '2026-01-02T00:00:00.000Z'
  const tx = (id: string, fields: Partial<Transaction>): Transaction => ({
    id, accountId: 'a1', type: 'buy', date: '2026-01-02', amountPLN: -1000, quantity: 10, ticker: 'TST',
    relatedHoldingId: 'h1', externalId: id, source: 'manual', createdAt: now, ...fields,
  })
  const log = [
    tx('close-buy', { externalId: 'close-buy-h1', affectsCash: false }),
    // 1 300 sale − 10 fee = 1 290; cost 1 000 → +290, +29 %.
    tx('close-sell', { type: 'sell', date: '2026-03-10', amountPLN: 1290, feePLN: 10, externalId: 'close-sell-h1' }),
  ]
  const account = (holdings: Holding[]): Account => ({
    id: 'a1', name: 'XTB', type: 'brokerage', createdAt: now, lastUpdated: now, holdings, closedHoldings: [closed],
  })

  it('is read-only: what the sale realized, its transactions, and Reopen and Delete', () => {
    portfolio.accounts = [account([])]
    portfolio.transactions = log
    render(<HoldingSlidePanel holding={closed} isOpen onClose={() => {}} />)

    expect(screen.getByText('10 Mar 2026')).toBeTruthy()
    expect(screen.getByText('After a 10,00 PLN fee')).toBeTruthy()
    expect(screen.getByText('+290,00 PLN')).toBeTruthy()
    expect(screen.getByText('(+29,00%)')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    const buttons = screen.getAllByRole('button').map((b) => b.textContent).filter(Boolean)
    expect(buttons).toEqual(['Reopen', 'Delete'])

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(portfolio.reopenPosition).toHaveBeenCalledWith('h1')
  })

  it('can’t be reopened while a rebuy with the same ticker is open', () => {
    const rebuy = { ...holding, id: 'h2', name: 'Test Holding (rebuy)', ticker: 'TST' }
    portfolio.accounts = [account([rebuy])]
    portfolio.transactions = log
    render(<HoldingSlidePanel holding={closed} isOpen onClose={() => {}} />)

    expect(screen.getByText('Reopen is unavailable while Test Holding (rebuy) is open in this account.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Reopen' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers Close Position for an open holding', () => {
    render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close Position' })).toBeTruthy()
  })
})

describe('HoldingSlidePanel — the Cash row', () => {
  const cash: Holding = {
    ...holding, id: 'cash_a1', name: 'Cash', category: 'cash', quantity: 1,
    purchasePrice: 1000, currentPrice: 1000, isSynthetic: true,
  }
  const actions = () => screen.getAllByRole('button').map((b) => b.textContent).filter(Boolean)

  it('says where the number comes from instead of offering Edit, Close Position or Delete', () => {
    render(<HoldingSlidePanel holding={cash} isOpen onClose={() => {}} />)

    expect(screen.getByText('Calculated from this account’s deposits, withdrawals, trades, income, taxes and fees.')).toBeTruthy()
    expect(actions()).toEqual([])
  })

  it('leaves a real holding its actions', () => {
    render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    expect(actions()).toEqual(['Edit', 'Close Position', 'Delete'])
  })
})
