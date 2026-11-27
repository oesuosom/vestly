import { describe, it, expect } from 'vitest'
import type { Account, AccountType, Holding, Transaction } from '@/types'
import { computeAccountCashBalance, getRealizedPnL } from './calculations'
import {
  closedPositionResult,
  earliestCloseDate,
  findSharedPositionHolding,
  latestCloseDate,
  moveToClosed,
  moveToOpen,
  planClose,
  planCloseFromSales,
  removeCloseTransactions,
} from './closePosition'
import { buildBondBuyTransaction } from './transactions'
import { quantityAtDate } from './historicalQuantity'
import { pairTradeFees } from './tradeFees'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const NOW = '2026-03-10T12:00:00.000Z'

function holding(fields: Partial<Holding> & Pick<Holding, 'id' | 'name' | 'quantity' | 'purchasePrice'>): Holding {
  return {
    accountId: 'acc',
    category: 'stock',
    currentPrice: fields.purchasePrice,
    purchaseDate: '2026-01-05',
    createdAt: NOW,
    updatedAt: NOW,
    ...fields,
  }
}

function account(type: AccountType, holdings: Holding[]): Account {
  return { id: 'acc', name: 'Account', type, createdAt: NOW, lastUpdated: NOW, holdings }
}

let nextId = 0
function tx(fields: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amountPLN' | 'source'>): Transaction {
  const id = `t${++nextId}`
  return { id, accountId: 'acc', externalId: id, createdAt: NOW, ...fields }
}

/** Close, then return the log and accounts as the app would hold them. */
function close(h: Holding, acc: Account, log: Transaction[], saleAmountPLN: number, feePLN: number, date = '2026-03-10') {
  const plan = planClose(h, acc, log, { date, saleAmountPLN, feePLN }, NOW)
  const after = [...log, ...plan.transactions]
  const [closedAccount] = moveToClosed([acc], h.id, date, NOW)
  return { plan, after, closedAccount, closedHolding: closedAccount.closedHoldings![0] }
}

// ─── The five kinds of holding ─────────────────────────────────────────────────

describe('Close position — XTB stock with imported buys', () => {
  const deposit = tx({ type: 'deposit', date: '2026-01-02', amountPLN: 2000, source: 'xtb_import' })
  const buy1 = tx({ type: 'buy', date: '2026-01-05', amountPLN: -1000, quantity: 10, ticker: 'AAPL', source: 'xtb_import' })
  const buy2 = tx({ type: 'buy', date: '2026-02-01', amountPLN: -600, quantity: 5, ticker: 'AAPL', source: 'xtb_import' })
  const log = [deposit, buy1, buy2]
  const apple = holding({ id: 'apple', name: 'Apple', ticker: 'AAPL', quantity: 15, purchasePrice: 1600 / 15 })
  const acc = account('brokerage', [apple])

  it('records one sale, net of the fee, with the fee kept for display', () => {
    const { plan } = close(apple, acc, log, 2100, 10)
    expect(plan.transactions).toHaveLength(1)
    expect(plan.filledInBuy).toBeNull()
    // 2 100 sale − 10 fee = 2 090 proceeds
    expect(plan.sale).toMatchObject({
      type: 'sell', date: '2026-03-10', amountPLN: 2090, feePLN: 10, quantity: 15,
      ticker: 'AAPL', relatedHoldingId: 'apple', externalId: 'close-sell-apple', affectsCash: true,
    })
  })

  it('adds the proceeds to Cash: the buys were paid from it', () => {
    const { plan, after } = close(apple, acc, log, 2100, 10)
    expect(plan.addsToCash).toBe(true)
    // Before: 2 000 deposit − 1 000 − 600 buys = 400. After: 400 + 2 090 = 2 490.
    expect(computeAccountCashBalance(log, 'acc')).toBe(400)
    expect(computeAccountCashBalance(after, 'acc')).toBe(2490)
  })

  it('realizes the same profit on the row and on Overview', () => {
    const { plan, after, closedHolding } = close(apple, acc, log, 2100, 10)
    // Cost 1 000 + 600 = 1 600. Profit 2 090 − 1 600 = 490, i.e. 490 / 1 600 = 30.625 %.
    expect(plan.result).toEqual({ proceedsPLN: 2090, costPLN: 1600, profitPLN: 490 })
    const row = closedPositionResult(closedHolding, after)!
    expect(row.result.profitPLN).toBeCloseTo(490, 9)
    expect(row.profitPercent).toBeCloseTo(30.625, 9)
    expect(getRealizedPnL(after)).toBeCloseTo(490, 9)
  })
})

