/**
 * A made-up Revolut Crypto Account Statement, as the lines the PDF reader
 * yields per page. Round numbers only; nothing here comes from a real file.
 *
 * Coins: BTC (bought, sold, sent, received), ETH (bought), XRP (bought, sold,
 * one unreadable row), SOL (held before the period, staked), ADA (received;
 * matches the statement).
 */
export const HEADER = ['Crypto Account Statement', 'Generated on the 1 Jan 2026', 'Period Jan 1, 2025 - Dec 31, 2025']
export const TX_HEADER = 'Symbol Type Quantity Price Value Fees Date'

export const STATEMENT_PAGES: string[][] = [
  [
    ...HEADER,
    'Account summary',
    'Symbol Asset Opening value Amount out Amount in Closing value',
    'BTC Bitcoin 0.00000000 0.01001000 0.03000000 0.02000000',
    '0.00 PLN 4,000.00 PLN 12,000.00 PLN 8,000.00 PLN',
    'ETH Ethereum 0 0 0.02000000 0.02000000',
    '0.00 PLN 0.00 PLN 200.00 PLN 200.00 PLN',
    'XRP XRP 0 25 100 75',
    '0.00 PLN 50.00 PLN 200.00 PLN 150.00 PLN',
    'SOL Solana 2.00000000 0 0.10000000 2.10000000',
    '800.00 PLN 0.00 PLN 40.00 PLN 840.00 PLN',
    'ADA Cardano 0 0 10 10',
    '0.00 PLN 0.00 PLN 20.00 PLN 20.00 PLN',
    'Portfolio breakdown',
    'Symbol Asset Amount Price Value % of portfolio',
    'BTC Bitcoin 0.02000000 400,000.00 PLN 8,000.00 PLN 86%',
    'ETH Ethereum 0.02000000 10,000.00 PLN 200.00 PLN 2%',
    'XRP XRP 75.00000000 2.00 PLN 150.00 PLN 2%',
    'SOL Solana 2.10000000 400.00 PLN 840.00 PLN 10%',
    'ADA Cardano 10.00000000 2.00 PLN 20.00 PLN 0%',
    'Page 1 of 3',
  ],
  [
    ...HEADER,
    'Transactions',
    TX_HEADER,
    'BTC Buy 0.02500000 400,000.00 PLN 10,000.00 PLN 100.00 PLN Jan 5, 2025, 3:04:12PM',
    'ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 1.00 PLN Feb 1, 2025, 9:00:00AM',
    'ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 1.00 PLN Feb 1, 2025, 9:00:00AM',
    'XRP Buy 100 2.00 PLN 200.00 PLN 2.00 PLN Feb 3, 2025, 12:15:00PM',
    'XRP Sell 25 2.00 PLN 50.00 PLN 1.00 PLN Feb 4, 2025, 7:31:58AM',
    'Page 2 of 3',
  ],
  [
    ...HEADER,
    TX_HEADER,
    'BTC Send 0.01000000 400,000.00 PLN 4,000.00 PLN 0.00 PLN Dec 13, 2025, 4:54:32PM',
    'BTC Receive 0.00500000 400,000.00 PLN 2,000.00 PLN 0.00 PLN Jun 1, 2025, 12:00:00AM',
    'ADA Receive 10 2.00 PLN 20.00 PLN 0.00 PLN Apr 1, 2025, 8:00:00AM',
    'XRP Buy 2.5O 2.00 PLN 5.00 PLN 0.00 PLN Mar 1, 2025, 10:00:00AM',
    'SOL Staking reward 0.10000000 400.00 PLN 40.00 PLN 0.00 PLN Jul 1, 2025, 1:00:00AM',
    'Staking rewards',
    'Symbol Date Amount',
    'SOL Jul 1, 2025, 1:00:00AM 0.10000000',
    'Page 3 of 3',
  ],
]
