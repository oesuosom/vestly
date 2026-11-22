import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/types'
import { computeAccountCashBalance } from '@/domain/calculations'
import { buildCashLedger, latestCashChanges, uncountedCashTransactions } from '@/domain/cashLedger'

let n = 0
function tx(fields: Partial<Transaction>): Transaction {
  n += 1
  return {
    id: `t${n}`, accountId: 'acc1', type: 'deposit', date: '2026-01-01', amountPLN: 100,
    externalId: `x${n}`, source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', ...fields,
  }
}

describe('buildCashLedger', () => {
  const log = [
    tx({ type: 'deposit', amountPLN: 1000 }),
    tx({ type: 'deposit', amountPLN: 500 }),
    tx({ type: 'withdrawal', amountPLN: -200 }),
    tx({ type: 'buy', amountPLN: -300, quantity: 2 }),
    tx({ type: 'sell', amountPLN: 120 }),
    tx({ type: 'dividend', amountPLN: 10 }),
    tx({ type: 'interest', amountPLN: 2.5 }),
    tx({ type: 'withholding_tax', amountPLN: -1.5 }),
    tx({ type: 'interest_tax', amountPLN: -0.48 }),
    tx({ type: 'fee', amountPLN: -4 }),
    // Not cash: an eMakler buy, and another account's deposit.
    tx({ type: 'buy', amountPLN: -999, source: 'emakler_import' }),
    tx({ type: 'deposit', amountPLN: 777, accountId: 'acc2' }),
  ]

  it('counts and sums each kind, grouping income and taxes', () => {
    const { rows } = buildCashLedger(log, 'acc1')
    expect(rows.map((r) => [r.label, r.count, Number(r.amountPLN.toFixed(2))])).toEqual([
      ['Deposits', 2, 1500],
      ['Withdrawals', 1, -200],
      ['Buys', 1, -300],
      ['Sales', 1, 120],
      ['Dividends & interest', 2, 12.5],
      ['Taxes', 2, -1.98],
      ['Fees', 1, -4],
    ])
  })

  it('totals to the account balance', () => {
    const ledger = buildCashLedger(log, 'acc1')
    expect(ledger.count).toBe(10)
    expect(ledger.totalPLN).toBe(computeAccountCashBalance(log, 'acc1'))
    expect(ledger.rows.reduce((s, r) => s + r.amountPLN, 0)).toBeCloseTo(ledger.totalPLN, 10)
  })

  it('leaves out kinds with no transactions', () => {
    const ledger = buildCashLedger([tx({ type: 'buy', amountPLN: -50 })], 'acc1')
    expect(ledger.rows.map((r) => r.kind)).toEqual(['buys'])
  })

  it('is empty for an account with no cash transactions', () => {
    expect(buildCashLedger([tx({ type: 'buy', source: 'emakler_import' })], 'acc1'))
      .toEqual({ rows: [], count: 0, totalPLN: 0 })
  })

  it('follows a row’s own affectsCash flag', () => {
    const ledger = buildCashLedger([tx({ type: 'buy', amountPLN: -80, affectsCash: false })], 'acc1')
    expect(ledger.rows).toEqual([])
  })
})

describe('latestCashChanges', () => {
  it('returns up to ten cash transactions, newest first', () => {
    // Twelve cash rows, January to December, in a shuffled order.
    const months = [3, 11, 1, 7, 12, 5, 9, 2, 10, 4, 8, 6]
    const log = [
      ...months.map((m) => tx({ date: `2026-${String(m).padStart(2, '0')}-01` })),
      tx({ date: '2026-12-31', source: 'bond_holding' }),
      tx({ date: '2026-12-31', accountId: 'acc2' }),
    ]
    expect(latestCashChanges(log, 'acc1').map((t) => t.date.slice(5, 7))).toEqual([
      '12', '11', '10', '09', '08', '07', '06', '05', '04', '03',
    ])
  })

  it('takes another limit', () => {
    const log = [tx({ date: '2026-01-01' }), tx({ date: '2026-02-01T10:00:00.000Z' }), tx({ date: '2026-03-01' })]
    expect(latestCashChanges(log, 'acc1', 2).map((t) => t.date.slice(0, 10))).toEqual(['2026-03-01', '2026-02-01'])
  })

  it('does not reorder the log it is given', () => {
    const log = [tx({ date: '2026-01-01' }), tx({ date: '2026-02-01' })]
    latestCashChanges(log, 'acc1')
    expect(log.map((t) => t.date)).toEqual(['2026-01-01', '2026-02-01'])
  })
})

describe('uncountedCashTransactions', () => {
  it('is null when every transaction moves cash', () => {
    expect(uncountedCashTransactions([tx({})], 'acc1')).toBeNull()
  })

  it('names eMakler imports', () => {
    const log = [tx({ type: 'buy', source: 'emakler_import' }), tx({ type: 'buy', source: 'emakler_import' })]
    expect(uncountedCashTransactions(log, 'acc1')).toEqual({ count: 2, source: 'emakler_import' })
  })

  it('names bond holdings', () => {
    expect(uncountedCashTransactions([tx({ type: 'buy', source: 'bond_holding' })], 'acc1'))
      .toEqual({ count: 1, source: 'bond_holding' })
  })

  it('falls back to other for a mix or another source', () => {
    const mix = [tx({ type: 'buy', source: 'emakler_import' }), tx({ type: 'buy', source: 'bond_holding' })]
    expect(uncountedCashTransactions(mix, 'acc1')).toEqual({ count: 2, source: 'other' })
    const flagged = [tx({ type: 'buy', affectsCash: false })]
    expect(uncountedCashTransactions(flagged, 'acc1')).toEqual({ count: 1, source: 'other' })
  })

  it('only looks at the given account', () => {
    expect(uncountedCashTransactions([tx({ source: 'emakler_import', accountId: 'acc2' })], 'acc1')).toBeNull()
  })
})
