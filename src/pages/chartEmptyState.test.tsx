// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Account, type Holding, type Snapshot } from '@/types'
import { AccountDetail } from '@/pages/AccountDetail'
import { Overview } from '@/pages/Overview'

// Synthetic data only. "Today" is fixed so the chart's timeline is predictable.
const TODAY = '2026-11-22'
const now = `${TODAY}T12:00:00.000Z`
const bond = (purchaseDate: string): Holding => ({
  id: 'h1', accountId: 'a1', name: 'Sample Bond', category: 'bond', quantity: 10,
  purchasePrice: 100, currentPrice: 100, purchaseDate, createdAt: now, updatedAt: now,
})
const todaySnapshot = (value: number): Snapshot => ({
  id: 's1', date: TODAY, totalValue: value, allocation: {} as Snapshot['allocation'],
  accountValues: { a1: value }, createdAt: now,
})

const data: { accounts: Account[]; snapshots: Snapshot[] } = { accounts: [], snapshots: [] }
function seed(holdings: Holding[], snapshots: Snapshot[]) {
  data.accounts = [{ id: 'a1', name: 'Test Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings }]
  data.snapshots = snapshots
}

vi.mock('@/context/SettingsContext', () => ({ useSettings: () => DEFAULT_SETTINGS }))
vi.mock('@/context/PortfolioContext', () => ({
  usePortfolio: () => ({
    accounts: data.accounts, snapshots: data.snapshots, transactions: [], isLoading: false,
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

async function renderAccount() {
  render(
    <MemoryRouter initialEntries={['/accounts/test-broker']}>
      <Routes><Route path="/accounts/:accountSlug" element={<AccountDetail />} /></Routes>
    </MemoryRouter>,
  )
  await flush()
  // The value + chart card: the one with the Refresh prices button.
  return screen.getByRole('button', { name: 'Refresh prices' }).closest('.rounded-xl') as HTMLElement
}

describe('account page: chart card with nothing to draw', () => {
  it.each([
    {
      name: 'no holdings and no snapshots',
      holdings: [],
      snapshots: [],
      title: 'No chart data yet',
      body: 'Add transactions or open the app daily to start building your portfolio history.',
    },
    {
      name: 'one holding bought today',
      holdings: [bond(TODAY)],
      snapshots: [todaySnapshot(1000)],
      title: 'Not enough history yet',
      body: 'Your chart will appear once you have more than one data point.',
    },
  ])('$name: the message takes the chart’s and range picker’s place, without the logo', async ({ holdings, snapshots, title, body }) => {
    seed(holdings, snapshots)
    const card = await renderAccount()
    expect(within(card).getByText(title)).toBeTruthy()
    expect(within(card).getByText(body)).toBeTruthy()
    // Same layout as the card's other chart messages (HistoryNotices).
    expect(within(card).getByText(title).parentElement!.className).toContain('max-w-[360px]')
    expect(card.querySelector('canvas')).toBeNull()
    for (const range of ['1M', '3M', '6M', '1Y', 'ALL']) {
      expect(within(card).queryByRole('button', { name: range })).toBeNull()
    }
  })

  it('draws ALL as soon as 1Y does, when the history started earlier this month', async () => {
    // Bought earlier this month: ALL has the first day and today, like 1Y.
    seed([bond('2026-11-10')], [todaySnapshot(1000)])
    const card = await renderAccount()
    expect(within(card).queryByText('Not enough history yet')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'ALL' }))
    expect(within(card).queryByText('Not enough history yet')).toBeNull()
    expect(within(card).getByRole('button', { name: 'ALL' })).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: '1Y' }))
    expect(within(card).queryByText('Not enough history yet')).toBeNull()
  })
})

describe('Overview: chart with nothing to draw', () => {
  it('keeps its empty state: logo, title, text and the range picker', async () => {
    seed([], [])
    const { container } = render(<MemoryRouter><Overview /></MemoryRouter>)
    await flush()
    const title = screen.getByRole('heading', { name: 'No chart data yet' })
    expect(screen.getByText('Add transactions or open the app daily to start building your portfolio history.')).toBeTruthy()
    expect(title.parentElement!.className).toContain('py-20')
    expect(title.parentElement!.querySelector('canvas')).toBeTruthy()
    expect(container.querySelector('canvas')).toBeTruthy()
    expect(screen.getByRole('button', { name: '1Y' })).toBeTruthy()
  })
})
