import { vi } from 'vitest'
import { runMidnightCases } from '@/utils/todayMidnight.cases'

// Pin the zone before anything in this file creates a Date (vi.hoisted runs
// ahead of the imports). Restored after the file's tests.
// The app's tsconfig has no Node types, so reach `process` through globalThis.
const originalTZ = vi.hoisted(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const previous = env.TZ
  env.TZ = 'America/New_York'
  return previous
})

// 21:00 on 24 Nov in New York (UTC-5) is already 25 Nov in UTC.
runMidnightCases({
  zone: 'America/New_York',
  now: '2026-11-25T02:00:00Z',
  offsetMinutes: 300,
  localDate: '2026-11-24',
  utcDate: '2026-11-25',
}, originalTZ)
