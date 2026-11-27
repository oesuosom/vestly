// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { KEYS } from '@/storage/portfolioStore'
import { HEADER, STATEMENT_PAGES, TX_HEADER } from '@/importers/revolutStatement.fixture'
import { holdingsCheckNote } from '@/features/import/holdingsCheckApply'
import { RevolutStatementFlow } from '@/features/import/RevolutStatementFlow'
import type { LayoutPage } from '@/importers/pdfText'
import type { Holding } from '@/types'
import { MemoryRouter } from 'react-router-dom'
import { Activity } from '@/pages/Activity'
import { getRealizedPnL } from '@/domain/calculations'

// The flow from a (made-up) statement to the done screen. The PDF reader is
// replaced by the statement's lines; everything after it is real.

let pages: string[][] = STATEMENT_PAGES
vi.mock('@/importers/pdfText', () => ({
  extractPDFLayout: async (): Promise<LayoutPage[]> =>
    pages.map((lines) => ({ images: [], lines: lines.map((text, i) => ({ cross: i, cells: [{ text, pos: 0 }] })) })),
}))

const NOW = '2026-11-01T00:00:00.000Z'
let portfolio: ReturnType<typeof usePortfolio>

function Spy() {
  const value = usePortfolio()
  useEffect(() => { portfolio = value })
  return null
}

const onComplete = vi.fn()
function renderFlow() {
  return render(
    <PortfolioProvider>
      <SettingsProvider>
        <Spy />
        <RevolutStatementFlow accountId="rev" file={new File([], 'statement.pdf')} timeZone="Europe/Warsaw" onComplete={onComplete} onBack={vi.fn()} />
      </SettingsProvider>
    </PortfolioProvider>,
  )
}

beforeEach(() => {
  pages = STATEMENT_PAGES
  localStorage.clear()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify([{ id: 'rev', name: 'Revolut Crypto', type: 'crypto', createdAt: NOW, lastUpdated: NOW, holdings: [] }]))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, '[]')
  // No price or rate requests are expected; fail loudly if one is made.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
  onComplete.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const holdings = (): Record<string, Holding> => Object.fromEntries(portfolio.accounts[0].holdings.map((h) => [h.ticker, h]))
const coinRow = (table: HTMLElement, coin: string) => within(table).getByRole('rowheader', { name: coin }).closest('tr')!

describe('preview', () => {
  it('shows what will be imported, what is left out and what couldn’t be read', async () => {
    renderFlow()
    expect(await screen.findByText('10 transactions to import')).toBeTruthy()
    expect(screen.getByText('1 staking reward left out')).toBeTruthy()
    expect(screen.getByText('1 row couldn’t be read')).toBeTruthy()
    expect(screen.getByText('1 Jan 2025 – 31 Dec 2025')).toBeTruthy()
    expect(screen.getByText('Revolut Crypto')).toBeTruthy()
    expect(screen.getByText('Converted from your time zone (Europe/Warsaw)')).toBeTruthy()

    const coins = screen.getByRole('columnheader', { name: 'Buys' }).closest('table')!
    expect(within(coinRow(coins, 'BTC')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '—', '1', '1'])
    expect(within(coinRow(coins, 'ETH')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2', '—', '—', '—'])

    // Fee methods are only mentioned when they couldn't be worked out (in the holdings check).
    expect(screen.queryByText(/fee added on top/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'View warnings' }))
    expect(screen.getByText('Page 3, row 4')).toBeTruthy()
    expect(screen.getByText('Couldn’t read the quantity, so this row isn’t imported.')).toBeTruthy()
    expect(screen.getByText('XRP · Buy · 5,00 PLN')).toBeTruthy()
  })

  it('fills in the received coins’ cost from the statement, editable, and stores what was typed', async () => {
    renderFlow()
    // Received at midnight local time: shown on its stored UTC day, which depends on the zone.
    const btc = (await screen.findByRole('textbox', { name: /Cost in PLN of 0,005 BTC received on / })) as HTMLInputElement
    expect(btc.value).toBe('2000,00')
    expect((screen.getByRole('textbox', { name: /of 10 ADA/ }) as HTMLInputElement).value).toBe('20,00')

    fireEvent.change(btc, { target: { value: '' } })
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(btc, { target: { value: '1 500,5' } })
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const receive = portfolio.transactions.find((t) => t.type === 'receive' && t.ticker === 'BTC')!
    expect(receive.amountPLN).toBe(1500.5)
  })

  it('warns about coins with no price source, only when they are still held', async () => {
    pages = [[
      ...HEADER,
      'Transactions',
      TX_HEADER,
      'ZZZ Buy 10 1.00 PLN 10.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM',
      'QQQ Buy 10 1.00 PLN 10.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM',
      'QQQ Sell 10 1.00 PLN 10.00 PLN 0.00 PLN Jan 6, 2025, 3:04:12PM',
      'OXT Buy 10 1.00 PLN 10.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM',
      'GRT Buy 10 1.00 PLN 10.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM',
    ]]
    renderFlow()
    // QQQ was sold out; OXT and GRT have a CoinGecko id now.
    expect((await screen.findByText(/No price source for/)).textContent).toBe('No price source for ZZZ: its value stays at Revolut’s price until you change it.')
  })

  it('counts only unread Transactions rows as rows that couldn’t be read', async () => {
    pages = [[
      ...HEADER,
      'Account summary',
      'LINK Chainlink 5.00000000 LINK',
      'Portfolio breakdown',
      'LINK Chainlink 5.00000000 60.00 PLN 300.00 PLN 100%',
      'Transactions',
      TX_HEADER,
      'LINK Buy 5 60.00 PLN 300.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM',
    ]]
    renderFlow()
    expect(await screen.findByText('1 transaction to import')).toBeTruthy()
    expect(screen.queryByText(/couldn’t be read/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'View warnings' })).toBeNull()
  })
})

