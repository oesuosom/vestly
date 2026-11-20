// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioProvider, usePortfolio } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { KEYS } from '@/storage/portfolioStore'
import type { Account, Holding, Transaction } from '@/types'
import { useXTBReconcile, type UseXTBReconcile } from './useXTBReconcile'

// ─── Fixtures ──────────────────────────────────────────────────────────────────
// The same ticker in two accounts, and a sold-and-rebought ticker in the
// importing one. Every stored purchase price is stale.

const NOW = '2025-01-01T00:00:00.000Z'

function holding(id: string, accountId: string, ticker: string, purchasePrice: number): Holding {
  return {
    id,
    accountId,
    name: `${ticker} Corp`,
    ticker,
    category: 'stock',
    quantity: 10,
    purchasePrice,
    currentPrice: 250,
    purchaseDate: '2025-01-10',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function account(id: string, holdings: Holding[]): Account {
  return { id, name: id, type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings }
}

function trade(
  id: string,
  accountId: string,
  type: 'buy' | 'sell',
  date: string,
  ticker: string,
  amountPLN: number,
): Transaction {
  return { id, accountId, type, date, amountPLN, ticker, quantity: 10, externalId: id, source: 'xtb_import', createdAt: NOW }
}

const ACCOUNTS: Account[] = [
  account('xtb', [holding('h-acme-xtb', 'xtb', 'ACME', 90), holding('h-beta-xtb', 'xtb', 'BETA', 150)]),
  account('other', [holding('h-acme-other', 'other', 'ACME', 250)]),
]

const TRANSACTIONS: Transaction[] = [
  trade('t1', 'xtb', 'buy', '2025-03-05', 'ACME', -1000),   // 100 each
  trade('t2', 'other', 'buy', '2025-01-10', 'ACME', -3000), // 300 each, in the other account
  trade('t3', 'xtb', 'buy', '2025-01-10', 'BETA', -1000),
  trade('t4', 'xtb', 'sell', '2025-02-10', 'BETA', 1500),
  trade('t5', 'xtb', 'buy', '2025-03-10', 'BETA', -2000),   // 200 each after the sell-out
]

// ─── Harness ───────────────────────────────────────────────────────────────────

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

function renderHarness() {
  return render(
    <PortfolioProvider>
      <SettingsProvider>
        <Harness />
      </SettingsProvider>
    </PortfolioProvider>
  )
}

/** Purchase price per holding id. The provider's synthetic cash holdings are left out. */
function purchasePrices(): Record<string, number> {
  return Object.fromEntries(
    portfolio.accounts.flatMap((a) =>
      a.holdings.filter((h) => !h.isSynthetic).map((h) => [h.id, h.purchasePrice]),
    ),
  )
}

beforeEach(() => {
  localStorage.clear()
  onFinish.mockClear()
  localStorage.setItem(KEYS.VERSION, JSON.stringify({ version: '5.0.0', createdAt: NOW, updatedAt: NOW }))
  localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(ACCOUNTS))
  localStorage.setItem(KEYS.SNAPSHOTS, '[]')
  localStorage.setItem(KEYS.TRANSACTIONS, JSON.stringify(TRANSACTIONS))
})

afterEach(() => {
  cleanup()
})

describe('useXTBReconcile — update purchase prices step', () => {
  it('previews only the importing account, with sale-aware prices', () => {
    renderHarness()
    act(() => {
      expect(reconcile.begin(portfolio.transactions, portfolio.accounts, [])).toBe(true)
    })

    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/ACME.*90 PLN.*100 PLN/)
    expect(rows[1]).toMatch(/BETA.*150 PLN.*200 PLN/)
  })

  it('confirming writes exactly what the preview showed and leaves other accounts alone', () => {
    renderHarness()
    act(() => {
      reconcile.begin(portfolio.transactions, portfolio.accounts, [])
    })
    const otherAccountBefore = portfolio.accounts[1]

    fireEvent.click(screen.getByRole('button', { name: 'Update 2 holdings' }))

    expect(purchasePrices()).toEqual({
      'h-acme-xtb': 100,   // this account's own buy, not the 200 blended with the other account
      'h-beta-xtb': 200,   // the rebuy price, not the 150 average of every buy ever made
      'h-acme-other': 250, // never shown in the preview, so never rewritten
    })
    expect(portfolio.accounts[1]).toEqual(otherAccountBefore)
    expect(onFinish).toHaveBeenCalledWith(['Purchase prices updated for 2 holdings'])
  })

  it('skipping changes nothing', () => {
    renderHarness()
    act(() => {
      reconcile.begin(portfolio.transactions, portfolio.accounts, [])
    })

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(purchasePrices()).toEqual({ 'h-acme-xtb': 90, 'h-beta-xtb': 150, 'h-acme-other': 250 })
    expect(onFinish).toHaveBeenCalledWith([])
  })
})

