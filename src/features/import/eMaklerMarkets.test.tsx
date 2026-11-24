// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { KEYS } from '@/storage/portfolioStore'
import { parseEMaklerOrderHistory, parseEMaklerPortfolio } from '@/importers/eMaklerParser'
import { buildEMaklerImport } from '@/importers/eMaklerImport'
import { toEODHDTicker, toYahooTicker } from '@/services/market-data/tickerUtils'
import type { Account, Holding } from '@/types'
import { EMaklerImportFlow } from './EMaklerImportFlow'

// Issue #67, eMakler side: its market codes and each holding's price currency.
// Synthetic files shaped like eMakler's exports (windows-1250, a header block
// with a name and an account number, then the table). The name, account
// number, instruments and amounts are all made up.

const CP1250: Record<string, number> = {
  'ą': 0xb9, 'ć': 0xe6, 'ę': 0xea, 'ł': 0xb3, 'ń': 0xf1, 'ó': 0xf3, 'ś': 0x9c, 'ź': 0x9f, 'ż': 0xbf,
  'Ł': 0xa3, 'Ś': 0x8c, 'Ż': 0xaf,
}
function cp1250File(name: string, lines: string[]): File {
  const bytes = Uint8Array.from([...lines.join('\r\n')].map((c) => {
    const b = CP1250[c] ?? c.charCodeAt(0)
    if (b > 0xff) throw new Error(`fixture: no windows-1250 byte for "${c}"`)
    return b
  }))
  return new File([bytes], name, { type: 'text/csv' })
}

const HEADER_BLOCK = ['Imię i nazwisko;Jan Przykładowy', 'Numer rachunku;00000000000000000000000000', '']

const PORTFOLIO_LINES = [
  ...HEADER_BLOCK,
  'Papier;Giełda;Liczba dostępna (Blokady);Kurs;Waluta;Wartość;Waluta',
  'SAMPLE WORLD ETF;GBR-LSE;10;10,50;USD;420,00;PLN',
  'EXAMPLE EUROPE ETF;DEU-XETRA;4;10,00;EUR;170,00;PLN',
  'ALPHA;WWA-GPW;10;55,00;PLN;550,00;PLN',
  'Łączna wycena papierów;;;;;1140,00;PLN',
]
const portfolioFile = (lines = PORTFOLIO_LINES) => cp1250File('portfolio.csv', lines)

/** eMakler spells the order file's currency column "Walute". */
const ORDER_HEADER = 'Stan;Papier;Giełda;K/S;Liczba zlecona;Liczba zrealizowana;Limit ceny;Walute;Limit aktywacji;Data zlecenia'
const ORDER_LINES = [
  ...HEADER_BLOCK,
  ORDER_HEADER,
  'Zrealizowane;SAMPLE WORLD ETF;GBR-LSE;K;5;5;10,00;USD;;03.02.2026 10:00:00',
  'Zrealizowane;SAMPLE WORLD ETF;GBR-LSE;K;5;5;10,20;USD;;04.02.2026 10:00:00',
  'Anulowane;SAMPLE WORLD ETF;GBR-LSE;K;5;0;9,00;USD;;05.02.2026 10:00:00',
  'Zrealizowane;EXAMPLE EUROPE ETF;DEU-XETRA;K;4;4;10,00;EUR;;06.02.2026 10:00:00',
  'Odrzucone;EXAMPLE EUROPE ETF;DEU-XETRA;K;4;0;9,50;EUR;;07.02.2026 10:00:00',
  'Zrealizowane;ALPHA;WWA-GPW;K;6;6;50,00;PLN;;09.02.2026 10:00:00',
  'Zrealizowane;ALPHA;WWA-GPW;K;4;4;52,00;PLN;;10.02.2026 10:00:00',
  'Anulowane;ALPHA;WWA-GPW;S;2;0;60,00;PLN;;11.02.2026 10:00:00',
  'Zrealizowane;ALPHA;WWA-GPW;S;2;2;60,00;PLN;;12.02.2026 10:00:00',
]
const ordersFile = () => cp1250File('orders.csv', ORDER_LINES)

