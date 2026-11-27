import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '@/types'
import { parseRevolutStatement, type RevolutStatement, type StatementRow } from '@/importers/revolutStatement'
import {
  ADJUSTMENT_NOTE,
  adjustmentTransactions,
  buildStatementTransactions,
  checkStatementHoldings,
  countByCoin,
  newCoinHoldings,
  planStatementRows,
  quantityAsOf,
  storedAmount,
  storedQuantity,
} from '@/importers/revolutStatementImport'
import { HEADER, STATEMENT_PAGES, TX_HEADER } from '@/importers/revolutStatement.fixture'
import { pairTradeFees } from '@/domain/tradeFees'
import { walkPosition, walkSales } from '@/domain/position'
import { getRealizedPnL } from '@/domain/calculations'

const NOW = '2026-01-01T00:00:00.000Z'
const statement = parseRevolutStatement(STATEMENT_PAGES)

function importAll(s: RevolutStatement, log: Transaction[] = [], receiveCosts?: Map<string, number>): Transaction[] {
  const rows = planStatementRows(s, new Set(log.map((t) => t.externalId)))
  return [...log, ...buildStatementTransactions({ rows, statement: s, accountId: 'revolut', receiveCosts, now: NOW })]
}

const row = (fields: Partial<StatementRow>): StatementRow => ({
  page: 1, row: 1, raw: '', symbol: 'BTC', type: 'buy', quantity: 1, price: 100, value: 100, fee: 0, date: '2025-01-05T14:04:12.000Z', ...fields,
})

describe('amounts and quantities', () => {
  it('buy: pays Value − Fee, with the fee as its own row, and receives fewer coins', () => {
    const r = row({ type: 'buy', quantity: 0.025, value: 10000, fee: 100 })
    expect(storedAmount(r)).toBe(-9900)
    expect(storedQuantity(r)).toBe(0.02475) // 0.025 × 9,900 / 10,000
  })

  it('sell: brings in Value + Fee, with the fee as its own row, and sells more coins', () => {
    const r = row({ type: 'sell', quantity: 25, value: 50, fee: 1 })
    expect(storedAmount(r)).toBe(51)
    expect(storedQuantity(r)).toBe(25.5) // 25 × 51 / 50
  })

  it('send: 0 PLN, the quantity as it is', () => {
    const r = row({ type: 'send', quantity: 0.00001, value: 4, fee: 0 })
    expect([storedAmount(r), storedQuantity(r)]).toEqual([0, 0.00001])
  })

  it('receive: costs the statement’s Value unless another cost is given', () => {
    const r = row({ type: 'receive', quantity: 0.005, value: 2000 })
    expect([storedAmount(r), storedQuantity(r)]).toEqual([2000, 0.005])
    expect(storedAmount(r, 1500)).toBe(1500)
  })
})

