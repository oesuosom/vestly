import { describe, it, expect } from 'vitest'
import type { Transaction } from '@/types'
import { pairTradeFees } from './tradeFees'

// ─── Helpers ───────────────────────────────────────────────────────────────────
// The externalIds below are written out the way the Revolut parsers build them
// (revolutBtcParser.ts, revolutCryptoParser.ts). The row's `id` is its externalId
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

describe('pairTradeFees', () => {
  it('returns nothing when there are no separately stored fees', () => {
    expect(entries([])).toEqual({})
    expect(entries([row('buy', 'xtb-123', -1000, { source: 'xtb_import' })])).toEqual({})
  })

  it('pairs a BTC buy with its fee — the buy id carries the amount, the fee id does not', () => {
    const transactions = [
      row('buy', 'revolut-btc-2025-01-10-0.5-100000', -100000),
      row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000),
    ]
    expect(entries(transactions)).toEqual({ 'revolut-btc-2025-01-10-0.5-100000': 1000 })
  })

  it('pairs a BTC sale with its own fee, not with a buy fee of the same day and quantity', () => {
    const transactions = [
      row('buy', 'revolut-btc-2025-01-10-0.5-100000', -100000),
      row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000),
      row('sell', 'revolut-btc-sell-2025-01-10-0.5-150000', 150000),
      row('fee', 'revolut-btc-sell-fee-2025-01-10-0.5', -1500),
    ]
    expect(entries(transactions)).toEqual({
      'revolut-btc-2025-01-10-0.5-100000': 1000,
      'revolut-btc-sell-2025-01-10-0.5-150000': 1500,
    })
  })

  it('pairs an ETH buy with its fee — both ids carry the fee, only the buy id carries the amount', () => {
    const transactions = [
      row('buy', 'revolut-eth-2021-01-28-0.00387433-19.49-0.49', -19.49),
      row('fee', 'revolut-eth-fee-2021-01-28-0.00387433-0.49', -0.49),
    ]
    expect(entries(transactions)).toEqual({ 'revolut-eth-2021-01-28-0.00387433-19.49-0.49': 0.49 })
  })

  it('keeps two ETH buys of the same day and quantity apart when their fees differ', () => {
    const transactions = [
      row('buy', 'revolut-eth-2021-01-28-0.1-500-5', -500),
      row('fee', 'revolut-eth-fee-2021-01-28-0.1-5', -5),
      row('buy', 'revolut-eth-2021-01-28-0.1-510-5.1', -510),
      row('fee', 'revolut-eth-fee-2021-01-28-0.1-5.1', -5.1),
    ]
    expect(entries(transactions)).toEqual({
      'revolut-eth-2021-01-28-0.1-500-5': 5,
      'revolut-eth-2021-01-28-0.1-510-5.1': 5.1,
    })
  })

  it('reads a quantity that JavaScript prints in exponent form', () => {
    // 0.0000001 prints as "1e-7", which puts an extra hyphen in the id.
    const transactions = [
      row('buy', 'revolut-btc-2025-01-10-1e-7-0.05', -0.05),
      row('fee', 'revolut-btc-fee-2025-01-10-1e-7', -0.01),
    ]
    expect(entries(transactions)).toEqual({ 'revolut-btc-2025-01-10-1e-7-0.05': 0.01 })
  })

  it('leaves a trade without a fee row out', () => {
    // Revolut charged no fee, so the parser stored no fee row.
    expect(entries([row('buy', 'revolut-btc-2025-01-10-0.5-100000', -100000)])).toEqual({})
  })

  it('leaves out fees that belong to no trade', () => {
    const transactions = [
      row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000),            // its buy was deleted
      row('fee', 'xtb-456', -5, { source: 'xtb_import' }),            // not a trade fee at all
      row('buy', 'revolut-btc-2025-02-10-0.5-100000', -100000, { date: '2025-02-10T00:00:00.000Z' }),
    ]
    expect(entries(transactions)).toEqual({})
  })

  it('does not treat sends, receives or fee rows as trades', () => {
    const transactions = [
      row('send', 'revolut-btc-send-2025-01-10-0.5', 0),
      row('receive', 'revolut-btc-receive-2025-01-10-0.5', 0),
      row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000),
    ]
    expect(entries(transactions)).toEqual({})
  })

  it('never pairs across accounts', () => {
    const transactions = [
      row('buy', 'revolut-btc-2025-01-10-0.5-100000', -100000, { id: 'buy-a', accountId: 'a' }),
      row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000, { id: 'fee-b', accountId: 'b' }),
    ]
    expect(entries(transactions)).toEqual({})
  })

  describe('several trades behind one fee id', () => {
    // Two BTC buys of the same quantity on the same day have different buy ids
    // (the amounts differ) but the same fee id.
    const buys = [
      row('buy', 'revolut-btc-2025-01-10-0.5-100000', -100000),
      row('buy', 'revolut-btc-2025-01-10-0.5-101000', -101000),
    ]

    it('splits the fees evenly when both fee rows were stored', () => {
      const transactions = [
        ...buys,
        row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000, { id: 'fee-1' }),
        row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1010, { id: 'fee-2' }),
      ]
      // (1,000 + 1,010) / 2 = 1,005 each; 2,010 in total, the same as the fee rows.
      expect(entries(transactions)).toEqual({
        'revolut-btc-2025-01-10-0.5-100000': 1005,
        'revolut-btc-2025-01-10-0.5-101000': 1005,
      })
    })

    it('shares a single stored fee row rather than counting it once per trade', () => {
      // Imported in two goes, the second fee row is dropped as a duplicate id.
      const transactions = [...buys, row('fee', 'revolut-btc-fee-2025-01-10-0.5', -1000)]
      // 1,000 / 2 = 500 each; 1,000 in total, not 2,000.
      expect(entries(transactions)).toEqual({
        'revolut-btc-2025-01-10-0.5-100000': 500,
        'revolut-btc-2025-01-10-0.5-101000': 500,
      })
    })
  })
})
