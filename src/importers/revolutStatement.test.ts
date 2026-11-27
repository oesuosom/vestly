import { describe, expect, it } from 'vitest'
import { isRevolutStatementText, parseRevolutStatement, parseStatementNumber } from '@/importers/revolutStatement'
import { HEADER, STATEMENT_PAGES, TX_HEADER } from '@/importers/revolutStatement.fixture'

/** The UTC instant of a local time, in whatever zone the tests run in. */
const local = (y: number, m: number, d: number, h: number, mi: number, s = 0) => new Date(y, m - 1, d, h, mi, s).toISOString()

describe('isRevolutStatementText', () => {
  it('recognises the statement by its title and Transactions header, not its file name', () => {
    expect(isRevolutStatementText(STATEMENT_PAGES.flat())).toBe(true)
  })

  it('needs both', () => {
    expect(isRevolutStatementText(['Crypto Account Statement', 'Symbol Asset Amount'])).toBe(false)
    expect(isRevolutStatementText([TX_HEADER])).toBe(false)
  })
})

describe('parseStatementNumber', () => {
  it('reads comma thousands and dot decimals, with or without decimals', () => {
    expect(parseStatementNumber('400,000.00')).toBe(400000)
    expect(parseStatementNumber('0.00001000')).toBe(0.00001)
    expect(parseStatementNumber('25')).toBe(25)
    expect(parseStatementNumber('1,250')).toBe(1250)
  })

  it('refuses what isn’t a number', () => {
    expect(parseStatementNumber('2.5O')).toBeNull()
    expect(parseStatementNumber('PLN')).toBeNull()
    expect(parseStatementNumber('1,25.0')).toBeNull()
  })
})