describe('buildStatementTransactions', () => {
  const log = importAll(statement)

  it('stores each row once, with a fee row for each buy and sell that has a fee', () => {
    const byType = (type: Transaction['type']) => log.filter((t) => t.type === type).length
    expect({ buy: byType('buy'), sell: byType('sell'), send: byType('send'), receive: byType('receive'), fee: byType('fee') })
      .toEqual({ buy: 4, sell: 1, send: 1, receive: 2, fee: 5 })
    expect(log.every((t) => t.source === 'revolut_crypto' && t.accountId === 'revolut')).toBe(true)
  })

  it('pairs every fee with its trade', () => {
    const fees = pairTradeFees(log)
    const btcBuy = log.find((t) => t.type === 'buy' && t.ticker === 'BTC')!
    expect(fees.get(btcBuy.id)).toBe(100)
    expect([...fees.values()].reduce((a, b) => a + b, 0)).toBe(100 + 1 + 1 + 2 + 1)
  })

  it('keeps two identical rows of one statement apart, so both import', () => {
    const ethBuys = log.filter((t) => t.type === 'buy' && t.ticker === 'ETH')
    expect(ethBuys.map((t) => t.externalId)).toEqual([
      expect.stringMatching(/^revolut-stmt-ETH-buy-.+-0\.01-1$/),
      expect.stringMatching(/^revolut-stmt-ETH-buy-.+-0\.01-2$/),
    ])
    expect(log.filter((t) => t.type === 'fee' && t.relatedTicker === 'ETH')).toHaveLength(2)
  })

  it('adds nothing when the same statement, or an overlapping one, is imported again', () => {
    expect(importAll(statement, log)).toEqual(log)
    const overlapping = parseRevolutStatement([
      [
        'Crypto Account Statement',
        'Period Dec 1, 2025 - Dec 31, 2025',
        TX_HEADER,
        'BTC Send 0.01000000 400,000.00 PLN 4,000.00 PLN 0.00 PLN Dec 13, 2025, 4:54:32PM',
        'BTC Buy 0.00100000 400,000.00 PLN 400.00 PLN 4.00 PLN Dec 20, 2025, 4:54:32PM',
      ],
    ])
    const added = importAll(overlapping, log).slice(log.length)
    expect(added.map((t) => t.type)).toEqual(['buy', 'fee'])
  })

  it('uses the cost given for a received row', () => {
    const rows = planStatementRows(statement, new Set())
    const receive = rows.find((r) => r.type === 'receive' && r.symbol === 'BTC')!
    const out = buildStatementTransactions({ rows, statement, accountId: 'revolut', receiveCosts: new Map([[receive.id, 1500]]), now: NOW })
    expect(out.find((t) => t.externalId === receive.id)).toMatchObject({ amountPLN: 1500, affectsCash: false })
  })

  it('counts the rows to import per coin and type', () => {
    expect(countByCoin(planStatementRows(statement, new Set()))).toEqual([
      { symbol: 'BTC', counts: { buy: 1, sell: 0, send: 1, receive: 1 } },
      { symbol: 'ETH', counts: { buy: 2, sell: 0, send: 0, receive: 0 } },
      { symbol: 'XRP', counts: { buy: 1, sell: 1, send: 0, receive: 0 } },
      { symbol: 'ADA', counts: { buy: 0, sell: 0, send: 0, receive: 1 } },
    ])
  })
})

describe('the position walk', () => {
  it('gives cost = the buy’s Value and proceeds = the sale’s Value', () => {
    const pages = [
      [
        ...HEADER,
        TX_HEADER,
        'XRP Buy 100 2.00 PLN 200.00 PLN 2.00 PLN Feb 3, 2025, 12:15:00PM',
        'XRP Sell 25 2.40 PLN 60.00 PLN 1.00 PLN Feb 4, 2025, 7:31:58AM',
      ],
    ]
    const s = parseRevolutStatement(pages)
    const log = importAll(s)
    const fees = pairTradeFees(log)
    const xrp = log.filter((t) => t.ticker === 'XRP')
    // Bought 99 XRP for 200 PLN (198 + 2 fee); sold 25 × 61 / 60 of them for 60 PLN (61 − 1 fee).
    const sold = (25 * 61) / 60
    const sale = [...walkSales(xrp, fees).values()][0]
    expect(sale.proceedsPLN).toBe(60)
    const position = walkPosition(xrp, fees)
    expect(position.quantity).toBeCloseTo(99 - sold, 7)
    expect(position.costPLN + sale.costPLN).toBeCloseTo(200, 8)
    expect(getRealizedPnL(log)).toBeCloseTo(60 - (200 / 99) * sold, 5)
  })
})