describe('Close position — PKO bond', () => {
  // A bond entered without a ticker: its buy is the app-made `bond_holding` row.
  const bond = holding({
    id: 'bond', name: 'Obligacje EDO0535', category: 'bond', quantity: 20, purchasePrice: 100, purchaseDate: '2025-05-15',
  })
  const log = [buildBondBuyTransaction(bond)]
  const acc = account('ike', [bond])

  it('uses the existing bond buy and leaves Cash alone', () => {
    // Amount received 2 232.50 — PKO already took the 2 PLN × 20 = 40 early-redemption fee
    // out of it — so the proceeds are 2 232.50; the fee is recorded, not subtracted again.
    const { plan, after } = close(bond, acc, log, 2232.5, 40)
    expect(plan.filledInBuy).toBeNull()
    expect(plan.sale).toMatchObject({ source: 'bond_holding', relatedHoldingId: 'bond', amountPLN: 2232.5, feePLN: 40 })
    expect(plan.addsToCash).toBe(false)
    expect(computeAccountCashBalance(after, 'acc')).toBe(0)
  })

  it('counts the profit on Overview even without a ticker', () => {
    const { after, closedHolding } = close(bond, acc, log, 2232.5, 40)
    // Cost 20 × 100 = 2 000. Profit 2 232.50 − 2 000 = 232.50, 232.50 / 2 000 = 11.625 %.
    const row = closedPositionResult(closedHolding, after)!
    expect(row.result).toEqual({ proceedsPLN: 2232.5, costPLN: 2000, profitPLN: 232.5 })
    expect(row.profitPercent).toBeCloseTo(11.625, 9)
    expect(getRealizedPnL(after)).toBeCloseTo(232.5, 9)
  })

  it('still subtracts the fee for a stock given the same inputs', () => {
    // A stock's amount is gross: 2 232.50 − 40 = 2 192.50.
    const stock = { ...bond, id: 'stock', name: 'Stock', ticker: 'STK', category: 'stock' as const }
    const stockBuy = tx({ type: 'buy', date: '2025-05-15', amountPLN: -2000, quantity: 20, ticker: 'STK', source: 'xtb_import' })
    const { plan } = close(stock, account('brokerage', [stock]), [stockBuy], 2232.5, 40)
    expect(plan.sale).toMatchObject({ amountPLN: 2192.5, feePLN: 40 })
    expect(plan.result.profitPLN).toBeCloseTo(192.5, 9)
  })
})

describe('Close position — two lots of the same bond series', () => {
  // Same series and ticker, bought a month apart; lot B came in at 99.90 per bond.
  const lotA = holding({ id: 'lot-a', name: 'EDO0535', ticker: 'EDO0535', category: 'bond', quantity: 10, purchasePrice: 100, purchaseDate: '2025-05-15' })
  const lotB = holding({ id: 'lot-b', name: 'EDO0535', ticker: 'EDO0535', category: 'bond', quantity: 10, purchasePrice: 99.9, purchaseDate: '2025-06-15' })
  const log = [buildBondBuyTransaction(lotA), buildBondBuyTransaction(lotB)]
  const acc = account('ike', [lotA, lotB])

  it('closes one lot at its own cost, as its own position', () => {
    const { plan, after, closedHolding } = close(lotA, acc, log, 1100, 0)
    // Lot A cost 10 × 100 = 1 000 → +100. Pooled with lot B (1 999 / 20 = 99.95) it would read +100.50.
    expect(plan.sale.source).toBe('bond_holding')
    expect(plan.filledInBuy).toBeNull()
    expect(plan.result).toEqual({ proceedsPLN: 1100, costPLN: 1000, profitPLN: 100 })
    expect(closedPositionResult(closedHolding, after)!.result.profitPLN).toBe(100)
    expect(getRealizedPnL(after)).toBe(100)
  })

  it('leaves the other lot untouched, on the chart too', () => {
    const { after } = close(lotA, acc, log, 1100, 0)
    expect(quantityAtDate(lotB, 'acc', after, '2026-04-01')).toBe(10)
    expect(quantityAtDate(lotA, 'acc', after, '2026-03-09')).toBe(10)
    expect(quantityAtDate(lotA, 'acc', after, '2026-03-10')).toBe(0)
  })
})

