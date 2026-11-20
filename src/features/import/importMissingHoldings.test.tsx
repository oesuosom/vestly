// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { KEYS } from '@/storage/portfolioStore'
import { detectFormat, parseCSVRaw } from '@/importers/csvParser'
import type { Account, Holding } from '@/types'
import { CSVImportFlow } from './CSVImportFlow'
import { EMaklerImportFlow } from './EMaklerImportFlow'

// Synthetic accounts and files only. #30: no import deletes a holding; a full
// holdings file lists the ones it lacks under "Not in this file", kept by default.

const NOW = '2026-01-01T00:00:00.000Z'

function holding(id: string, accountId: string, fields: Partial<Holding>): Holding {
  return {
    id, accountId, name: id.toUpperCase(), category: 'stock', quantity: 10, purchasePrice: 50, currentPrice: 60,
    purchaseDate: '2025-06-01', createdAt: NOW, updatedAt: NOW, ...fields,
  }
}

const bond = (id: string, ticker: string, quantity: number, purchaseDate: string) =>
  holding(id, 'ike', { name: ticker, ticker, category: 'bond', quantity, purchasePrice: 100, currentPrice: 101, purchaseDate })

const ACCOUNTS: Account[] = [
  {
    id: 'mb', name: 'Broker M', type: 'brokerage', createdAt: NOW, lastUpdated: NOW,
    holdings: ['alpha', 'beta', 'gamma'].map((id) => holding(id, 'mb', { ticker: id.toUpperCase(), exchange: 'PL' })),
  },
  {
    id: 'ike', name: 'Bonds IKE', type: 'ike', createdAt: NOW, lastUpdated: NOW,
    holdings: [bond('b1', 'EDO0134', 10, '2024-01-15'), bond('b2', 'EDO0235', 5, '2025-02-15'), bond('b3', 'EDO0136', 3, '2026-01-15')],
  },
]

// ─── Harness ───────────────────────────────────────────────────────────────────

let portfolio: ReturnType<typeof usePortfolio>
let completed: string | null

function Capture() {
  const value = usePortfolio()
  useEffect(() => {
    portfolio = value
  })
  return null
}

function renderInProviders(flow: React.ReactNode) {
  return render(
    <PortfolioProvider>
      <SettingsProvider>
        <Capture />
        {flow}
      </SettingsProvider>
    </PortfolioProvider>,
  )
}

const account = (id: string) => portfolio.accounts.find((a) => a.id === id)!
const openNames = (id: string) => account(id).holdings.filter((h) => !h.isSynthetic).map((h) => `${h.name}×${h.quantity}`)
const closed = (id: string) => (account(id).closedHoldings ?? []).map((h) => `${h.name} ${h.closedAt}`)

beforeEach(() => {
  localStorage.clear()
  completed = null
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(ACCOUNTS))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, '[]')
})

afterEach(() => cleanup())

// ─── PKO IKE (CSV holdings) ──────────────────────────────────────────────────

const IKE_CSV = [
  'EMISJA;DOSTĘPNA LICZBA OBLIGACJI;WARTOŚĆ NOMINALNA;WARTOŚĆ AKTUALNA;DATA WYKUPU',
  'EDO0134;10;1000,00;1100,00;2034-01-15',
  'EDO0235;5;500,00;520,00;2035-02-15',
].join('\n')

