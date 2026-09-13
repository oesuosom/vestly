/**
 * One row per import format, holding everything the import UI needs to know
 * about it.
 *
 * This used to be five parallel lists spread across two files (display label,
 * file badge, holding-type badge, suggested accounts, transactions-or-holdings).
 * Adding a format meant remembering all five, and two of them were shaped so
 * that forgetting one failed silently rather than at compile time.
 *
 * `Record<DetectedFormatType, FormatSpec>` is exhaustive, so a new member of
 * DetectedFormatType is a type error until it is described here.
 */
import type { DetectedFormatType } from '@/importers/formatDetector'
import type { AccountType } from '@/types'

/** The Badge variants the import UI uses. Subset of Badge's full palette. */
export type BadgeVariant =
  | 'blue' | 'teal' | 'purple' | 'orange' | 'neutral' | 'warning' | 'negative'

export type FormatSpec = {
  /** Full name, shown on the account step ("XTB Cash Operations"). */
  label: string
  /** Concise tag beside each uploaded file's name ("Cash Operations"). */
  fileBadge: string
  /** Holding-type badge above the account-step title. */
  badge: { label: string; variant: BadgeVariant }
  /**
   * Account types this format suits, used to pre-filter the account picker.
   * Empty means "no suggestion" — every account is offered.
   */
  accounts: AccountType[]
  /** True when the format produces transactions, false when it produces holdings. */
  transactional: boolean
}

export const FORMAT_SPECS: Record<DetectedFormatType, FormatSpec> = {
  pko_ike: {
    label: 'PKO IKE (Treasury Bonds)',
    fileBadge: 'Treasury Bonds',
    badge: { label: 'Treasury Bonds', variant: 'blue' },
    accounts: ['ike'],
    transactional: false,
  },
  xtb_holdings: {
    label: 'XTB Portfolio',
    fileBadge: 'Portfolio',
    badge: { label: 'Stocks & ETFs', variant: 'teal' },
    accounts: ['brokerage'],
    transactional: false,
  },
  xtb_transactions: {
    label: 'XTB Cash Operations',
    fileBadge: 'Cash Operations',
    badge: { label: 'Cash Operations', variant: 'teal' },
    accounts: ['brokerage'],
    transactional: true,
  },
  xtb_confirmation: {
    label: 'XTB Daily Confirmation',
    fileBadge: 'Daily Statement',
    badge: { label: 'Order Confirmation', variant: 'teal' },
    accounts: ['brokerage'],
    transactional: true,
  },
  emakler_portfolio: {
    label: 'eMakler Portfolio',
    fileBadge: 'Portfolio',
    badge: { label: 'Stocks & ETFs', variant: 'purple' },
    accounts: ['ikze'],
    transactional: false,
  },
  emakler_order_history: {
    label: 'eMakler Order History',
    fileBadge: 'Order History',
    badge: { label: 'Order History', variant: 'purple' },
    accounts: ['ikze'],
    transactional: false,
  },
  revolut_crypto: {
    label: 'Revolut Crypto',
    fileBadge: 'Crypto',
    badge: { label: 'Crypto', variant: 'orange' },
    accounts: ['crypto'],
    transactional: true,
  },
  revolut_btc_transfer: {
    label: 'Revolut BTC Transfer',
    fileBadge: 'BTC Transfer',
    badge: { label: 'Crypto', variant: 'orange' },
    accounts: ['crypto'],
    transactional: true,
  },
  unknown_csv: {
    label: 'CSV / Spreadsheet',
    fileBadge: 'CSV',
    badge: { label: 'Custom CSV', variant: 'neutral' },
    accounts: [],
    transactional: false,
  },
  unsupported: {
    label: 'Unsupported',
    fileBadge: 'Unsupported',
    badge: { label: 'Unsupported', variant: 'negative' },
    accounts: [],
    transactional: false,
  },
}