describe('parseRevolutStatement', () => {
  const statement = parseRevolutStatement(STATEMENT_PAGES)

  it('reads the period as local days', () => {
    expect(statement.period).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('reads every row of the Transactions table across pages, skipping the repeated headers', () => {
    expect(statement.rows.map((r) => `${r.symbol} ${r.type}`)).toEqual([
      'BTC buy', 'ETH buy', 'ETH buy', 'XRP buy', 'XRP sell', 'BTC send', 'BTC receive', 'ADA receive',
    ])
    expect(statement.rows.map((r) => [r.page, r.row])).toEqual([[2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [3, 1], [3, 2], [3, 3]])
  })

  it('reads quantity, price, value and fee, with and without decimals', () => {
    expect(statement.rows[0]).toMatchObject({ symbol: 'BTC', type: 'buy', quantity: 0.025, price: 400000, value: 10000, fee: 100 })
    expect(statement.rows[4]).toMatchObject({ symbol: 'XRP', type: 'sell', quantity: 25, price: 2, value: 50, fee: 1 })
  })

  it('reads AM and PM, 12 AM as midnight, as local time', () => {
    expect(statement.rows[0].date).toBe(local(2025, 1, 5, 15, 4, 12))
    expect(statement.rows[1].date).toBe(local(2025, 2, 1, 9, 0, 0))
    expect(statement.rows[3].date).toBe(local(2025, 2, 3, 12, 15, 0))
    expect(statement.rows[6].date).toBe(local(2025, 6, 1, 0, 0, 0))
  })

  it('turns an unreadable row into a warning with its page, row and raw text', () => {
    expect(statement.warnings).toEqual([
      {
        page: 3,
        row: 4,
        raw: 'XRP Buy 2.5O 2.00 PLN 5.00 PLN 0.00 PLN Mar 1, 2025, 10:00:00AM',
        message: 'Couldn’t read the quantity, so this row isn’t imported.',
        summary: 'XRP · Buy · 5,00 PLN',
      },
    ])
  })

  it('counts staking rewards per coin and imports none of them', () => {
    expect(statement.staking).toEqual({ SOL: 1 })
    expect(statement.rows.some((r) => r.symbol === 'SOL')).toBe(false)
  })

  it('takes the closing amounts from Account summary, and names and prices from both tables', () => {
    expect(statement.closing).toEqual({
      BTC: { quantity: 0.02, source: 'summary' },
      ETH: { quantity: 0.02, source: 'summary' },
      XRP: { quantity: 75, source: 'summary' },
      SOL: { quantity: 2.1, source: 'summary' },
      ADA: { quantity: 10, source: 'summary' },
    })
    expect(statement.opening).toMatchObject({ SOL: 2, BTC: 0 })
    expect(statement.names).toMatchObject({ BTC: 'Bitcoin', SOL: 'Solana', XRP: 'XRP' })
    expect(statement.prices).toMatchObject({ BTC: 400000, XRP: 2 })
  })

  it('falls back to Portfolio breakdown, where a coin it doesn’t list is no longer held', () => {
    const pages = [
      [
        ...HEADER,
        'Portfolio breakdown',
        'Symbol Asset Amount Price Value % of portfolio',
        'BTC Bitcoin 0.02000000 400,000.00 PLN 8,000.00 PLN 100%',
        'Transactions',
        TX_HEADER,
        'BTC Buy 0.02000000 400,000.00 PLN 8,000.00 PLN 0.00 PLN Jan 5, 2025, 3:04:12PM',
        'XRP Buy 25 2.00 PLN 50.00 PLN 0.00 PLN Jan 6, 2025, 3:04:12PM',
        'XRP Sell 25 2.00 PLN 50.00 PLN 0.00 PLN Jan 7, 2025, 3:04:12PM',
      ],
    ]
    expect(parseRevolutStatement(pages).closing).toEqual({
      BTC: { quantity: 0.02, source: 'breakdown' },
      XRP: { quantity: 0, source: 'not_listed' },
    })
  })

  it('counts the Staking rewards section when the table has no staking rows', () => {
    const pages = [[...HEADER, 'Staking rewards', 'Symbol Date Amount', 'SOL Jul 1, 2025, 1:00:00AM 0.10000000', 'SOL Aug 1, 2025, 1:00:00AM 0.10000000']]
    expect(parseRevolutStatement(pages).staking).toEqual({ SOL: 2 })
  })

  it('joins a row whose date wrapped onto the next line', () => {
    const pages = [[...HEADER, TX_HEADER, 'ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 1.00 PLN', 'Feb 1, 2025, 9:00:00AM']]
    const { rows, warnings } = parseRevolutStatement(pages)
    expect(warnings).toEqual([])
    expect(rows).toMatchObject([{ symbol: 'ETH', type: 'buy', date: local(2025, 2, 1, 9, 0, 0) }])
  })

  it('accepts a space before AM/PM and a time without seconds', () => {
    const pages = [[...HEADER, TX_HEADER, 'ETH Sell 0.01 10,000.00 PLN 100.00 PLN 1.00 PLN Feb 1, 2025, 9:30 PM']]
    expect(parseRevolutStatement(pages).rows[0].date).toBe(local(2025, 2, 1, 21, 30, 0))
  })

  it('warns about a type it doesn’t know, a missing date and amounts in another currency', () => {
    const pages = [
      [
        ...HEADER,
        TX_HEADER,
        'ETH Exchange 0.01 10,000.00 PLN 100.00 PLN 1.00 PLN Feb 1, 2025, 9:00:00AM',
        'ETH Buy 0.01 10,000.00 PLN 100.00 PLN 1.00 PLN',
        'ETH Buy 0.01 2,500.00 EUR 25.00 EUR 0.25 EUR Feb 1, 2025, 9:00:00AM',
      ],
    ]
    const { rows, warnings } = parseRevolutStatement(pages)
    expect(rows).toEqual([])
    expect(warnings.map((w) => [w.row, w.message])).toEqual([
      [1, '“Exchange” isn’t a type the import knows, so this row isn’t imported.'],
      [2, 'Couldn’t read the date and time, so this row isn’t imported.'],
      [3, 'Amounts are in EUR, not PLN, so this row isn’t imported.'],
    ])
  })

  it('ignores page furniture between rows', () => {
    const pages = [[...HEADER, TX_HEADER, 'Report lost or stolen card', '+44 20 3322 8352', 'Page 1 of 1']]
    expect(parseRevolutStatement(pages)).toMatchObject({ rows: [], warnings: [] })
  })
})
