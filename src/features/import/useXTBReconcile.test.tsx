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
      expect(reconcile.begin(portfolio.transactions, portfolio.accounts)).toBe(true)
    })

    const rows = screen.getAllByRole('row').slice(1).map((row) => row.textContent)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/ACME.*90 PLN.*100 PLN/)
    expect(rows[1]).toMatch(/BETA.*150 PLN.*200 PLN/)
  })

  it('confirming writes exactly what the preview showed and leaves other accounts alone', () => {
    renderHarness()
    act(() => {
      reconcile.begin(portfolio.transactions, portfolio.accounts)
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
      reconcile.begin(portfolio.transactions, portfolio.accounts)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    expect(purchasePrices()).toEqual({ 'h-acme-xtb': 90, 'h-beta-xtb': 150, 'h-acme-other': 250 })
    expect(onFinish).toHaveBeenCalledWith([])
  })
})
