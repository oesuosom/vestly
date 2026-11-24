import { describe, expect, it, vi } from 'vitest'
import type { Account, Holding } from '@/types'
import { applyStatementCurrencies } from '@/domain/holdingsCheck'
import { withStatementCurrencies, type RateSource } from '@/features/import/holdingsCheckApply'
import { toEODHDTicker, toYahooTicker } from '@/services/market-data/tickerUtils'
import { parseXTBCashOperations, parseXTBCashOperationsText } from './xtbParser'
import { MIXED_MARKET_RATES, mixedMarketStatementSheets, xtbStatementFile } from './xtbStatement.fixture'

// Issue #67: XTB's market suffixes and each instrument's price currency.
// A synthetic statement shaped like a current export: ".UK" ETFs priced in
// USD, ".DE" instruments in EUR, a ".NL" one in USD, plus London shares quoted
// in pounds and in pence. Nothing here comes from a real account.

const parseMixed = () => parseXTBCashOperations(xtbStatementFile('s.xlsx', { sheets: mixedMarketStatementSheets() }), 'xtb', new Set())

/** NBP stand-in: table A with the made-up rates. */
function fakeRates(): RateSource & { table: ReturnType<typeof vi.fn> } {
  return {
    table: vi.fn(async () => new Map<string, number>([['USD', MIXED_MARKET_RATES.USD], ['EUR', MIXED_MARKET_RATES.EUR], ['GBP', MIXED_MARKET_RATES.GBP], ['CHF', 4.5]])),
    rate: async (currency) => MIXED_MARKET_RATES[currency as keyof typeof MIXED_MARKET_RATES],
  }
}

describe('importing the mixed-market statement', () => {
  it('translates XTB’s suffixes: DE → XETRA, NL → Amsterdam; the rest as they are', async () => {
    const r = await parseMixed()
    const buys = r.transactions.filter((t) => t.type === 'buy').map((t) => [t.ticker, t.exchange])
    expect(buys).toEqual([
      ['PNCE', 'UK'], ['GBPS', 'UK'], ['VBTK', 'NL'], ['MSTW', 'XETRA'], ['EXEU', 'XETRA'],
      ['SBND', 'UK'], ['SWLD', 'UK'], ['PRZK', 'PL'], ['ACME', 'US'],
    ])
    expect(r.openPositions!.holdings.map((h) => [h.ticker, h.exchange])).toEqual([
      ['ACME', 'US'], ['PRZK', 'PL'], ['SWLD', 'UK'], ['SBND', 'UK'], ['EXEU', 'XETRA'],
      ['MSTW', 'XETRA'], ['VBTK', 'NL'], ['GBPS', 'UK'], ['PNCE', 'UK'],
    ])
    expect(r.warnings).toEqual([])
  })

  it('gives every instrument the symbols of its own market', async () => {
    const r = await parseMixed()
    const symbols = Object.fromEntries(r.openPositions!.holdings.map((h) => [h.ticker, [toYahooTicker(h.ticker, h.exchange!), toEODHDTicker(h.ticker, h.exchange!)]]))
    expect(symbols).toEqual({
      ACME: ['ACME', 'ACME.US'],
      PRZK: ['PRZK.WA', 'PRZK.WAR'],
      SWLD: ['SWLD.L', 'SWLD.LSE'],
      SBND: ['SBND.L', 'SBND.LSE'],
      EXEU: ['EXEU.DE', 'EXEU.XETRA'],
      MSTW: ['MSTW.DE', 'MSTW.XETRA'],
      VBTK: ['VBTK.AS', 'VBTK.AS'],
      GBPS: ['GBPS.L', 'GBPS.LSE'],
      PNCE: ['PNCE.L', 'PNCE.LSE'],
    })
  })

  it('works out each instrument’s currency from Open Positions, with one NBP table', async () => {
    const r = await parseMixed()
    const rates = fakeRates()
    const statement = await withStatementCurrencies(r.openPositions!, rates)
    expect(Object.fromEntries(statement.holdings.map((h) => [h.ticker, h.currency]))).toEqual({
      ACME: 'USD', PRZK: 'PLN',
      SWLD: 'USD', SBND: 'USD',     // ".UK" ETFs priced in USD
      EXEU: 'EUR', MSTW: 'EUR',     // ".DE" in EUR
      VBTK: 'USD',                  // ".NL" priced in USD
      GBPS: 'GBP', PNCE: 'GBX',     // London in pounds, and in pence
    })
    expect(rates.table).toHaveBeenCalledTimes(1)
    expect(rates.table).toHaveBeenCalledWith(statement.asOf)
  })

  it('with NBP off, asks nothing: PLN instruments still get PLN, the rest stay unknown', async () => {
    const r = await parseMixed()
    const statement = await withStatementCurrencies(r.openPositions!, null)
    expect(statement.holdings.filter((h) => h.currency).map((h) => [h.ticker, h.currency])).toEqual([['PRZK', 'PLN']])
  })

  it('with NBP’s table unavailable, leaves the currencies unknown rather than failing', async () => {
    const r = await parseMixed()
    const rates: RateSource = { table: async () => { throw new Error('NBP: HTTP 500') }, rate: async () => 1 }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const statement = await withStatementCurrencies(r.openPositions!, rates)
    expect(statement.holdings.filter((h) => h.currency).map((h) => h.ticker)).toEqual(['PRZK'])
  })
})

