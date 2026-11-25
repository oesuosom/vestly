import { vi } from 'vitest'
import { runMidnightCases } from '@/utils/todayMidnight.cases'

// Pin the zone before anything in this file creates a Date (vi.hoisted runs
// ahead of the imports). Restored after the file's tests.
// The app's tsconfig has no Node types, so reach `process` through globalThis.
const originalTZ = vi.hoisted(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  env.TZ = 'Europe/Warsaw'
  return previous
})

// 00:30 on 25 Nov in Warsaw (UTC+1) is still 24 Nov in UTC.
runMidnightCases({
  zone: 'Europe/Warsaw',
  now: '2026-11-24T23:30:00Z',
  offsetMinutes: -60,
  localDate: '2026-11-25',
  utcDate: '2026-11-24',
}, originalTZ)
