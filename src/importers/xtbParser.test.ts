import { describe, expect, it } from 'vitest'
import { computeAccountCashBalance } from '@/domain/calculations'
import { walkPosition } from '@/domain/position'
import type { Transaction } from '@/types'
import {
  parseCashOperationsTime,
  parseTradeComment,
  parseXTBCashOperations,
  parseXTBCashOperationsText,
} from './xtbParser'

// ─── Synthetic fixtures in the confirmed format ────────────────────────────────
// Metadata rows, a header row, data rows newest first, and a Total row that is
// the sum of the Amount column. Times are UTC. Tickers and amounts are made up.

const HEADER_7 = 'Type,Instrument,Time,Amount,ID,Comment,Product'

/** A Cash Operations CSV. `total` defaults to the sum of the rows' Amount. */
function cashOps(rows: string[][], opts: { header?: string; total?: number | null } = {}): string {
  const header = opts.header ?? HEADER_7
  const names = header.split(',')
  const amountAt = names.indexOf('Amount')
  const sum = rows.reduce((s, r) => s + Number(r[amountAt]), 0)
  const total = opts.total === undefined ? Math.round(sum * 100) / 100 : opts.total
  const totalRow = names.map((n, i) => (i === 0 ? 'Total' : n === 'Amount' ? String(total) : ''))
  return [
    'Account number,00000000',
    'Cash Operations,',
    'Date from (UTC),2026-01-01 00:00:00',
    'Date to (UTC),2026-03-01 00:00:00',
    header,
    ...rows.map((r) => r.join(',')),
    ...(total === null ? [] : [totalRow.join(',')]),
  ].join('\n')
}

/** One row in the 7-column layout. */
const row = (type: string, instrument: string, time: string, amount: number, id: string, comment = '', product = 'Stocks') =>
  [type, instrument, time, String(amount), id, comment, product]

const parse = (text: string, existing: Transaction[] = []) =>
  parseXTBCashOperationsText(text, 'xtb', new Set(existing.map((t) => t.externalId)), [], {}, existing)

const messages = (r: { warnings: { message: string }[] }) => r.warnings.map((w) => w.message)

// ─── Comments ──────────────────────────────────────────────────────────────────

describe('parseTradeComment', () => {
  it.each([
    ['OPEN BUY 0.25 @ 100.00', { action: 'OPEN', side: 'BUY', quantity: 0.25, pricePerUnitOriginal: 100 }],
    ['OPEN BUY ACME.US 2 @ 10.00', { action: 'OPEN', side: 'BUY', ticker: 'ACME', exchange: 'US', quantity: 2, pricePerUnitOriginal: 10 }],
    ['OPEN BUY ACME.US 0.5/2.5 @ 10.00', { action: 'OPEN', side: 'BUY', ticker: 'ACME', exchange: 'US', quantity: 0.5, orderQuantity: 2.5, pricePerUnitOriginal: 10 }],
    ['OPEN BUY 0.5/2.5 @ 10.00', { action: 'OPEN', side: 'BUY', quantity: 0.5, orderQuantity: 2.5, pricePerUnitOriginal: 10 }],
    ['CLOSE BUY 6/12 @ 55.00', { action: 'CLOSE', side: 'BUY', quantity: 6, orderQuantity: 12, pricePerUnitOriginal: 55 }],
    ['CLOSE BUY EXAMPLE.PL 3 @ 41.50', { action: 'CLOSE', side: 'BUY', ticker: 'EXAMPLE', exchange: 'PL', quantity: 3, pricePerUnitOriginal: 41.5 }],
    ['CLOSE BUY ACME.B.US 1 @ 5.00', { action: 'CLOSE', side: 'BUY', ticker: 'ACME.B', exchange: 'US', quantity: 1, pricePerUnitOriginal: 5 }],
    ['OPEN SELL 1 @ 5.00', { action: 'OPEN', side: 'SELL', quantity: 1, pricePerUnitOriginal: 5 }],
  ])('%s', (comment, expected) => {
    expect(parseTradeComment(comment)).toEqual(expected)
  })

  it('rejects comments that are not trades', () => {
    expect(parseTradeComment('ACME.US USD 0.1200/ SHR')).toBeNull()
    expect(parseTradeComment('OPEN BUY @ market')).toBeNull()
    expect(parseTradeComment('OPEN BUY 0 @ 10.00')).toBeNull()
  })
})

// ─── Time ──────────────────────────────────────────────────────────────────────

