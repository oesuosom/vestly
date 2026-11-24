/**
 * Exchanges a user can pick for a holding. The code is what's stored on
 * `Holding.exchange` and what `tickerUtils` maps to each price provider's
 * suffix — its maps are checked against this list, so adding an exchange here
 * without a provider mapping fails to compile.
 *
 * 'CC' (crypto) isn't listed: importers set it, users never pick it.
 */
export const EXCHANGE_CODES = ['US', 'PL', 'UK', 'XETRA', 'NL'] as const

export type ExchangeCode = typeof EXCHANGE_CODES[number]

/**
 * XTB's market suffix ("ACME.DE" → "DE") → our exchange code. XTB writes
 * "DE" for XETRA and "NL" for Euronext Amsterdam; the rest are ours already.
 */
const XTB_SUFFIXES: Record<string, ExchangeCode> = {
  US: 'US',
  PL: 'PL',
  UK: 'UK',
  DE: 'XETRA',
  NL: 'NL',
}

/**
 * Our exchange code for one of XTB's market suffixes, or undefined when we
 * don't know the suffix. Callers keep an unknown suffix as it is and warn:
 * guessing a market would fetch another listing's prices.
 */
export function exchangeFromXTBSuffix(suffix: string): ExchangeCode | undefined {
  return XTB_SUFFIXES[suffix.trim().toUpperCase()]
}

/**
 * Exchange codes stored by earlier versions that mean one of ours: XTB
 * imports kept XTB's raw "DE", and eMakler imports kept its raw "DEU-XETRA".
 * Startup rewrites them (`storage/migrations.ts`).
 */
export const LEGACY_EXCHANGE_CODES: Readonly<Record<string, ExchangeCode>> = {
  DE: 'XETRA',
  'DEU-XETRA': 'XETRA',
}

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
