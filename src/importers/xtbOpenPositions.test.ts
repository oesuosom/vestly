import { describe, expect, it } from 'vitest'
import { checkHoldings } from '@/domain/holdingsCheck'
import type { Account } from '@/types'
import { detectFileFormat } from './formatDetector'
import { parseXTBCashOperations } from './xtbParser'
import { readWorkbook } from './xlsReader'
import { readOpenPositions } from './xtbStatement'
import {
  cashOperationsSheet,
  closedPositionsSheet,
  differencesStatementSheets,
  FAKE_ACCOUNT_NUMBER,
  openPositionsSheet,
  xtbStatementFile,
} from './xtbStatement.fixture'

const account: Account = { id: 'xtb', name: 'Demo Broker', type: 'brokerage', createdAt: '', lastUpdated: '', holdings: [] }

async function check(file: File) {
  const r = await parseXTBCashOperations(file, 'xtb', new Set())
  return checkHoldings(r.openPositions!, account, r.transactions)
}

describe('reading Open Positions', () => {
  it('reads every instrument with its lots, typed, in any sheet order', async () => {
    const file = xtbStatementFile('s.xlsx', { sheets: [openPositionsSheet(), cashOperationsSheet(), closedPositionsSheet()] })
    const op = readOpenPositions(await readWorkbook(file))!
    expect(op.asOf).toBe('2026-11-20T12:00:00.000Z')
    expect(op.holdings.map((h) => [h.key, h.exchange, h.name, h.category, h.quantity])).toEqual([
      ['ACME', 'US', 'Acme Corp', 'stock', 7],
      ['EXGL', 'XETRA', 'Example Global ETF', 'etf', 0.25],
      ['PRZK', 'PL', 'Przyklad SA', 'stock', 10],
      ['SMPL', 'UK', 'Sample Holdings', 'stock', 4],
      ['VBLD', 'NL', 'Voorbeeld NV', 'stock', 1],
    ])
    expect(op.holdings[0].lots).toEqual([{ positionId: '70000002', quantity: 7, openPrice: 10, openDate: '2026-01-05T14:37:04.277Z' }])
  })

  it('works out each instrument’s PLN price and currency rate from Value, not the market suffix', async () => {
    const op = readOpenPositions(await readWorkbook(xtbStatementFile()))!
    const by = Object.fromEntries(op.holdings.map((h) => [h.key, h]))
    expect(by.PRZK.rateToPLN).toBeCloseTo(1, 6)
    expect(by.PRZK.currentPricePLN).toBeCloseTo(11, 6)
    expect(by.SMPL.rateToPLN).toBeCloseTo(4, 6) // a ".UK" ticker priced in USD
    expect(by.SMPL.currentPricePLN).toBeCloseTo(10.4, 6)
    expect(by.EXGL.rateToPLN).toBeCloseTo(4.25, 2)
  })

  it('never reads the account number', async () => {
    const op = readOpenPositions(await readWorkbook(xtbStatementFile()))!
    expect(JSON.stringify(op)).not.toContain(FAKE_ACCOUNT_NUMBER)
  })

  it('a file without Open Positions has none', async () => {
    const wb = await readWorkbook(xtbStatementFile('s.xlsx', { sheets: [closedPositionsSheet(), cashOperationsSheet()] }))
    expect(readOpenPositions(wb)).toBeNull()
    const r = await parseXTBCashOperations(xtbStatementFile('s.xlsx', { sheets: [cashOperationsSheet()] }), 'xtb', new Set())
    expect(r.openPositions).toBeUndefined()
  })
})

describe('checking holdings against Open Positions', () => {
  it('everything matches, the merged ACME lot included', async () => {
    const r = await check(xtbStatementFile())
    expect(r.differences).toEqual([])
    expect(r.matching.map((m) => m.statement.key).sort()).toEqual(['ACME', 'EXGL', 'PRZK', 'SMPL', 'VBLD'])
  })

  it('finds each kind of difference, and only those', async () => {
    const r = await check(xtbStatementFile('s.xlsx', { sheets: differencesStatementSheets() }))
    expect(r.matching.map((m) => m.statement.key).sort()).toEqual(['ACME', 'EXGL', 'PRZK', 'VBLD'])
    expect(r.differences.map((d) => [d.kind, d.key, d.vestlyQuantity, 'statement' in d ? d.statement.quantity : null])).toEqual([
      ['free_shares', 'SPIN', 0, 3],
      ['broker_more', 'SMPL', 4, 6],
      ['gone', 'FOOI', 5, null],
      ['vestly_more', 'MUST', 5, 3],
    ])
    const smpl = r.differences.find((d) => d.key === 'SMPL')
    expect(smpl).toMatchObject({ missing: 2, lots: [{ positionId: '70000009', quantity: 2, openPrice: 2.4, openDate: '2026-01-20T13:00:00.000Z' }] })
  })
})

describe('the old "XTB" holdings CSV format', () => {
  it('is gone: a file with its columns is an unknown CSV, mapped by hand', async () => {
    const file = new File(['Symbol,Quantity,Open Price,Current Price,Open Date\nACME.US,2,10,12,2026-01-05'], 'holdings.csv')
    expect(await detectFileFormat(file)).toEqual({ type: 'unknown_csv', headers: ['Symbol', 'Quantity', 'Open Price', 'Current Price', 'Open Date'] })
  })
})
