// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Activity } from '@/pages/Activity'
import type { Account, Transaction } from '@/types'

const now = '2026-01-01T00:00:00.000Z'
const account = (id: string, name: string): Account => ({
  id, name, type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [],
})
const deposit = (id: string, accountId: string, amountPLN: number): Transaction => ({
  id, accountId, type: 'deposit', date: '2026-02-01', amountPLN, externalId: id, source: 'manual', createdAt: now,
})

const portfolio = {
  accounts: [account('acc_a', 'Demo Broker'), account('acc_b', 'Other Broker')],
  transactions: [deposit('t1', 'acc_a', 111), deposit('t2', 'acc_b', 222)],
  deleteTransaction: vi.fn(),
  deleteHolding: vi.fn(),
  setTransactions: vi.fn(),
  replaceAccounts: vi.fn(),
}
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Shows the current search and navigation type for the assertions. */
function Where() {
  const { search } = useLocation()
  return <output data-testid="where" data-search={search} data-navigation={useNavigationType()} />
}
const where = () => screen.getByTestId('where')

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Activity />
      <Where />
    </MemoryRouter>,
  )
}

/** Clicks the account chip's remove zone (its left quarter). */
function clearAccountChip() {
  const chip = screen.getByText('Demo Broker', { selector: 'span' }).parentElement!
  chip.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
  fireEvent.click(chip, { clientX: 10 })
}

const shows = (text: string) => screen.queryAllByText(text, { exact: false }).length > 0

describe('Activity — ?account=', () => {
  it('shows every account without the parameter', () => {
    renderAt('/activity')
    expect(shows('+111,00')).toBe(true)
    expect(shows('+222,00')).toBe(true)
  })

  it('presets the account filter from the parameter', () => {
    renderAt('/activity?account=acc_a')
    expect(shows('+111,00')).toBe(true)
    expect(shows('+222,00')).toBe(false)
  })

  it('ignores an unknown account', () => {
    renderAt('/activity?account=nope')
    expect(shows('+111,00')).toBe(true)
    expect(shows('+222,00')).toBe(true)
  })

  it('clears like any other account filter', () => {
    renderAt('/activity?account=acc_a')
    clearAccountChip()
    expect(screen.queryByText('Demo Broker', { selector: 'span' })).toBeNull()
    expect(shows('+222,00')).toBe(true)
  })

  it('drops the parameter when the filter is cleared, keeping other parameters', () => {
    renderAt('/activity?account=acc_a&other=1')
    expect(where().dataset.search).toBe('?account=acc_a&other=1')
    clearAccountChip()
    expect(where().dataset.search).toBe('?other=1')
    // In place, so Back doesn't return to the filtered list.
    expect(where().dataset.navigation).toBe('REPLACE')
  })
})

describe('Activity — delete buttons', () => {
  it('says which transaction each one deletes', () => {
    renderAt('/activity')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Deposit, Demo Broker, 1 Feb 2026' }))
    expect(portfolio.deleteTransaction).toHaveBeenCalledWith('t1')
    expect(screen.getByRole('button', { name: 'Delete Deposit, Other Broker, 1 Feb 2026' })).toBeTruthy()
  })
})

describe('Activity — notes on rows the holdings check added', () => {
  const holding = (id: string, name: string, ticker: string) => ({
    id, accountId: 'acc_a', name, ticker, category: 'stock' as const, quantity: 1, purchasePrice: 0, currentPrice: 0,
    purchaseDate: '2026-01-01', createdAt: now, updatedAt: now,
  })
  const row = (t: Partial<Transaction> & Pick<Transaction, 'id' | 'type' | 'externalId'>): Transaction => ({
    accountId: 'acc_a', date: '2026-02-01', amountPLN: 0, source: 'xtb_import', createdAt: now, ...t,
  })
  const rows: Transaction[] = [
    row({ id: 'r', type: 'receive', externalId: 'xtb-open-position-70000012', instrument: 'Spinco Example', ticker: 'SPIN',
      quantity: 3, comment: 'Received without a purchase (free shares or a spin-off)' }),
    row({ id: 'b', type: 'buy', externalId: 'xtb-open-position-70000009', instrument: 'Sample Holdings', ticker: 'SMPL',
      quantity: 2, amountPLN: -18.72, pricePerUnitOriginal: 2.4, originalCurrency: 'USD' }),
    row({ id: 'i', type: 'buy', externalId: '90000007', instrument: 'Sample Holdings', ticker: 'SMPL', quantity: 4,
      amountPLN: -51.2, comment: 'OPEN BUY SMPL.UK 4 @ 2.50' }),
  ]

  function renderNotes() {
    portfolio.accounts = [{ ...account('acc_a', 'Demo Broker'), holdings: [holding('h1', 'Spinco Example', 'SPIN'), holding('h2', 'Sample Holdings', 'SMPL')] }]
    portfolio.transactions = rows
    return renderAt('/activity')
  }
  const describedBy = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby')!)!

  it('badges only the rows the check added, with the exact copy, linked for screen readers', () => {
    renderNotes()
    const badges = screen.getAllByRole('img', { name: 'Note' })
    expect(badges).toHaveLength(2)
    expect(badges.map((b) => describedBy(b).textContent)).toEqual([
      'Added from XTB’s Open Positions: 3 received at cost 0 (free shares or a spin-off)',
      'Added from XTB’s Open Positions: 2 @ 2,4 USD',
    ])
    expect(badges.map((b) => describedBy(b).getAttribute('role'))).toEqual(['tooltip', 'tooltip'])
    // No visible note line under the instrument, and the comment isn't printed anywhere else.
    expect(screen.queryByText(/Received without a purchase/)).toBeNull()
    expect(screen.queryByText(/OPEN BUY/)).toBeNull()
  })

  it('the badge takes keyboard focus, and the tooltip shows on hover and on focus', () => {
    renderNotes()
    const [badge] = screen.getAllByRole('img', { name: 'Note' })
    expect(badge.tabIndex).toBe(0)
    badge.focus()
    expect(document.activeElement).toBe(badge)
    // Shown by the badge's own named group, on hover and on focus — never by the row's hover.
    expect(describedBy(badge).className).toMatch(/group-hover\/tooltip:opacity-100/)
    expect(describedBy(badge).className).toMatch(/group-focus-within\/tooltip:opacity-100/)
    expect(badge.className).toMatch(/group\/tooltip/)
  })

  it('rows without a note add no tab stops', () => {
    portfolio.accounts = [{ ...account('acc_a', 'Demo Broker'), holdings: [holding('h2', 'Sample Holdings', 'SMPL')] }]
    portfolio.transactions = [rows[2]]
    renderAt('/activity')
    expect(screen.queryByRole('img', { name: 'Note' })).toBeNull()
    expect(document.querySelectorAll('tbody [tabindex="0"]')).toHaveLength(0)
  })
})
