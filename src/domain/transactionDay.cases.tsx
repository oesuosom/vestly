import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Activity } from '@/pages/Activity'
import { SettingsProvider } from '@/context/SettingsContext'
import { XTBConfirmationFlow } from '@/features/import/XTBConfirmationFlow'
import { RevolutStatementFlow } from '@/features/import/RevolutStatementFlow'
import type { RevolutStatement } from '@/importers/revolutStatement'
import { HoldingSyncStep } from '@/features/import/HoldingSyncStep'
import { ClosePositionDialog } from '@/features/accounts/ClosePositionDialog'
import { transactionDay } from '@/domain/transactionDay'
import type { ParsedTrade } from '@/importers/xtbConfirmationParser'
import type { Account, Holding, Transaction } from '@/types'

/**
 * Shared cases for #78, run by transactionDay.warsaw.test.tsx and
 * transactionDay.newYork.test.tsx with the time zone pinned: a transaction is
 * shown on its stored (UTC) day everywhere, whatever the viewer's zone.
 * Synthetic data only.
 */
export type TransactionDayCase = {
  zone: string
  /** Minutes from `Date#getTimezoneOffset` on the row's day — proves the zone took effect. */
  offsetMinutes: number
  /** The row's timestamp, near midnight so the local and stored days differ. */
  date: string
  /** The local calendar day of `date`: the wrong answer before the fix. */
  localDay: string
  /** The clock for the close-position case: the local today is before the stored day (west of UTC only). */
  closeNow?: string
}

/** The mocked `usePortfolio()` value. Each test file mocks the context with it. */
export type MockPortfolio = Record<string, unknown> & { accounts: Account[]; transactions: Transaction[] }

const NOW = '2026-01-01T00:00:00.000Z'
const account: Account = { id: 'acc_demo', name: 'Demo Broker', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings: [] }


