import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { decodeText, excelSerialToISO, readWorkbook } from './xlsReader'
import { FAKE_ACCOUNT_NUMBER, serial, xtbStatementFile, xtbStatementXLSX } from './xtbStatement.fixture'

afterEach(() => vi.restoreAllMocks())

describe('excelSerialToISO', () => {
  it.each([
    ['2026-01-05 14:37:04.277391', '2026-01-05T14:37:04.277Z'],
    ['2026-01-15 15:30:12.000001', '2026-01-15T15:30:12.000Z'],
    ['2026-02-09 23:59:59.999600', '2026-02-09T23:59:59.999Z'],
    ['2026-02-10 09:15:30.123456', '2026-02-10T09:15:30.123Z'],
    ['2026-03-29 01:30:00', '2026-03-29T01:30:00.000Z'], // a DST change in Poland: no local time involved
    ['2026-10-25 02:30:00', '2026-10-25T02:30:00.000Z'],
    ['2026-02-20 12:00:01.500000', '2026-02-20T12:00:01.500Z'],
  ])('%s → %s, as UTC, cut to the millisecond', (time, iso) => {
    expect(excelSerialToISO(serial(time))).toBe(iso)
  })

  it('reads every millisecond of a day exactly', () => {
    const day = Date.UTC(2026, 0, 5)
    for (let ms = 1; ms < 86_400_000; ms += 997) {
      expect(excelSerialToISO((day + ms) / 86_400_000 + 25_569)).toBe(new Date(day + ms).toISOString())
    }
  })

  it('a whole number is a date with no time', () => {
    expect(excelSerialToISO(46027)).toBe('2026-01-05')
  })

  it('the 1904 date system', () => {
    expect(excelSerialToISO(46027 - 1462, true)).toBe('2026-01-05')
  })

  it('not a date', () => {
    expect(excelSerialToISO(Number.NaN)).toBeNull()
    expect(excelSerialToISO(12)).toBeNull()
  })
})

describe('readWorkbook', () => {
  it('reads every sheet in file order, as typed cells', async () => {
    const wb = await readWorkbook(xtbStatementFile())
    expect(wb.sheets.map((s) => s.name)).toEqual(['Closed Positions', 'Cash Operations', 'Open Positions'])
    const cash = wb.sheets[1].rows
    expect(cash[4]).toEqual(['Type', 'Instrument', 'Ticker', 'Category', 'Time', 'Amount', 'ID', 'Comment', 'Product', 'Position ID'])
    const deposit = cash.find((r) => r[0] === 'Deposit')!
    expect(typeof deposit[4]).toBe('number') // a date serial
    expect(deposit[5]).toBe(1100)
    expect(deposit[6]).toBe('90000001') // a numeric-looking id stays text
    expect(deposit[3]).toBe('') // an empty string, not a missing cell
  })

  it('never reads the account number', async () => {
    const wb = await readWorkbook(xtbStatementFile())
    for (const sheet of wb.sheets) expect(sheet.rows[0]).toEqual(['Account number'])
    expect(JSON.stringify(wb)).not.toContain(FAKE_ACCOUNT_NUMBER)
  })

  it("doesn't log SheetJS's size warnings for a zip with data descriptors, and reads it all", async () => {
    // The fixture's zip is written the way XTB's is; plain SheetJS logs about it.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    XLSX.read(xtbStatementXLSX(), { type: 'array' })
    expect(logged.mock.calls.some(([m]) => /^Bad uncompressed size: \d+ != 0$/.test(String(m)))).toBe(true)
    logged.mockClear()

    const wb = await readWorkbook(xtbStatementFile())
    expect(logged).not.toHaveBeenCalled()
    expect(wb.sheets[1].rows.at(-1)?.[0]).toBe('Total')
  })

  it('puts console.error back after reading', async () => {
    const original = console.error
    await readWorkbook(xtbStatementFile('again.xlsx'))
    expect(console.error).toBe(original)
  })

  it('opens a File once', async () => {
    const file = xtbStatementFile()
    const read = vi.spyOn(file, 'arrayBuffer')
    expect(await readWorkbook(file)).toBe(await readWorkbook(file))
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('decodeText', () => {
  const enc = (s: string) => new TextEncoder().encode(s)

  it('strips a UTF-8 byte-order mark', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Type,Amount')]))).toBe('Type,Amount')
  })

  it('keeps UTF-8', () => {
    expect(decodeText(enc('Spółka Przykład'))).toBe('Spółka Przykład')
  })

  it('falls back to windows-1250 when the bytes are not UTF-8', () => {
    // "Spółka" in windows-1250: ó = 0xF3, ł = 0xB3.
    const bytes = new Uint8Array([0x53, 0x70, 0xf3, 0xb3, 0x6b, 0x61])
    expect(decodeText(bytes)).toBe('Spółka')
  })
})
