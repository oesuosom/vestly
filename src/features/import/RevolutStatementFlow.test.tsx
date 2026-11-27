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
    expect(await screen.findByText('8 transactions to import')).toBeTruthy()
    expect(screen.getByText('1 staking reward left out')).toBeTruthy()
    expect(screen.getByText('1 row couldn’t be read')).toBeTruthy()
    expect(screen.getByText('1 Jan 2025 – 31 Dec 2025')).toBeTruthy()
    expect(screen.getByText('Revolut Crypto')).toBeTruthy()
    expect(screen.getByText('Converted from your time zone (Europe/Warsaw)')).toBeTruthy()

    const coins = screen.getByRole('columnheader', { name: 'Buys' }).closest('table')!
    expect(within(coinRow(coins, 'BTC')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '—', '1', '1'])
    expect(within(coinRow(coins, 'ETH')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2', '—', '—', '—'])

    fireEvent.click(screen.getByRole('button', { name: 'View warnings' }))
    expect(screen.getByText('Page 3, row 4')).toBeTruthy()
    expect(screen.getByText('Couldn’t read the quantity, so this row isn’t imported.')).toBeTruthy()
    expect(screen.getByText('XRP · Buy · 5,00 PLN')).toBeTruthy()
  })

  it('fills in the received coins’ cost from the statement, editable, and stores what was typed', async () => {
    renderFlow()
    const btc = (await screen.findByRole('textbox', { name: /Cost in PLN of 0,005 BTC received on 1 Jun 2025/ })) as HTMLInputElement
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

  it('warns about coins with no price source', async () => {
    pages = [[...HEADER, 'Transactions', TX_HEADER, 'ZZZ Buy 10 1.00 PLN 10.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM']]
    renderFlow()
    expect(await screen.findByText(/No price source for ZZZ/)).toBeTruthy()
  })
})

describe('holdings check and done', () => {
  it('lists the coins that differ with a ticked adjustment each, and applies the ticked ones', async () => {
    renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))

    expect(screen.getByText(/Revolut’s statement shows what you held on 31 Dec 2025\./).textContent)
      .toContain('1 coin matches it. These 4 don’t:')
    const xrp = screen.getByRole('rowheader', { name: 'XRP' }).closest('table')!
    expect(within(xrp).getByText('A row couldn’t be read · Fees estimated from the statement')).toBeTruthy()
    expect(within(xrp).getAllByRole('cell').map((c) => c.textContent).slice(1, 3)).toEqual(['73,5', '75'])
    const box = (label: RegExp) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement
    expect(box(/Adjust: add 1,5 XRP at 0 PLN/).checked).toBe(true)
    expect(box(/Adjust: add 2,1 SOL at 0 PLN/).checked).toBe(true)
    expect(screen.getByText(/An adjustment is a 0 PLN row dated 31 Dec 2025/)).toBeTruthy()

    // Leave SOL as it is.
    fireEvent.click(box(/SOL/))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 3 changes' }))

    const adjustments = portfolio.transactions.filter((t) => t.externalId.startsWith('revolut-stmt-adjust-'))
    expect(adjustments.map((t) => [t.ticker, t.type, t.quantity, t.amountPLN])).toEqual([
      ['BTC', 'receive', 0.00025, 0],
      ['ETH', 'receive', 0.0002, 0],
      ['XRP', 'receive', 1.5, 0],
    ])
    expect(adjustments.every((t) => holdingsCheckNote(t) === 'Adjustment to match Revolut statement')).toBe(true)

    // New coins became crypto holdings at the statement's closing amounts.
    const h = holdings()
    expect(Object.keys(h).sort()).toEqual(['ADA', 'BTC', 'ETH', 'XRP'])
    expect([h.BTC.quantity, h.ETH.quantity, h.XRP.quantity, h.ADA.quantity]).toEqual([0.02, 0.02, 75, 10])
    expect(Object.values(h).every((x) => x.exchange === 'CC' && x.category === 'crypto')).toBe(true)

    expect(screen.getByText('Imported 8 transactions into Revolut Crypto')).toBeTruthy()
    expect(screen.getByText(/4 of 5 coins match Revolut’s statement of 31 Dec 2025, with 3 adjustments; the others were left as they are\. 1 staking reward was left out\./)).toBeTruthy()
  })

  it('says so on the done screen when everything matches, and a re-import adds nothing', async () => {
    const first = renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 4 changes' }))
    expect(screen.getByText(/All 5 coins match Revolut’s statement of 31 Dec 2025, with 4 adjustments\./)).toBeTruthy()
    const count = portfolio.transactions.length
    first.unmount()

    renderFlow()
    expect(await screen.findByText('0 transactions to import')).toBeTruthy()
    expect(screen.getByText('8 already imported')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // Nothing differs any more, so the check is skipped.
    expect(screen.getByText('No new transactions for Revolut Crypto')).toBeTruthy()
    expect(screen.getByText(/All 5 coins match/)).toBeTruthy()
    expect(portfolio.transactions).toHaveLength(count)
  })

  it('skipping the check leaves the holdings at what the rows explain', async () => {
    renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(portfolio.transactions.some((t) => t.externalId.startsWith('revolut-stmt-adjust-'))).toBe(false)
    expect(holdings().XRP.quantity).toBe(73.5)
    expect(screen.getByText(/1 of 5 coins match/)).toBeTruthy()
  })
})
