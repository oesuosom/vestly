// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClosedPositions } from '@/features/accounts/ClosedPositions'
import type { Holding, Transaction } from '@/types'

const now = '2026-01-01T00:00:00.000Z'
const closed = (id: string, name: string, ticker: string, closedAt: string): Holding => ({
  id, accountId: 'xtb', name, ticker, category: 'stock', quantity: 10, purchasePrice: 100, currentPrice: 100,
  purchaseDate: '2026-01-10', closedAt, createdAt: now, updatedAt: now,
})
const tx = (id: string, fields: Partial<Transaction>): Transaction => ({
  id, accountId: 'xtb', type: 'buy', date: '2026-01-10', amountPLN: 0, externalId: id, source: 'xtb_import', createdAt: now, ...fields,
})

const apple = closed('aapl', 'Apple', 'AAPL', '2026-03-10')
const orlen = closed('pkn', 'Orlen', 'PKN', '2026-04-02')
const transactions = [
  tx('b1', { ticker: 'AAPL', quantity: 10, amountPLN: -1000 }),
  // 1 590 − 1 000 = +590, +59 %
  tx('s1', { type: 'sell', date: '2026-03-10', ticker: 'AAPL', quantity: 10, amountPLN: 1590, externalId: 'close-sell-aapl' }),
  tx('b2', { ticker: 'PKN', quantity: 10, amountPLN: -1000 }),
  // 900 − 1 000 = −100, −10 %
  tx('s2', { type: 'sell', date: '2026-04-02', ticker: 'PKN', quantity: 10, amountPLN: 900, externalId: 'close-sell-pkn' }),
]

afterEach(cleanup)

describe('ClosedPositions', () => {
  it('is collapsed by default, showing only the count', () => {
    render(<ClosedPositions holdings={[apple, orlen]} transactions={transactions} onSelect={() => {}} />)
    const toggle = screen.getByRole('button', { name: /Closed positions/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('2')
    expect(screen.queryByText('Apple')).toBeNull()
  })

  it('lists name, close date and realized profit, newest close first', () => {
    render(<ClosedPositions holdings={[apple, orlen]} transactions={transactions} onSelect={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Closed positions/ }))

    // Cells: instrument (the icon falls back to the ticker in jsdom), close date, profit and %.
    const rows = screen.getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent))
    expect(rows).toEqual([
      ['PKNOrlen', '2 Apr 2026', '-100 PLN-10,0%'],
      ['AAPLApple', '10 Mar 2026', '+590 PLN+59,0%'],
    ])
  })

  it('opens a row by click or keyboard', () => {
    const onSelect = vi.fn()
    render(<ClosedPositions holdings={[apple]} transactions={transactions} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Closed positions/ }))

    fireEvent.click(screen.getByText('Apple'))
    fireEvent.keyDown(screen.getByRole('row', { name: /Apple, closed/ }), { key: 'Enter' })
    expect(onSelect.mock.calls).toEqual([['aapl'], ['aapl']])
  })
})
