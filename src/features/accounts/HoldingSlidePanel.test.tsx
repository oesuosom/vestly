// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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

const settings = {
  priceProvider: { id: 'eodhd' as const, enabled: false, apiKey: '' },
  coinGeckoEnabled: true,
}
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => settings }))

afterEach(() => {
  cleanup()
  settings.priceProvider = { id: 'eodhd', enabled: false, apiKey: '' }
  settings.coinGeckoEnabled = true
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

  it('closes with the header button, found by its accessible name', () => {
    const onClose = vi.fn()
    render(<HoldingSlidePanel holding={holding} isOpen onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
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
  const now = '2026-01-02T00:00:00.000Z'
  let n = 0
  const tx = (fields: Partial<Transaction>): Transaction => {
    n += 1
    return {
      id: `c${n}`, accountId: 'a1', type: 'deposit', date: '2026-01-02', amountPLN: 100,
      externalId: `c${n}`, source: 'manual', createdAt: now, ...fields,
    }
  }
  const demo: Account = { id: 'a1', name: 'Demo Broker', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [cash] }

  function renderCash(transactions: Transaction[]) {
    portfolio.accounts = [demo]
    portfolio.transactions = transactions
    const onLocation = vi.fn()
    function Where() {
      onLocation(useLocation())
      return null
    }
    render(
      <MemoryRouter initialEntries={['/accounts/demo-broker']}>
        <HoldingSlidePanel holding={cash} isOpen onClose={() => {}} />
        <Where />
      </MemoryRouter>,
    )
    return { lastLocation: () => onLocation.mock.calls.at(-1)![0] as { pathname: string; search: string } }
  }

  /** The "How it adds up" table's rows as [kind, count, amount]. */
  function ledgerRows() {
    const table = screen.getByText('How it adds up').nextElementSibling!.querySelector('table')!
    return [...table.querySelectorAll('tbody tr, tfoot tr')].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    )
  }

  const actions = () => screen.getAllByRole('button').map((b) => b.textContent).filter(Boolean)

  const full = [
    tx({ type: 'deposit', date: '2026-01-05', amountPLN: 2000 }),
    tx({ type: 'buy', date: '2026-01-10', amountPLN: -500, instrument: 'Acme Corp', quantity: 3 }),
    tx({ type: 'buy', date: '2026-01-11', amountPLN: -120, instrument: 'Globex Industries', quantity: 1 }),
    tx({ type: 'dividend', date: '2026-01-20', amountPLN: 12.4, relatedInstrument: 'Acme Corp' }),
    tx({ type: 'interest', date: '2026-01-21', amountPLN: 1.6 }),
    tx({ type: 'withholding_tax', date: '2026-01-20', amountPLN: -2.36, relatedInstrument: 'Acme Corp' }),
    tx({ type: 'fee', date: '2026-01-25', amountPLN: -5 }),
  ]

  it('names the account above “Cash”', () => {
    renderCash(full)
    expect(screen.getByText('Demo Broker')).toBeTruthy()
    expect(screen.getByText('Cash', { selector: 'span' })).toBeTruthy()
  })

  it('shows the balance and where it comes from, without unit, price or return fields', () => {
    renderCash(full)
    expect(screen.getByText('Available cash')).toBeTruthy()
    expect(screen.getByText('Available cash').nextElementSibling!.textContent).toBe('1 386,64 PLN')
    expect(screen.getByText('Calculated from this account’s deposits, withdrawals, trades, income, taxes and fees.')).toBeTruthy()
    for (const gone of ['Quantity', 'Avg cost / unit', 'Current price / unit', 'Unrealised P&L', 'Total return']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.queryByText(/Not yet refreshed/)).toBeNull()
  })

  it('adds the balance up by kind, hiding kinds with no transactions, to a total that equals it', () => {
    renderCash(full)
    expect(ledgerRows()).toEqual([
      ['Deposits', '1', '+2 000,00 PLN'],
      ['Buys', '2', '−620,00 PLN'],
      ['Dividends & interest', '2', '+14,00 PLN'],
      ['Taxes', '1', '−2,36 PLN'],
      ['Fees', '1', '−5,00 PLN'],
      ['Cash', '7', '1 386,64 PLN'],
    ])
  })

  /** The "Latest changes" rows' text, "View all →" included. */
  const latestRows = () =>
    [...screen.getByText('Latest changes').nextElementSibling!.querySelectorAll('tr')].map((tr) => tr.textContent)

  it('lists the latest changes, newest first, and links to the account’s Activity', () => {
    const { lastLocation } = renderCash(full)
    expect(latestRows()).toEqual([
      'Fee25/01/2026−5,00 PLN',
      'Interest21/01/2026+1,60 PLN',
      'DividendAcme Corp · 20/01/2026+12,40 PLN',
      'Withholding taxAcme Corp · 20/01/2026−2,36 PLN',
      'BuyGlobex Industries · 1 unit · 11/01/2026−120,00 PLN',
      'BuyAcme Corp · 3 units · 10/01/2026−500,00 PLN',
      'Deposit05/01/2026+2 000,00 PLN',
      'View all →',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'View all →' }))
    expect(lastLocation()).toMatchObject({ pathname: '/activity', search: '?account=a1' })
  })

  it('stops the latest changes at ten', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tx({ type: 'deposit', date: `2026-03-${String(i + 1).padStart(2, '0')}`, amountPLN: 10 }))
    renderCash(many)
    const rows = latestRows()
    expect(rows).toHaveLength(11)
    expect(rows[0]).toBe('Deposit12/03/2026+10,00 PLN')
    expect(rows[9]).toBe('Deposit03/03/2026+10,00 PLN')
    expect(rows[10]).toBe('View all →')
  })

  it('has no actions besides closing the panel', () => {
    renderCash(full)
    expect(actions()).toEqual(['View all →'])
  })

  it.each([
    ['emakler_import', '2 trades aren’t counted.', 'They came from an eMakler import and were paid from a bank account outside Vestly.'],
    ['bond_holding', '2 trades aren’t counted.', 'They’re bond purchases recorded with your bond holdings, paid from outside this account.'],
  ] as const)('explains trades from %s that aren’t counted', (source, title, body) => {
    renderCash([...full, tx({ type: 'buy', source }), tx({ type: 'buy', source })])
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getByText(body)).toBeTruthy()
  })

  it('explains several uncounted trades of another kind or a mix', () => {
    renderCash([...full, tx({ type: 'buy', affectsCash: false }), tx({ type: 'buy', source: 'emakler_import' })])
    expect(screen.getByText('2 trades aren’t counted.')).toBeTruthy()
    expect(screen.getByText('They were paid from outside this account, so they don’t change its cash.')).toBeTruthy()
  })

  it.each([
    [{ source: 'emakler_import' }, 'It came from an eMakler import and was paid from a bank account outside Vestly.'],
    [{ source: 'bond_holding' }, 'It’s a bond purchase recorded with your bond holdings, paid from outside this account.'],
    [{ affectsCash: false }, 'It was paid from outside this account, so it doesn’t change the balance.'],
  ] as const)('explains a single uncounted trade in the singular (%o)', (fields, body) => {
    renderCash([...full, tx({ type: 'buy', ...fields })])
    expect(screen.getByText('1 trade isn’t counted.')).toBeTruthy()
    expect(screen.getByText(body)).toBeTruthy()
  })

  it('says nothing about uncounted trades when there are none', () => {
    renderCash(full)
    expect(screen.queryByText(/counted\./)).toBeNull()
  })

  it('points to Activity when there are no cash transactions yet', () => {
    const { lastLocation } = renderCash([tx({ type: 'buy', source: 'emakler_import' })])
    expect(screen.getByText('0,00 PLN').className).toContain('text-accent')
    expect(screen.getByText('No cash transactions yet')).toBeTruthy()
    expect(screen.queryByText('How it adds up')).toBeNull()
    expect(screen.queryByText('Latest changes')).toBeNull()
    expect(screen.getByText('1 trade isn’t counted.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Activity →' }))
    expect(lastLocation()).toMatchObject({ pathname: '/activity', search: '?account=a1' })
  })

  it('warns when cash is below zero', () => {
    renderCash([tx({ type: 'buy', amountPLN: -300, quantity: 2, instrument: 'Initech' })])
    const balance = screen.getByText('Available cash').nextElementSibling!
    expect(balance.className).toContain('text-negative')
    // A true minus (U+2212), not a hyphen, in the balance and the total row.
    expect(balance.textContent).toBe('−300,00 PLN')
    expect(ledgerRows().at(-1)).toEqual(['Cash', '1', '−300,00 PLN'])
    expect(screen.getByText('Cash is below zero.')).toBeTruthy()
  })

  it('doesn’t warn for a positive balance', () => {
    renderCash(full)
    expect(screen.queryByText('Cash is below zero.')).toBeNull()
  })

  it('leaves a real holding its actions', () => {
    render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    expect(actions()).toEqual(['Edit', 'Close Position', 'Delete'])
  })
})

