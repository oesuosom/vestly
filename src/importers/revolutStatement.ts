/**
 * Revolut's Crypto Account Statement (PDF): one file for a chosen period that
 * lists every crypto transaction for every coin, and each coin's amounts at the
 * start and end of the period.
 *
 * The document, as text (one line per row once the PDF is laid out):
 *
 *   Crypto Account Statement
 *   Generated on the 25 Nov 2026            ← repeated at the top of every page
 *   Period Jan 1, 2025 - Nov 25, 2026        ←  "
 *   Account summary
 *   Symbol Asset Opening value Amount out Amount in Closing value
 *   BTC Bitcoin 0.50000000 0.10000000 0.20000000 0.60000000      ← coin amounts
 *   20,000.00 PLN 4,000.00 PLN 8,000.00 PLN 24,000.00 PLN         ← PLN, under them
 *   Portfolio breakdown
 *   Symbol Asset Amount Price Value % of portfolio
 *   BTC Bitcoin 0.60000000 400,000.00 PLN 240,000.00 PLN 100%
 *   Transactions
 *   Symbol Type Quantity Price Value Fees Date                    ← repeated on every page
 *   ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 2.49 PLN Jan 5, 2025, 3:04:12PM
 *   Staking rewards
 *   …
 *
 * Numbers use comma thousands separators and dot decimals; quantities have up
 * to 8 decimals or none. Times are local (the owner checked them against the
 * app: Warsaw time, not UTC), with no space before AM/PM.
 *
 * Everything here is pure: it reads lines of text, so it can be tested on
 * synthetic statements. Anything it can't read becomes a warning with its page,
 * row and raw text; nothing is dropped silently.
 */

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

/** The trade types the import records. */
export type StatementRowType = 'buy' | 'sell' | 'send' | 'receive'

/** One readable row of the Transactions table. */
export type StatementRow = {
  /** 1-based page of the PDF. */
  page: number
  /** 1-based row of the Transactions table on that page. */
  row: number
  /** The row as read, for warnings and debugging. */
  raw: string
  /** Coin symbol, uppercased ("BTC"). */
  symbol: string
  type: StatementRowType
  /** The statement's Quantity column: Value ÷ Price (see `revolutStatementImport.ts`). */
  quantity: number
  /** Price per coin, rounded to 2 decimals by Revolut. Display only. */
  price: number
  /** PLN paid (buy), received (sell), or the transfer's value on the day. */
  value: number
  /** The fee in PLN. */
  fee: number
  /** The row's time as a real instant, converted from local time: UTC ISO. */
  date: string
}

export type StatementWarning = {
  page: number
  /** 1-based row of the table on that page; 0 when it isn't a table row. */
  row: number
  message: string
  raw: string
  /** "XRP · Buy · 5,00 PLN" — what the row seems to be, when that much is readable. */
  summary?: string
}

/** A coin's amount at the end of the period. */
export type ClosingAmount = {
  quantity: number
  source: 'summary' | 'breakdown' | 'not_listed'
}

export type RevolutStatement = {
  /** The statement's period, local calendar days `yyyy-MM-dd`. Null when it can't be read. */
  period: { from: string; to: string } | null
  rows: StatementRow[]
  /** Staking rewards, which are counted but not imported, per coin. */
  staking: Record<string, number>
  /**
   * Each coin's amount at the end of the period: Account summary's closing
   * value, else Portfolio breakdown's amount. A coin missing from a breakdown
   * that lists coins still held is `not_listed` (0) when there is no summary.
   */
  closing: Record<string, ClosingAmount>
  /** Coin amount at the start of the period, from Account summary. */
  opening: Record<string, number>
  /** Asset names by symbol ("Bitcoin"), from either table. */
  names: Record<string, string>
  /** Portfolio breakdown's price per coin in PLN, for a new holding's current price. */
  prices: Record<string, number>
  warnings: StatementWarning[]
}

// ─────────────────────────────────────────
// Recognising the document
// ─────────────────────────────────────────

const TITLE = /Crypto Account Statement/i
const TRANSACTIONS_HEADER = /^Symbol\s+Type\s+Quantity\s+Price\s+Value\s+Fees?\s+Date$/i

/** Whether the text is a Revolut Crypto Account Statement: its title and its Transactions header. */
export function isRevolutStatementText(lines: string[]): boolean {
  return lines.some((l) => TITLE.test(l)) && lines.some((l) => TRANSACTIONS_HEADER.test(normalise(l)))
}

// ─────────────────────────────────────────
// Small readers
// ─────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?'

/** Collapse whitespace (including non-breaking spaces) to single spaces. */
function normalise(line: string): string {
  return line.replace(/[\s  ]+/g, ' ').trim()
}