describe('holdings check', () => {
  const log = importAll(statement)
  const check = checkStatementHoldings(statement, log, 'revolut')!

  it('compares each coin as of the statement’s end date', () => {
    expect(check.asOf).toBe('2025-12-31')
    expect(check.matching).toEqual(['ADA'])
    expect(check.differences.map((d) => [d.symbol, d.vestly, d.revolut, d.delta])).toEqual([
      ['BTC', 0.01975, 0.02, 0.00025],
      ['ETH', 0.0198, 0.02, 0.0002],
      ['SOL', 0, 2.1, 2.1],
      ['XRP', 73.5, 75, 1.5],
    ])
  })

  it('says why they may differ', () => {
    const why = Object.fromEntries(check.differences.map((d) => [d.symbol, d.reasons]))
    expect(why.BTC).toEqual(['Fees estimated from the statement'])
    expect(why.SOL).toEqual(['Held before the statement’s period', 'Staking rewards left out'])
    expect(why.XRP).toEqual(['A row couldn’t be read', 'Fees estimated from the statement'])
  })

  it('doesn’t blame staking when Vestly holds more', () => {
    const sol: Transaction = { ...log.find((t) => t.ticker === 'ADA' && t.type === 'receive')!, id: 'sol', externalId: 'sol', ticker: 'SOL', instrument: 'Solana', quantity: 5 }
    const d = checkStatementHoldings(statement, [...log, sol], 'revolut')!.differences.find((x) => x.symbol === 'SOL')!
    expect(d.delta).toBeLessThan(0)
    expect(d.reasons).toEqual(['Not explained by the statement’s rows'])
  })

  it('leaves out rows after the end date', () => {
    const later: Transaction = { ...log.find((t) => t.ticker === 'ADA')!, id: 'later', externalId: 'later', date: '2026-02-01T10:00:00.000Z' }
    expect(checkStatementHoldings(statement, [...log, later], 'revolut')!.matching).toEqual(['ADA'])
  })

  it('makes one 0 PLN adjustment per coin that brings it to the closing amount', () => {
    const adjustments = adjustmentTransactions(check.differences, 'revolut', check.asOf, NOW)
    expect(adjustments.map((t) => [t.ticker, t.type, t.quantity, t.amountPLN, t.date])).toEqual([
      ['BTC', 'receive', 0.00025, 0, '2025-12-31T23:59:59.000Z'],
      ['ETH', 'receive', 0.0002, 0, '2025-12-31T23:59:59.000Z'],
      ['SOL', 'receive', 2.1, 0, '2025-12-31T23:59:59.000Z'],
      ['XRP', 'receive', 1.5, 0, '2025-12-31T23:59:59.000Z'],
    ])
    expect(adjustments.every((t) => t.comment === ADJUSTMENT_NOTE && t.affectsCash === false)).toBe(true)

    const after = [...log, ...adjustments]
    const recheck = checkStatementHoldings(statement, after, 'revolut')!
    expect(recheck.differences).toEqual([])
    expect(recheck.matching).toEqual(['ADA', 'BTC', 'ETH', 'SOL', 'XRP'])
  })

  it('removes coins with a send when the log holds more, without realizing anything', () => {
    const more = adjustmentTransactions([{ symbol: 'BTC', name: 'Bitcoin', vestly: 0.03, revolut: 0.02, delta: -0.01, reasons: [] }], 'revolut', '2025-12-31', NOW)
    expect(more[0]).toMatchObject({ type: 'send', quantity: 0.01, amountPLN: 0 })
    expect(getRealizedPnL([...log, ...more])).toBe(getRealizedPnL(log))
  })

  it('an adjustment doesn’t change what was paid', () => {
    const adjustments = adjustmentTransactions(check.differences, 'revolut', check.asOf, NOW)
    const btc = (rows: Transaction[]) => walkPosition(rows.filter((t) => t.ticker === 'BTC'), pairTradeFees(rows)).costPLN
    expect(btc([...log, ...adjustments])).toBeCloseTo(btc(log), 8)
  })

  it('counts coins with no closing amount as unchecked', () => {
    const noClosing = { ...statement, closing: {} }
    expect(checkStatementHoldings(noClosing, log, 'revolut')!.unchecked).toEqual(['ADA', 'BTC', 'ETH', 'XRP'])
  })

  it('reads the walk as of an instant', () => {
    expect(quantityAsOf(log, 'revolut', 'BTC', '2025-01-31T00:00:00.000Z')).toBe(0.02475)
  })
})

describe('newCoinHoldings', () => {
  const account: Account = { id: 'revolut', name: 'Revolut Crypto', type: 'crypto', createdAt: NOW, lastUpdated: NOW, holdings: [] }

  it('creates a crypto holding (exchange CC) for each coin still held, from the walk', () => {
    const log = importAll(statement)
    const holdings = newCoinHoldings(account, log, statement, ['BTC', 'ADA', 'SOL'], NOW)
    expect(holdings.map((h) => [h.ticker, h.name, h.exchange, h.category, h.quantity, h.currentPrice])).toEqual([
      ['BTC', 'Bitcoin', 'CC', 'crypto', 0.01975, 400000],
      ['ADA', 'Cardano', 'CC', 'crypto', 10, 2],
    ])
    // BTC cost: buy 10,000 (9,900 + 100 fee) + receive 2,000 = 12,000 for 0.02975; 0.01 sent at the average.
    expect(holdings[0].purchasePrice).toBeCloseTo(12000 / 0.02975, 6)
    expect(holdings[0].purchaseDate).toBe(log.find((t) => t.type === 'buy' && t.ticker === 'BTC')!.date.slice(0, 10))
  })

  it('skips coins the account already holds', () => {
    const btc = { ...newCoinHoldings(account, importAll(statement), statement, ['BTC'], NOW)[0] }
    expect(newCoinHoldings({ ...account, holdings: [btc] }, importAll(statement), statement, ['BTC'], NOW)).toEqual([])
  })
})