describe('HoldingSlidePanel — price provider off', () => {
  const listed: Holding = { ...holding, ticker: 'EXMP', exchange: 'US' }
  const coin: Holding = { ...holding, name: 'Test Coin', category: 'crypto', ticker: 'BTC', exchange: 'CC' }

  it('says the price isn’t updated and hides Refresh Price while EODHD is off, key or not', () => {
    settings.priceProvider = { id: 'eodhd', enabled: false, apiKey: 'fake-eodhd' }
    render(<HoldingSlidePanel holding={listed} isOpen onClose={() => {}} />)
    expect(screen.getByText('This price isn’t updated automatically')).toBeTruthy()
    expect(screen.getByText('EODHD is off, so the current price is the last one you entered or imported.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refresh Price' })).toBeNull()
  })

  it('names CoinGecko for crypto', () => {
    settings.coinGeckoEnabled = false
    render(<HoldingSlidePanel holding={coin} isOpen onClose={() => {}} />)
    expect(screen.getByText('CoinGecko is off, so the current price is the last one you entered or imported.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refresh Price' })).toBeNull()
  })

  it('shows Refresh Price and no warning while the provider is on', () => {
    settings.priceProvider = { id: 'eodhd', enabled: true, apiKey: 'fake-eodhd' }
    render(<HoldingSlidePanel holding={listed} isOpen onClose={() => {}} />)
    expect(screen.queryByText('This price isn’t updated automatically')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh Price' })).toBeTruthy()
  })

  it('crypto refreshes through CoinGecko even with EODHD off', () => {
    render(<HoldingSlidePanel holding={coin} isOpen onClose={() => {}} />)
    expect(screen.queryByText('This price isn’t updated automatically')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh Price' })).toBeTruthy()
  })

  it('shows no warning for a holding nothing can price, like a bond', () => {
    render(<HoldingSlidePanel holding={{ ...holding, category: 'bond' }} isOpen onClose={() => {}} />)
    expect(screen.queryByText('This price isn’t updated automatically')).toBeNull()
  })
})