// ─── Holding changes step (#30) ────────────────────────────────────────────────

describe('useXTBReconcile — trades update their holdings', () => {
  const holdingById = (id: string) => portfolio.accounts.flatMap((a) => a.holdings).find((h) => h.id === id)
  const closedById = (id: string) => portfolio.accounts.flatMap((a) => a.closedHoldings ?? []).find((h) => h.id === id)

  /** Import rows the way the XTB flows do, then start reconciliation. */
  function importAndBegin(rows: Transaction[]) {
    act(() => {
      const { mergedTransactions, nextAccounts } = portfolio.importTransactions(rows, 'xtb')
      reconcile.begin(mergedTransactions, nextAccounts, rows)
    })
  }

  const laterBuy: Transaction = {
    id: 'n1', accountId: 'xtb', type: 'buy', date: '2025-04-02', amountPLN: -600, ticker: 'ACME', quantity: 5,
    externalId: 'n1', source: 'xtb_import', createdAt: NOW,
  }
  const sellAllBeta: Transaction = {
    id: 'n2', accountId: 'xtb', type: 'sell', date: '2025-04-03', amountPLN: 2500, ticker: 'BETA', quantity: 10,
    externalId: 'n2', source: 'xtb_confirmation', createdAt: NOW,
  }

  it('a later buy: the preview offers the new quantity, and confirming applies it', () => {
    renderHarness()
    importAndBegin([laterBuy])
    expect(screen.getByRole('row', { name: /ACME Corp\s*10\s*→\s*15 shares/ })).toBeTruthy()
    expect(holdingById('h-acme-xtb')!.quantity).toBe(10) // nothing changes before confirming

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(holdingById('h-acme-xtb')).toMatchObject({ quantity: 15, purchasePrice: 1600 / 15 })
    // The purchase-price step that follows sees the update: only BETA is left.
    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatch(/BETA/)
    fireEvent.click(screen.getByRole('button', { name: 'Update 1 holding' }))
    expect(onFinish).toHaveBeenCalledWith(['1 holding updated', 'Purchase prices updated for 1 holding'])
  })

  it('a full sale: the preview offers to close, and confirming closes it with the sale’s date and proceeds', () => {
    renderHarness()
    importAndBegin([sellAllBeta])
    expect(screen.getByRole('row', { name: /BETA Corp\s*Sold out\s*→\s*close on 3 Apr 2025\s*·\s*2 500 PLN/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(holdingById('h-beta-xtb')).toBeUndefined()
    expect(closedById('h-beta-xtb')).toMatchObject({ closedAt: '2025-04-03' })
    // The import's own sale is the close: no second sale was recorded.
    expect(portfolio.transactions.filter((t) => t.type === 'sell' && t.ticker === 'BETA')).toHaveLength(2)
  })

  it('skipping leaves the holding as it was', () => {
    renderHarness()
    importAndBegin([laterBuy])
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(holdingById('h-acme-xtb')!.quantity).toBe(10)
  })

  it('a holding whose history doesn’t explain its quantity is left alone and flagged', () => {
    const accounts = ACCOUNTS.map((a) =>
      a.id === 'xtb' ? { ...a, holdings: a.holdings.map((h) => (h.id === 'h-acme-xtb' ? { ...h, quantity: 12 } : h)) } : a,
    )
    localStorage.setItem(KEYS.ACCOUNTS, JSON.stringify(accounts))
    renderHarness()
    importAndBegin([laterBuy])

    expect(screen.getByText(/don’t explain the 12 shares you hold/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(holdingById('h-acme-xtb')!.quantity).toBe(12)
  })
})
