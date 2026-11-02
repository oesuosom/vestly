/**
 * Exchanges a user can pick for a holding. The code is what's stored on
 * `Holding.exchange` and what `tickerUtils` maps to each price provider's
 * suffix — its maps are checked against this list, so adding an exchange here
 * without a provider mapping fails to compile.
 *
 * 'CC' (crypto) isn't listed: importers set it, users never pick it.
 */
export const EXCHANGE_CODES = ['US', 'PL', 'UK', 'XETRA'] as const

export type ExchangeCode = typeof EXCHANGE_CODES[number]

/**
 * Picker options: a blank choice, every exchange in `EXCHANGE_CODES` order,
 * then 'Other'. Labels are per surface (a narrow table cell can't fit what a
 * form field can), but typing them as a full record means every picker has to
 * label every exchange — the drift that hid UK and XETRA from the XTB import.
 */
export function exchangeOptions(
  labels: Record<ExchangeCode, string>,
  blankLabel = '—',
): { value: string; label: string }[] {
  return [
    { value: '', label: blankLabel },
    ...EXCHANGE_CODES.map(code => ({ value: code, label: labels[code] })),
    { value: 'Other', label: 'Other' },
  ]
}