function renderIke(csv = IKE_CSV) {
  const { headers, rows } = parseCSVRaw(csv)
  renderInProviders(
    <CSVImportFlow
      accountId="ike"
      accountName="Bonds IKE"
      accountType="ike"
      headers={headers}
      rawRows={rows}
      detectedFormat={detectFormat(headers)}
      onComplete={(m) => { completed = m }}
      onBack={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Preview Import' }))
}

describe('PKO IKE import — holdings missing from the file', () => {
  it('lists the missing bond under "Not in this file" with Keep selected', () => {
    renderIke()
    expect(screen.getByRole('heading', { name: 'Not in this file' })).toBeTruthy()
    expect(screen.getByText('EDO0136')).toBeTruthy()
    expect((screen.getByRole('radio', { name: 'Keep' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'Mark as sold' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('Remove')).toBeNull()
  })

  it('importing with no changes leaves the missing bond and its buy untouched', () => {
    renderIke()
    const before = account('ike').holdings.find((h) => h.id === 'b3')
    const buysBefore = portfolio.transactions.filter((t) => t.relatedHoldingId === 'b3')

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 Selected' }))

    expect(account('ike').holdings.find((h) => h.id === 'b3')).toEqual(before)
    expect(openNames('ike')).toEqual(['EDO0134×10', 'EDO0235×5', 'EDO0136×3'])
    expect(closed('ike')).toEqual([])
    expect(portfolio.transactions.filter((t) => t.relatedHoldingId === 'b3')).toEqual(buysBefore)
  })

  it('Mark as sold closes it with the edited amount and date; it moves to Closed positions', () => {
    renderIke()
    fireEvent.click(screen.getByRole('radio', { name: 'Mark as sold' }))
    // Prefilled from the last known value (3 × 101).
    // A bond's amount is what PKO paid out, labelled as in Close position.
    const amount = screen.getByLabelText('Amount received (PLN)') as HTMLInputElement
    expect(amount.value).toBe('303')
    fireEvent.change(amount, { target: { value: '310,50' } })
    fireEvent.change(screen.getByLabelText('Date sold'), { target: { value: '2026-06-30' } })

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 Selected' }))

    expect(openNames('ike')).toEqual(['EDO0134×10', 'EDO0235×5'])
    expect(closed('ike')).toEqual(['EDO0136 2026-06-30'])
    const sale = portfolio.transactions.find((t) => t.type === 'sell')!
    expect(sale).toMatchObject({ date: '2026-06-30', amountPLN: 310.5, quantity: 3, relatedHoldingId: 'b3' })
    expect(completed).toBeNull()
    expect(screen.getByText('Updated 2, Closed 1 holdings in Bonds IKE')).toBeTruthy()
  })

  it('blocks the import while a Mark as sold row is invalid', () => {
    renderIke()
    fireEvent.click(screen.getByRole('radio', { name: 'Mark as sold' }))
    fireEvent.change(screen.getByLabelText('Amount received (PLN)'), { target: { value: '' } })
    expect((screen.getByRole('button', { name: 'Import 2 Selected' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Required')).toBeTruthy()
  })

  it('warns and lists nothing as missing when the file shares no holding with the account', () => {
    renderIke('EMISJA;DOSTĘPNA LICZBA OBLIGACJI;WARTOŚĆ NOMINALNA;WARTOŚĆ AKTUALNA;DATA WYKUPU\nCOI0530;4;400,00;410,00;2030-05-15')
    expect(screen.getByText(/None of the holdings in this file are in Bonds IKE/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Not in this file' })).toBeNull()
  })
})

// ─── eMakler ─────────────────────────────────────────────────────────────────

const CP1250: Record<string, number> = { 'ł': 0xb3, 'ę': 0xea, 'ś': 0x9c, 'Ł': 0xa3 }
function cp1250File(name: string, lines: string[]): File {
  const bytes = Uint8Array.from([...lines.join('\r\n')].map((c) => CP1250[c] ?? c.charCodeAt(0)))
  return new File([bytes], name, { type: 'text/csv' })
}

const ORDER_HEADER = 'Stan;Papier;Giełda;K/S;Liczba zlecona;Liczba zrealizowana;Limit ceny;Waluta;Limit aktywacji;Data zlecenia'
const ordersFile = (...rows: string[]) => cp1250File('orders.csv', ['Historia', '', ORDER_HEADER, ...rows, ''])
const BUY_ALPHA = 'Zrealizowane;ALPHA;WWA-GPW;K;10;10;50,00;PLN;;03.02.2026 10:00:00'
const SELL_BETA = 'Zrealizowane;BETA;WWA-GPW;S;10;10;70,00;PLN;;01.03.2026 11:00:00'
const SELL_SOME_BETA = 'Zrealizowane;BETA;WWA-GPW;S;3;3;70,00;PLN;;01.03.2026 11:00:00'
const BUY_ONE_ALPHA = 'Zrealizowane;ALPHA;WWA-GPW;K;1;1;55,00;PLN;;05.03.2026 10:00:00'
const portfolioFile = () => cp1250File('portfolio.csv', [
  'Portfel', '',
  'Papier;Giełda;Liczba dostępna (Blokady);Kurs;Waluta;Wartość;Waluta',
  'ALPHA;WWA-GPW;10;55,00;PLN;550,00;PLN',
  'Łączna wycena papierów;;;;;550,00;PLN',
])

function renderEMakler(files: { file: File; type: 'portfolio' | 'order_history' }[]) {
  return renderInProviders(
    <EMaklerImportFlow
      accountId="mb"
      accountName="Broker M"
      files={files}
      onComplete={(m) => { completed = m }}
      onBack={() => {}}
    />,
  )
}

describe('eMakler import — holdings missing from the files', () => {
  it('order history alone never removes, closes or lists other holdings', async () => {
    renderEMakler([{ file: ordersFile(BUY_ALPHA), type: 'order_history' }])
    await screen.findByRole('button', { name: 'Confirm Import' })
    expect(screen.queryByText('Not in this file')).toBeNull()
    expect(screen.queryByText('BETA')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))

    expect(openNames('mb')).toEqual(['ALPHA×10', 'BETA×10', 'GAMMA×10'])
    expect(closed('mb')).toEqual([])
  })

  it('the same order history uploaded twice proposes nothing and changes nothing', async () => {
    const first = renderEMakler([{ file: ordersFile(BUY_ALPHA), type: 'order_history' }])
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Import' }))
    first.unmount()

    renderEMakler([{ file: ordersFile(BUY_ALPHA), type: 'order_history' }])
    await screen.findByText(/already up to date/)
    expect((screen.getByRole('button', { name: 'Confirm Import' }) as HTMLButtonElement).disabled).toBe(true)
    expect(openNames('mb')).toEqual(['ALPHA×10', 'BETA×10', 'GAMMA×10'])
    expect(closed('mb')).toEqual([])
  })

  it('a portfolio file keeps the holdings it lacks unless they are marked as sold', async () => {
    renderEMakler([{ file: portfolioFile(), type: 'portfolio' }])
    await screen.findByRole('heading', { name: 'Not in this file' })
    const keeps = screen.getAllByRole('radio', { name: 'Keep' }) as HTMLInputElement[]
    expect(keeps.map((r) => r.checked)).toEqual([true, true])

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))

    expect(openNames('mb')).toEqual(['ALPHA×10', 'BETA×10', 'GAMMA×10'])
    expect(closed('mb')).toEqual([])
  })

  it('a sale in the same upload closes the missing holding on its date, with its proceeds', async () => {
    renderEMakler([
      { file: portfolioFile(), type: 'portfolio' },
      { file: ordersFile(BUY_ALPHA, SELL_BETA), type: 'order_history' },
    ])
    await screen.findByText('Sold')
    // BETA is closed by its sale, so only GAMMA is listed as missing.
    expect(screen.getAllByRole('radio', { name: 'Keep' })).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))
    })

    await waitFor(() => expect(closed('mb')).toEqual(['BETA 2026-03-01']))
    expect(openNames('mb')).toEqual(['ALPHA×10', 'GAMMA×10'])
    const sales = portfolio.transactions.filter((t) => t.type === 'sell')
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({ amountPLN: 700, quantity: 10, ticker: 'BETA' })
  })
})

describe('eMakler import — order history and existing holdings', () => {
  it('order history alone keeps an existing holding as it is, and records its orders', async () => {
    renderEMakler([{ file: ordersFile(BUY_ONE_ALPHA), type: 'order_history' }])
    await screen.findByText('Kept')
    expect(screen.getByText(/Order history alone doesn’t change holdings you already have/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))

    expect(account('mb').holdings.find((h) => h.id === 'alpha')).toMatchObject({ quantity: 10, purchasePrice: 50, currentPrice: 60 })
    expect(portfolio.transactions.filter((t) => t.accountId === 'mb' && t.type === 'buy')).toMatchObject([{ quantity: 1, amountPLN: -55, ticker: 'ALPHA' }])
  })
})

describe('eMakler import — a holding the upload sold part of', () => {
  it('Mark as sold closes only what is left after the upload’s sale', async () => {
    renderEMakler([
      { file: portfolioFile(), type: 'portfolio' },
      { file: ordersFile(SELL_SOME_BETA), type: 'order_history' },
    ])
    await screen.findByRole('heading', { name: 'Not in this file' })
    expect(screen.getByText(/^7 units · 420/)).toBeTruthy()
    expect(screen.getByText('3 sold in this upload')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('radio', { name: 'Mark as sold' })[0])
    const amount = screen.getByLabelText('Sale amount (PLN)') as HTMLInputElement
    expect(amount.value).toBe('420') // 7 left × 60
    fireEvent.change(screen.getByLabelText('Date sold'), { target: { value: '2026-03-05' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Import' }))
    })

    await waitFor(() => expect(closed('mb')).toEqual(['BETA 2026-03-05']))
    const beta = portfolio.transactions.filter((t) => t.ticker === 'BETA')
    // One filled-in buy for the 10 held, the upload's sale of 3 and the close of the 7 left.
    expect(beta.map((t) => `${t.type} ${t.quantity}`).sort()).toEqual(['buy 10', 'sell 3', 'sell 7'])
    expect(beta.find((t) => t.type === 'buy')!.date <= '2026-03-01').toBe(true)
  })

  it('a date before the upload’s sale is refused', async () => {
    renderEMakler([
      { file: portfolioFile(), type: 'portfolio' },
      { file: ordersFile(SELL_SOME_BETA), type: 'order_history' },
    ])
    await screen.findByRole('heading', { name: 'Not in this file' })
    fireEvent.click(screen.getAllByRole('radio', { name: 'Mark as sold' })[0])
    fireEvent.change(screen.getByLabelText('Date sold'), { target: { value: '2026-02-28' } })
    expect(screen.getByText('Pick 1 Mar 2026 or later')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Confirm Import' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