describe('saving the statement’s currency on holdings', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const holding = (ticker: string, exchange: string, extra: Partial<Holding> = {}): Holding => ({
    id: ticker.toLowerCase(), accountId: 'xtb', name: ticker, ticker, exchange, category: 'stock', quantity: 1,
    purchasePrice: 1, currentPrice: 1, purchaseDate: '2026-01-02', createdAt: now, updatedAt: now, ...extra,
  })
  const accounts = (holdings: Holding[]): Account[] => [
    { id: 'xtb', name: 'XTB', type: 'brokerage', createdAt: now, lastUpdated: now, holdings },
    { id: 'other', name: 'Other', type: 'brokerage', createdAt: now, lastUpdated: now, holdings: [{ ...holding('GBPS', 'UK'), id: 'o', accountId: 'other' }] },
  ]

  it('sets it on the account’s holdings of each instrument, over what price data said', async () => {
    const statement = await withStatementCurrencies((await parseMixed()).openPositions!, fakeRates())
    const before = accounts([holding('GBPS', 'UK', { currency: 'GBX' }), holding('PNCE', 'UK'), holding('SWLD', 'UK'), holding('OTHR', 'US')])
    const after = applyStatementCurrencies(before, 'xtb', statement)
    expect(after[0].holdings.map((h) => [h.ticker, h.currency])).toEqual([
      ['GBPS', 'GBP'], ['PNCE', 'GBX'], ['SWLD', 'USD'], ['OTHR', undefined],
    ])
    expect(after[1]).toBe(before[1]) // another account's holding of the same ticker is untouched
  })

  it('returns the same accounts when nothing changes', async () => {
    const statement = await withStatementCurrencies((await parseMixed()).openPositions!, fakeRates())
    const before = accounts([holding('GBPS', 'UK', { currency: 'GBP' })])
    expect(applyStatementCurrencies(before, 'xtb', statement)).toBe(before)
  })
})

describe('an XTB suffix Vestly doesn’t know', () => {
  const csv = [
    'Type,Instrument,Ticker,Time,Amount,ID,Comment,Product',
    'Stock purchase,Exemple SA,EXPL.FR,2026-02-12 10:00:00,-40,3,OPEN BUY 1 @ 10.00,Stocks',
    'Stock purchase,Exemple SA,EXPL.FR,2026-02-11 10:00:00,-40,2,OPEN BUY 1 @ 10.00,Stocks',
    'Stock purchase,Acme Corp,ACME.US,2026-02-10 10:00:00,-40,1,OPEN BUY 1 @ 10.00,Stocks',
    'Total,,,,-120',
  ].join('\n')

  it('is kept as it is, nothing guessed', () => {
    const r = parseXTBCashOperationsText(csv, 'xtb', new Set())
    expect(r.transactions.map((t) => t.exchange)).toEqual(['FR', 'FR', 'US'])
  })

  it('is warned about once in the import preview', () => {
    const r = parseXTBCashOperationsText(csv, 'xtb', new Set())
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].message).toBe(
      'Unknown market ".FR" (Exemple SA): kept as it is, so prices for its holdings can\'t be fetched. Set the exchange on the holding to fix it.',
    )
    expect(r.warnings[0].row).toBe(2)
  })
})
