// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { StorageErrorBanner } from '@/components/layout/StorageErrorBanner'
import { KEYS } from '@/storage/portfolioStore'
import type { Account, Holding, Transaction } from '@/types'

type Ctx = ReturnType<typeof usePortfolio>

/** Captures the live context value so tests can call actions directly. */
let ctx: Ctx
function Probe() {
  const value = usePortfolio()
  useEffect(() => {
    ctx = value
  })
  return <p>portfolio children</p>
}

function renderProvider() {
  return render(
    // Same nesting as App: SettingsProvider writes on mount, so it must sit
    // inside the gate for the "no writes on a failed load" checks to mean anything.
    <PortfolioProvider>
      <SettingsProvider>
        <StorageErrorBanner />
        <Probe />
      </SettingsProvider>
    </PortfolioProvider>
  )
}

/** A valid, current-schema store, written with the real setItem before any spy. */
function seedValidStore() {
  const now = new Date().toISOString()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: now, updatedAt: now }))
  localStorage.setItem(KEYS.ACCOUNTS, '[]')
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, '[]')
}

const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

/** Make setItem throw a quota error for the given keys. */
function failWritesTo(keys: string[]) {
  const realSetItem = Storage.prototype.setItem
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (keys.includes(key)) throw quotaError()
    realSetItem.call(this, key, value)
  })
}

beforeEach(() => {
  localStorage.clear()
  // writeKey logs every failed write; keep the test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PortfolioProvider — unreadable stored data', () => {
  it.each([KEYS.ACCOUNTS, KEYS.SNAPSHOTS, KEYS.TRANSACTIONS])(
    'shows the recovery screen instead of the app when %s is unreadable',
    (key) => {
      seedValidStore()
      localStorage.setItem(key, '{')
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

      renderProvider()

      expect(screen.queryByText('portfolio children')).toBeNull()
      expect(screen.getByRole('button', { name: 'Download backup' })).toBeTruthy()
      expect(screen.getByText(new RegExp(key))).toBeTruthy()
      // The unreadable value must survive untouched so the backup can carry it.
      expect(localStorage.getItem(key)).toBe('{')
      expect(setItem).not.toHaveBeenCalled()
      expect(removeItem).not.toHaveBeenCalled()
    }
  )

  it('treats valid JSON of the wrong shape as unreadable', () => {
    seedValidStore()
    localStorage.setItem(KEYS.ACCOUNTS, '{}')

    renderProvider()

    expect(screen.queryByText('portfolio children')).toBeNull()
    expect(localStorage.getItem(KEYS.ACCOUNTS)).toBe('{}')
  })

  it('does not let a schema migration overwrite unreadable data', () => {
    // A lost version key makes initializeStore stamp 2.0.0 and migrate to the
    // current schema, which re-saves accounts. It must never get that far.
    seedValidStore()
    localStorage.removeItem(KEYS.VERSION)
    localStorage.setItem(KEYS.ACCOUNTS, '{')

    renderProvider()

    expect(screen.queryByText('portfolio children')).toBeNull()
    expect(localStorage.getItem(KEYS.ACCOUNTS)).toBe('{')
  })
})

