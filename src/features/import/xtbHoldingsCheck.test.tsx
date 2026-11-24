// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { KEYS } from '@/storage/portfolioStore'
import { differencesStatementSheets, xtbStatementFile } from '@/importers/xtbStatement.fixture'
import { XTBTransactionFlow } from './XTBTransactionFlow'

// The flow from upload to the holdings check, on the synthetic statement.
// "Differences": SPIN free shares, SMPL short of XTB by 2, FOOI gone at XTB,
// MUST more in Vestly; ACME (merged lots), EXGL, PRZK and VBLD match.

const NOW = '2026-11-01T00:00:00.000Z'
let portfolio: ReturnType<typeof usePortfolio>

function Spy() {
  const value = usePortfolio()
  useEffect(() => { portfolio = value })
  return null
}

function renderFlow(file: File) {
  return render(
    <PortfolioProvider>
      <SettingsProvider>
        <Spy />
        <XTBTransactionFlow accountId="xtb" file={file} onComplete={vi.fn()} onBack={vi.fn()} />
      </SettingsProvider>
    </PortfolioProvider>,
  )
}

const fetchMock = vi.fn(async (url: string) => {
  const body = url.includes('/tables/a/')
    ? [{ effectiveDate: '2026-11-20', rates: [{ code: 'USD', mid: 3.98 }, { code: 'EUR', mid: 4.24 }, { code: 'GBP', mid: 4.95 }] }]
    : { rates: [{ effectiveDate: '2026-01-16', mid: 3.85 }, { effectiveDate: '2026-01-19', mid: 3.9 }] }
  return new Response(JSON.stringify(body), { status: 200 })
})

function setup({ nbp = true } = {}) {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify({ nbpEnabled: nbp }))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify([{ id: 'xtb', name: 'Demo Broker', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings: [] }]))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, '[]')
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const holdings = () => Object.fromEntries(
  portfolio.accounts[0].holdings.filter((h) => !h.isSynthetic).map((h) => [h.ticker, h]),
)
const card = (name: string) => screen.getByRole('rowheader', { name }).closest('table')!

/** Import the file and create the holdings the step before offers, up to the holdings check. */
async function importUpToCheck(file: File) {
  renderFlow(file)
  fireEvent.click(await screen.findByRole('button', { name: /^Import \d+ transactions$/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Create \d+ holdings$/ }))
}

const differences = () => xtbStatementFile('PLN_statement.xlsx', { sheets: differencesStatementSheets() })

