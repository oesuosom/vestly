import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { pairTradeFees } from './tradeFees'

// ─── Helpers ───────────────────────────────────────────────────────────────────
// The externalIds below are written out the way the Revolut statement import
// builds them (importers/revolutStatementImport.ts). The row's `id` is its externalId
// unless given, so expectations can name the trade directly.

function row(
  type: Transaction['type'],
  externalId: string,
  amountPLN: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: externalId,
    accountId: 'revolut',
    type,
    date: '2025-01-10T00:00:00.000Z',
    amountPLN,
    externalId,
    source: 'revolut_crypto',
    createdAt: '2025-01-10T00:00:00.000Z',
    ...overrides,
  }
}

const entries = (transactions: Transaction[]) => Object.fromEntries(pairTradeFees(transactions))

// ─── pairTradeFees ─────────────────────────────────────────────────────────────

const BUY = 'revolut-stmt-BTC-buy-2025-01-10T09:00:00.000Z-0.5-1'
const SELL = 'revolut-stmt-BTC-sell-2025-03-10T09:00:00.000Z-0.5-1'

describe('pairTradeFees', () => {
  it('returns nothing when there are no separately stored fees', () => {
    expect(entries([])).toEqual({})
    expect(entries([row('buy', 'xtb-123', -1000, { source: 'xtb_import' })])).toEqual({})
  })

  it('pairs a buy with its fee: the fee id is the trade id plus "-fee"', () => {
    const transactions = [row('buy', BUY, -100000), row('fee', `${BUY}-fee`, -1000)]
    expect(entries(transactions)).toEqual({ [BUY]: 1000 })
  })

  it('pairs a sale with its own fee, not with a buy fee', () => {
    const transactions = [
      row('buy', BUY, -100000),
      row('fee', `${BUY}-fee`, -1000),
      row('sell', SELL, 150000),
      row('fee', `${SELL}-fee`, -1500),
    ]
    expect(entries(transactions)).toEqual({ [BUY]: 1000, [SELL]: 1500 })
  })

  it('keeps two identical rows of one statement apart by their occurrence', () => {
    const second = BUY.replace(/-1$/, '-2')
    const transactions = [
      row('buy', BUY, -100000),
      row('fee', `${BUY}-fee`, -1000),
      row('buy', second, -100000),
      row('fee', `${second}-fee`, -1000),
    ]
    expect(entries(transactions)).toEqual({ [BUY]: 1000, [second]: 1000 })
  })

  it('reads a quantity that JavaScript prints in exponent form', () => {
    // 0.0000001 prints as "1e-7", which puts an extra hyphen in the id.
    const id = 'revolut-stmt-BTC-buy-2025-01-10T09:00:00.000Z-1e-7-1'
    expect(entries([row('buy', id, -0.05), row('fee', `${id}-fee`, -0.01)])).toEqual({ [id]: 0.01 })
  })

  it('leaves a trade without a fee row out', () => {
    // Revolut charged no fee, so the import stored no fee row.
    expect(entries([row('buy', BUY, -100000)])).toEqual({})
  })

  it('leaves out fees that belong to no trade', () => {
    const transactions = [
      row('fee', `${BUY}-fee`, -1000),                          // its buy was deleted
      row('fee', 'xtb-456', -5, { source: 'xtb_import' }),      // not a trade fee at all
      row('buy', SELL.replace('sell', 'buy'), -100000),
    ]
    expect(entries(transactions)).toEqual({})
  })

  it('does not treat sends, receives, adjustments or fee rows as trades', () => {
    const transactions = [
      row('send', 'revolut-stmt-BTC-send-2025-01-10T09:00:00.000Z-0.5-1', 0),
      row('receive', 'revolut-stmt-BTC-receive-2025-01-10T09:00:00.000Z-0.5-1', 0),
      row('receive', 'revolut-stmt-adjust-BTC-2025-12-31-0.001', 0),
      row('fee', `${BUY}-fee`, -1000),
    ]
    expect(entries(transactions)).toEqual({})
  })

  it('no longer pairs rows from the retired per-transaction import, and does not fail on them', () => {
    const transactions = [
      row('buy', 'revolut-btc-2025-01-10-0.5-100000', -100000),
      row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000),
      row('buy', 'revolut-eth-2021-01-28-0.1-500-5', -500),
      row('fee', 'revolut-eth-fee-2021-01-28-0.1-5', -5),
    ]
    expect(entries(transactions)).toEqual({})
  })

  it('never pairs across accounts', () => {
    const transactions = [
      row('buy', BUY, -100000, { id: 'buy-a', accountId: 'a' }),
      row('fee', `${BUY}-fee`, -1000, { id: 'fee-b', accountId: 'b' }),
    ]
    expect(entries(transactions)).toEqual({})
  })

  it('shares fee rows stored under one id between the trades that point at it', () => {
    // Two trades in different accounts never share; within one account two
    // trades with the same id can only come from hand-edited data. The fees
    // are then split, and add up to exactly the fee rows.
    const transactions = [
      row('buy', BUY, -100000, { id: 'buy-1' }),
      row('buy', BUY, -100000, { id: 'buy-2' }),
      row('fee', `${BUY}-fee`, -1000, { id: 'fee-1' }),
    ]
    expect(entries(transactions)).toEqual({ 'buy-1': 500, 'buy-2': 500 })
  })
})