describe('PortfolioProvider — failed saves', () => {
  it('shows the storage-full message when a save fails, and clears it after the next successful save', () => {
    seedValidStore()
    renderProvider()
    expect(screen.getByText('portfolio children')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    const setItem = failWritesTo([KEYS.ACCOUNTS])
    act(() => ctx.addAccount({ name: 'Lost', type: 'brokerage' }))

    expect(ctx.loadError).toBeNull()
    expect(ctx.saveError).toMatch(/Browser storage is full/)
    expect(screen.getByRole('alert').textContent).toMatch(/Browser storage is full — could not save "ft_accounts"/)
    // The snapshot write succeeded, but the accounts write is still failing.
    expect(JSON.parse(localStorage.getItem(KEYS.SNAPSHOTS)!)).toHaveLength(1)

    setItem.mockRestore()
    act(() => ctx.updateAccount(ctx.accounts[0].id, { name: 'Saved' }))

    expect(ctx.saveError).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(JSON.parse(localStorage.getItem(KEYS.ACCOUNTS)!)).toMatchObject([{ name: 'Saved' }])
  })

  it('keeps the app running with a save error when storage is full at startup', () => {
    seedValidStore()
    // Portfolio keys only: SettingsProvider's own save has the same unhandled
    // quota problem, which is outside this issue.
    failWritesTo([KEYS.ACCOUNTS, KEYS.SNAPSHOTS, KEYS.TRANSACTIONS])

    renderProvider()

    expect(screen.getByText('portfolio children')).toBeTruthy()
    expect(ctx.loadError).toBeNull()
    expect(ctx.saveError).toMatch(/Browser storage is full/)
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})

describe('PortfolioProvider — deleting holdings and transactions', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const holding = (id: string, accountId: string, value: number): Holding => ({
    id, accountId, name: 'Apple', ticker: 'AAPL', category: 'stock', quantity: 1,
    purchasePrice: value, currentPrice: value, purchaseDate: '2026-01-10', createdAt: now, updatedAt: now,
  })
  const account = (id: string, type: Account['type'], holdings: Holding[]): Account => ({
    id, name: id, type, createdAt: now, lastUpdated: now, holdings,
  })
  const tx = (id: string, accountId: string, fields: Partial<Transaction>): Transaction => ({
    id, accountId, type: 'buy', date: '2026-01-10T10:00:00.000Z', amountPLN: 0,
    externalId: id, source: 'manual', createdAt: now, ...fields,
  })

  /** #17's scenario: one account, two Apple holdings, a buy for each, a linked dividend and a deposit. */
  function seedTwoApples(type: Account['type'] = 'brokerage', income?: Transaction[]) {
    const now = new Date().toISOString()
    localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: now, updatedAt: now }))
    localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify([
      account('acc', type, [holding('apple-1', 'acc', 1200), holding('apple-2', 'acc', 400)]),
    ]))
    localStorage.setItem(KEYS.SNAPSHOTS, '[]')
    localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify([
      tx('deposit', 'acc', { type: 'deposit', amountPLN: 2000 }),
      tx('buy-1', 'acc', { instrument: 'Apple', ticker: 'AAPL', amountPLN: -1200 }),
      tx('buy-2', 'acc', { instrument: 'Apple', ticker: 'AAPL', amountPLN: -400 }),
      // Linked by id only: with a relatedTicker, startup's resolveDividendLinks
      // would re-point it at whichever AAPL holding comes last.
      ...(income ?? [tx('div-1', 'acc', { type: 'dividend', amountPLN: 55, relatedInstrument: 'Apple', relatedHoldingId: 'apple-1' })]),
    ]))
  }

  // StrictMode double-invokes state updaters, so these also catch an impure one.
  function renderStrict() {
    return render(<StrictMode><PortfolioProvider><Probe /></PortfolioProvider></StrictMode>)
  }

  const cashOf = (accounts: Account[]) => accounts[0].holdings.find((h) => h.isSynthetic)?.currentPrice
  const storedCash = () => cashOf(JSON.parse(localStorage.getItem(KEYS.ACCOUNTS)!))
  const txIds = () => ctx.transactions.map((t) => t.id)

  it('keeps the other same-ticker holding’s transactions and updates Cash at once', () => {
    seedTwoApples()
    renderStrict()
    expect(cashOf(ctx.accounts)).toBe(455)

    act(() => ctx.deleteHolding('apple-1'))

    expect(ctx.accounts[0].holdings.map((h) => h.id)).toEqual(['apple-2', 'cash_acc'])
    expect(txIds()).toEqual(['deposit', 'buy-1', 'buy-2'])
    // Only the linked dividend left the log: 2000 − 1200 − 400.
    expect(cashOf(ctx.accounts)).toBe(400)
    expect(storedCash()).toBe(400)

    // A reload derives the same Cash from the stored log.
    cleanup()
    renderStrict()
    expect(cashOf(ctx.accounts)).toBe(400)
  })

  // The realistic shape: dividend and tax carry a relatedTicker, so startup's
  // resolveDividendLinks points both at the last AAPL holding, apple-2.
  const tickerLinkedIncome = [
    tx('div', 'acc', { type: 'dividend', amountPLN: 55, relatedTicker: 'AAPL' }),
    tx('tax', 'acc', { type: 'withholding_tax', amountPLN: -1, relatedTicker: 'AAPL' }),
  ]
  const links = () => ctx.transactions.map((t) => `${t.id}→${t.relatedHoldingId ?? '-'}`)

  it.each([
    ['last', 'apple-2', 'apple-1'],
    ['first', 'apple-1', 'apple-2'],
  ])('keeps ticker-linked dividends when the %s of two same-ticker holdings is deleted', (_, deleted, remaining) => {
    seedTwoApples('brokerage', tickerLinkedIncome)
    renderStrict()
    expect(links()).toEqual(['deposit→-', 'buy-1→-', 'buy-2→-', 'div→apple-2', 'tax→apple-2'])
    expect(cashOf(ctx.accounts)).toBe(454)

    act(() => ctx.deleteHolding(deleted))

    // Nothing leaves the log, and the income now points at the holding that's left.
    expect(links()).toEqual(['deposit→-', 'buy-1→-', 'buy-2→-', `div→${remaining}`, `tax→${remaining}`])
    expect(cashOf(ctx.accounts)).toBe(454)

    cleanup()
    renderStrict()
    expect(links()).toEqual(['deposit→-', 'buy-1→-', 'buy-2→-', `div→${remaining}`, `tax→${remaining}`])
    expect(cashOf(ctx.accounts)).toBe(454)
  })

  it('updates Cash as soon as a transaction is deleted', () => {
    seedTwoApples()
    renderStrict()

    act(() => ctx.deleteTransaction('buy-2'))

    expect(txIds()).toEqual(['deposit', 'buy-1', 'div-1'])
    expect(cashOf(ctx.accounts)).toBe(855)
    expect(storedCash()).toBe(855)
  })

  it('handles a transaction and a holding deleted in the same handler, as Activity does', () => {
    seedTwoApples()
    renderStrict()

    act(() => {
      ctx.deleteTransaction('buy-1')
      ctx.deleteHolding('apple-1')
    })

    expect(txIds()).toEqual(['deposit', 'buy-2'])
    expect(cashOf(ctx.accounts)).toBe(1600)
  })

  it('adds no Cash row to a crypto account', () => {
    seedTwoApples('crypto')
    renderStrict()

    act(() => ctx.deleteHolding('apple-1'))
    act(() => ctx.deleteTransaction('buy-2'))

    expect(ctx.accounts[0].holdings.map((h) => h.id)).toEqual(['apple-2'])
    expect(txIds()).toEqual(['deposit', 'buy-1'])
  })
})

