import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '@/types'
import { parseRevolutStatement, type RevolutStatement, type StatementRow } from '@/importers/revolutStatement'
import {
  ADJUSTMENT_NOTE,
  adjustmentTransactions,
  buildStatementTransactions,
  checkStatementHoldings,
  closedCoinHoldings,
  coinFlows,
  round8,
  countByCoin,
  newCoinHoldings,
  planStatementRows,
  quantityAsOf,
  storedAmount,
  storedQuantity,
} from '@/importers/revolutStatementImport'
import { HEADER, STATEMENT_PAGES, TX_HEADER } from '@/importers/revolutStatement.fixture'
import { pairTradeFees } from '@/domain/tradeFees'
import { walkClosingSales, walkPosition, walkSales } from '@/domain/position'
import { getRealizedPnL } from '@/domain/calculations'
import { closedPositionResult } from '@/domain/closePosition'

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
  it('buy, fee taken out: pays Value − Fee, with the fee as its own row, and receives fewer coins', () => {
    const r = row({ type: 'buy', quantity: 0.025, value: 10000, fee: 100 })
    expect(storedAmount(r, 'out')).toBe(-9900)
    expect(storedQuantity(r, 'out')).toBe(0.02475) // 0.025 × 9,900 / 10,000
  })

  it('buy, fee on top: pays Value, with the fee as its own row, and receives Quantity', () => {
    const r = row({ type: 'buy', quantity: 0.025, value: 10000, fee: 100 })
    expect(storedAmount(r, 'top')).toBe(-10000)
    expect(storedQuantity(r, 'top')).toBe(0.025)
  })

  it('sell, fee taken out: brings in Value + Fee, with the fee as its own row, and sells more coins', () => {
    const r = row({ type: 'sell', quantity: 25, value: 50, fee: 1 })
    expect(storedAmount(r, 'out')).toBe(51)
    expect(storedQuantity(r, 'out')).toBe(25.5) // 25 × 51 / 50
  })

  it('sell, fee on top ("sell all"): brings in Value, with the fee as its own row, and sells Quantity', () => {
    const r = row({ type: 'sell', quantity: 25, value: 50, fee: 1 })
    expect(storedAmount(r, 'top')).toBe(50)
    expect(storedQuantity(r, 'top')).toBe(25)
  })

  it('send: 0 PLN, the quantity as it is', () => {
    const r = row({ type: 'send', quantity: 0.00001, value: 4, fee: 0 })
    expect([storedAmount(r), storedQuantity(r)]).toEqual([0, 0.00001])
  })

  it('receive: costs the statement’s Value unless another cost is given', () => {
    const r = row({ type: 'receive', quantity: 0.005, value: 2000 })
    expect([storedAmount(r), storedQuantity(r)]).toEqual([2000, 0.005])
    expect(storedAmount(r, 'out', 1500)).toBe(1500)
  })
})

describe('buildStatementTransactions', () => {
  const log = importAll(statement)

  it('stores each row once, with a fee row for each buy and sell that has a fee', () => {
    const byType = (type: Transaction['type']) => log.filter((t) => t.type === type).length
    expect({ buy: byType('buy'), sell: byType('sell'), send: byType('send'), receive: byType('receive'), fee: byType('fee') })
      .toEqual({ buy: 5, sell: 2, send: 1, receive: 2, fee: 7 })
    expect(log.every((t) => t.source === 'revolut_crypto' && t.accountId === 'revolut')).toBe(true)
  })

  it('pairs every fee with its trade', () => {
    const fees = pairTradeFees(log)
    const btcBuy = log.find((t) => t.type === 'buy' && t.ticker === 'BTC')!
    expect(fees.get(btcBuy.id)).toBe(100)
    expect([...fees.values()].reduce((a, b) => a + b, 0)).toBe(100 + 1 + 1 + 2 + 1 + 1 + 1)
  })

  it('keeps two identical rows of one statement apart, so both import', () => {
    const ethBuys = log.filter((t) => t.type === 'buy' && t.ticker === 'ETH')
    expect(ethBuys.map((t) => t.externalId)).toEqual([
      expect.stringMatching(/^revolut-stmt-ETH-buy-.+-0\.01-1$/),
      expect.stringMatching(/^revolut-stmt-ETH-buy-.+-0\.01-2$/),
    ])
    expect(log.filter((t) => t.type === 'fee' && t.relatedTicker === 'ETH')).toHaveLength(2)
    // Account summary counts 0.0199 ETH in: one buy had the fee on top, the other taken out.
    expect(ethBuys.map((t) => [t.amountPLN, t.quantity])).toEqual([[-100, 0.01], [-99, 0.0099]])
  })

  it('stores each buy and sell by the fee method its coin’s totals call for', () => {
    const rows = planStatementRows(statement, new Set())
    expect(rows.filter((r) => r.feeMethod).map((r) => `${r.symbol} ${r.type} ${r.feeMethod}`)).toEqual([
      'BTC buy top', 'ETH buy top', 'ETH buy out', 'XRP buy out', 'XRP sell top', 'DOT buy top', 'DOT sell top',
    ])
    expect(rows.filter((r) => r.type === 'send' || r.type === 'receive').every((r) => r.feeMethod === undefined)).toBe(true)
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
      { symbol: 'DOT', counts: { buy: 1, sell: 1, send: 0, receive: 0 } },
      { symbol: 'ADA', counts: { buy: 0, sell: 0, send: 0, receive: 1 } },
    ])
  })
})