describe('the holdings check after an XTB .xlsx import', () => {
  it('lists only the differences, with the designed copy and defaults', async () => {
    setup()
    await importUpToCheck(differences())

    expect(screen.getByText(/XTB’s statement shows what you held on 20 Nov 2026\./).textContent)
      .toContain('4 holdings match it. These 4 don’t:')
    // Merged lots (ACME) and the other matching holdings aren't listed.
    expect(screen.queryByRole('rowheader', { name: 'Acme Corp' })).toBeNull()
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent))
      .toEqual(['Spinco Example', 'Sample Holdings', 'Foo Industries', 'Muster AG'])

    expect(within(card('Spinco Example')).getByText('Free shares or a spin-off: no purchase')).toBeTruthy()
    expect(within(card('Sample Holdings')).getByText('No purchase in the file explains 2 shares')).toBeTruthy()
    expect(within(card('Foo Industries')).getByText('XTB shows none held')).toBeTruthy()
    expect(within(card('Muster AG')).getByText('XTB holds 2 fewer shares')).toBeTruthy()

    expect((screen.getByRole('checkbox', { name: 'Add at cost 0: Spinco Example' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Add 2 shares at XTB’s open price: Sample Holdings' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: 'Close position: Foo Industries' }) as HTMLInputElement).checked).toBe(false)
    expect(within(card('Muster AG')).queryByRole('checkbox')).toBeNull() // informational
    expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Add at cost 0: Spinco Example' }))
    expect((screen.getByRole('button', { name: 'Apply 0 changes' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('matching holdings take the statement’s price and category, before anything is applied', async () => {
    setup()
    await importUpToCheck(differences())
    expect(holdings().EXGL).toMatchObject({ category: 'etf', currentPrice: 1742.52 }) // 0.25 × 410 EUR × 4.25 ÷ 0.25
    expect(holdings().ACME.currentPrice).toBe(48)
    expect(holdings().FOOI.currentPrice).toBe(40) // not in the statement: untouched
  })

  it('Apply: free shares at cost 0, and the missing shares at XTB’s open price in PLN', async () => {
    setup()
    await importUpToCheck(differences())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add 2 shares at XTB’s open price: Sample Holdings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    await screen.findByRole('button', { name: 'Done' })

    const received = portfolio.transactions.filter((t) => t.ticker === 'SPIN')
    expect(received).toMatchObject([{ type: 'receive', quantity: 3, amountPLN: 0, affectsCash: false,
      comment: 'Received without a purchase (free shares or a spin-off)', date: '2026-02-16T05:00:00.000Z' }])
    expect(holdings().SPIN).toMatchObject({ quantity: 3, purchasePrice: 0, category: 'stock', currentPrice: 20, purchaseDate: '2026-02-16' })

    // 2 × 2.40 USD at NBP's rate from the business day before 20 Jan (19 Jan: 3.90). The currency comes from the statement, not ".UK".
    const bought = portfolio.transactions.filter((t) => t.ticker === 'SMPL' && t.externalId.startsWith('xtb-open-position-'))
    expect(bought).toMatchObject([{ type: 'buy', quantity: 2, amountPLN: -18.72, originalCurrency: 'USD', affectsCash: false }])
    expect(holdings().SMPL).toMatchObject({ quantity: 6, currentPrice: 10.4 })
    expect(holdings().SMPL.purchasePrice).toBeCloseTo((51.2 + 18.72) / 6, 8)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.nbp.pl/api/exchangerates/tables/a/2026-11-10/2026-11-20/?format=json',
      'https://api.nbp.pl/api/exchangerates/rates/a/usd/2026-01-05/2026-01-19/?format=json',
    ])
    expect(screen.getByText(/SPIN holding added at cost 0\. 2 shares of SMPL added at XTB’s open price\./)).toBeTruthy()
    expect(screen.getByText('6 holdings match XTB’s statement of 20 Nov 2026. Their prices and categories are updated from it.')).toBeTruthy()
  })

  it('with NBP off, the open-price row is disabled, says why, and NBP is never called', async () => {
    setup({ nbp: false })
    await importUpToCheck(differences())
    const box = screen.getByRole('checkbox', { name: 'Add 2 shares at XTB’s open price: Sample Holdings' }) as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect(within(card('Sample Holdings')).getByText('Needs NBP (Settings › Market Data) to convert the price')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }))
    await screen.findByRole('button', { name: 'Done' })
    expect(holdings().SPIN.quantity).toBe(3)
    expect(holdings().SMPL.quantity).toBe(4)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Close position opens the Close position dialog for that holding', async () => {
    setup()
    await importUpToCheck(differences())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Close position: Foo Industries' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 changes' }))
    expect(await screen.findByText(/Record that you sold all of/)).toBeTruthy()
    // The statement's report day, not today; the amount is left for the person to enter.
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toMatch(/20\/11\/2026|2026-11-20/)
    expect((screen.getByLabelText('Sale amount (PLN)') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await screen.findByRole('button', { name: 'Done' })
    expect(holdings().FOOI.quantity).toBe(5) // cancelled: still open
  })

  it('Skip changes nothing but the matching prices', async () => {
    setup()
    await importUpToCheck(differences())
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByRole('button', { name: 'Done' })
    expect(holdings().SPIN).toBeUndefined()
    expect(holdings().SMPL.quantity).toBe(4)
    expect(portfolio.transactions.some((t) => t.externalId.startsWith('xtb-open-position-'))).toBe(false)
  })

  it('all match: no step; the success message says so', async () => {
    setup()
    await importUpToCheck(xtbStatementFile())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy())
    expect(screen.queryByText(/XTB’s statement shows/)).toBeNull()
    expect(screen.getByText('Imported 13 transactions into Demo Broker. 5 holdings created.')).toBeTruthy()
    expect(screen.getByText('All 5 holdings match XTB’s statement of 20 Nov 2026. Their prices and categories are updated from it.')).toBeTruthy()
    expect(holdings().EXGL.category).toBe('etf')
  })
})