describe('Close position — eMakler holding', () => {
  const buy = tx({ type: 'buy', date: '2026-01-05', amountPLN: -1800, quantity: 30, ticker: 'PKN', source: 'emakler_import' })
  const orlen = holding({ id: 'pkn', name: 'Orlen', ticker: 'PKN', quantity: 30, purchasePrice: 60 })
  const acc = account('ikze', [orlen])

  it('leaves Cash alone: eMakler buys are paid from outside the account', () => {
    const { plan, after } = close(orlen, acc, [buy], 2100, 5.25)
    expect(plan.addsToCash).toBe(false)
    expect(plan.sale.affectsCash).toBe(false)
    expect(computeAccountCashBalance([buy], 'acc')).toBe(0)
    expect(computeAccountCashBalance(after, 'acc')).toBe(0)
  })

  it('realizes the same profit on the row and on Overview', () => {
    const { after, closedHolding } = close(orlen, acc, [buy], 2100, 5.25)
    // Proceeds 2 100 − 5.25 = 2 094.75. Cost 1 800. Profit 294.75, 294.75 / 1 800 = 16.375 %.
    const row = closedPositionResult(closedHolding, after)!
    expect(row.result.profitPLN).toBeCloseTo(294.75, 9)
    expect(row.profitPercent).toBeCloseTo(16.375, 9)
    expect(getRealizedPnL(after)).toBeCloseTo(294.75, 9)
  })
})

describe('Close position — Revolut crypto', () => {
  // Revolut stores the buy's fee as its own row, paired by externalId (pairTradeFees).
  const buy = tx({
    type: 'buy', date: '2026-01-10', amountPLN: -3990, quantity: 0.01, ticker: 'BTC', source: 'revolut_crypto',
    externalId: 'revolut-stmt-BTC-buy-2026-01-10T09:00:00.000Z-0.01-1',
  })
  const buyFee = tx({
    type: 'fee', date: '2026-01-10', amountPLN: -10, source: 'revolut_crypto', externalId: 'revolut-stmt-BTC-buy-2026-01-10T09:00:00.000Z-0.01-1-fee',
  })
  const btc = holding({ id: 'btc', name: 'Bitcoin', ticker: 'BTC', category: 'crypto', quantity: 0.01, purchasePrice: 400000 })
  const acc = account('crypto', [btc])

  it('gets no Cash, and its fee is not paired a second time', () => {
    const { plan, after } = close(btc, acc, [buy, buyFee], 4500, 15)
    expect(plan.addsToCash).toBe(false)
    // The close's fee is already inside amountPLN (4 500 − 15 = 4 485); no fee row may pair with it.
    expect(plan.sale.amountPLN).toBe(4485)
    expect(pairTradeFees(after).has(plan.sale.id)).toBe(false)
  })

  it('realizes the same profit on the row and on Overview', () => {
    const { after, closedHolding } = close(btc, acc, [buy, buyFee], 4500, 15)
    // Cost 3 990 + 10 buy fee = 4 000. Profit 4 485 − 4 000 = 485 (not 470: the
    // close's 15 fee counts once), 485 / 4 000 = 12.125 %.
    const row = closedPositionResult(closedHolding, after)!
    expect(row.result.profitPLN).toBeCloseTo(485, 9)
    expect(row.profitPercent).toBeCloseTo(12.125, 9)
    expect(getRealizedPnL(after)).toBeCloseTo(485, 9)
  })
})

