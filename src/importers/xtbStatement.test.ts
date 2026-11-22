import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import type { Transaction } from '@/types'
import { detectFileFormat } from './formatDetector'
import { parseXTBCashOperations, parseXTBCashOperationsText, type ParseResult } from './xtbParser'
import { detectSeparator, parseCSVNumber, StatementCurrencyError } from './xtbStatement'
import {
  CASH_OPERATIONS,
  cashOperationsCSV,
  cashOperationsSheet,
  closedPositionsSheet,
  FAKE_ACCOUNT_NUMBER,
  openPositionsSheet,
  xtbStatementFile,
  type CashOpRow,
} from './xtbStatement.fixture'

const parseFile = (file: File, existing: Transaction[] = []) =>
  parseXTBCashOperations(file, 'xtb', new Set(existing.map((t) => t.externalId)), [], {}, existing)

const messages = (r: ParseResult) => r.warnings.map((w) => w.message)

/** What a transaction says, without the ids and timestamps each parse makes up. */
const facts = (r: ParseResult) => r.transactions.map(({ id: _id, createdAt: _c, ...t }) => t)

// ─── Detection ─────────────────────────────────────────────────────────────────

describe('detecting XTB’s .xlsx statement', () => {
  it('finds Cash Operations although it is not the first sheet', async () => {
    expect(await detectFileFormat(xtbStatementFile())).toEqual({ type: 'xtb_transactions' })
  })

  it('in any sheet order', async () => {
    const file = xtbStatementFile('statement.xlsx', { sheets: [openPositionsSheet(), cashOperationsSheet(), closedPositionsSheet()] })
    expect(await detectFileFormat(file)).toEqual({ type: 'xtb_transactions' })
  })

  it('confirms the sheet by its header row, not only its name', async () => {
    const renamed = { ...cashOperationsSheet(), name: 'Sheet7' }
    expect(await detectFileFormat(xtbStatementFile('s.xlsx', { sheets: [closedPositionsSheet(), renamed] })))
      .toEqual({ type: 'xtb_transactions' })

    const empty = { name: 'Cash Operations', rows: [['Account number', FAKE_ACCOUNT_NUMBER], ['Cash Operations', '']] }
    const r = await detectFileFormat(xtbStatementFile('s.xlsx', { sheets: [closedPositionsSheet(), empty, openPositionsSheet()] }))
    expect(r.type).not.toBe('xtb_transactions')
  })

  it('a statement without Cash Operations is not one', async () => {
    const r = await detectFileFormat(xtbStatementFile('s.xlsx', { sheets: [closedPositionsSheet(), openPositionsSheet()] }))
    expect(r.type).toBe('unknown_csv')
  })

  it('other workbooks keep today’s behaviour: their first sheet', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Shares'], ['Acme', 3]]), 'Holdings')
    const file = new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], 'holdings.xlsx')
    expect(await detectFileFormat(file)).toEqual({ type: 'unknown_csv', headers: ['Name', 'Shares'] })
  })

  it.each([
    ['XTB’s CSV', () => cashOperationsCSV()],
    ['a CSV saved with ; and decimal commas', () => cashOperationsCSV(CASH_OPERATIONS, { locale: 'pl' })],
    ['with a byte-order mark', () => '\uFEFF' + cashOperationsCSV(CASH_OPERATIONS, { locale: 'pl' })],
  ])('%s', async (_, text) => {
    expect(await detectFileFormat(new File([text()], 'cash.csv'))).toEqual({ type: 'xtb_transactions' })
  })
})

// ─── Parsing the .xlsx ─────────────────────────────────────────────────────────

