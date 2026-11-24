import { describe, expect, it } from 'vitest'
import type { Account, Holding, Transaction } from '@/types'
import { applyStatementPrices, checkHoldings, currencyForRate, isHoldingsCheckRow, lotExternalId, missingLots, type HoldingsStatement, type StatementHolding } from './holdingsCheck'

const NOW = '2026-11-01T00:00:00.000Z'
const holding = (id: string, ticker: string, quantity: number, extra: Partial<Holding> = {}): Holding => ({
  id, accountId: 'a', name: `${ticker} Corp`, ticker, category: 'stock', quantity, purchasePrice: 10, currentPrice: 10,
  purchaseDate: '2026-01-01', createdAt: NOW, updatedAt: NOW, ...extra,
})
const account = (holdings: Holding[] = []): Account => ({ id: 'a', name: 'A', type: 'brokerage', createdAt: NOW, lastUpdated: NOW, holdings })
let n = 0
const trade = (type: Transaction['type'], ticker: string, quantity: number, date: string, accountId = 'a'): Transaction => ({
  id: `t${++n}`, accountId, type, date, ticker, quantity, amountPLN: type === 'buy' ? -10 * quantity : 10 * quantity,
  externalId: `t${n}`, source: 'xtb_import', createdAt: NOW,
})
const pos = (key: string, lots: [string, number, number, string][], extra: Partial<StatementHolding> = {}): StatementHolding => ({
  key, ticker: key, name: `${key} Corp`, quantity: lots.reduce((s, l) => s + l[1], 0), category: 'stock',
  lots: lots.map(([positionId, quantity, openPrice, openDate]) => ({ positionId, quantity, openPrice, openDate })), ...extra,
})
const statement = (...holdings: StatementHolding[]): HoldingsStatement => ({ asOf: '2026-11-20T12:00:00.000Z', holdings })

describe('checkHoldings', () => {
  it('compares per instrument: lots XTB merged still match their purchases', () => {
    const t = [trade('buy', 'ACME', 1.5, '2026-01-05T10:00:00.000Z'), trade('buy', 'ACME', 0.25, '2026-02-05T10:00:00.000Z')]
    const r = checkHoldings(statement(pos('ACME', [['1', 1.75, 10.4, '2026-01-05T10:00:00.000Z']])), account(), t)
    expect(r.differences).toEqual([])
    expect(r.matching).toHaveLength(1)
  })

  it('fractional sums are equal within float noise', () => {
    const t = [0.1, 0.2, 0.3].map((q, i) => trade('buy', 'ACME', q, `2026-01-0${i + 1}T10:00:00.000Z`))
    const r = checkHoldings(statement(pos('ACME', [['1', 0.6, 10, '2026-01-01T10:00:00.000Z']])), account(), t)
    expect(r.differences).toEqual([])
  })

  it('Vestly’s side is the walk of this account’s transactions, sales included, not other accounts’', () => {
    const t = [
      trade('buy', 'ACME', 10, '2026-01-01T10:00:00.000Z'),
      trade('sell', 'ACME', 4, '2026-02-01T10:00:00.000Z'),
      trade('buy', 'ACME', 100, '2026-01-01T10:00:00.000Z', 'other'),
    ]
    const r = checkHoldings(statement(pos('ACME', [['1', 6, 10, '2026-01-01T10:00:00.000Z']])), account([holding('h', 'ACME', 99)]), t)
    expect(r.differences).toEqual([])
    expect(r.matching[0].holdings.map((h) => h.id)).toEqual(['h'])
  })

  it('free shares need all three: nothing held, no purchase, open price about 0', () => {
    const free = pos('SPIN', [['1', 3, 0, '2026-02-16T05:00:00.000Z']])
    expect(checkHoldings(statement(free), account(), []).differences[0].kind).toBe('free_shares')
    // Bought before, sold out since: a purchase exists, so it's not free.
    const t = [trade('buy', 'SPIN', 1, '2026-01-01T10:00:00.000Z'), trade('sell', 'SPIN', 1, '2026-01-02T10:00:00.000Z')]
    expect(checkHoldings(statement(free), account(), t).differences[0].kind).toBe('broker_more')
    // A real open price: missing history, not free shares.
    expect(checkHoldings(statement(pos('SPIN', [['1', 3, 5, '2026-02-16T05:00:00.000Z']])), account(), []).differences[0])
      .toMatchObject({ kind: 'broker_more', vestlyQuantity: 0, missing: 3 })
  })

  it('a holding XTB doesn’t show: offered to close only when there is one open holding for it', () => {
    const t = [trade('buy', 'FOOI', 5, '2026-01-01T10:00:00.000Z')]
    expect(checkHoldings(statement(), account([holding('h', 'FOOI', 5)]), t).differences)
      .toEqual([{ kind: 'gone', key: 'FOOI', name: 'FOOI Corp', vestlyQuantity: 5, holding: expect.objectContaining({ id: 'h' }) }])
    expect(checkHoldings(statement(), account(), t).differences[0]).toMatchObject({ kind: 'gone', holding: undefined })
  })

  it('positions with nothing held, bond lots and hand-entered holdings with no history are not “gone”', () => {
    const t = [trade('buy', 'OLD', 5, '2026-01-01T10:00:00.000Z'), trade('sell', 'OLD', 5, '2026-01-02T10:00:00.000Z')]
    const r = checkHoldings(statement(), account([holding('b', 'EDO0336', 10, { category: 'bond' }), holding('m', 'MANU', 3)]), t)
    expect(r.differences).toEqual([])
  })

  it('Vestly holds more: informational, with the extra units', () => {
    const t = [trade('buy', 'MUST', 5, '2026-01-01T10:00:00.000Z')]
    expect(checkHoldings(statement(pos('MUST', [['1', 3, 12, '2026-01-01T10:00:00.000Z']])), account(), t).differences[0])
      .toMatchObject({ kind: 'vestly_more', vestlyQuantity: 5, extra: 2 })
  })
})

