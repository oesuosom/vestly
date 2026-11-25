// @vitest-environment jsdom
import { vi } from 'vitest'
import { runTransactionDayCases, type MockPortfolio } from '@/domain/transactionDay.cases'

// Pin the zone before anything in this file creates a Date (vi.hoisted runs
// ahead of the imports). Restored after the file's tests.
// The app's tsconfig has no Node types, so reach `process` through globalThis.
const originalTZ = vi.hoisted(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  env.TZ = 'Europe/Warsaw'
  return previous
})

const portfolio = vi.hoisted((): MockPortfolio => ({
  accounts: [], transactions: [], deleteTransaction: () => {}, deleteHolding: () => {}, setTransactions: () => {},
  replaceAccounts: () => {}, importTransactions: () => {}, closePosition: () => ({}),
}))
vi.mock('@/context/PortfolioContext', () => ({ usePortfolio: () => portfolio }))

// 23:30 UTC on 10 Nov is 00:30 on 11 Nov in Warsaw (UTC+1). Stored day: 10 Nov.
runTransactionDayCases({
  zone: 'Europe/Warsaw',
  offsetMinutes: -60,
  date: '2026-11-10T23:30:00.000Z',
  localDay: '2026-11-11',
}, portfolio, originalTZ)
