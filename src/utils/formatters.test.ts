import { describe, it, expect } from 'vitest'
import { formatPLN, formatPLNDetail, formatPercent, formatDate, formatMonth } from './formatters'

// ─── formatPLN ────────────────────────────────────────────────────────────────

describe('formatPLN', () => {
  it('formats a plain number with PLN suffix', () => {
    expect(formatPLN(500)).toBe('500 PLN')
  })

  it('formats thousands with Polish-style space separators', () => {
    expect(formatPLN(127450)).toBe('127 450 PLN')
    expect(formatPLN(1000000)).toBe('1 000 000 PLN')
  })

  it('rounds to the nearest whole PLN', () => {
    expect(formatPLN(1234.49)).toBe('1 234 PLN')
    expect(formatPLN(1234.89)).toBe('1 235 PLN')
  })

  it('handles negative values', () => {
    expect(formatPLN(-500)).toBe('-500 PLN')
    expect(formatPLN(-1500)).toBe('-1 500 PLN')
  })

  it('handles zero', () => {
    expect(formatPLN(0)).toBe('0 PLN')
  })
})

// ─── formatPLNDetail ──────────────────────────────────────────────────────────

describe('formatPLNDetail', () => {
  it('shows two decimal places', () => {
    expect(formatPLNDetail(1234.56)).toBe('1 234,56 PLN')
  })

  it('pads to two decimals when value is whole', () => {
    expect(formatPLNDetail(500)).toBe('500,00 PLN')
  })

  it('formats large numbers with space separators', () => {
    expect(formatPLNDetail(1234567.89)).toBe('1 234 567,89 PLN')
  })
})

// ─── formatPercent ────────────────────────────────────────────────────────────

describe('formatPercent', () => {
  it('formats a positive value without a sign by default', () => {
    expect(formatPercent(7.3)).toBe('7,3%')
  })

  it('adds a + sign for positive values when showSign is true', () => {
    expect(formatPercent(7.3, true)).toBe('+7,3%')
  })

  it('does not add + sign for negative values even with showSign', () => {
    expect(formatPercent(-7.3, true)).toBe('-7,3%')
  })

  it('formats zero without a sign', () => {
    expect(formatPercent(0, true)).toBe('0,0%')
  })

  it('rounds to one decimal place', () => {
    expect(formatPercent(7.36)).toBe('7,4%')  // rounds up
    expect(formatPercent(7.34)).toBe('7,3%')  // rounds down
  })
})

// ─── formatDate ───────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats an ISO date string to "d MMM yyyy"', () => {
    expect(formatDate('2026-02-14')).toBe('14 Feb 2026')
  })

  it('formats single-digit day without leading zero', () => {
    expect(formatDate('2026-01-03')).toBe('3 Jan 2026')
  })
})

// ─── formatMonth ──────────────────────────────────────────────────────────────

describe('formatMonth', () => {
  it('formats a YYYY-MM string to "MMM yyyy"', () => {
    expect(formatMonth('2026-02')).toBe('Feb 2026')
  })

  it('formats January correctly', () => {
    expect(formatMonth('2026-01')).toBe('Jan 2026')
  })
})