describe('reading eMakler’s files', () => {
  it('maps its markets: GBR-LSE → UK, DEU-XETRA → XETRA, WWA-GPW → PL', async () => {
    const rows = await parseEMaklerPortfolio(portfolioFile())
    expect(rows.map((r) => [r.name, r.exchange, r.priceCurrency])).toEqual([
      ['SAMPLE WORLD ETF', 'UK', 'USD'],
      ['EXAMPLE EUROPE ETF', 'XETRA', 'EUR'],
      ['ALPHA', 'PL', 'PLN'],
    ])
    expect(toYahooTicker('EXEU', 'XETRA')).toBe('EXEU.DE')
    expect(toEODHDTicker('EXEU', 'XETRA')).toBe('EXEU.XETRA')
  })

  it('reads the order history’s "Walute" column, and only executed orders', async () => {
    const rows = await parseEMaklerOrderHistory(ordersFile())
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => [r.name, r.exchange, r.currency, r.quantityExecuted])).toEqual([
      ['SAMPLE WORLD ETF', 'UK', 'USD', 5],
      ['SAMPLE WORLD ETF', 'UK', 'USD', 5],
      ['EXAMPLE EUROPE ETF', 'XETRA', 'EUR', 4],
      ['ALPHA', 'PL', 'PLN', 6],
      ['ALPHA', 'PL', 'PLN', 4],
      ['ALPHA', 'PL', 'PLN', 2],
    ])
  })

  it('finds the currency column by its name, not its position', async () => {
    const moved = ORDER_LINES.map((l) => {
      const cells = l.split(';')
      if (cells.length < 10) return l
      const [walute] = cells.splice(7, 1)
      return [...cells, walute].join(';')
    })
    const rows = await parseEMaklerOrderHistory(cp1250File('orders.csv', moved))
    expect(rows.map((r) => r.currency)).toEqual(['USD', 'USD', 'EUR', 'PLN', 'PLN', 'PLN'])
  })

  it('never carries the header block’s name or account number into a row', async () => {
    const rows = [...await parseEMaklerPortfolio(portfolioFile()), ...await parseEMaklerOrderHistory(ordersFile())]
    expect(JSON.stringify(rows)).not.toMatch(/Przykładowy|00000000000000000000000000/)
  })
})

describe('the import’s holdings', () => {
  it('carry the file’s price currency', async () => {
    const r = await buildEMaklerImport(await parseEMaklerPortfolio(portfolioFile()), [], new Set())
    expect(r.holdings.map((h) => [h.name, h.exchange, h.currency])).toEqual([
      ['SAMPLE WORLD ETF', 'UK', 'USD'],
      ['EXAMPLE EUROPE ETF', 'XETRA', 'EUR'],
      ['ALPHA', 'PL', 'PLN'],
    ])
    expect(r.warnings).toEqual([])
  })

  it('a market eMakler writes that Vestly doesn’t know is kept, and warned about once', async () => {
    const lines = [...PORTFOLIO_LINES]
    lines.splice(5, 0, 'FAKE ONE;FAKE-MKT;1;1,00;USD;4,00;PLN', 'FAKE TWO;FAKE-MKT;1;1,00;USD;4,00;PLN')
    const r = await buildEMaklerImport(await parseEMaklerPortfolio(portfolioFile(lines)), [], new Set())
    expect(r.holdings.find((h) => h.name === 'FAKE ONE')?.exchange).toBe('FAKE-MKT')
    expect(r.warnings).toEqual([
      'Unknown market "FAKE-MKT" (FAKE ONE): kept as it is, so prices for its holdings can\'t be fetched. Set the exchange on the holding to fix it.',
    ])
  })
})

// ─── Through the import flow ──────────────────────────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z'
const holding = (id: string, fields: Partial<Holding>): Holding => ({
  id, accountId: 'mb', name: id.toUpperCase(), category: 'stock', quantity: 10, purchasePrice: 50, currentPrice: 60,
  purchaseDate: '2025-06-01', createdAt: NOW, updatedAt: NOW, ...fields,
})

let portfolio: ReturnType<typeof usePortfolio>
function Capture() {
  const value = usePortfolio()
  useEffect(() => {
    portfolio = value
  })
  return null
}

function seed(holdings: Holding[]) {
  const accounts: Account[] = [{ id: 'mb', name: 'Broker M', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings }]
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, '[]')
}

function renderFlow() {
  return render(
    <PortfolioProvider>
      <SettingsProvider>
        <Capture />
        <EMaklerImportFlow
          accountId="mb"
          accountName="Broker M"
          files={[{ file: portfolioFile(), type: 'portfolio' }]}
          onComplete={() => {}}
          onBack={() => {}}
        />
      </SettingsProvider>
    </PortfolioProvider>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('eMakler import flow', () => {
  it('saves the file’s currency on added holdings, and on updated ones over what price data said', async () => {
    seed([holding('alpha', { name: 'ALPHA', ticker: 'ALPHA', exchange: 'PL', currency: 'USD' })])
    renderFlow()
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Import' }))

    await waitFor(() => expect(portfolio.accounts[0].holdings.filter((h) => !h.isSynthetic)).toHaveLength(3))
    const byName = Object.fromEntries(portfolio.accounts[0].holdings.map((h) => [h.name, [h.exchange, h.currency]]))
    expect(byName).toMatchObject({
      'ALPHA': ['PL', 'PLN'],
      'SAMPLE WORLD ETF': ['UK', 'USD'],
      'EXAMPLE EUROPE ETF': ['XETRA', 'EUR'],
    })
  })
})