describe('holdings check and done', () => {
  it('lists the coins that differ with a ticked adjustment each, and applies the ticked ones', async () => {
    renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(screen.getByText(/Revolut’s statement shows what you held on 31 Dec 2025\./).textContent)
      .toContain('4 coins match it. These 2 don’t:')
    const xrp = screen.getByRole('rowheader', { name: 'XRP' }).closest('table')!
    const why = within(xrp).getByText('Unreadable row')
    expect(why.getAttribute('title')).toBe('Couldn’t tell how fees were charged on 1 buy. Coins in 99 vs Revolut’s 102,5')
    expect(within(xrp).getAllByRole('cell').map((c) => c.textContent).slice(1, 3)).toEqual(['74', '77,5'])
    const box = (label: RegExp) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement
    expect(box(/Adjust: add 3,5 XRP at 0 PLN/).checked).toBe(true)
    expect(box(/Adjust: add 2,1 SOL at 0 PLN/).checked).toBe(true)
    expect(screen.getByText(/An adjustment is a 0 PLN row dated 31 Dec 2025/)).toBeTruthy()

    // Leave SOL as it is.
    fireEvent.click(box(/SOL/))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }))

    const adjustments = portfolio.transactions.filter((t) => t.externalId.startsWith('revolut-stmt-adjust-'))
    expect(adjustments.map((t) => [t.ticker, t.type, t.quantity, t.amountPLN])).toEqual([['XRP', 'receive', 3.5, 0]])
    expect(adjustments.every((t) => holdingsCheckNote(t) === 'Adjustment to match Revolut statement')).toBe(true)

    // New coins became crypto holdings at the statement's closing amounts.
    const h = holdings()
    expect(Object.keys(h).sort()).toEqual(['ADA', 'BTC', 'ETH', 'XRP'])
    expect([h.BTC.quantity, h.ETH.quantity, h.XRP.quantity, h.ADA.quantity]).toEqual([0.02, 0.0199, 77.5, 10])
    expect(Object.values(h).every((x) => x.exchange === 'CC' && x.category === 'crypto')).toBe(true)

    expect(screen.getByText('Imported 10 transactions into Revolut Crypto')).toBeTruthy()
    expect(screen.getByText(/5 of 6 coins match Revolut’s statement of 31 Dec 2025, with 1 adjustment; the others were left as they are\. 1 staking reward was left out\. 4 holdings created, 1 sold-out coin kept as closed position\./)).toBeTruthy()
  })

  it('says so on the done screen when everything matches, and a re-import adds nothing', async () => {
    const first = renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    expect(screen.getByText(/All 6 coins match Revolut’s statement of 31 Dec 2025, with 2 adjustments\./)).toBeTruthy()
    const count = portfolio.transactions.length
    first.unmount()

    renderFlow()
    expect(await screen.findByText('0 transactions to import')).toBeTruthy()
    expect(screen.getByText('10 already imported')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // Nothing differs any more, so the check is skipped.
    expect(screen.getByText('No new transactions for Revolut Crypto')).toBeTruthy()
    expect(screen.getByText(/All 6 coins match/)).toBeTruthy()
    expect(portfolio.transactions).toHaveLength(count)
  })

  it('skipping the check leaves the holdings at what the rows explain', async () => {
    renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(portfolio.transactions.some((t) => t.externalId.startsWith('revolut-stmt-adjust-'))).toBe(false)
    expect(holdings().XRP.quantity).toBe(74)
    expect(screen.getByText(/4 of 6 coins match/)).toBeTruthy()
  })
})

describe('coins sold out during the statement', () => {
  it('are kept as closed holdings, so Activity shows their icon, and realized profit is unchanged', async () => {
    const view = renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    const before = getRealizedPnL(portfolio.transactions)

    const account = portfolio.accounts[0]
    expect(account.holdings.some((h) => h.ticker === 'DOT')).toBe(false)
    const dot = account.closedHoldings!.find((h) => h.ticker === 'DOT')!
    const sale = portfolio.transactions.find((t) => t.type === 'sell' && t.ticker === 'DOT')!
    expect(dot).toMatchObject({ name: 'Polkadot', category: 'crypto', exchange: 'CC', closedAt: sale.date.slice(0, 10) })
    expect(getRealizedPnL(portfolio.transactions)).toBe(before)
    view.unmount()

    render(
      <PortfolioProvider>
        <SettingsProvider>
          <MemoryRouter initialEntries={['/activity']}><Activity /></MemoryRouter>
        </SettingsProvider>
      </PortfolioProvider>,
    )
    const dotRows = (await screen.findAllByText('Polkadot')).map((el) => el.closest('tr')!)
    // Adjustments read as "Adjustment", not Send or Receive.
    const adjusted = screen.getAllByText('Adjustment').map((el) => el.closest('tr')!)
    expect(adjusted.map((row) => within(row).getByText(/^(XRP|Solana)$/).textContent).sort()).toEqual(['Solana', 'XRP'])
    expect(dotRows.length).toBeGreaterThan(0)
    // The icon sits next to the name only when Activity finds the coin's holding.
    expect(dotRows.every((row) => row.querySelector('td:nth-child(3) span.relative'))).toBe(true)
  })
})