describe('Close position — holding entered by hand', () => {
  // Inside an XTB account, but with no buy in the log: the units never left Cash.
  const deposit = tx({ type: 'deposit', date: '2025-05-01', amountPLN: 1000, source: 'xtb_import' })
  const cdr = holding({ id: 'cdr', name: 'CD Projekt', ticker: 'CDR', quantity: 4, purchasePrice: 250, purchaseDate: '2025-06-01' })
  const acc = account('brokerage', [cdr])

  it('fills in a buy from the purchase date and price, which never touches Cash', () => {
    const { plan, after } = close(cdr, acc, [deposit], 1200, 0)
    // 4 × 250 = 1 000, on the purchase date, date-only so it runs before any same-day sale.
    expect(plan.filledInBuy).toMatchObject({
      type: 'buy', date: '2025-06-01', amountPLN: -1000, quantity: 4, pricePerUnitPLN: 250,
      relatedHoldingId: 'cdr', externalId: 'close-buy-cdr', affectsCash: false,
    })
    expect(plan.transactions).toEqual([plan.filledInBuy, plan.sale])
    expect(plan.sale.feePLN).toBeUndefined()
    // Neither row moves Cash: still the 1 000 deposit.
    expect(plan.addsToCash).toBe(false)
    expect(computeAccountCashBalance(after, 'acc')).toBe(1000)
  })

  it('realizes the same profit on the row and on Overview', () => {
    const { after, closedHolding } = close(cdr, acc, [deposit], 1200, 0)
    // 1 200 − 1 000 = 200, 200 / 1 000 = 20 %.
    const row = closedPositionResult(closedHolding, after)!
    expect(row.result.profitPLN).toBeCloseTo(200, 9)
    expect(row.profitPercent).toBeCloseTo(20, 9)
    expect(getRealizedPnL(after)).toBeCloseTo(200, 9)
  })
})

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe('Close position — log covers only part of the holding', () => {
  it('fills in the missing units and keeps Cash unchanged, so no unpaid units are credited', () => {
    const buy = tx({ type: 'buy', date: '2026-01-05', amountPLN: -1000, quantity: 10, ticker: 'KGH', source: 'xtb_import' })
    // Holding raised to 12 by hand at a 110 average: 2 units the log doesn't explain.
    const kgh = holding({ id: 'kgh', name: 'KGHM', ticker: 'KGH', quantity: 12, purchasePrice: 110 })
    const acc = account('brokerage', [kgh])
    const { plan, after } = close(kgh, acc, [buy], 1440, 0)

    expect(plan.filledInBuy).toMatchObject({ quantity: 2, amountPLN: -220 })
    expect(plan.addsToCash).toBe(false)
    // Cost 1 000 + 2 × 110 = 1 220. Profit 1 440 − 1 220 = 220.
    expect(plan.result.profitPLN).toBeCloseTo(220, 9)
    expect(getRealizedPnL(after)).toBeCloseTo(220, 9)
  })
})

describe('Close position — a rebuy after the close', () => {
  it('starts a new pool: the closed row keeps its own figure', () => {
    const buy = tx({ type: 'buy', date: '2026-01-05', amountPLN: -1000, quantity: 10, ticker: 'AAPL', source: 'xtb_import' })
    const first = holding({ id: 'first', name: 'Apple', ticker: 'AAPL', quantity: 10, purchasePrice: 100 })
    const { after, closedHolding } = close(first, account('brokerage', [first]), [buy], 1500, 0)

    // Rebuy 10 for 2 000 a month later, and sell 5 of them for 1 100.
    const rebuy = tx({ type: 'buy', date: '2026-04-10', amountPLN: -2000, quantity: 10, ticker: 'AAPL', source: 'xtb_import' })
    const sell = tx({ type: 'sell', date: '2026-05-10', amountPLN: 1100, quantity: 5, ticker: 'AAPL', source: 'xtb_import' })
    const later = [...after, rebuy, sell]

    // First close: 1 500 − 1 000 = 500. The pool reset at 0 units, so the rebuy can't change it.
    expect(closedPositionResult(closedHolding, later)!.result.profitPLN).toBeCloseTo(500, 9)
    // Overview: 500 + (1 100 − 5 × 200) = 600.
    expect(getRealizedPnL(later)).toBeCloseTo(600, 9)
  })
})