/** "1,234.56" → 1234.56; "25" → 25. Null when it isn't a plain number. */
export function parseStatementNumber(text: string): number | null {
  const t = text.replace(/^[+−-]/, '')
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(t) && !/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase())
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "Jan 5, 2025" or "5 Jan 2025" → "2025-01-05". */
function readDay(text: string): string | null {
  let m = text.match(new RegExp(`^${MONTH} (\\d{1,2}),? (\\d{4})$`, 'i'))
  if (m) return `${m[3]}-${pad(monthIndex(m[1]) + 1)}-${pad(Number(m[2]))}`
  m = text.match(new RegExp(`^(\\d{1,2}) ${MONTH},? (\\d{4})$`, 'i'))
  if (m) return `${m[3]}-${pad(monthIndex(m[2]) + 1)}-${pad(Number(m[1]))}`
  return null
}

const DAY = `(?:[A-Za-z]{3,9}\\.? \\d{1,2},? \\d{4}|\\d{1,2} [A-Za-z]{3,9}\\.?,? \\d{4})`
const PERIOD = new RegExp(`^Period:? (${DAY}) ?[-–—] ?(${DAY})`, 'i')

/** The "Period Jan 1, 2025 - Nov 25, 2026" line, as local days. */
function readPeriod(line: string): { from: string; to: string } | null {
  const m = line.match(PERIOD)
  if (!m) return null
  const from = readDay(m[1])
  const to = readDay(m[2])
  return from && to ? { from, to } : null
}

/** The row's date and time at the end of a line: "Jan 5, 2025, 3:04:12PM". */
const ROW_TIME = new RegExp(
  `(${MONTH}) (\\d{1,2}),? (\\d{4}),? (\\d{1,2}):(\\d{2})(?::(\\d{2}))? ?([AP]\\.?M\\.?)$`,
  'i',
)

/**
 * A local date and time as a UTC ISO timestamp, using the runtime's time zone
 * (the browser's: the person's own, which is the zone Revolut shows times in).
 */
export function localToUTC(year: number, month: number, day: number, hour: number, minute: number, second: number): string {
  return new Date(year, month, day, hour, minute, second).toISOString()
}

/** A row time anywhere in a line (the Staking rewards table puts it mid-row). */
const ANY_TIME = new RegExp(ROW_TIME.source.replace(/\$$/, ''), 'i')

type RowTime = { date: string; index: number }

function readRowTime(line: string): RowTime | null {
  const m = line.match(ROW_TIME)
  if (!m || m.index === undefined) return null
  const month = monthIndex(m[1])
  const day = Number(m[3])
  const year = Number(m[4])
  let hour = Number(m[5])
  const minute = Number(m[6])
  const second = m[7] ? Number(m[7]) : 0
  const pm = /^p/i.test(m[8])
  if (hour < 1 || hour > 12 || minute > 59 || second > 59 || day < 1 || day > 31) return null
  if (hour === 12) hour = 0
  if (pm) hour += 12
  return { date: localToUTC(year, month, day, hour, minute, second), index: m.index }
}

const SYMBOL = /^[A-Z0-9]{2,10}$/
const TYPE_WORDS: Record<string, StatementRowType> = {
  buy: 'buy',
  sell: 'sell',
  send: 'send',
  receive: 'receive',
}

/** Whether a Type cell is a staking reward (counted, not imported). */
const isStaking = (type: string) => /stak/i.test(type)

type Money = { amount: number; currency: string | null }

/**
 * The numbers in the middle of a row: quantity, then price, value and fee,
 * each with its currency when one follows ("10,000.00 PLN").
 */
function readNumbers(tokens: string[]): Money[] | null {
  const out: Money[] = []
  for (let i = 0; i < tokens.length; i++) {
    const n = parseStatementNumber(tokens[i])
    if (n === null) return null
    const next = tokens[i + 1]
    if (next && /^[A-Z]{3}$/.test(next) && parseStatementNumber(next) === null) {
      out.push({ amount: n, currency: next })
      i++
    } else {
      out.push({ amount: n, currency: null })
    }
  }
  return out
}

const fmtPLN = (n: number) => `${n.toFixed(2).replace('.', ',')} PLN`

// ─────────────────────────────────────────
// Sections
// ─────────────────────────────────────────

type Section = 'none' | 'summary' | 'breakdown' | 'transactions' | 'staking'

/** Lines Revolut repeats at the top and bottom of every page. */
function isBoilerplate(line: string): boolean {
  return (
    TITLE.test(line) ||
    /^Generated on/i.test(line) ||
    /^Period\b/i.test(line) ||
    /^Page \d+( of \d+)?$/i.test(line) ||
    /^\d+ ?\/ ?\d+$/.test(line)
  )
}

