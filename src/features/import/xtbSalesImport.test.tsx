// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { computeAccountCashBalance } from '@/domain/calculations'
import { parseXTBCashOperations } from '@/importers/xtbParser'
import { KEYS } from '@/storage/portfolioStore'
import type { Account, Holding, Transaction } from '@/types'
import { useXTBReconcile, type UseXTBReconcile } from './useXTBReconcile'

// End to end: an XTB Cash Operations file with sales, parsed and imported the
// way XTBTransactionFlow does it, then reconciled. Synthetic data throughout.

const NOW = '2026-01-01T00:00:00.000Z'

function holding(id: string, name: string, ticker: string, exchange: string): Holding {
  return {
    id, accountId: 'xtb', name, ticker, exchange, category: 'stock', quantity: 10, purchasePrice: 0,
    currentPrice: 50, purchaseDate: '2026-01-05', createdAt: NOW, updatedAt: NOW,
  }
}

const ACCOUNTS: Account[] = [{
  id: 'xtb', name: 'XTB', type: 'brokerage', createdAt: NOW, lastUpdated: NOW,
  holdings: [holding('h-acme', 'Acme Corp', 'ACME', 'US'), holding('h-example', 'Example SA', 'EXAMPLE', 'PL')],
}]

/** An earlier import, from before times were kept: date-only rows. */
const EARLIER: Transaction[] = [
  { id: 'e0', accountId: 'xtb', type: 'deposit', date: '2026-01-02', amountPLN: 2000, externalId: '100', source: 'xtb_import', createdAt: NOW },
  { id: 'e1', accountId: 'xtb', type: 'buy', date: '2026-01-05', amountPLN: -1000, instrument: 'Acme Corp', ticker: 'ACME', quantity: 10, externalId: '101', source: 'xtb_import', createdAt: NOW },
  { id: 'e2', accountId: 'xtb', type: 'buy', date: '2026-01-05', amountPLN: -400, instrument: 'Example SA', ticker: 'EXAMPLE', quantity: 10, externalId: '102', source: 'xtb_import', createdAt: NOW },
]

/** The next month's export: the same early rows again, then two sales and a commission. Newest first. */
const FILE = [
  'Account number,00000000',
  'Cash Operations,',
  'Date from (UTC),2026-01-01 00:00:00',
  'Date to (UTC),2026-03-01 00:00:00',
  'Type,Instrument,Time,Amount,ID,Comment,Product',
  'Commission,Example SA,2026-02-04 09:15:00,-1,105,,Stocks',
  'Stock sale,Example SA,2026-02-04 09:15:00,200,104,CLOSE BUY EXAMPLE.PL 4/10 @ 50.00,Stocks',
  'Stock sale,Acme Corp,2026-02-03 15:30:00.120000,1200,103,CLOSE BUY ACME.US 10 @ 30.00,Stocks',
  'Stock purchase,Example SA,2026-01-05 10:00:00,-400,102,OPEN BUY EXAMPLE.PL 10 @ 40.00,Stocks',
  'Stock purchase,Acme Corp,2026-01-05 10:00:00,-1000,101,OPEN BUY 10 @ 25.00,Stocks',
  'Deposit,,2026-01-02 09:00:00,2000,100,,',
  'Total,,,1999,,,',
].join('\n')

let portfolio: ReturnType<typeof usePortfolio>
let reconcile: UseXTBReconcile
const onFinish = vi.fn()

function Harness() {
  const portfolioValue = usePortfolio()
  const reconcileValue = useXTBReconcile({ accountId: 'xtb', onFinish })
  useEffect(() => {
    portfolio = portfolioValue
    reconcile = reconcileValue
  })
  return reconcileValue.render()
}

beforeEach(() => {
  localStorage.clear()
  onFinish.mockClear()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(ACCOUNTS))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(EARLIER))
})

afterEach(() => {
  cleanup()
})

describe('importing XTB sales from Cash Operations', () => {
  it('a full sale closes the holding, a partial sale updates its quantity, and Cash gets the proceeds', async () => {
    render(<PortfolioProvider><SettingsProvider><Harness /></SettingsProvider></PortfolioProvider>)

    const existingIds = new Set(portfolio.transactions.map((t) => t.externalId))
    const parsed = await parseXTBCashOperations(
      new File([FILE], 'cash-operations.csv'), 'xtb', existingIds, portfolio.accounts, {}, portfolio.transactions,
    )
    expect(parsed.warnings).toEqual([])
    expect(parsed.skipped).toBe(3)
    expect(parsed.transactions.map((t) => [t.type, t.ticker ?? t.relatedTicker, t.quantity, t.date])).toEqual([
      ['fee', 'EXAMPLE', undefined, '2026-02-04T09:15:00.000Z'],
      ['sell', 'EXAMPLE', 4, '2026-02-04T09:15:00.000Z'],
      ['sell', 'ACME', 10, '2026-02-03T15:30:00.120Z'],
    ])

    act(() => {
      const { mergedTransactions, nextAccounts } = portfolio.importTransactions(parsed.transactions, 'xtb')
      expect(reconcile.begin(mergedTransactions, nextAccounts, parsed.transactions)).toBe(true)
    })

    // The holding-changes step offers both changes; nothing changes before confirming.
    expect(screen.getByRole('row', { name: /Acme Corp\s*Sold out\s*→\s*close on 3 Feb 2026\s*·\s*1 200 PLN/ })).toBeTruthy()
    expect(screen.getByRole('row', { name: /Example SA\s*10\s*→\s*6 shares/ })).toBeTruthy()
    expect(portfolio.accounts[0].holdings.find((h) => h.id === 'h-acme')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    const account = portfolio.accounts[0]
    expect(account.holdings.find((h) => h.id === 'h-acme')).toBeUndefined()
    expect(account.closedHoldings).toMatchObject([{ id: 'h-acme', closedAt: '2026-02-03' }])
    expect(account.holdings.find((h) => h.id === 'h-example')).toMatchObject({ quantity: 6, purchasePrice: 40 })
    // 2,000 deposit − 1,400 in buys + 1,400 in sales − 1 commission: the file's Total.
    expect(computeAccountCashBalance(portfolio.transactions, 'xtb')).toBe(1999)
  })
})