describe('importing XTB’s .xlsx statement', () => {
  it('imports every Cash Operations row, and the rows add up to its Total', async () => {
    const r = await parseFile(xtbStatementFile())
    expect(messages(r)).toEqual([])
    expect(r.transactions).toHaveLength(CASH_OPERATIONS.length)
    expect(r.transactions.map((t) => [t.type, t.date, t.amountPLN, t.externalId])).toEqual([
      ['interest_tax', '2026-03-01T00:05:00.000Z', -0.36, '90000013'],
      ['interest', '2026-03-01T00:05:00.000Z', 1.89, '90000012'],
      ['dividend', '2026-02-25T06:00:00.000Z', 10, '90000011'],
      ['withholding_tax', '2026-02-20T12:00:01.500Z', -0.55, '90000010'],
      ['dividend', '2026-02-20T12:00:01.500Z', 3.66, '90000009'],
      ['buy', '2026-02-10T09:15:30.123Z', -412.5, '90000008'],
      ['buy', '2026-02-09T23:59:59.999Z', -51.2, '90000007'],
      ['buy', '2026-02-06T08:00:00.000Z', -86.4, '90000006'],
      ['buy', '2026-02-05T10:00:00.250Z', -105, '90000005'],
      ['buy', '2026-01-15T15:30:12.000Z', -120.4, '90000004'],
      ['buy', '2026-01-15T15:30:12.000Z', -80.27, '90000003'],
      ['buy', '2026-01-05T14:37:04.277Z', -80, '90000002'],
      ['deposit', '2026-01-02T08:00:00.000Z', 1100, '90000001'],
    ])
  })

  it('reads tickers, quantities and partial fills', async () => {
    const r = await parseFile(xtbStatementFile())
    const buys = r.transactions.filter((t) => t.type === 'buy').map((t) => [t.ticker, t.exchange, t.quantity, t.pricePerUnitOriginal])
    expect(buys).toEqual([
      ['EXGL', 'DE', 0.25, 400],
      ['SMPL', 'UK', 4, 2.5],
      ['VBLD', 'NL', 1, 20],
      ['PRZK', 'PL', 10, 10.5],
      ['ACME', 'US', 3, 10],
      ['ACME', 'US', 2, 10],
      ['ACME', 'US', 2, 10],
    ])
    expect(r.transactions.find((t) => t.type === 'withholding_tax')).toMatchObject({ relatedTicker: 'ACME', exchange: 'US' })
  })

  it('a day near midnight UTC stays that day', async () => {
    const r = await parseFile(xtbStatementFile())
    expect(r.transactions.find((t) => t.externalId === '90000007')?.date.slice(0, 10)).toBe('2026-02-09')
  })

  it('returns the statement period from the header block', async () => {
    const r = await parseFile(xtbStatementFile())
    expect(r.period).toEqual({ from: '2006-01-01', to: '2026-11-20T12:00:00.000Z' })
  })

  it('finds Cash Operations in any sheet order', async () => {
    const file = xtbStatementFile('PLN_s.xlsx', { sheets: [openPositionsSheet(), closedPositionsSheet(), cashOperationsSheet()] })
    expect((await parseFile(file)).transactions).toHaveLength(CASH_OPERATIONS.length)
  })

  it('says so when the workbook has no Cash Operations sheet', async () => {
    const file = xtbStatementFile('s.xlsx', { sheets: [closedPositionsSheet(), openPositionsSheet()] })
    await expect(parseFile(file)).rejects.toThrow('This file has no Cash Operations sheet.')
  })

  it('the Total check still catches rows that weren’t imported', async () => {
    const unknown: CashOpRow = ['Brand new type', '', '', '', '2026-01-03 10:00:00', 5, '90000099', '', 'My Trades', '']
    const file = xtbStatementFile('s.xlsx', { sheets: [cashOperationsSheet([...CASH_OPERATIONS, unknown])] })
    const r = await parseFile(file)
    expect(messages(r)).toEqual([
      "The rows add up to 178.87, but the file's Total row says 183.87: 5.00 PLN wasn't imported, so Cash will be off by that much",
      'Unknown transaction type: "Brand new type"',
    ])
  })

  it('a second import of the same file skips every row', async () => {
    const first = await parseFile(xtbStatementFile())
    const again = await parseFile(xtbStatementFile(), first.transactions)
    expect(again).toMatchObject({ transactions: [], skipped: CASH_OPERATIONS.length, warnings: [] })
  })

  it('the account number never reaches the result', async () => {
    const r = await parseFile(xtbStatementFile())
    expect(JSON.stringify(r)).not.toContain(FAKE_ACCOUNT_NUMBER)
    const csv = parseXTBCashOperationsText(cashOperationsCSV(), 'xtb', new Set())
    expect(JSON.stringify(csv)).not.toContain(FAKE_ACCOUNT_NUMBER)
  })
})