describe('the position walk', () => {
  it('fee on top: cost = Value + Fee and proceeds = Value − Fee', () => {
    const pages = [
      [
        ...HEADER,
        'Account summary',
        'XRP XRP 25 XRP 100 XRP',
        TX_HEADER,
        'XRP Buy 100 2.00 PLN 200.00 PLN 2.00 PLN Feb 3, 2025, 12:15:00PM',
        'XRP Sell 25 2.40 PLN 60.00 PLN 1.00 PLN Feb 4, 2025, 7:31:58AM',
      ],
    ]
    const s = parseRevolutStatement(pages)
    expect(planStatementRows(s, new Set()).map((r) => r.feeMethod)).toEqual(['top', 'top'])
    const log = importAll(s)
    const fees = pairTradeFees(log)
    const xrp = log.filter((t) => t.ticker === 'XRP')
    const sale = [...walkSales(xrp, fees).values()][0]
    expect(sale.proceedsPLN).toBe(59)
    const position = walkPosition(xrp, fees)
    expect(position.quantity).toBe(75)
    expect(position.costPLN + sale.costPLN).toBeCloseTo(202, 8)
    expect(getRealizedPnL(log)).toBeCloseTo(59 - (202 / 100) * 25, 8)
  })

  it('fee taken out: cost = the buy’s Value and proceeds = the sale’s Value', () => {
    const pages = [
      [
        ...HEADER,
        TX_HEADER,
        'XRP Buy 100 2.00 PLN 200.00 PLN 2.00 PLN Feb 3, 2025, 12:15:00PM',
        'XRP Sell 25 2.40 PLN 60.00 PLN 1.00 PLN Feb 4, 2025, 7:31:58AM',
      ],
    ]
    // No Account summary: each row follows its clue, and these have none, so the fee was taken out.
    const s = parseRevolutStatement(pages)
    expect(planStatementRows(s, new Set()).map((r) => r.feeMethod)).toEqual(['out', 'out'])
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
    // BTC, ETH and DOT match once their fees are read the way their totals call for.
    expect(check.matching).toEqual(['ADA', 'BTC', 'DOT', 'ETH'])
    expect(check.differences.map((d) => [d.symbol, d.vestly, d.revolut, d.delta])).toEqual([
      ['SOL', 0, 2.1, 2.1],
      ['XRP', 74, 77.5, 3.5],
    ])
  })

  it('gives one short reason per coin, with the details in a tooltip', () => {
    const why = Object.fromEntries(check.differences.map((d) => [d.symbol, [d.reason, d.detail]]))
    expect(why.SOL).toEqual(['Held before the period', 'Staking left out. Coins in 0 vs Revolut’s 0,1'])
    // The unread row is in Revolut's total, so no split of the buy's fee method adds up.
    expect(why.XRP).toEqual(['Unreadable row', 'Couldn’t tell how fees were charged on 1 buy. Coins in 99 vs Revolut’s 102,5'])
  })

  it('compares the rows’ coins in and out with Account summary’s amount in and out, for every coin', () => {
    expect(check.flows.BTC).toEqual({ in: { vestly: 0.03, revolut: 0.03 }, out: { vestly: 0.01, revolut: 0.01 } })
    expect(check.flows.ETH).toEqual({ in: { vestly: 0.0199, revolut: 0.0199 }, out: { vestly: 0, revolut: 0 } })
    expect(check.flows.DOT).toEqual({ in: { vestly: 20, revolut: 20 }, out: { vestly: 20, revolut: 20 } })
    expect(check.flows.XRP).toEqual({ in: { vestly: 99, revolut: 102.5 }, out: { vestly: 25, revolut: 25 } })
    // Read the other way, DOT's fees would show as a difference in and out.
    expect(round8((20 * 121) / 120)).not.toBe(20)
    expect(coinFlows({ ...statement, summary: {} }, 'BTC')).toBeUndefined()
  })

  it('doesn’t blame staking when Vestly holds more', () => {
    const sol: Transaction = { ...log.find((t) => t.ticker === 'ADA' && t.type === 'receive')!, id: 'sol', externalId: 'sol', ticker: 'SOL', instrument: 'Solana', quantity: 5 }
    const d = checkStatementHoldings(statement, [...log, sol], 'revolut')!.differences.find((x) => x.symbol === 'SOL')!
    expect(d.delta).toBeLessThan(0)
    expect(d.reason).toBe('Doesn’t match the statement')
    expect(d.detail).toBe('Coins in 0 vs Revolut’s 0,1')
  })

  it('leaves out rows after the end date', () => {
    const later: Transaction = { ...log.find((t) => t.ticker === 'ADA')!, id: 'later', externalId: 'later', date: '2026-02-01T10:00:00.000Z' }
    expect(checkStatementHoldings(statement, [...log, later], 'revolut')!.matching).toEqual(['ADA', 'BTC', 'DOT', 'ETH'])
  })

  it('makes one 0 PLN adjustment per coin that brings it to the closing amount', () => {
    const adjustments = adjustmentTransactions(check.differences, 'revolut', check.asOf, NOW)
    expect(adjustments.map((t) => [t.ticker, t.type, t.quantity, t.amountPLN, t.date])).toEqual([
      ['SOL', 'receive', 2.1, 0, '2025-12-31T23:59:59.000Z'],
      ['XRP', 'receive', 3.5, 0, '2025-12-31T23:59:59.000Z'],
    ])
    expect(adjustments.every((t) => t.comment === ADJUSTMENT_NOTE && t.affectsCash === false)).toBe(true)

    const after = [...log, ...adjustments]
    const recheck = checkStatementHoldings(statement, after, 'revolut')!
    expect(recheck.differences).toEqual([])
    expect(recheck.matching).toEqual(['ADA', 'BTC', 'DOT', 'ETH', 'SOL', 'XRP'])
  })

  it('removes coins with a send when the log holds more, without realizing anything', () => {
    const more = adjustmentTransactions([{ symbol: 'BTC', name: 'Bitcoin', vestly: 0.03, revolut: 0.02, delta: -0.01, reason: 'Doesn’t match the statement', detail: '' }], 'revolut', '2025-12-31', NOW)
    expect(more[0]).toMatchObject({ type: 'send', quantity: 0.01, amountPLN: 0 })
    expect(getRealizedPnL([...log, ...more])).toBe(getRealizedPnL(log))
  })

  it('an adjustment doesn’t change what was paid', () => {
    const adjustments = adjustmentTransactions(check.differences, 'revolut', check.asOf, NOW)
    const xrp = (rows: Transaction[]) => walkPosition(rows.filter((t) => t.ticker === 'XRP'), pairTradeFees(rows)).costPLN
    expect(xrp([...log, ...adjustments])).toBeCloseTo(xrp(log), 8)
  })

  it('counts coins with no closing amount as unchecked', () => {
    const noClosing = { ...statement, closing: {} }
    expect(checkStatementHoldings(noClosing, log, 'revolut')!.unchecked).toEqual(['ADA', 'BTC', 'DOT', 'ETH', 'XRP'])
  })

  it('reads the walk as of an instant', () => {
    expect(quantityAsOf(log, 'revolut', 'BTC', '2025-01-31T00:00:00.000Z')).toBe(0.025)
  })
})

