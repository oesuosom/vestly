// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Holding, type Snapshot, type Transaction } from '@/types'
import { AccountDetail } from '@/pages/AccountDetail'
import { Overview } from '@/pages/Overview'

// Synthetic data only. "Today" is fixed so the chart's timeline is predictable.
const TODAY = '2026-11-25'
const now = `${TODAY}T12:00:00.000Z`
// Bought for 800 PLN, worth 1,000 PLN today.
const bond = (purchaseDate: string): Holding => ({
  id: 'h1', accountId: 'a1', name: 'Sample Bond', category: 'bond', quantity: 8,
  purchasePrice: 100, currentPrice: 125, purchaseDate, createdAt: now, updatedAt: now,
})
const snapshot = (date: string, value: number): Snapshot => ({
  id: `s-${date}`, date, totalValue: value, allocation: {} as Snapshot['allocation'],
  accountValues: { a1: value }, createdAt: now,
})

const data: { accounts: Account[]; snapshots: Snapshot[]; transactions: Transaction[] } = {
  accounts: [], snapshots: [], transactions: [],
}
function seed(holdings: Holding[], snapshots: Snapshot[]) {
  data.accounts = [{ id: 'a1', name: 'Demo Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings }]
  data.snapshots = snapshots
  data.transactions = []
}

const flow = (accountId: string, date: string, amountPLN: number): Transaction => ({
  id: `f-${accountId}-${date}-${amountPLN}`, externalId: `f-${accountId}-${date}-${amountPLN}`, accountId,
  type: amountPLN >= 0 ? 'deposit' : 'withdrawal', date: `${date}T10:00:00.000Z`, amountPLN, source: 'manual', createdAt: now,
})
/** The synthetic cash holding the app keeps for an account, from its transactions. */
const cash = (accountId: string, transactions: Transaction[]): Holding => {
  const own = transactions.filter((t) => t.accountId === accountId)
  const balance = own.reduce((sum, t) => sum + t.amountPLN, 0)
  return {
    id: `cash_${accountId}`, accountId, name: 'Cash', category: 'cash', quantity: 1, purchasePrice: balance,
    currentPrice: balance, purchaseDate: own.map((t) => t.date.slice(0, 10)).sort()[0], isSynthetic: true,
    createdAt: now, updatedAt: now,
  }
}
/** Accounts by name, each with its own cash and any other holdings. */
function seedAccounts(accounts: { id: string; name: string; holdings?: Holding[] }[], transactions: Transaction[], snapshots: Snapshot[] = []) {
  data.accounts = accounts.map(({ id, name, holdings = [] }) => ({
    id, name, type: 'brokerage', createdAt: now, lastUpdated: now,
    holdings: [...holdings, cash(id, transactions)],
  }))
  data.transactions = transactions
  data.snapshots = snapshots
}

vi.mock('@/context/SettingsContext', () => ({ useSettings: () => DEFAULT_SETTINGS }))
vi.mock('@/context/PortfolioContext', () => ({
  usePortfolio: () => ({
    accounts: data.accounts, snapshots: data.snapshots, transactions: data.transactions, isLoading: false,
    replaceAccounts: vi.fn(), addAccount: vi.fn(), updateAccount: vi.fn(), deleteAccount: vi.fn(),
    addHolding: vi.fn(), updateHolding: vi.fn(),
  }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(now))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const flush = () => act(() => new Promise((r) => setTimeout(r, 20)))

/** The "since …" label and the change next to it. */
function changeLabel(scope: HTMLElement) {
  const since = within(scope).getByText(/^since /)
  return { since: since.textContent, change: since.previousElementSibling?.textContent ?? null }
}

async function renderOverview() {
  render(<MemoryRouter><Overview /></MemoryRouter>)
  await flush()
  return document.body
}

async function renderAccount(slug = 'demo-broker') {
  render(
    <MemoryRouter initialEntries={[`/accounts/${slug}`]}>
      <Routes><Route path="/accounts/:accountSlug" element={<AccountDetail />} /></Routes>
    </MemoryRouter>,
  )
  await flush()
  // The value + chart card: the one with the Refresh prices button.
  return screen.getByRole('button', { name: 'Refresh prices' }).closest('.rounded-xl') as HTMLElement
}

describe.each([
  { page: 'Overview', renderPage: renderOverview },
  { page: 'account page', renderPage: renderAccount },
])('$page: change under the value', ({ renderPage }) => {
  it('history imported today, only today’s snapshot: ALL is since the first day with data, not today', async () => {
    seed([bond('2023-03-17')], [snapshot(TODAY, 1000)])
    const scope = await renderPage()
    fireEvent.click(within(scope).getByRole('button', { name: 'ALL' }))
    const label = changeLabel(scope)
    expect(label.since).toBe('since 17 Mar 2023')
    expect(label.change).toMatch(/^\+200 PLN \(\+25,0+%\)$/)
    expect(within(scope).queryByText(/inception/)).toBeNull()
  })

  it('a range that starts before the history does: since the first day with data', async () => {
    seed([bond('2026-11-05')], [snapshot(TODAY, 1000)])
    const scope = await renderPage()
    // 1Y is the default range and starts a year ago, long before the purchase.
    expect(changeLabel(scope).since).toBe('since 5 Nov 2026')
  })

  it('follows the range picker', async () => {
    seed([bond('2023-03-17')], [snapshot('2026-10-01', 900), snapshot(TODAY, 1000)])
    const scope = await renderPage()
    const seen: Record<string, string | null> = {}
    for (const [range, date] of [['1M', '25 Oct 2026'], ['1Y', '25 Nov 2025'], ['ALL', '17 Mar 2023']]) {
      fireEvent.click(within(scope).getByRole('button', { name: range }))
      const label = changeLabel(scope)
      expect(label.since, range).toBe(`since ${date}`)
      seen[range] = label.change
    }
    expect(seen.ALL).toMatch(/^\+200 PLN \(\+25,0+%\)$/)
    expect(new Set(Object.values(seen)).size).toBe(3)
  })

  it('shows no change when the chart has no line', async () => {
    seed([bond(TODAY)], [snapshot(TODAY, 1000)])
    const scope = await renderPage()
    expect(within(scope).queryByText(/^since /)).toBeNull()
  })
})

describe('money moved in or out isn’t a gain or a loss', () => {
  const RANGES = ['1M', '1Y', 'ALL'] as const
  const deposits = [flow('a1', '2026-09-01', 1000), flow('a1', '2026-11-10', 10_000)]
  // Overview hides the change when it's 0 and keeps "since …"; the account page shows "0 PLN (0,00%)".
  const overviewChange = (scope: HTMLElement) => changeLabel(scope).change
  const accountChange = (scope: HTMLElement) => changeLabel(scope).change?.replace(/\s/g, ' ')

  it('Overview: cash only, a deposit and no price move is no change', async () => {
    seedAccounts([{ id: 'a1', name: 'Demo Broker' }], deposits, [snapshot('2026-10-01', 1000)])
    const scope = await renderOverview()
    for (const range of RANGES) {
      fireEvent.click(within(scope).getByRole('button', { name: range }))
      expect(overviewChange(scope), range).toBeNull()
      expect(changeLabel(scope).since, range).toMatch(/^since /)
    }
  })

  it('account page: cash only, a deposit and no price move is no change', async () => {
    seedAccounts([{ id: 'a1', name: 'Demo Broker' }], deposits, [snapshot('2026-10-01', 1000)])
    const scope = await renderAccount()
    for (const range of RANGES) {
      fireEvent.click(within(scope).getByRole('button', { name: range }))
      expect(accountChange(scope), range).toMatch(/^0 PLN \(0,00%\)$/)
    }
  })

  it('a price move plus a deposit: only the price move counts', async () => {
    seedAccounts([{ id: 'a1', name: 'Demo Broker', holdings: [bond('2023-03-17')] }], [flow('a1', '2026-11-18', 5000)])
    const overview = await renderOverview()
    fireEvent.click(within(overview).getByRole('button', { name: 'ALL' }))
    expect(changeLabel(overview).change).toMatch(/^\+200 PLN/)
    cleanup()
    const account = await renderAccount()
    fireEvent.click(within(account).getByRole('button', { name: 'ALL' }))
    expect(changeLabel(account).change).toMatch(/^\+200 PLN/)
  })

  describe('a transfer between two accounts on the same day', () => {
    const base = [flow('a1', '2026-09-01', 5000), flow('a2', '2026-09-01', 1000)]
    const transfer = [flow('a1', '2026-11-12', -2000), flow('a2', '2026-11-12', 2000)]
    const accounts = [
      { id: 'a1', name: 'Demo Broker', holdings: [bond('2023-03-17')] },
      { id: 'a2', name: 'Demo Savings' },
    ]

    it('leaves Overview’s change as it was', async () => {
      const seen: (string | null)[] = []
      for (const txs of [base, [...base, ...transfer]]) {
        seedAccounts(accounts, txs)
        const scope = await renderOverview()
        fireEvent.click(within(scope).getByRole('button', { name: 'ALL' }))
        seen.push(changeLabel(scope).change)
        cleanup()
      }
      expect(seen[0]).toMatch(/^\+200 PLN/)
      expect(seen[1]).toBe(seen[0])
    })

    it('shows no change on either account page: each counts its own side', async () => {
      seedAccounts(accounts.map((a) => ({ ...a, holdings: [] })), [...base, ...transfer])
      for (const slug of ['demo-broker', 'demo-savings']) {
        const scope = await renderAccount(slug)
        for (const range of RANGES) {
          fireEvent.click(within(scope).getByRole('button', { name: range }))
          expect(accountChange(scope), `${slug} ${range}`).toMatch(/^0 PLN \(0,00%\)$/)
        }
        cleanup()
      }
    })
  })
})