describe('findSharedPositionHolding', () => {
  const a = holding({ id: 'a', name: 'Apple', ticker: 'AAPL', quantity: 1, purchasePrice: 1 })
  const b = holding({ id: 'b', name: 'Apple (2nd lot)', ticker: 'aapl', quantity: 1, purchasePrice: 1 })
  const cash = holding({ id: 'cash_acc', name: 'Cash', category: 'cash', quantity: 1, purchasePrice: 0, isSynthetic: true })

  it('finds another open holding with the same ticker, ignoring case', () => {
    expect(findSharedPositionHolding(a, account('brokerage', [a, b, cash]))).toBe(b)
  })

  it('is undefined for a holding alone in its position', () => {
    expect(findSharedPositionHolding(a, account('brokerage', [a, cash]))).toBeUndefined()
  })

  it('never matches bond lots of the same series, with a ticker or by a short name', () => {
    const lot = (id: string, fields: Partial<Holding>) =>
      holding({ id, name: 'EDO0535', category: 'bond', quantity: 10, purchasePrice: 100, ...fields })
    const withTicker = [lot('ba', { ticker: 'EDO0535' }), lot('bb', { ticker: 'EDO0535' })]
    const byName = [lot('ca', {}), lot('cb', {})]
    expect(findSharedPositionHolding(withTicker[0], account('ike', withTicker))).toBeUndefined()
    expect(findSharedPositionHolding(byName[0], account('ike', byName))).toBeUndefined()
  })
})

describe('earliestCloseDate', () => {
  const kgh = holding({ id: 'kgh', name: 'KGHM', ticker: 'KGH', quantity: 10, purchasePrice: 100, purchaseDate: '2026-01-05' })
  const acc = account('brokerage', [kgh])

  it('is the purchase date when no later buy is recorded', () => {
    expect(earliestCloseDate(kgh, acc, [])).toBe('2026-01-05')
  })

  it('is the last buy of the position when that is later', () => {
    const later = tx({ type: 'buy', date: '2026-02-20T10:00:00.000Z', amountPLN: -500, quantity: 5, ticker: 'KGH', source: 'xtb_import' })
    const other = tx({ type: 'buy', date: '2026-03-01', amountPLN: -500, quantity: 5, ticker: 'PKN', source: 'xtb_import' })
    expect(earliestCloseDate(kgh, acc, [later, other])).toBe('2026-02-20')
  })

  it('is the stored (UTC) day of the last buy, even when that is after the local today', () => {
    // 21:00 on 11 Nov in New York is stored under 12 Nov.
    const evening = tx({ type: 'buy', date: '2026-11-12T02:00:00.000Z', amountPLN: -500, quantity: 5, ticker: 'KGH', source: 'xtb_import' })
    expect(earliestCloseDate(kgh, acc, [evening])).toBe('2026-11-12')
  })
})

describe('latestCloseDate', () => {
  it('is today when the earliest allowed day is today or before', () => {
    expect(latestCloseDate('2026-11-05', '2026-11-11')).toBe('2026-11-11')
    expect(latestCloseDate('2026-11-11', '2026-11-11')).toBe('2026-11-11')
  })

  it('is the earliest allowed day when a row is stored after the local today, so a close is still possible', () => {
    expect(latestCloseDate('2026-11-12', '2026-11-11')).toBe('2026-11-12')
  })
})