describe('newCoinHoldings', () => {
  const account: Account = { id: 'revolut', name: 'Revolut Crypto', type: 'crypto', createdAt: NOW, lastUpdated: NOW, holdings: [] }

  it('creates a crypto holding (exchange CC) for each coin still held, from the walk', () => {
    const log = importAll(statement)
    const holdings = newCoinHoldings(account, log, statement, ['BTC', 'ADA', 'SOL'], NOW)
    expect(holdings.map((h) => [h.ticker, h.name, h.exchange, h.category, h.quantity, h.currentPrice])).toEqual([
      ['BTC', 'Bitcoin', 'CC', 'crypto', 0.02, 400000],
      ['ADA', 'Cardano', 'CC', 'crypto', 10, 2],
    ])
    // BTC cost: buy 10,100 (10,000 + 100 fee on top) + receive 2,000 = 12,100 for 0.03; 0.01 sent at the average.
    expect(holdings[0].purchasePrice).toBeCloseTo(12100 / 0.03, 6)
    expect(holdings[0].purchaseDate).toBe(log.find((t) => t.type === 'buy' && t.ticker === 'BTC')!.date.slice(0, 10))
  })

  it('skips coins the account already holds', () => {
    const btc = { ...newCoinHoldings(account, importAll(statement), statement, ['BTC'], NOW)[0] }
    expect(newCoinHoldings({ ...account, holdings: [btc] }, importAll(statement), statement, ['BTC'], NOW)).toEqual([])
  })
})

