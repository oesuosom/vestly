import { afterAll, describe, expect, it, vi } from 'vitest'
import { parseRevolutStatement } from '@/importers/revolutStatement'
import { buildStatementTransactions, planStatementRows } from '@/importers/revolutStatementImport'
import { HEADER, TX_HEADER } from '@/importers/revolutStatement.fixture'
import { transactionDay } from '@/domain/transactionDay'

// Pin the zone before anything in this file creates a Date (vi.hoisted runs
// ahead of the imports). Restored after the file's tests.
// The app's tsconfig has no Node types, so reach `process` through globalThis.
const originalTZ = vi.hoisted(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  env.TZ = 'Europe/Warsaw'
  return previous
})

afterAll(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  if (originalTZ === undefined) delete env.TZ
  else env.TZ = originalTZ
})

const pages = [
  [
    ...HEADER,
    TX_HEADER,
    // Winter: Warsaw is UTC+1.
    'ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 1.00 PLN Jan 5, 2025, 3:04:12PM',
    // Summer: UTC+2, and 00:30 local is still the day before in UTC.
    'BTC Send 0.00001000 400,000.00 PLN 4.00 PLN 0.00 PLN Jul 1, 2025, 12:30:00AM',
    // New Year's Eve, late evening: still 31 December in UTC.
    'XRP Sell 25 2.00 PLN 50.00 PLN 1.00 PLN Dec 31, 2025, 11:30:00PM',
  ],
]

describe('Revolut statement times in Europe/Warsaw', () => {
  const statement = parseRevolutStatement(pages)

  it('converts local times to real UTC instants', () => {
    expect(statement.rows.map((r) => r.date)).toEqual([
      '2025-01-05T14:04:12.000Z',
      '2025-06-30T22:30:00.000Z',
      '2025-12-31T22:30:00.000Z',
    ])
  })

  it('stores the UTC time and counts each row on its UTC day', () => {
    const transactions = buildStatementTransactions({
      rows: planStatementRows(statement, new Set()),
      statement,
      accountId: 'revolut',
      now: '2026-01-01T00:00:00.000Z',
    })
    const send = transactions.find((t) => t.type === 'send')!
    expect(send.date).toBe('2025-06-30T22:30:00.000Z')
    expect(transactionDay(send)).toBe('2025-06-30')
    expect(send.externalId).toBe('revolut-stmt-BTC-send-2025-06-30T22:30:00.000Z-0.00001-1')
    expect(transactionDay(transactions.find((t) => t.type === 'sell')!)).toBe('2025-12-31')
  })
})
