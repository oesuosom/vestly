import { format, parseISO, subMonths, subYears } from 'date-fns'
import type { DateRange } from '@/types'

/** Format a number with Polish thousand spacing, e.g. "127 450". */
export function formatPLNNumber(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Format a number as PLN with Polish spacing, e.g. "127 450 PLN". */
export function formatPLN(value: number): string {
  return `${formatPLNNumber(value)} PLN`
}

/**
 * Format a number as PLN with 2 decimal places and Polish-style thousand
 * separators — intended for detail / drawer views where precision matters.
 * e.g. 1 234.56 PLN
 */
export function formatPLNDetail(value: number): string {
  const [intPart, decPart] = value.toFixed(2).split('.')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${intFormatted},${decPart} PLN`
}

/** Format a number as a percentage, e.g. "+7.3%" or "7.3%". */
export function formatPercent(value: number, showSign = false, decimals = 1): string {
  const sign = showSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals).replace('.', ',')}%`
}

/**
 * Format a quantity (shares, crypto units) with Polish separators.
 * Strips trailing decimal zeros; auto-expands to 8 places for tiny values (< 0.001).
 * e.g. 1 234,5 or 0,00012345
 */
export function formatQuantity(value: number, maxDecimals = 4): string {
  const decimals = value < 0.001 ? 8 : maxDecimals
  const [intPart, decPart] = value.toFixed(decimals).split('.')
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const trimmedDec = decPart.replace(/0+$/, '')
  return trimmedDec ? `${intFormatted},${trimmedDec}` : intFormatted
}

/** Convert an account name to a URL-safe slug, e.g. "IKE PKO" → "ike-pko". */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Format an ISO date string to "14 Feb 2026". */
export function formatDate(isoDate: string): string {
  return format(parseISO(isoDate), 'd MMM yyyy')
}

/** Format an ISO date string for chart tooltips, e.g. "14/02/26". */
export function formatTooltipDate(isoDate: string): string {
  return format(parseISO(isoDate), 'dd/MM/yy')
}

/** Format a YYYY-MM string to "Feb 2026". */
export function formatMonth(yearMonth: string): string {
  return format(parseISO(`${yearMonth}-01`), 'MMM yyyy')
}

/**
 * Format a YYYY-MM-DD snapshot date for chart X-axis labels.
 * Short ranges (≤ 6 months): "15 Mar"
 * Long ranges (> 6 months): "Mar 2026"
 */
export function formatChartDate(dateStr: string, shortRange: boolean): string {
  const parsed = parseISO(dateStr)
  return shortRange ? format(parsed, 'd MMM') : format(parsed, 'MMM yyyy')
}

/** Return the human-readable date range label for the chart controls, e.g. "Apr 2025 to Apr 2026". */
export function getDateRangeLabel(dateRange: DateRange, earliestDate?: string): string {
  const now = new Date()
  const end = format(now, 'MMM yyyy')
  if (dateRange === 'ALL') {
    if (!earliestDate) return ''
    return `${format(parseISO(earliestDate), 'MMM yyyy')} to ${end}`
  }
  const startDate: Date =
    dateRange === '1M' ? subMonths(now, 1) :
    dateRange === '3M' ? subMonths(now, 3) :
    dateRange === '6M' ? subMonths(now, 6) :
    subYears(now, 1)
  return `${format(startDate, 'MMM yyyy')} to ${end}`
}
