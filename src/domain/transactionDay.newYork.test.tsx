// @vitest-environment jsdom
import { vi } from 'vitest'
import { runTransactionDayCases, type MockPortfolio } from '@/domain/transactionDay.cases'

// Pin the zone before anything in this file creates a Date (vi.hoisted runs
// ahead of the imports). Restored after the file's tests.
// The app's tsconfig has no Node types, so reach `process` through globalThis.
const originalTZ = vi.hoisted(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  env.TZ = 'America/New_York'
  return previous
})

const portfolio = vi.hoisted((): MockPortfolio => ({
  accounts: [], transactions: [], deleteTransaction: () => {}, deleteHolding: () => {}, setTransactions: () => {},
  replaceAccounts: () => {}, importTransactions: () => {}, closePosition: () => ({}),
}))
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))

// 02:00 UTC on 12 Nov is 21:00 on 11 Nov in New York (UTC-5). Stored day: 12 Nov,
// a day after the local date. At 21:30 local the last buy is stored "tomorrow".
runTransactionDayCases({
  zone: 'America/New_York',
  offsetMinutes: 300,
  date: '2026-11-12T02:00:00.000Z',
  localDay: '2026-11-11',
  closeNow: '2026-11-12T02:30:00.000Z',
}, portfolio, originalTZ)
