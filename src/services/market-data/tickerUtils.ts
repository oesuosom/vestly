import type { ExchangeCode } from '@/domain/exchanges'

// ─────────────────────────────────────────
// Ticker format helpers for each provider
// ─────────────────────────────────────────

/** Maps our internal exchange codes to Yahoo Finance ticker suffixes. */
const EXCHANGE_TO_YAHOO: Record<string, string> = {
  US:    '',
  PL:    '.WA',
  UK:    '.L',
  XETRA: '.DE',
  NL:    '.AS',    // Euronext Amsterdam
  CC:    '-USD',   // crypto: ETH → ETH-USD
} satisfies Record<ExchangeCode | 'CC', string>

/**
 * Convert a ticker + exchange to Yahoo Finance symbol format.
 * e.g. ('AGNC', 'US') → 'AGNC', ('KRU', 'PL') → 'KRU.WA', ('ETH', 'CC') → 'ETH-USD'
 */
export function toYahooTicker(ticker: string, exchange: string): string {
  if (exchange === 'CC') {
    // Crypto already has -USD suffix from XTB format (e.g. ETH-USD)
    if (ticker.includes('-')) return ticker
    return `${ticker}-USD`
  }
  const suffix = EXCHANGE_TO_YAHOO[exchange] ?? ''
  return `${ticker}${suffix}`
}

/** Maps our internal exchange codes to EODHD exchange suffixes. */
const EXCHANGE_TO_EODHD: Record<string, string> = {
  US:    'US',
  PL:    'WAR',
  UK:    'LSE',   // London Stock Exchange (e.g. EIMI.LSE, CSPX.LSE)
  XETRA: 'XETRA', // Frankfurt / XETRA (e.g. EXS1.XETRA)
  NL:    'AS',    // Euronext Amsterdam (e.g. ASML.AS)
  CC:    'CC',    // CryptoCompare (e.g. ETH-USD.CC, BTC-USD.CC)
} satisfies Record<ExchangeCode | 'CC', string>

/**
 * The currency a market's prices are usually in: the default for a holding
 * whose own price currency isn't known (see `holdingPriceCurrency` in
 * `domain/priceCurrency.ts`, which callers should use instead). London has no
 * single answer — its listings trade in USD, GBP or pence — so UK keeps the
 * USD default it always had.
 */
export function currencyForExchange(exchange: string): 'PLN' | 'USD' | 'EUR' {
  if (exchange === 'PL') return 'PLN'
  if (exchange === 'XETRA' || exchange === 'NL') return 'EUR'
  return 'USD'  // US, UK (LSE) by default, CC (crypto)
}

/**
 * Convert a ticker + exchange to EODHD format: "TICKER.EXCHANGE"
 * e.g. ('AGNC', 'US') → 'AGNC.US', ('KRU', 'PL') → 'KRU.WAR'
 *
 * For CC (crypto) exchange, EODHD expects the quote currency appended:
 * ('ETH', 'CC') → 'ETH-USD.CC'  (tickers without an existing dash get -USD appended)
 */
export function toEODHDTicker(ticker: string, exchange: string): string {
  const suffix = EXCHANGE_TO_EODHD[exchange] ?? exchange
  if (exchange === 'CC' && !ticker.includes('-')) {
    return `${ticker}-USD.${suffix}`
  }
  return `${ticker}.${suffix}`
}

/**
 * Convert a ticker + exchange to Alpha Vantage format.
 * Alpha Vantage uses plain tickers for US stocks.
 * Polish stocks are not well-supported; logs a warning.
 */
export function toAlphaVantageTicker(ticker: string, exchange: string): string {
  if (exchange === 'PL') {
    console.warn(
      `[AlphaVantage] Polish stock "${ticker}" (exchange: PL) may not be supported. ` +
      'Alpha Vantage has limited coverage of Warsaw Stock Exchange tickers.'
    )
  }
  return ticker
}

/**
 * Convert a ticker + exchange to Tiingo format.
 * Tiingo uses plain tickers for US stocks.
 * Polish stocks are not supported; logs a warning.
 */
export function toTiingoTicker(ticker: string, exchange: string): string {
  if (exchange === 'PL') {
    console.warn(
      `[Tiingo] Polish stock "${ticker}" (exchange: PL) is not supported by Tiingo. ` +
      'Tiingo only covers US and select international markets.'
    )
  }
  return ticker.toLowerCase()
}