describe('PortfolioProvider — closing and reopening positions', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const base = { category: 'stock' as const, accountId: 'xtb', createdAt: now, updatedAt: now }
  // AAPL: bought from the account's cash (imported). CDR: entered by hand, no buy in the log.
  const apple: Holding = { ...base, id: 'aapl', name: 'Apple', ticker: 'AAPL', quantity: 10, purchasePrice: 100, currentPrice: 150, purchaseDate: '2026-01-10' }
  const cdr: Holding = { ...base, id: 'cdr', name: 'CD Projekt', ticker: 'CDR', quantity: 4, purchasePrice: 250, currentPrice: 250, purchaseDate: '2025-06-01' }
  const seedLog: Transaction[] = [
    { id: 'deposit', accountId: 'xtb', type: 'deposit', date: '2026-01-02', amountPLN: 1500, externalId: 'deposit', source: 'xtb_import', createdAt: now },
    { id: 'buy', accountId: 'xtb', type: 'buy', date: '2026-01-10', amountPLN: -1000, quantity: 10, ticker: 'AAPL', externalId: 'buy', source: 'xtb_import', createdAt: now },
  ]

  function seed() {
    localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: now, updatedAt: now }))
    localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify([
      { id: 'xtb', name: 'XTB', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [apple, cdr] },
    ]))
    localStorage.setItem(KEYS.SNAPSHOTS, '[]')
    localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(seedLog))
  }

  function renderStrict() {
    return render(<StrictMode><PortfolioProvider><Probe /></PortfolioProvider></StrictMode>)
  }

  const xtb = () => ctx.accounts[0]
  const cash = () => xtb().holdings.find((h) => h.isSynthetic)!.currentPrice
  const storedAccount = (): Account => JSON.parse(localStorage.getItem(KEYS.ACCOUNTS)!)[0]
  const todaysTotal = () => ctx.snapshots.at(-1)!.totalValue

  it('records the sale, moves the holding to closed and adds the proceeds to Cash, surviving a reload', () => {
    seed()
    renderStrict()
    // Cash 1 500 − 1 000 = 500. Total: AAPL 10 × 150 + CDR 4 × 250 + 500 = 3 000.
    expect(cash()).toBe(500)
    expect(todaysTotal()).toBe(3000)

    act(() => { ctx.closePosition('aapl', { date: '2026-03-10', saleAmountPLN: 1600, feePLN: 10 }) })

    // One sale of 1 600 − 10 = 1 590; Cash 500 + 1 590 = 2 090. Total: 1 000 + 2 090 = 3 090.
    const sells = ctx.transactions.filter((t) => t.type === 'sell')
    expect(ctx.transactions).toHaveLength(3)
    expect(sells).toMatchObject([{ amountPLN: 1590, feePLN: 10, quantity: 10, relatedHoldingId: 'aapl' }])
    expect(xtb().holdings.map((h) => h.id)).toEqual(['cdr', 'cash_xtb'])
    expect(xtb().closedHoldings).toMatchObject([{ id: 'aapl', closedAt: '2026-03-10' }])
    expect(cash()).toBe(2090)
    expect(todaysTotal()).toBe(3090)

    cleanup()
    renderStrict()
    expect(xtb().closedHoldings!.map((h) => h.id)).toEqual(['aapl'])
    expect(cash()).toBe(2090)
    expect(storedAccount().holdings.find((h) => h.isSynthetic)!.currentPrice).toBe(2090)
  })

  it('leaves Cash alone for a holding entered by hand, filling in its buy', () => {
    seed()
    renderStrict()

    act(() => { ctx.closePosition('cdr', { date: '2026-03-10', saleAmountPLN: 1200, feePLN: 0 }) })

    expect(ctx.transactions.slice(2)).toMatchObject([
      { type: 'buy', date: '2025-06-01', amountPLN: -1000, quantity: 4, affectsCash: false },
      { type: 'sell', amountPLN: 1200, quantity: 4, affectsCash: false },
    ])
    expect(cash()).toBe(500)
    cleanup()
    renderStrict()
    expect(cash()).toBe(500)
  })

  it('reopens to exactly where it was before the close', () => {
    seed()
    renderStrict()
    act(() => { ctx.closePosition('cdr', { date: '2026-03-10', saleAmountPLN: 1200, feePLN: 0 }) })

    let reopened = false
    act(() => { reopened = ctx.reopenPosition('cdr') })

    expect(reopened).toBe(true)
    expect(ctx.transactions.map((t) => t.id)).toEqual(['deposit', 'buy'])
    expect(xtb().holdings.map((h) => h.id)).toEqual(['aapl', 'cdr', 'cash_xtb'])
    expect(xtb().holdings[1]).not.toHaveProperty('closedAt')
    expect(xtb()).not.toHaveProperty('closedHoldings')
    expect(cash()).toBe(500)
  })

  it('refuses to reopen while a rebuy of the same ticker is open', () => {
    seed()
    renderStrict()
    act(() => { ctx.closePosition('aapl', { date: '2026-03-10', saleAmountPLN: 1600, feePLN: 0 }) })
    act(() => ctx.addHolding('xtb', { name: 'Apple', ticker: 'AAPL', category: 'stock', quantity: 2, purchasePrice: 180, currentPrice: 180, purchaseDate: '2026-04-01' }))
    const before = ctx.transactions

    let reopened = true
    act(() => { reopened = ctx.reopenPosition('aapl') })
    expect(reopened).toBe(false)
    expect(ctx.transactions).toBe(before)
    expect(xtb().closedHoldings!.map((h) => h.id)).toEqual(['aapl'])
  })

  it('deletes a closed holding with its sale and filled-in buy', () => {
    seed()
    renderStrict()
    act(() => { ctx.closePosition('cdr', { date: '2026-03-10', saleAmountPLN: 1200, feePLN: 0 }) })

    act(() => ctx.deleteHolding('cdr'))

    expect(ctx.transactions.map((t) => t.id)).toEqual(['deposit', 'buy'])
    expect(xtb().closedHoldings).toEqual([])
    expect(cash()).toBe(500)
  })
})