describe('missingLots', () => {
  const s = pos('SMPL', [['a', 4, 2.5, '2026-02-09T23:59:59.999Z'], ['b', 2, 2.4, '2026-01-20T13:00:00.000Z']])
  const bought = [trade('buy', 'SMPL', 4, '2026-02-09T23:59:59.999Z')]

  it('the lots no purchase is dated at, when they hold exactly the missing units', () => {
    expect(missingLots(s, bought, 2)).toEqual([s.lots[1]])
  })

  it('otherwise one lot at the weighted-average open price of the unexplained lots', () => {
    expect(missingLots(s, bought, 1)).toEqual([{ positionId: 'b', quantity: 1, openPrice: 2.4, openDate: '2026-01-20T13:00:00.000Z' }])
    const merged = pos('X', [['m', 6, 2.45, '2026-01-20T13:00:00.000Z']])
    const r = missingLots(merged, [trade('buy', 'X', 4, '2026-01-20T13:00:00.000Z')], 2)
    expect(r).toEqual([{ positionId: 'm', quantity: 2, openPrice: 2.45, openDate: '2026-01-20T13:00:00.000Z' }])
  })
})

describe('applyStatementPrices', () => {
  it('saves the statement’s PLN price and category on matching holdings only', () => {
    const accounts = [account([holding('h1', 'EXGL', 1), holding('h2', 'ACME', 1)]), { ...account([holding('o', 'EXGL', 1)]), id: 'b' }]
    const s = pos('EXGL', [['1', 1, 400, NOW]], { category: 'etf', currentPricePLN: 1742.5 })
    const next = applyStatementPrices(accounts, 'a', [{ statement: s, holdings: [accounts[0].holdings[0]] }], '2026-11-24T00:00:00.000Z')
    expect(next[0].holdings[0]).toMatchObject({ currentPrice: 1742.5, category: 'etf', updatedAt: '2026-11-24T00:00:00.000Z' })
    expect(next[0].holdings[1]).toBe(accounts[0].holdings[1])
    expect(next[1]).toBe(accounts[1])
  })
})

describe('currencyForRate', () => {
  const table = new Map([['USD', 3.65], ['EUR', 4.24], ['GBP', 4.9], ['CHF', 4.55]])
  it.each([
    [1.0, { currency: 'PLN', divisor: 1 }],
    [3.6, { currency: 'USD', divisor: 1 }],
    [4.27, { currency: 'EUR', divisor: 1 }],
    [4.5, { currency: 'CHF', divisor: 1 }],
    [0.049, { currency: 'GBP', divisor: 100 }],
    [2.0, null],
  ])('rate %s', (rate, expected) => {
    expect(currencyForRate(rate, table)).toEqual(expected)
  })
})

describe('isHoldingsCheckRow', () => {
  it('is true for a row the check added, and false for an imported row', () => {
    const added = { ...trade('receive', 'SPIN', 3, NOW), externalId: lotExternalId({ positionId: '7', quantity: 3, openPrice: 0, openDate: NOW }) }
    expect(isHoldingsCheckRow(added)).toBe(true)
    expect(isHoldingsCheckRow(trade('buy', 'ACME', 1, NOW))).toBe(false)
  })
})
