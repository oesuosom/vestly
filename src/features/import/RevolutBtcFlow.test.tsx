// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { KEYS } from '@/storage/portfolioStore'
import type { Account, Transaction } from '@/types'
import { RevolutBtcFlow } from './RevolutBtcFlow'

// Synthetic statement text, keyed by file name, in place of reading PDFs.
const PDF_TEXT: Record<string, string> = {
  'transaction-statement_sellhalf_en_a.pdf': 'Mar 1, 2026 Exchanged to PLN1.00000000\nfiat amount150,000.00 PLN\nFee: 300.00 PLN',
  'transaction-statement_sellall_en_b.pdf': 'Mar 1, 2026 Exchanged to PLN2.00000000\nfiat amount300,000.00 PLN\nFee: 600.00 PLN',
  'p2p-transaction-confirmation-report_en_sendall.pdf': 'Transfer Confirmation\nRecipient External wallet\nValue Date 2026-03-02\nTransfer details 0.50000000 BTC',
}
vi.mock('@/importers/pdfText', () => ({
  extractPDFText: async (file: File) => PDF_TEXT[file.name] ?? '',
}))

const NOW = '2026-01-01T00:00:00.000Z'

function setup(quantity: number, amountPLN: number) {
  const accounts: Account[] = [{
    id: 'rev', name: 'Revolut', type: 'crypto', createdAt: NOW, lastUpdated: NOW,
    holdings: [{
      id: 'btc', accountId: 'rev', name: 'Bitcoin', ticker: 'BTC', exchange: 'CC', category: 'crypto', quantity,
      purchasePrice: -amountPLN / quantity, currentPrice: 300000, purchaseDate: '2026-01-10', createdAt: NOW, updatedAt: NOW,
    }],
  }]
  const log: Transaction[] = [{
    id: 'b1', externalId: 'b1', accountId: 'rev', type: 'buy', date: '2026-01-10T00:00:00.000Z', amountPLN, quantity,
    ticker: 'BTC', source: 'revolut_crypto', createdAt: NOW,
  }]
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts))
  localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(log))
}

let portfolio: ReturnType<typeof usePortfolio>
function Capture() {
  const value = usePortfolio()
  useEffect(() => {
    portfolio = value
  })
  return null
}

async function importFiles(names: string[]) {
  render(
    <PortfolioProvider>
      <Capture />
      <RevolutBtcFlow
        accountId="rev"
        files={names.map((n) => new File(['%PDF'], n, { type: 'application/pdf' }))}
        onComplete={() => {}}
        onBack={() => {}}
      />
    </PortfolioProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Import \d+ transactions?$/ }))
}

const btc = () => portfolio.accounts[0].holdings.find((h) => h.id === 'btc')
const closedBtc = () => portfolio.accounts[0].closedHoldings?.find((h) => h.id === 'btc')

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
})
afterEach(() => cleanup())

describe('Revolut BTC import — the holding follows the trades', () => {
  it('a partial sale keeps the per-unit cost: 2 BTC for 200,000 PLN, 1 sold → 1 BTC at 100,000', async () => {
    setup(2, -200000)
    await importFiles(['transaction-statement_sellhalf_en_a.pdf'])

    expect(screen.getByRole('row', { name: /Bitcoin\s*2\s*→\s*1 BTC/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(btc()).toMatchObject({ quantity: 1, purchasePrice: 100000 })
    expect(screen.getByText(/BTC holding updated/)).toBeTruthy()
  })

  it('selling everything closes the holding on the sale’s day', async () => {
    setup(2, -200000)
    await importFiles(['transaction-statement_sellall_en_b.pdf'])

    expect(screen.getByRole('row', { name: /Bitcoin\s*Sold out\s*→\s*close on 1 Mar 2026\s*·\s*299 400 PLN/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(btc()).toBeUndefined()
    expect(closedBtc()).toMatchObject({ closedAt: '2026-03-01' })
    expect(screen.getByText(/BTC holding closed/)).toBeTruthy()
  })

  it('sending everything away closes it too', async () => {
    setup(0.5, -50000)
    await importFiles(['p2p-transaction-confirmation-report_en_sendall.pdf'])

    expect(screen.getByRole('row', { name: /Bitcoin\s*All sent\s*→\s*close on 2 Mar 2026/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(closedBtc()).toMatchObject({ closedAt: '2026-03-02' })
  })

  it('skipping leaves the holding as it was', async () => {
    setup(2, -200000)
    await importFiles(['transaction-statement_sellhalf_en_a.pdf'])
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(btc()).toMatchObject({ quantity: 2, purchasePrice: 100000 })
  })
})
