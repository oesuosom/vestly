// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { format } from 'date-fns'
import { ClosePositionDialog } from '@/features/accounts/ClosePositionDialog'
import type { Account, Holding, Transaction } from '@/types'

const now = '2026-01-01T00:00:00.000Z'
const apple: Holding = {
  id: 'aapl', accountId: 'xtb', name: 'Apple', ticker: 'AAPL', category: 'stock', quantity: 10,
  purchasePrice: 100, currentPrice: 150, purchaseDate: '2026-01-10', createdAt: now, updatedAt: now,
}
const bond: Holding = {
  ...apple, id: 'edo', name: 'Obligacje EDO0535', ticker: undefined, category: 'bond', quantity: 20, purchaseDate: '2025-05-15',
}
const buy: Transaction = {
  id: 'buy', accountId: 'xtb', type: 'buy', date: '2026-01-10', amountPLN: -1000, quantity: 10, ticker: 'AAPL',
  externalId: 'buy', source: 'xtb_import', createdAt: now,
}

const portfolio = {
  accounts: [] as Account[],
  transactions: [] as Transaction[],
  closePosition: vi.fn(() => ({})),
}
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))

function setAccount(type: Account['type'], holdings: Holding[], transactions: Transaction[] = [buy]) {
  portfolio.accounts = [{ id: 'xtb', name: 'XTB', type, createdAt: now, lastUpdated: now, holdings }]
  portfolio.transactions = transactions
}

const amount = () => screen.getByLabelText(/Sale amount|Amount received/)
const fee = () => screen.getByLabelText('Fee (PLN)')
const confirm = () => screen.getByRole('button', { name: 'Close Position' })
const previewRow = (label: string) => screen.getByText(label).nextElementSibling!.textContent

beforeEach(() => setAccount('brokerage', [apple]))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ClosePositionDialog', () => {
  it('previews the proceeds, realized profit and Cash change before anything is recorded', () => {
    render(<ClosePositionDialog holding={apple} isOpen onClose={() => {}} />)
    expect(previewRow('Proceeds')).toBe('—')

    fireEvent.change(amount(), { target: { value: '1600' } })
    fireEvent.change(fee(), { target: { value: '10' } })

    // 1 600 − 10 = 1 590 proceeds; cost 1 000 → +590, 59 %. Bought from cash, so Cash gets it.
    expect(previewRow('Proceeds')).toBe('1 590,00 PLN')
    expect(previewRow('Realized profit')).toBe('+590,00 PLN (+59,00%)')
    expect(previewRow('Cash')).toBe('+1 590,00 PLN')
    expect(portfolio.closePosition).not.toHaveBeenCalled()
  })

  it('records the close with today’s date by default, then closes and reports back', async () => {
    const onClose = vi.fn()
    const onClosed = vi.fn()
    render(<ClosePositionDialog holding={apple} isOpen onClose={onClose} onClosed={onClosed} />)

    fireEvent.change(amount(), { target: { value: '1600' } })
    fireEvent.click(confirm())

    await waitFor(() => expect(portfolio.closePosition).toHaveBeenCalledWith('aapl', {
      date: format(new Date(), 'yyyy-MM-dd'), saleAmountPLN: 1600, feePLN: 0,
    }))
    expect(onClose).toHaveBeenCalled()
    expect(onClosed).toHaveBeenCalled()
  })

  it('says Cash won’t change for a holding entered by hand', () => {
    setAccount('brokerage', [apple], [])
    render(<ClosePositionDialog holding={apple} isOpen onClose={() => {}} />)
    fireEvent.change(amount(), { target: { value: '1200' } })

    expect(previewRow('Cash')).toBe('No change')
    expect(screen.getByText(/wasn’t bought with the account’s cash/)).toBeTruthy()
  })

  it('refuses a fee larger than the sale, or a sale before the last purchase', async () => {
    render(<ClosePositionDialog holding={apple} isOpen onClose={() => {}} />)
    fireEvent.change(amount(), { target: { value: '100' } })
    fireEvent.change(fee(), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-09' } })
    fireEvent.click(confirm())

    expect(await screen.findByText('More than the sale')).toBeTruthy()
    expect(screen.getByText('Pick 10 Jan 2026 or later: the last purchase was then')).toBeTruthy()
    expect(portfolio.closePosition).not.toHaveBeenCalled()
  })

  it('labels a bond’s amount as what was received', () => {
    setAccount('ike', [bond], [])
    render(<ClosePositionDialog holding={bond} isOpen onClose={() => {}} />)
    expect(screen.getByLabelText('Amount received (PLN)')).toBeTruthy()
    expect(screen.getByText(/after the 19% tax where it applies/)).toBeTruthy()
  })

  it('blocks the close while another open holding shares the ticker', () => {
    const second = { ...apple, id: 'aapl-2', name: 'Apple (2nd lot)' }
    setAccount('brokerage', [apple, second])
    render(<ClosePositionDialog holding={apple} isOpen onClose={() => {}} />)

    expect(screen.getByText(/Apple \(2nd lot\) in this account has the same ticker/)).toBeTruthy()
    expect(screen.queryByLabelText('Sale amount (PLN)')).toBeNull()
    expect((confirm() as HTMLButtonElement).disabled).toBe(true)
  })
})