/** "2026-11-10" → "10/11/26", as Activity's date column shows it. */
const columnDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`
/** "2026-11-10" → "10 Nov 2026", as `formatDate` shows it. */
const longDay = (day: string) =>
  `${Number(day.slice(8, 10))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`

export function runTransactionDayCases(c: TransactionDayCase, portfolio: MockPortfolio, originalTZ: string | undefined): void {
  const stored = c.date.slice(0, 10)

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  afterAll(() => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
    if (originalTZ === undefined) delete env.TZ
    else env.TZ = originalTZ
  })

  describe(`a transaction's day in ${c.zone}, row at ${c.date}`, () => {
    it('really runs in that zone, where the row falls on another local day', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(c.zone)
      expect(new Date(c.date).getTimezoneOffset()).toBe(c.offsetMinutes)
      const local = new Date(c.date)
      const localISO = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
      expect(localISO).toBe(c.localDay)
      expect(c.localDay).not.toBe(stored)
      expect(transactionDay({ date: c.date })).toBe(stored)
    })

    describe('Activity', () => {
      beforeEach(() => {
        portfolio.accounts = [account]
        portfolio.transactions = [{
          id: 't1', accountId: account.id, type: 'deposit', date: c.date, amountPLN: 1000,
          externalId: 't1', source: 'xtb_import', createdAt: NOW,
        }]
      })

      it('shows the row and its delete label on the same, stored day', () => {
        render(<MemoryRouter initialEntries={['/activity']}><Activity /></MemoryRouter>)
        const button = screen.getByRole('button', { name: /^Delete Deposit/ })
        const row = button.closest('tr')!
        expect(within(row).getByText(columnDay(stored))).toBeTruthy()
        expect(button.getAttribute('aria-label')).toBe(`Delete Deposit, Demo Broker, ${longDay(stored)}`)
        expect(button.getAttribute('aria-label')).not.toContain(longDay(c.localDay))
      })
    })

    describe('XTB confirmation import', () => {
      const trade: ParsedTrade = {
        id: 'trade_1', direction: 'buy', orderNo: '1000', ticker: 'DEMO', exchange: 'PL', instrument: 'Demo Equity Fund',
        quantity: 10, unitPriceOriginal: 100, currency: 'PLN', fxRate: 1, totalCosts: 0, date: c.date, grossPLN: 1000,
      }

      beforeEach(() => {
        portfolio.accounts = [account]
        // The same order, already in the log: the preview flags it as a duplicate.
        portfolio.transactions = [{
          id: 'existing', accountId: account.id, type: 'buy', date: c.date, amountPLN: -1000, ticker: 'DEMO', exchange: 'PL',
          instrument: 'Demo Equity Fund', quantity: 10, pricePerUnitPLN: 100, externalId: 'xtb-cash-op:1',
          source: 'xtb_import', createdAt: NOW,
        }]
      })

      it('shows the trade and the transaction it matches on the stored day', () => {
        render(
          <SettingsProvider>
          <XTBConfirmationFlow
            accountId={account.id}
            files={[]}
            onComplete={() => {}}
            onBack={() => {}}
            devSeed={{ step: 'preview', state: { parseResult: { trades: [trade], warnings: [], statement: {} } } }}
          />
          </SettingsProvider>,
        )
        expect(screen.getByText(new RegExp(`· ${longDay(stored)}$`))).toBeTruthy()
        expect(screen.getByText(`Matches an existing transaction from ${longDay(stored)}`)).toBeTruthy()
        expect(screen.queryByText(new RegExp(longDay(c.localDay)))).toBeNull()
      })
    })

    describe('Revolut statement import', () => {
      it('asks for the cost of a receive on its stored (UTC) day', () => {
        portfolio.accounts = [account]
        portfolio.transactions = []
        // The statement's local time, converted to UTC: the stored day can be another local day.
        const statement: RevolutStatement = {
          period: { from: '2026-01-01', to: '2026-12-31' },
          rows: [{ page: 1, row: 1, raw: '', symbol: 'BTC', type: 'receive', quantity: 0.5, price: 400000, value: 200000, fee: 0, date: c.date }],
          staking: {}, stakingQuantity: {}, closing: {}, opening: {}, summary: {}, names: {}, prices: {}, warnings: [],
        }
        render(
          <RevolutStatementFlow
            accountId={account.id}
            file={new File([], 'statement.pdf')}
            onComplete={() => {}}
            onBack={() => {}}
            devSeed={{ step: 'preview', state: { statement } }}
          />,
        )
        expect(screen.getByText(longDay(stored))).toBeTruthy()
        expect(screen.queryByText(longDay(c.localDay))).toBeNull()
      })
    })

    describe('Holdings step after an import', () => {
      it('closes on the stored day of the last sale', () => {
        const holding: Holding = {
          id: 'demo', accountId: account.id, name: 'Demo Equity Fund', ticker: 'DEMO', category: 'stock', quantity: 10,
          purchasePrice: 100, currentPrice: 100, purchaseDate: '2026-01-05', createdAt: NOW, updatedAt: NOW,
        }
        const sale: Transaction = {
          id: 's1', accountId: account.id, type: 'sell', date: c.date, amountPLN: 1000, ticker: 'DEMO', quantity: 10,
          externalId: 's1', source: 'xtb_import', createdAt: NOW,
        }
        // `date` is the plan's day (`accountForUploadSales` → transactionDay of the last sale).
        render(
          <HoldingSyncStep
            rows={[{ kind: 'close', holding, date: transactionDay(sale), proceedsPLN: 1000, sales: [sale] }]}
            onConfirm={() => {}}
            onSkip={() => {}}
          />,
        )
        expect(screen.getByText(new RegExp(`close on ${longDay(stored)}`))).toBeTruthy()
      })
    })

    if (c.closeNow) {
      const closeNow = c.closeNow
      describe('Close position when the last buy is stored after the local today', () => {
        const holding: Holding = {
          id: 'demo', accountId: account.id, name: 'Demo Equity Fund', ticker: 'DEMO', category: 'stock', quantity: 10,
          purchasePrice: 100, currentPrice: 100, purchaseDate: '2026-01-05', createdAt: NOW, updatedAt: NOW,
        }

        beforeEach(() => {
          vi.useFakeTimers({ toFake: ['Date'] })
          vi.setSystemTime(new Date(closeNow))
          portfolio.accounts = [{ ...account, holdings: [holding] }]
          portfolio.transactions = [{
            id: 'b1', accountId: account.id, type: 'buy', date: c.date, amountPLN: -1000, ticker: 'DEMO', quantity: 10,
            externalId: 'b1', source: 'xtb_import', createdAt: NOW,
          }]
        })

        it('starts on the stored day of that buy, allows it, and records the close', () => {
          render(<ClosePositionDialog holding={holding} isOpen onClose={() => {}} />)
          const date = screen.getByLabelText('Date') as HTMLInputElement
          expect(date.value).toBe(stored)
          expect(date.max).toBe(stored)
          expect(date.min).toBe(stored)

          fireEvent.change(screen.getByLabelText(/Sale amount/), { target: { value: '1200' } })
          expect(screen.getByText('Realized profit').nextElementSibling!.textContent).toBe('+200,00 PLN (+20,00%)')
        })
      })
    }
  })
}
