import type { Transaction } from '@/types'

/**
 * The calendar day (`yyyy-MM-dd`) a transaction counts on: the day it is
 * stored under, `date.slice(0, 10)`, never converted to the viewer's zone.
 *
 * XTB rows carry real UTC times, so this is their UTC day: the day XTB's own
 * file shows. Revolut, manual and Close position rows are stored at
 * `T00:00:00.000Z` (or date-only), so it is the day that was entered. Cash,
 * positions, the chart and tax years all count a row on this day, so every
 * screen shows it too. A row at 23:30 UTC stays on its day in Warsaw, where
 * it is already past midnight; west of UTC a row can be stored under the day
 * after the viewer's local today.
 *
 * To show it, pass it to `formatDate`: a bare `yyyy-MM-dd` is parsed as local
 * midnight of that same day, so no zone conversion happens.
 */
export function transactionDay(t: Pick<Transaction, 'date'>): string {
  return t.date.slice(0, 10)
}
