// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteHoldingDialog } from '@/features/accounts/DeleteHoldingDialog'
import type { Account, Holding, Transaction } from '@/types'

const now = '2026-01-01T00:00:00.000Z'
const holding = (id: string): Holding => ({
  id, accountId: 'acc', name: 'Apple', ticker: 'AAPL', category: 'stock', quantity: 1,
  purchasePrice: 100, currentPrice: 100, purchaseDate: '2026-01-10', createdAt: now, updatedAt: now,
})
const tx = (id: string, fields: Partial<Transaction>): Transaction => ({
  id, accountId: 'acc', type: 'buy', date: now, amountPLN: -100, externalId: id, source: 'manual', createdAt: now, ...fields,
})

const portfolio = {
  accounts: [] as Account[],
  transactions: [] as Transaction[],
  deleteHolding: vi.fn(),
}
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setPortfolio(holdings: Holding[], transactions: Transaction[]) {
  portfolio.accounts = [{ id: 'acc', name: 'Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings }]
  portfolio.transactions = transactions
}

/** The dialog's body copy, read as one string across its inline emphasis. */
function message() {
  return screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.startsWith('Are you sure')).textContent
}

describe('DeleteHoldingDialog', () => {
  it('says how many transactions go with the holding', () => {
    const apple = holding('apple')
    setPortfolio([apple], [
      tx('buy-1', { ticker: 'AAPL' }),
      tx('buy-2', { ticker: 'AAPL' }),
      tx('div', { type: 'dividend', amountPLN: 5, relatedTicker: 'AAPL' }),
      tx('deposit', { type: 'deposit', amountPLN: 500 }),
    ])
    render(<DeleteHoldingDialog holding={apple} isOpen onClose={() => {}} />)

    expect(message()).toBe(
      'Are you sure you want to delete Apple? This also deletes 3 transactions (2 buys, 1 dividend). This cannot be undone.',
    )
  })

  it('mentions no transactions when none go — e.g. one of two same-ticker holdings', () => {
    const apple1 = holding('apple-1')
    setPortfolio([apple1, holding('apple-2')], [tx('buy-1', { ticker: 'AAPL' }), tx('buy-2', { ticker: 'AAPL' })])
    render(<DeleteHoldingDialog holding={apple1} isOpen onClose={() => {}} />)

    expect(message()).toBe(
      'Are you sure you want to delete Apple? This cannot be undone.',
    )
  })

  it('deletes the holding, then closes and reports back', () => {
    const apple = holding('apple')
    setPortfolio([apple], [])
    const onClose = vi.fn()
    const onDeleted = vi.fn()
    render(<DeleteHoldingDialog holding={apple} isOpen onClose={onClose} onDeleted={onDeleted} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(portfolio.deleteHolding).toHaveBeenCalledWith('apple')
    expect(onClose).toHaveBeenCalled()
    expect(onDeleted).toHaveBeenCalled()
  })

  it('cancels without deleting', () => {
    const apple = holding('apple')
    setPortfolio([apple], [])
    const onClose = vi.fn()
    render(<DeleteHoldingDialog holding={apple} isOpen onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(portfolio.deleteHolding).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