// ─── One parser, two sources ───────────────────────────────────────────────────

describe('the .xlsx and a CSV of the same sheet import the same', () => {
  it.each([
    ['XTB’s CSV', () => new File([cashOperationsCSV()], 'cash.csv')],
    ['a CSV saved in Polish: ; and decimal commas', () => new File([cashOperationsCSV(CASH_OPERATIONS, { locale: 'pl' })], 'cash.csv')],
  ])('%s', async (_, csv) => {
    const fromXLSX = await parseFile(xtbStatementFile())
    const fromCSV = await parseFile(csv())
    expect(messages(fromCSV)).toEqual([])
    expect(facts(fromCSV)).toEqual(facts(fromXLSX))
    expect(fromCSV.period).toEqual({ from: '2006-01-01T00:00:00.000Z', to: '2026-11-20T12:00:00.000Z' })
  })

  it('transfers pair up and cancel out in both', async () => {
    const legs: CashOpRow[] = [
      ['Subaccount transfer', '', '', '', '2026-01-03 10:00:00', -200, '90000021', 'Transfer', 'My Trades', ''],
      ['Subaccount transfer', '', '', '', '2026-01-03 10:00:00', 200, '90000020', 'Transfer', 'Investment Plans', ''],
    ]
    const rows = [...legs, ...CASH_OPERATIONS]
    const fromXLSX = await parseFile(xtbStatementFile('s.xlsx', { sheets: [cashOperationsSheet(rows)] }))
    const fromCSV = await parseFile(new File([cashOperationsCSV(rows, { locale: 'pl' })], 'cash.csv'))
    for (const r of [fromXLSX, fromCSV]) {
      expect(r).toMatchObject({ internalTransfersSkipped: 2, warnings: [] })
      expect(r.transactions).toHaveLength(CASH_OPERATIONS.length)
    }
  })
})

// ─── CSV saved by hand ─────────────────────────────────────────────────────────

describe('a Cash Operations CSV saved by hand', () => {
  it('with a byte-order mark', async () => {
    const r = await parseFile(new File(['\uFEFF' + cashOperationsCSV()], 'cash.csv'))
    expect(messages(r)).toEqual([])
    expect(r.transactions).toHaveLength(CASH_OPERATIONS.length)
  })

  it('in windows-1250, as Excel set to Polish saves it', async () => {
    const rows: CashOpRow[] = [['Stock purchase', 'Spółka Przykład SA', 'SPRZ.PL', 'STOCK', '2026-01-05 10:00:00', -50, '1', 'OPEN BUY 5 @ 10.00', 'My Trades', '2']]
    const text = cashOperationsCSV(rows, { locale: 'pl' })
    // Encode to windows-1250 by hand: the text is ASCII apart from these letters.
    const map: Record<string, number> = { ó: 0xf3, ł: 0xb3, '\u00A0': 0xa0 }
    const bytes = new Uint8Array([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)))
    const r = await parseFile(new File([bytes], 'cash.csv'))
    expect(messages(r)).toEqual([])
    expect(r.transactions).toMatchObject([{ instrument: 'Spółka Przykład SA', ticker: 'SPRZ', amountPLN: -50 }])
  })

  it('with times shown without seconds', () => {
    const text = cashOperationsCSV().replace('2026-01-02 08:00:00', '2026-01-02 8:00')
    const r = parseXTBCashOperationsText(text, 'xtb', new Set())
    expect(messages(r)).toEqual([])
    expect(r.transactions.at(-1)?.date).toBe('2026-01-02T08:00:00.000Z')
  })

  it('a deposit comment with commas stays one field', () => {
    const r = parseXTBCashOperationsText(cashOperationsCSV(), 'xtb', new Set())
    expect(r.transactions.at(-1)).toMatchObject({ type: 'deposit', amountPLN: 1100 })
  })
})

