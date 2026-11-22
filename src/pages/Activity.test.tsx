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