describe('Reopen', () => {
  const deposit = tx({ type: 'deposit', date: '2025-05-01', amountPLN: 1000, source: 'xtb_import' })
  const dividend = tx({ type: 'dividend', date: '2025-09-01', amountPLN: 12, relatedTicker: 'CDR', relatedHoldingId: 'cdr', source: 'xtb_import' })
  const cdr = holding({ id: 'cdr', name: 'CD Projekt', ticker: 'CDR', quantity: 4, purchasePrice: 250, purchaseDate: '2025-06-01' })
  const acc = account('brokerage', [cdr])

  it('removes exactly the sale and the filled-in buy, and nothing else', () => {
    const log = [deposit, dividend]
    const { after, closedHolding } = close(cdr, acc, log, 1200, 0)
    expect(after).toHaveLength(4)
    expect(removeCloseTransactions(closedHolding, after)).toEqual(log)
  })

  it('moves the holding back without its close date, dropping an empty closed list', () => {
    const { closedAccount } = close(cdr, acc, [deposit], 1200, 0)
    expect(closedAccount.holdings).toEqual([])
    expect(closedAccount.closedHoldings).toEqual([{ ...cdr, closedAt: '2026-03-10', updatedAt: NOW }])

    const [reopened] = moveToOpen([closedAccount], 'cdr', NOW)
    expect(reopened.holdings).toEqual([{ ...cdr, updatedAt: NOW }])
    expect(reopened).not.toHaveProperty('closedHoldings')
  })

  it('has no row figure once the sale is gone from the log', () => {
    const { after, closedHolding } = close(cdr, acc, [deposit], 1200, 0)
    const withoutSale = after.filter((t) => t.type !== 'sell')
    expect(closedPositionResult(closedHolding, withoutSale)).toBeNull()
  })
})

// ─── Closing with sales an import brought (#30) ──────────────────────────────