describe('detectSeparator', () => {
  it('is ; only when the header row needs it', () => {
    expect(detectSeparator(['Type,Instrument,Time,Amount'])).toBe(',')
    expect(detectSeparator(['Type;Instrument;Time;Amount'])).toBe(';')
    expect(detectSeparator(['Account number;1', 'Type,Amount;x'])).toBe(',')
    expect(detectSeparator(['nothing here'])).toBe(',')
  })
})

describe('parseCSVNumber', () => {
  it.each([
    ['-1 234,56', -1234.56],
    ['-1\u00A0234,56', -1234.56],
    ['1\u202F234\u202F567,8', 1234567.8],
    ['1.234,56', 1234.56],
    ['\u221212,5', -12.5],
    ['0,05', 0.05],
    ['12.5', 12.5],
    ['', Number.NaN],
    ['abc', Number.NaN],
  ])('with ; %s → %s', (text, n) => {
    expect(parseCSVNumber(text, ';')).toBe(n)
  })

  it('with , it reads numbers as it always did', () => {
    expect(parseCSVNumber('-1234.56', ',')).toBe(-1234.56)
  })
})

// ─── Account currency ──────────────────────────────────────────────────────────

describe('the account currency', () => {
  const nothingImported = 'This is a USD statement. Vestly imports PLN accounts only, so nothing was imported.'

  it('a PLN statement imports', async () => {
    expect((await parseFile(xtbStatementFile('PLN_statement.xlsx'))).transactions).toHaveLength(CASH_OPERATIONS.length)
  })

  it('Open Positions says USD: refused, whatever the file is called', async () => {
    const file = xtbStatementFile('statement.xlsx', { sheets: [closedPositionsSheet(), cashOperationsSheet(), openPositionsSheet('USD')] })
    await expect(parseFile(file)).rejects.toThrow(nothingImported)
    await expect(parseFile(file)).rejects.toBeInstanceOf(StatementCurrencyError)
  })

  it('Open Positions wins over the file name', async () => {
    const file = xtbStatementFile('USD_statement.xlsx')
    expect((await parseFile(file)).transactions).toHaveLength(CASH_OPERATIONS.length)
  })

  it('without Open Positions, the file name’s prefix', async () => {
    const xlsx = xtbStatementFile('USD_statement.xlsx', { sheets: [cashOperationsSheet()] })
    await expect(parseFile(xlsx)).rejects.toThrow(nothingImported)
    await expect(parseFile(new File([cashOperationsCSV()], 'EUR_cash.csv'))).rejects.toThrow(
      'This is a EUR statement. Vestly imports PLN accounts only, so nothing was imported.',
    )
  })

  it('unknown: imports as before', async () => {
    expect((await parseFile(new File([cashOperationsCSV()], 'cash.csv'))).transactions).toHaveLength(CASH_OPERATIONS.length)
    expect((await parseFile(new File([cashOperationsCSV()], 'ABC_cash.csv'))).transactions).toHaveLength(CASH_OPERATIONS.length)
    const noOpen = xtbStatementFile('statement.xlsx', { sheets: [cashOperationsSheet()] })
    expect((await parseFile(noOpen)).transactions).toHaveLength(CASH_OPERATIONS.length)
  })
})