function sectionHeading(line: string): Section | null {
  if (/^Account summary$/i.test(line)) return 'summary'
  if (/^Portfolio breakdown$/i.test(line)) return 'breakdown'
  if (/^Transactions$/i.test(line)) return 'transactions'
  if (/^Staking rewards?$/i.test(line)) return 'staking'
  return null
}

const isTableHeader = (line: string) => /^Symbol\b/i.test(line)

/** A row of Account summary or Portfolio breakdown: symbol, asset name, then the numbers. */
type CoinLine = { symbol: string; name: string; coinAmounts: number[]; plnAmounts: number[] }

function readCoinLine(line: string): CoinLine | null {
  const tokens = line.split(' ')
  const symbol = tokens[0]
  if (!SYMBOL.test(symbol) || symbol === 'PLN') return null
  const nameWords: string[] = []
  let i = 1
  while (i < tokens.length && parseStatementNumber(tokens[i]) === null) nameWords.push(tokens[i++])
  const coinAmounts: number[] = []
  const plnAmounts: number[] = []
  for (; i < tokens.length; i++) {
    const n = parseStatementNumber(tokens[i])
    if (n === null) continue
    const next = tokens[i + 1]
    if (next === 'PLN' || next === 'zł') {
      plnAmounts.push(n)
      i++
    } else if (next?.startsWith('%') || tokens[i].endsWith('%')) {
      i++
    } else {
      // A coin amount may carry its symbol ("0.5 BTC"): skip it.
      if (next === symbol) i++
      coinAmounts.push(n)
    }
  }
  if (coinAmounts.length === 0 && plnAmounts.length === 0) return null
  return { symbol, name: nameWords.join(' ').replace(/[,:]$/, ''), coinAmounts, plnAmounts }
}

// ─────────────────────────────────────────
// Parser
// ─────────────────────────────────────────

/**
 * Read a statement from its pages, each a list of text lines in reading order.
 * Never throws: what it can't read is in `warnings`.
 */
export function parseRevolutStatement(pages: string[][]): RevolutStatement {
  const result: RevolutStatement = {
    period: null,
    rows: [],
    staking: {},
    closing: {},
    opening: {},
    names: {},
    prices: {},
    warnings: [],
  }
  const summaryClosing: Record<string, number> = {}
  const breakdown: Record<string, number> = {}
  let breakdownSeen = false
  let stakingInTable = 0
  const stakingSection: Record<string, number> = {}

  let section: Section = 'none'

  pages.forEach((rawLines, p) => {
    const page = p + 1
    const lines = rawLines.map(normalise).filter(Boolean)
    let rowOnPage = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!result.period && /^Period\b/i.test(line)) result.period = readPeriod(line)
      if (isBoilerplate(line)) continue

      const heading = sectionHeading(line)
      if (heading) {
        section = heading
        continue
      }
      if (TRANSACTIONS_HEADER.test(line)) {
        // The header repeats on every page the table runs over.
        section = 'transactions'
        continue
      }
      if (isTableHeader(line)) continue

      if (section === 'summary') {
        const coin = readCoinLine(line)
        if (!coin || coin.coinAmounts.length === 0) continue
        if (coin.name) result.names[coin.symbol] ??= coin.name
        // Opening, amount out, amount in, closing: closing is the last.
        if (coin.coinAmounts.length >= 4) {
          result.opening[coin.symbol] = coin.coinAmounts[0]
          summaryClosing[coin.symbol] = coin.coinAmounts[coin.coinAmounts.length - 1]
        } else {
          result.warnings.push({ page, row: 0, raw: line, message: `Couldn’t read ${coin.symbol}’s closing amount in Account summary.` })
        }
        continue
      }

      if (section === 'breakdown') {
        const coin = readCoinLine(line)
        if (!coin || coin.coinAmounts.length === 0) continue
        breakdownSeen = true
        if (coin.name) result.names[coin.symbol] ??= coin.name
        breakdown[coin.symbol] = coin.coinAmounts[0]
        if (coin.plnAmounts.length >= 1) result.prices[coin.symbol] = coin.plnAmounts[0]
        continue
      }

      if (section === 'staking') {
        if (ANY_TIME.test(line) && SYMBOL.test(line.split(' ')[0])) {
          const symbol = line.split(' ')[0]
          stakingSection[symbol] = (stakingSection[symbol] ?? 0) + 1
        }
        continue
      }

      if (section !== 'transactions') continue

      // A candidate row starts with a symbol and a word, or ends with a time.
      // Lines that do neither are page furniture (legal text, totals).
      let text = line
      const tokens = text.split(' ')
      const looksLikeRow = SYMBOL.test(tokens[0]) && tokens.length > 1 && /^[A-Za-z]/.test(tokens[1])
      let time = readRowTime(text)
      if (!looksLikeRow && !time) continue

      // A row whose date wrapped onto the next line.
      if (looksLikeRow && !time && i + 1 < lines.length) {
        const next = lines[i + 1]
        const nextTokens = next.split(' ')
        const nextIsRow = SYMBOL.test(nextTokens[0]) && nextTokens.length > 1 && /^[A-Za-z]/.test(nextTokens[1])
        const joined = `${text} ${next}`
        if (!nextIsRow && readRowTime(joined)) {
          text = joined
          time = readRowTime(joined)
          i++
        }
      }

      rowOnPage++
      const parsed = readTransactionRow(text, time, page, rowOnPage)
      if (parsed.kind === 'row') result.rows.push(parsed.row)
      else if (parsed.kind === 'staking') {
        stakingInTable++
        result.staking[parsed.symbol] = (result.staking[parsed.symbol] ?? 0) + 1
      } else result.warnings.push(parsed.warning)
    }
  })

  // Staking: the table's rows when it has them, else the Staking rewards section's.
  if (stakingInTable === 0) result.staking = stakingSection

  const coins = new Set([...Object.keys(summaryClosing), ...Object.keys(breakdown), ...result.rows.map((r) => r.symbol)])
  for (const symbol of coins) {
    if (symbol in summaryClosing) result.closing[symbol] = { quantity: summaryClosing[symbol], source: 'summary' }
    else if (symbol in breakdown) result.closing[symbol] = { quantity: breakdown[symbol], source: 'breakdown' }
    else if (Object.keys(summaryClosing).length === 0 && breakdownSeen) {
      // Portfolio breakdown lists only the coins still held.
      result.closing[symbol] = { quantity: 0, source: 'not_listed' }
    }
  }

  return result
}