describe('planCloseFromSales', () => {
  const emakler = (fields: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amountPLN' | 'quantity'>) =>
    tx({ ticker: 'BETA', instrument: 'BETA', source: 'emakler_import', ...fields })
  const beta = holding({ id: 'beta', name: 'BETA', ticker: 'BETA', quantity: 10, purchasePrice: 50, purchaseDate: '2025-06-01' })
  const acc = account('brokerage', [beta])

  it('closes on the last sale’s day, filling in the buys the log never saw', () => {
    const sale = emakler({ type: 'sell', date: '2026-03-01T11:00:00.000Z', amountPLN: 700, quantity: 10 })
    const plan = planCloseFromSales(beta, acc, [sale], [sale], NOW)!
    expect(plan.date).toBe('2026-03-01')
    expect(plan.filledInBuy).toMatchObject({ type: 'buy', date: '2025-06-01', quantity: 10, amountPLN: -500, affectsCash: false })

    const after = [sale, plan.filledInBuy!]
    const [closedAccount] = moveToClosed([acc], beta.id, plan.date, NOW)
    const row = closedPositionResult(closedAccount.closedHoldings![0], after)!
    expect(row.sale.id).toBe(sale.id)
    expect(row.result).toEqual({ proceedsPLN: 700, costPLN: 500, profitPLN: 200 })
    expect(getRealizedPnL(after)).toBe(200)
  })

  it('adds no buy when the log explains the units, and counts every sale of the round', () => {
    const buy = emakler({ type: 'buy', date: '2025-06-01T09:00:00.000Z', amountPLN: -500, quantity: 10 })
    const s1 = emakler({ type: 'sell', date: '2026-02-01T09:00:00.000Z', amountPLN: 240, quantity: 4 })
    const s2 = emakler({ type: 'sell', date: '2026-03-01T09:00:00.000Z', amountPLN: 420, quantity: 6 })
    const log = [buy, s1, s2]
    const plan = planCloseFromSales(beta, acc, log, [s1, s2], NOW)!
    expect(plan).toMatchObject({ date: '2026-03-01', filledInBuy: null })

    const [closedAccount] = moveToClosed([acc], beta.id, plan.date, NOW)
    expect(closedPositionResult(closedAccount.closedHoldings![0], log)!.result).toEqual({
      proceedsPLN: 660, costPLN: 500, profitPLN: 160,
    })
  })

  it('closes nothing when the sales leave units held', () => {
    const sale = emakler({ type: 'sell', date: '2026-03-01', amountPLN: 210, quantity: 3 })
    expect(planCloseFromSales(beta, acc, [sale], [sale], NOW)).toBeNull()
  })

  it('closes the holding when the sales sell more than it had; the excess adds no profit', () => {
    const sale = emakler({ type: 'sell', date: '2026-03-01', amountPLN: 840, quantity: 12 })
    const plan = planCloseFromSales(beta, acc, [sale], [sale], NOW)!
    expect(plan.date).toBe('2026-03-01')
    expect(plan.filledInBuy).toMatchObject({ quantity: 10, amountPLN: -500 })
    // 10 of the 12 units are explained: 10/12 of 840 = 700 in, 500 cost.
    expect(getRealizedPnL([sale, plan.filledInBuy!])).toBeCloseTo(200, 9)
  })

  it('ignores sales of other instruments', () => {
    const other = tx({ type: 'sell', date: '2026-03-01', amountPLN: 700, quantity: 10, ticker: 'ALPHA', source: 'emakler_import' })
    expect(planCloseFromSales(beta, acc, [other], [other], NOW)).toBeNull()
  })
})

describe('planClose with an import’s partial sale (Mark as sold the rest)', () => {
  const emakler = (fields: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amountPLN' | 'quantity'>) =>
    tx({ ticker: 'BETA', instrument: 'BETA', source: 'emakler_import', ...fields })
  const beta = holding({ id: 'beta', name: 'BETA', ticker: 'BETA', quantity: 10, purchasePrice: 50, purchaseDate: '2025-06-01' })
  const acc = account('brokerage', [beta])

  it('sells only the units left after the upload’s sale, and fills in only one buy', () => {
    const upload = emakler({ type: 'sell', date: '2026-03-01T11:00:00.000Z', amountPLN: 210, quantity: 3 })
    const log = [upload]
    const plan = planClose(beta, acc, log, { date: '2026-03-05', saleAmountPLN: 420, feePLN: 0 }, NOW, [upload])

    expect(plan.filledInBuy).toMatchObject({ quantity: 10, date: '2025-06-01' })
    expect(plan.sale).toMatchObject({ quantity: 7, amountPLN: 420, date: '2026-03-05' })
    const after = [...log, ...plan.transactions]
    // 10 units in, 3 + 7 out: nothing oversold. 210 + 420 − 500.
    expect(getRealizedPnL(after)).toBeCloseTo(130, 9)
    expect(after.filter((t) => t.type === 'sell').reduce((q, t) => q + t.quantity!, 0)).toBe(10)
  })

  it('dates the filled-in buy no later than the first upload sale', () => {
    const late = { ...beta, purchaseDate: '2026-04-01' }
    const upload = emakler({ type: 'sell', date: '2026-03-01', amountPLN: 210, quantity: 3 })
    const plan = planClose(late, account('brokerage', [late]), [upload], { date: '2026-05-01', saleAmountPLN: 420, feePLN: 0 }, NOW, [upload])
    expect(plan.filledInBuy).toMatchObject({ date: '2026-03-01', quantity: 10 })
  })

  it('counts upload buys before the sales: only the gap is filled in', () => {
    const buy = emakler({ type: 'buy', date: '2026-02-01T09:00:00.000Z', amountPLN: -240, quantity: 4 })
    const upload = emakler({ type: 'sell', date: '2026-03-01T09:00:00.000Z', amountPLN: 210, quantity: 3 })
    const plan = planClose(beta, acc, [buy, upload], { date: '2026-03-05', saleAmountPLN: 420, feePLN: 0 }, NOW, [upload])
    expect(plan.filledInBuy).toMatchObject({ quantity: 6 })
    expect(plan.sale.quantity).toBe(7)
  })
})

describe('closedPositionResult — a closed holding whose sale is gone', () => {
  it('does not pick up a sale from an earlier round', () => {
    const apple = holding({ id: 'apple', name: 'Apple', ticker: 'AAPL', quantity: 5, purchasePrice: 100, purchaseDate: '2026-02-01' })
    const oldBuy = tx({ type: 'buy', date: '2026-01-02', amountPLN: -100, quantity: 1, ticker: 'AAPL', source: 'xtb_import' })
    const oldSale = tx({ type: 'sell', date: '2026-01-05', amountPLN: 120, quantity: 1, ticker: 'AAPL', source: 'xtb_import' })
    const buy = tx({ type: 'buy', date: '2026-02-01', amountPLN: -500, quantity: 5, ticker: 'AAPL', source: 'xtb_import' })
    const acc = account('brokerage', [apple])
    const [closedAccount] = moveToClosed([acc], apple.id, '2026-03-10', NOW)
    // The close's own sale was deleted in Activity.
    expect(closedPositionResult(closedAccount.closedHoldings![0], [oldBuy, oldSale, buy])).toBeNull()
  })
})
