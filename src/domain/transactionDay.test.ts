import { describe, expect, it } from 'vitest'
import { transactionDay } from '@/domain/transactionDay'
import { formatDate, formatTooltipDate } from '@/utils/formatters'

describe('transactionDay', () => {
  it('is the UTC day of a full timestamp (XTB rows)', () => {
    expect(transactionDay({ date: '2026-11-10T23:30:00.000Z' })).toBe('2026-11-10')
    expect(transactionDay({ date: '2026-11-12T02:00:00.000Z' })).toBe('2026-11-12')
  })

  it('is the entered day of a row stored at midnight UTC (Revolut, manual, close)', () => {
    expect(transactionDay({ date: '2026-11-10T00:00:00.000Z' })).toBe('2026-11-10')
  })

  it('is the date itself for a date-only row', () => {
    expect(transactionDay({ date: '2026-11-10' })).toBe('2026-11-10')
  })

  it('formats as the same day, whatever the zone (a bare day is local midnight)', () => {
    expect(formatDate(transactionDay({ date: '2026-11-10T23:30:00.000Z' }))).toBe('10 Nov 2026')
    expect(formatDate(transactionDay({ date: '2026-11-12T02:00:00.000Z' }))).toBe('12 Nov 2026')
    expect(formatTooltipDate(transactionDay({ date: '2026-11-10T00:00:00.000Z' }))).toBe('10/11/26')
  })
})