describe('closedCoinHoldings', () => {
  const account: Account = { id: 'revolut', name: 'Revolut Crypto', type: 'crypto', createdAt: NOW, lastUpdated: NOW, holdings: [] }
  const log = importAll(statement)
  const closed = closedCoinHoldings(account, log, statement, ['BTC', 'DOT', 'SOL'], NOW)

  it('keeps a coin sold out during the statement as a closed holding, on the day of its last sale', () => {
    const sale = log.find((t) => t.type === 'sell' && t.ticker === 'DOT')!
    expect(closed.map((h) => [h.ticker, h.name, h.exchange, h.category, h.quantity, h.closedAt])).toEqual([
      ['DOT', 'Polkadot', 'CC', 'crypto', 20, sale.date.slice(0, 10)],
    ])
    // 20 DOT for 101 PLN (100 + 1 fee on top).
    expect(closed[0].purchasePrice).toBeCloseTo(101 / 20, 8)
  })

  it('reads its result from the walk, so it agrees with realized profit', () => {
    const result = closedPositionResult(closed[0], log)!
    expect(result.result.proceedsPLN + result.result.costPLN).toBeGreaterThan(0)
    const dotOnly = log.filter((t) => t.ticker === 'DOT' || t.relatedTicker === 'DOT')
    expect(result.result.profitPLN).toBeCloseTo(getRealizedPnL(dotOnly), 8)
  })

  it('skips coins still held, coins with an open holding and coins already closed that day', () => {
    expect(closedCoinHoldings({ ...account, closedHoldings: closed }, log, statement, ['DOT'], NOW)).toEqual([])
    const open = { ...closed[0], closedAt: undefined }
    expect(closedCoinHoldings({ ...account, holdings: [open] }, log, statement, ['DOT'], NOW)).toEqual([])
  })
})

