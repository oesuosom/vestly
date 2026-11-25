/**
 * Today's calendar date (`YYYY-MM-DD`) in the browser's local time zone.
 *
 * Use this wherever "today" means a calendar day (snapshots, the chart, import
 * fallbacks, cache keys, file names) so every part of the app agrees on the
 * date around midnight. Not for timestamps — those stay `toISOString()`.
 *
 * Same result as date-fns `format(new Date(), 'yyyy-MM-dd')`, but with no
 * imports, so the crash-recovery backup download can use it too.
 */
export function todayISO(): string {
  return localDate(new Date())
}

/** The local calendar date (`YYYY-MM-DD`) of an ISO timestamp, e.g. a cache's `fetchedAt`. */
export function localDateOf(timestamp: string): string {
  return localDate(new Date(timestamp))
}

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