type RowResult =
  | { kind: 'row'; row: StatementRow }
  | { kind: 'staking'; symbol: string }
  | { kind: 'warning'; warning: StatementWarning }

function readTransactionRow(text: string, time: RowTime | null, page: number, row: number): RowResult {
  // Everything before the date: symbol, type, then the numbers.
  const tokens = (time ? text.slice(0, time.index) : text).split(' ').filter(Boolean)
  const symbol = tokens[0] ?? ''
  const warn = (message: string, summary?: string): RowResult => ({
    kind: 'warning',
    warning: { page, row, raw: text, message, ...(summary && { summary }) },
  })

  if (!SYMBOL.test(symbol)) return warn('Couldn’t read the coin, so this row isn’t imported.')

  // The Type cell: the words of letters after the symbol ("Buy", "Staking reward").
  const typeWords: string[] = []
  let i = 1
  while (i < tokens.length && /^[A-Za-z][A-Za-z-]*$/.test(tokens[i])) typeWords.push(tokens[i++])
  const typeText = typeWords.join(' ')
  if (isStaking(typeText)) return { kind: 'staking', symbol }

  const type = TYPE_WORDS[typeText.toLowerCase()]
  const label = typeText || '?'
  if (!type) return warn(`“${label}” isn’t a type the import knows, so this row isn’t imported.`, `${symbol} · ${label}`)

  const typeLabel = type[0].toUpperCase() + type.slice(1)
  if (!time) return warn('Couldn’t read the date and time, so this row isn’t imported.', `${symbol} · ${typeLabel}`)

  const numbers = readNumbers(tokens.slice(i))
  // Value is the second-last PLN amount (price, value, fee), even when another cell is unreadable.
  const pln = tokens.flatMap((t, k) => (tokens[k + 1] === 'PLN' && parseStatementNumber(t) !== null ? [parseStatementNumber(t)!] : []))
  const value = pln.length >= 2 ? pln[pln.length - 2] : null
  const summary = value !== null ? `${symbol} · ${typeLabel} · ${fmtPLN(value)}` : `${symbol} · ${typeLabel}`

  if (!numbers || numbers.length !== 4) return warn('Couldn’t read the quantity, so this row isn’t imported.', summary)
  const [quantity, price, val, fee] = numbers
  if (quantity.currency !== null) return warn('Couldn’t read the quantity, so this row isn’t imported.', summary)
  const foreign = [price, val, fee].find((m) => m.currency !== null && m.currency !== 'PLN')
  if (foreign) return warn(`Amounts are in ${foreign.currency}, not PLN, so this row isn’t imported.`, summary)
  if (!(quantity.amount > 0)) return warn('The quantity is 0, so this row isn’t imported.', summary)

  return {
    kind: 'row',
    row: {
      page,
      row,
      raw: text,
      symbol,
      type,
      quantity: quantity.amount,
      price: price.amount,
      value: val.amount,
      fee: fee.amount,
      date: time.date,
    },
  }
}