describe('parseCashOperationsTime', () => {
  it('reads the time as UTC and keeps it', () => {
    expect(parseCashOperationsTime('2026-01-02 14:37:04')).toBe('2026-01-02T14:37:04.000Z')
  })
  it('keeps fractional seconds to the millisecond', () => {
    expect(parseCashOperationsTime('2026-02-10 10:59:02.277000')).toBe('2026-02-10T10:59:02.277Z')
  })
  it('accepts DD.MM.YYYY', () => {
    expect(parseCashOperationsTime('10.02.2026 10:59:02')).toBe('2026-02-10T10:59:02.000Z')
  })
  it('keeps a time just before midnight UTC on its own day', () => {
    expect(parseCashOperationsTime('2026-12-31 23:30:00')!.slice(0, 10)).toBe('2026-12-31')
  })
  it('leaves a bare date date-only, and rejects what is not a date', () => {
    expect(parseCashOperationsTime('2026-02-10')).toBe('2026-02-10')
    expect(parseCashOperationsTime('2026-02-30 10:00:00')).toBeNull()
    expect(parseCashOperationsTime('yesterday')).toBeNull()
  })
})

// ─── Sales ─────────────────────────────────────────────────────────────────────

describe('sales', () => {
  it('the reported case: deposit 1,000, buy 500, sale 600 → Cash 1,100', () => {
    const r = parse(cashOps([
      row('Stock sale', 'Acme Corp', '2026-01-05 10:00:00', 600, '3', 'CLOSE BUY ACME.US 5 @ 120.00'),
      row('Stock purchase', 'Acme Corp', '2026-01-03 10:00:00', -500, '2', 'OPEN BUY ACME.US 5 @ 100.00'),
      row('Deposit', '', '2026-01-02 09:00:00', 1000, '1', '', ''),
    ]))
    expect(r.warnings).toEqual([])
    expect(computeAccountCashBalance(r.transactions, 'xtb')).toBe(1100)
    expect(walkPosition(r.transactions.filter((t) => t.ticker === 'ACME'))).toMatchObject({ quantity: 0, realizedProfitPLN: 100 })
  })

  it.each([
    ['Stock sale', 'CLOSE BUY 6/12 @ 55.00', 6],
    ['Stock sell', 'CLOSE BUY ACME.US 2 @ 55.00', 2],
    ['Stocks/ETF sale', 'CLOSE BUY ACME.US 0.5/2.5 @ 55.00', 0.5],
    ['Stock sale', 'CLOSE BUY 0.5/2.5 @ 55.00', 0.5],
    ['Stock sale', 'CLOSE BUY 3 @ 55.00', 3],
  ])('"%s" with "%s" imports as a sell of %d', (type, comment, quantity) => {
    const amount = Math.round(quantity * 55 * 4 * 100) / 100 // 4 PLN per USD
    const r = parse(cashOps([
      row(type, 'Acme Corp', '2026-01-05 10:00:00', amount, '9', comment),
      // A dividend names the ticker for rows whose comment doesn't.
      row('Dividend', 'Acme Corp', '2026-01-02 09:00:00', 1, '8', 'ACME.US USD 0.1000/ SHR'),
    ]))
    expect(r.warnings).toEqual([])
    const sale = r.transactions.find((t) => t.type === 'sell')!
    expect(sale).toMatchObject({
      type: 'sell', ticker: 'ACME', exchange: 'US', quantity, amountPLN: amount,
      pricePerUnitPLN: amount / quantity, pricePerUnitOriginal: 55, originalCurrency: 'USD', instrument: 'Acme Corp',
    })
  })

  it('a sale whose comment opens a position is not imported', () => {
    const r = parse(cashOps([row('Stock sale', 'Acme Corp', '2026-01-05 10:00:00', 100, '9', 'OPEN BUY 1 @ 100.00')]))
    expect(r.transactions).toEqual([])
    expect(messages(r)).toContainEqual(expect.stringMatching(/doesn't match/))
  })
})

// ─── Buys ──────────────────────────────────────────────────────────────────────

describe('buys', () => {
  it.each([
    ['OPEN BUY 0.25 @ 100.00', 0.25, undefined],
    ['OPEN BUY ACME.US 2 @ 10.00', 2, 'ACME'],
    ['OPEN BUY ACME.US 0.5/2.5 @ 10.00', 0.5, 'ACME'],
    ['OPEN BUY 0.5/2.5 @ 10.00', 0.5, undefined],
  ])('"%s" imports %d units', (comment, quantity, ticker) => {
    const r = parse(cashOps([row('Stock purchase', 'Widget Inc', '2026-01-05 10:00:00', -40, '9', comment)]))
    expect(r.warnings).toEqual([])
    expect(r.transactions[0]).toMatchObject({ type: 'buy', quantity, ticker, amountPLN: -40 })
  })

  it('a ticker in one comment resolves the same instrument’s rows that have none', () => {
    const r = parse(cashOps([
      row('Stock purchase', 'Widget Inc', '2026-01-06 10:00:00', -10, '2', 'OPEN BUY 1 @ 10.00'),
      row('Stock purchase', 'Widget Inc', '2026-01-05 10:00:00', -10, '1', 'OPEN BUY WIDG.US 1 @ 10.00'),
    ]))
    expect(r.transactions.map((t) => t.ticker)).toEqual(['WIDG', 'WIDG'])
  })

  it('the comment’s ticker comes before aliases and other ways of finding one', () => {
    const text = cashOps([row('Stock purchase', 'Acme Corp', '2026-01-05 10:00:00', -10, '1', 'OPEN BUY ACME.US 1 @ 10.00')])
    const r = parseXTBCashOperationsText(text, 'xtb', new Set(), [], { 'Acme Corp': { ticker: 'OTHER', exchange: 'PL' } })
    expect(r.transactions[0]).toMatchObject({ ticker: 'ACME', exchange: 'US' })
  })

  it('reads old spellings: Stocks/ETF purchase, DIVIDENT, Free funds interests (tax)', () => {
    const r = parse(cashOps([
      row('Stocks/ETF purchase', 'Acme Corp', '2026-01-05 10:00:00', -10, '1', 'OPEN BUY 1 @ 10.00'),
      row('DIVIDENT', 'Acme Corp', '2026-01-06 10:00:00', 2, '2', 'ACME.US USD 0.2000/ SHR'),
      row('Free funds interests', '', '2026-01-07 10:00:00', 1.5, '3', '', ''),
      row('Free funds interests tax', '', '2026-01-07 10:00:00', -0.29, '4', '', ''),
    ]))
    expect(r.warnings).toEqual([])
    expect(r.transactions.map((t) => t.type)).toEqual(['buy', 'dividend', 'interest', 'interest_tax'])
  })
})

// ─── Fees and other row types ──────────────────────────────────────────────────

describe('fees', () => {
  it('Commission, SEC fee and Tax IFTT import as fees and take money out of Cash', () => {
    const r = parse(cashOps([
      row('Commission', 'Acme Corp', '2026-01-05 10:00:00', -2.5, '5', 'ACME.US commission'),
      row('SEC fee', 'Acme Corp', '2026-01-05 10:00:00', -0.03, '4', ''),
      row('Tax IFTT', 'Italco', '2026-01-04 10:00:00', -0.4, '3', ''),
      row('Stock sale', 'Acme Corp', '2026-01-05 10:00:00', 400, '2', 'CLOSE BUY ACME.US 2 @ 50.00'),
      row('Deposit', '', '2026-01-02 09:00:00', 100, '1', '', ''),
    ]))
    expect(r.warnings).toEqual([])
    const fees = r.transactions.filter((t) => t.type === 'fee')
    expect(fees.map((t) => t.amountPLN)).toEqual([-2.5, -0.03, -0.4])
    expect(fees[0]).toMatchObject({ relatedInstrument: 'Acme Corp', relatedTicker: 'ACME' })
    // 100 deposit + 400 sale − 2.93 in fees
    expect(computeAccountCashBalance(r.transactions, 'xtb')).toBeCloseTo(497.07, 10)
  })

  it('Transfer and Subaccount transfer move cash in or out; Spinoff is a payout', () => {
    const r = parse(cashOps([
      row('Transfer', '', '2026-01-05 10:00:00', -50, '3', '', ''),
      row('Subaccount transfer', '', '2026-01-04 10:00:00', 70, '2', '', ''),
      row('Spinoff', 'Acme Corp', '2026-01-03 10:00:00', 4, '1', '', ''),
    ]))
    expect(r.warnings).toEqual([])
    expect(r.transactions.map((t) => t.type)).toEqual(['withdrawal', 'deposit', 'dividend'])
    expect(computeAccountCashBalance(r.transactions, 'xtb')).toBe(24)
  })
})

describe('CFD rows', () => {
  it.each([
    ['Swap', '', -0.12],
    ['Close trade', 'CLOSE BUY 1 @ 1.10000', 3.2],
    ['Profit/Loss (FX/CFD)', '', -1.4],
    ['Stock sale', 'CLOSE SELL ACME.US 1 @ 10.00', 5],
    ['Stock purchase', 'OPEN SELL 1 @ 10.00', -5],
  ])('"%s" %s is skipped with a warning', (type, comment, amount) => {
    const r = parse(cashOps([
      row(type, 'Acme Corp', '2026-01-05 10:00:00', amount, '2', comment, 'CFD'),
      row('Deposit', '', '2026-01-02 09:00:00', 100, '1', '', ''),
    ]))
    expect(r.transactions.map((t) => t.type)).toEqual(['deposit'])
    expect(messages(r)).toHaveLength(1)
    expect(messages(r)[0]).toMatch(/^Not imported: .*CFD/)
  })
})

// ─── Time of day ───────────────────────────────────────────────────────────────

describe('time of day', () => {
  it('rows keep their time as UTC', () => {
    const r = parse(cashOps([row('Deposit', '', '2026-01-02 14:37:04', 10, '1', '', '')]))
    expect(r.transactions[0].date).toBe('2026-01-02T14:37:04.000Z')
  })

  it('a same-day sell-then-rebuy leaves the rebuy price, whatever the file’s order', () => {
    // Newest first, as XTB lists them.
    const r = parse(cashOps([
      row('Stock purchase', 'Acme Corp', '2026-01-10 11:00:00', -2000, '3', 'OPEN BUY ACME.US 10 @ 50.00'),
      row('Stock sale', 'Acme Corp', '2026-01-10 10:00:00', 1500, '2', 'CLOSE BUY ACME.US 10 @ 37.50'),
      row('Stock purchase', 'Acme Corp', '2026-01-05 10:00:00', -1000, '1', 'OPEN BUY ACME.US 10 @ 25.00'),
    ]))
    expect(walkPosition(r.transactions)).toMatchObject({ quantity: 10, averageCostPLN: 200, realizedProfitPLN: 500 })
  })

  it('rows imported before this change stay date-only and still de-duplicate by ID', () => {
    const old: Transaction = {
      id: 'old', accountId: 'xtb', type: 'buy', date: '2026-01-05', amountPLN: -1000, ticker: 'ACME', quantity: 10,
      externalId: '1', source: 'xtb_import', createdAt: '2026-01-06T00:00:00.000Z',
    }
    const r = parse(cashOps([
      row('Stock sale', 'Acme Corp', '2026-01-05 15:00:00', 1200, '2', 'CLOSE BUY ACME.US 10 @ 30.00'),
      row('Stock purchase', 'Acme Corp', '2026-01-05 10:00:00', -1000, '1', 'OPEN BUY ACME.US 10 @ 25.00'),
    ]), [old])
    expect(r.skipped).toBe(1)
    expect(r.transactions.map((t) => t.date)).toEqual(['2026-01-05T15:00:00.000Z'])
    // A date-only buy runs before a same-day timestamped sale.
    expect(walkPosition([old, ...r.transactions])).toMatchObject({ quantity: 0, realizedProfitPLN: 200 })
  })
})

// ─── Total row ─────────────────────────────────────────────────────────────────

describe('the Total check', () => {
  const rows = [
    row('Swap', 'Acme Corp', '2026-01-06 10:00:00', -0.12, '4', '', 'CFD'),
    row('Stock purchase', 'Acme Corp', '2026-01-05 10:00:00', -10.01, '3', 'OPEN BUY ACME.US 1 @ 2.50'),
    row('Commission', 'Acme Corp', '2026-01-05 10:00:00', -0.2, '2', ''),
    row('Deposit', '', '2026-01-02 09:00:00', 100.1, '1', '', ''),
  ]

  it('stays quiet on a correct file, CFD rows and rows already imported included', () => {
    const existing: Transaction = {
      id: 'x', accountId: 'xtb', type: 'deposit', date: '2026-01-02', amountPLN: 100.1, externalId: '1', source: 'xtb_import', createdAt: '',
    }
    const r = parse(cashOps(rows), [existing])
    expect(messages(r)).toEqual(['Not imported: "Swap" is a CFD row, and Vestly tracks shares only'])
  })

  it('warns when rows are missing from what the Total adds up', () => {
    const r = parse(cashOps([...rows, row('Mystery bonus', '', '2026-01-03 10:00:00', 7, '5', '', '')]))
    expect(messages(r)).toContain('Unknown transaction type: "Mystery bonus"')
    expect(r.warnings[0].message).toBe("The rows add up to 89.77, but the file's Total row says 96.77: 7.00 PLN wasn't imported, so Cash will be off by that much")
  })

  it('warns when the Total disagrees with the rows', () => {
    const r = parse(cashOps(rows, { total: 90 }))
    expect(r.warnings[0].message).toMatch(/add up to 89\.77, but the file's Total row says 90\.00: 0\.23 PLN/)
  })

  it('is skipped when the file has no Total row', () => {
    expect(parse(cashOps(rows, { total: null })).warnings).toHaveLength(1)
  })
})

// ─── Layouts ───────────────────────────────────────────────────────────────────

describe('column layouts', () => {
  it('reads columns by name, in any order, with a Ticker column', () => {
    const header = 'ID,Type,Time,Ticker,Instrument,Comment,Amount,Product,Currency,Notes'
    const r = parse(cashOps([
      ['2', 'Stock sale', '2026-01-06 10:00:00', 'EXAMPLE.PL', 'Example SA', 'CLOSE BUY 3/4 @ 20.00', '60', 'Stocks', 'PLN', ''],
      ['1', 'Stock purchase', '2026-01-05 10:00:00', 'EXAMPLE.PL', 'Example SA', 'OPEN BUY 4 @ 15.00', '-60', 'Stocks', 'PLN', ''],
    ], { header }))
    expect(r.warnings).toEqual([])
    expect(r.transactions).toMatchObject([
      { type: 'sell', ticker: 'EXAMPLE', exchange: 'PL', quantity: 3, amountPLN: 60, originalCurrency: 'PLN', externalId: '2' },
      { type: 'buy', ticker: 'EXAMPLE', exchange: 'PL', quantity: 4, amountPLN: -60, externalId: '1' },
    ])
  })

  it('finds the header row wherever it is, and reads quoted fields', () => {
    const text = [
      'Cash Operations,',
      '"Type","Instrument","Time","Amount","ID","Comment","Product"',
      '"Deposit","","2026-01-02 09:00:00","1000","1","",""',
      '"Total","","","1000","","",""',
    ].join('\r\n')
    expect(parse(text)).toMatchObject({ warnings: [], transactions: [{ type: 'deposit', amountPLN: 1000 }] })
  })

  it('parseXTBCashOperations reads a File', async () => {
    const file = new File([cashOps([row('Deposit', '', '2026-01-02 09:00:00', 5, '1', '', '')])], 'cash.csv')
    const r = await parseXTBCashOperations(file, 'xtb', new Set())
    expect(r.transactions).toHaveLength(1)
  })
})

// ─── Duplicates ────────────────────────────────────────────────────────────────

describe('duplicates', () => {
  const sale = cashOps([row('Stock sale', 'Acme Corp', '2026-01-05 15:00:00', 600, '7', 'CLOSE BUY ACME.US 5 @ 30.00')])

  it('a sale that already came in from a daily confirmation is counted once', () => {
    const fromPdf: Transaction = {
      id: 'pdf', accountId: 'xtb', type: 'sell', date: '2026-01-05T15:00:00.000Z', amountPLN: 600, ticker: 'ACME', quantity: 5,
      externalId: 'xtb-order:123', source: 'xtb_confirmation', createdAt: '',
    }
    const r = parse(sale, [fromPdf])
    expect(r.transactions).toEqual([])
    expect(r.crossFormatSkipped).toBe(1)
    expect(r.warnings).toEqual([])
  })

  it('a sale already recorded with Close position is flagged, not imported again', () => {
    const closedByHand: Transaction = {
      id: 'hand', accountId: 'xtb', type: 'sell', date: '2026-01-06', amountPLN: 595, ticker: 'ACME', quantity: 5,
      externalId: 'close-sell-h1', relatedHoldingId: 'h1', source: 'manual', affectsCash: true, createdAt: '',
    }
    const r = parse(sale, [closedByHand])
    expect(r.transactions).toEqual([])
    expect(r.crossFormatSkipped).toBe(0)
    expect(r.closedByHand).toMatchObject([{ sale: { ticker: 'ACME', quantity: 5, amountPLN: 600 }, existing: { id: 'hand' } }])
    expect(r.warnings).toEqual([]) // still accounted for in the Total
  })

  it('a hand-recorded sale of another quantity, ticker or week is not a match', () => {
    const base: Transaction = {
      id: 'hand', accountId: 'xtb', type: 'sell', date: '2026-01-05', amountPLN: 600, ticker: 'ACME', quantity: 5,
      externalId: 'close-sell-h1', source: 'manual', createdAt: '',
    }
    for (const other of [{ quantity: 4 }, { ticker: 'OTHER' }, { date: '2026-01-12' }, { accountId: 'elsewhere' }]) {
      expect(parse(sale, [{ ...base, ...other }]).transactions).toHaveLength(1)
    }
  })
})