describe('rounding leftovers', () => {
  // Made-up LTC rows. The buy's fee was taken out: the statement says 1.00 PLN, Revolut
  // charged a grosz more, so 9.899 LTC arrived, not 9.9. The sale sold all of them.
  const BUY = 'LTC Buy 10 10.00 PLN 100.00 PLN 1.00 PLN Feb 1, 2025, 9:00:00AM'
  const SELL_ALL = 'LTC Sell 9.899 12.00 PLN 118.79 PLN 1.19 PLN Mar 1, 2025, 9:00:00AM'
  const account: Account = { id: 'revolut', name: 'Revolut Crypto', type: 'crypto', createdAt: NOW, lastUpdated: NOW, holdings: [] }
  const statementOf = (summary: string[], rows: string[]) =>
    parseRevolutStatement([[...HEADER, 'Account summary', ...summary, TX_HEADER, ...rows]])

  it('folds into the sale that empties a coin, which then closes on its own day with its own result', () => {
    const s = statementOf(['LTC Litecoin 9.899 LTC 9.899 LTC'], [BUY, SELL_ALL])
    const rows = planStatementRows(s, new Set())
    expect(rows.map((r) => [r.type, r.feeMethod, r.storedQuantity])).toEqual([['buy', 'out', 9.9], ['sell', 'top', 9.9]])
    const log = importAll(s)

    const check = checkStatementHoldings(s, log, 'revolut')!
    expect(check).toMatchObject({ matching: ['LTC'], differences: [] })

    const sale = log.find((t) => t.type === 'sell')!
    const [closed] = closedCoinHoldings(account, log, s, ['LTC'], NOW)
    expect(closed.closedAt).toBe(sale.date.slice(0, 10))
    // Cost: 99 + 1 fee. Proceeds: 118.79 − 1.19 fee, the fee added on top of a "sell all".
    const result = closedPositionResult(closed, log)!.result
    expect(result.costPLN).toBeCloseTo(100, 8)
    expect(result.proceedsPLN).toBeCloseTo(117.6, 8)
    expect(result.profitPLN).toBeCloseTo(17.6, 8)
  })

  it('folds into the last buy of a coin still held, so it matches without an adjustment', () => {
    const s = statementOf(['9.89900000 LTC', 'LTC Litecoin 0 LTC 9.899 LTC'], [BUY])
    expect(planStatementRows(s, new Set())[0].storedQuantity).toBe(9.899)
    const log = importAll(s)
    expect(checkStatementHoldings(s, log, 'revolut')).toMatchObject({ matching: ['LTC'], differences: [] })
    // Never a PLN amount: the buy still cost 99 + 1.
    expect(log.find((t) => t.type === 'buy')!.amountPLN).toBe(-99)
  })

  it('a sale that leaves only dust before a later buy sold everything: two rounds, each on its own days', () => {
    const s = statementOf(
      ['4.95000000 LTC', 'LTC Litecoin 9.899 LTC 14.849 LTC'],
      [BUY, SELL_ALL, 'LTC Buy 5 10.00 PLN 50.00 PLN 0.50 PLN Jun 1, 2025, 9:00:00AM'],
    )
    expect(planStatementRows(s, new Set()).map((r) => r.storedQuantity)).toEqual([9.9, 9.9, 4.95])
    const log = importAll(s)
    const ltc = log.filter((t) => t.ticker === 'LTC' || t.relatedTicker === 'LTC')
    const sale = log.find((t) => t.type === 'sell')!
    // The first round closed with the sale; the second holds 4.95 that cost 49.5 + 0.5.
    expect(walkClosingSales(ltc, pairTradeFees(log)).get(sale.id)!.profitPLN).toBeCloseTo(17.6, 8)
    expect(walkPosition(ltc, pairTradeFees(log))).toMatchObject({ quantity: 4.95, costPLN: 50 })
    expect(checkStatementHoldings(s, log, 'revolut')!.differences).toEqual([])
  })

  it('leaves a real gap to an adjustment, with its reason', () => {
    const s = statementOf(
      ['2.10000000 SOL', 'SOL Solana 0 SOL 2.1 SOL'],
      [
        'SOL Buy 2 400.00 PLN 800.00 PLN 12.00 PLN Feb 1, 2025, 9:00:00AM',
        'SOL Staking reward 0.10000000 400.00 PLN 40.00 PLN 0.00 PLN Jul 1, 2025, 1:00:00AM',
      ],
    )
    // Amount in less the staking rewards: the buy had its fee on top, nothing to fold.
    expect(planStatementRows(s, new Set()).map((r) => [r.feeMethod, r.storedQuantity])).toEqual([['top', 2]])
    const check = checkStatementHoldings(s, importAll(s), 'revolut')!
    expect(check.differences.map((d) => [d.symbol, d.delta, d.reason])).toEqual([['SOL', 0.1, 'Staking left out']])
  })

  it('a sold-out coin never takes its close date or result from an adjustment', () => {
    // An unread row blocks folding and leaves the sale's fee method unclear (taken out by default),
    // so 0.91 LTC is left that Revolut says is gone: an adjustment sends it.
    const s = statementOf(
      ['LTC Litecoin 10 LTC 10 LTC'],
      [
        'LTC Buy 10 10.00 PLN 100.00 PLN 1.00 PLN Feb 1, 2025, 9:00:00AM',
        'LTC Sell 9 12.00 PLN 108.00 PLN 1.08 PLN Mar 1, 2025, 9:00:00AM',
        'LTC Sell 1.O 12.00 PLN 12.00 PLN 0.12 PLN Mar 2, 2025, 9:00:00AM',
      ],
    )
    const log = importAll(s)
    const check = checkStatementHoldings(s, log, 'revolut')!
    expect(check.differences.map((d) => [d.delta, d.reason])).toEqual([[-0.91, 'Unreadable row']])
    const after = [...log, ...adjustmentTransactions(check.differences, 'revolut', check.asOf, NOW)]
    const sale = after.find((t) => t.type === 'sell')!
    const [closed] = closedCoinHoldings(account, after, s, ['LTC'], NOW)
    expect(closed.closedAt).toBe(sale.date.slice(0, 10))
    // The sale's own result: 9.09 of the 10 LTC (cost 101 for 10) sold for 108 (109.08 − 1.08 fee).
    const result = closedPositionResult(closed, after)!.result
    expect(result.proceedsPLN).toBeCloseTo(108, 8)
    expect(result.costPLN).toBeCloseTo((101 / 10) * 9.09, 8)
  })

  it('folds nothing for a coin with an unread row', () => {
    const s = statementOf(['9.89900000 LTC', 'LTC Litecoin 0 LTC 9.899 LTC'], [BUY, 'LTC Buy 1.5O 10.00 PLN 15.00 PLN 0.15 PLN Feb 2, 2025, 9:00:00AM'])
    expect(planStatementRows(s, new Set())[0].storedQuantity).toBe(9.9)
  })
})
