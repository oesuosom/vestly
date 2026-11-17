import { describe, expect, it } from 'vitest'
import type { Account, Holding, Transaction } from '@/types'
import {
  deleteHoldingFromLog,
  describeTransactions,
  findAccountTransactions,
  findHoldingTransactions,
} from './holdingDeletion'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeHolding(overrides: Partial<Holding>): Holding {
  return {
    id: 'h1',
    accountId: 'acc1',
    name: 'Apple',
    ticker: 'AAPL',
    category: 'stock',
    quantity: 1,
    purchasePrice: 100,
    currentPrice: 100,
    purchaseDate: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't1',
    accountId: 'acc1',
    type: 'buy',
    date: '2026-01-01T00:00:00.000Z',
    amountPLN: -100,
    externalId: overrides.id ?? 't1',
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAccount(id: string, holdings: Holding[]): Account {
  return {
    id,
    name: id,
    type: 'brokerage',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    holdings,
  }
}

const ids = (txs: Transaction[]) => txs.map((t) => t.id)

// ─── findHoldingTransactions ──────────────────────────────────────────────────

describe('findHoldingTransactions', () => {
  // The scenario from #17: two Apple holdings bought on different dates.
  const apple1 = makeHolding({ id: 'apple-1' })
  const apple2 = makeHolding({ id: 'apple-2', purchaseDate: '2026-03-01' })
  const cash = makeHolding({ id: 'cash_acc1', name: 'Cash', ticker: undefined, category: 'cash', isSynthetic: true })
  const sameTicker = [makeAccount('acc1', [apple1, apple2, cash])]
  // What a load leaves behind: resolveDividendLinks points every AAPL dividend
  // and tax at the last AAPL holding, here apple-2.
  const sameTickerTxs = [
    makeTx({ id: 'deposit', type: 'deposit', amountPLN: 2000 }),
    makeTx({ id: 'buy-1', instrument: 'Apple', ticker: 'AAPL', amountPLN: -1200 }),
    makeTx({ id: 'buy-2', instrument: 'Apple', ticker: 'AAPL', amountPLN: -400 }),
    makeTx({ id: 'div', type: 'dividend', amountPLN: 55, relatedTicker: 'AAPL', relatedHoldingId: 'apple-2' }),
    makeTx({ id: 'tax', type: 'withholding_tax', amountPLN: -8, relatedTicker: 'AAPL', relatedHoldingId: 'apple-2' }),
  ]

  it('keeps everything when the first of two same-ticker holdings is deleted', () => {
    expect(findHoldingTransactions(apple1, sameTicker, sameTickerTxs)).toEqual([])
  })

  it('keeps ticker-linked dividends when the last same-ticker holding — the one they point at — is deleted', () => {
    expect(findHoldingTransactions(apple2, sameTicker, sameTickerTxs)).toEqual([])
  })

  it('still removes a row linked by id alone when the ticker is shared', () => {
    const txs = [makeTx({ id: 'div-by-id', type: 'dividend', amountPLN: 5, relatedInstrument: 'Apple', relatedHoldingId: 'apple-1' })]
    expect(ids(findHoldingTransactions(apple1, sameTicker, txs))).toEqual(['div-by-id'])
  })

  it('still removes a bond lot’s own buy when another lot shares the series', () => {
    const lot1 = makeHolding({ id: 'lot-1', name: 'EDO0136', ticker: 'EDO0136', category: 'bond' })
    const lot2 = makeHolding({ id: 'lot-2', name: 'EDO0136', ticker: 'EDO0136', category: 'bond' })
    const accounts = [makeAccount('acc1', [lot1, lot2])]
    const txs = [
      makeTx({ id: 'bond-buy-1', ticker: 'EDO0136', source: 'bond_holding', relatedHoldingId: 'lot-1' }),
      makeTx({ id: 'bond-buy-2', ticker: 'EDO0136', source: 'bond_holding', relatedHoldingId: 'lot-2' }),
    ]
    expect(ids(findHoldingTransactions(lot1, accounts, txs))).toEqual(['bond-buy-1'])
  })

  it('removes a ticker-linked dividend when the ticker is unique', () => {
    const accounts = [makeAccount('acc1', [apple1])]
    const txs = [makeTx({ id: 'div', type: 'dividend', amountPLN: 5, relatedTicker: 'AAPL', relatedHoldingId: 'apple-1' })]
    expect(ids(findHoldingTransactions(apple1, accounts, txs))).toEqual(['div'])
  })

  it('treats a shared name as ambiguous too, even with different tickers', () => {
    const a = makeHolding({ id: 'a', ticker: 'AAPL' })
    const b = makeHolding({ id: 'b', ticker: 'AAPL.DE' })
    const accounts = [makeAccount('acc1', [a, b])]
    const txs = [makeTx({ id: 'by-name', instrument: 'Apple' }), makeTx({ id: 'by-ticker', ticker: 'AAPL' })]
    expect(findHoldingTransactions(a, accounts, txs)).toEqual([])
  })

  it('matches by ticker, related ticker and instrument name when the holding is the only match', () => {
    const accounts = [makeAccount('acc1', [apple1, cash])]
    const txs = [
      makeTx({ id: 'deposit', type: 'deposit', amountPLN: 2000 }),
      makeTx({ id: 'buy-ticker', ticker: 'aapl' }),
      makeTx({ id: 'buy-name', instrument: 'APPLE' }),
      makeTx({ id: 'div-unlinked', type: 'dividend', amountPLN: 5, relatedTicker: 'AAPL' }),
      makeTx({ id: 'tax-by-name', type: 'withholding_tax', amountPLN: -1, relatedInstrument: 'apple' }),
      makeTx({ id: 'other', ticker: 'MSFT', instrument: 'Microsoft' }),
    ]
    expect(ids(findHoldingTransactions(apple1, accounts, txs))).toEqual([
      'buy-ticker', 'buy-name', 'div-unlinked', 'tax-by-name',
    ])
  })

  it('resolves a ticker-less transaction through the static instrument lookup', () => {
    const etf = makeHolding({ id: 'etf', name: 'S&P 500 ETF', ticker: 'CSPX', category: 'etf' })
    const accounts = [makeAccount('acc1', [etf])]
    const txs = [makeTx({ id: 'xtb-short-name', instrument: 'Core S&P 500' })]
    expect(ids(findHoldingTransactions(etf, accounts, txs))).toEqual(['xtb-short-name'])
  })

  it('never matches by ticker or name across accounts', () => {
    const accounts = [makeAccount('acc1', [apple1]), makeAccount('acc2', [])]
    const txs = [makeTx({ id: 'elsewhere', accountId: 'acc2', ticker: 'AAPL', instrument: 'Apple' })]
    expect(findHoldingTransactions(apple1, accounts, txs)).toEqual([])
  })

  it('always removes linked transactions, whichever account they sit in', () => {
    const accounts = [makeAccount('acc1', [apple1]), makeAccount('acc2', [])]
    const txs = [makeTx({ id: 'linked', accountId: 'acc2', type: 'dividend', amountPLN: 5, relatedHoldingId: 'apple-1' })]
    expect(ids(findHoldingTransactions(apple1, accounts, txs))).toEqual(['linked'])
  })

  it('keeps a transaction linked to another existing holding, even when its ticker matches', () => {
    const elsewhere = makeHolding({ id: 'apple-acc2', accountId: 'acc2' })
    const accounts = [makeAccount('acc1', [apple1]), makeAccount('acc2', [elsewhere])]
    const txs = [makeTx({ id: 'theirs', type: 'dividend', amountPLN: 5, relatedTicker: 'AAPL', relatedHoldingId: 'apple-acc2' })]
    expect(findHoldingTransactions(apple1, accounts, txs)).toEqual([])
  })

  it('falls back to ticker matching when a link points at a holding that no longer exists', () => {
    const accounts = [makeAccount('acc1', [apple1])]
    const txs = [makeTx({ id: 'stale', type: 'dividend', amountPLN: 5, relatedTicker: 'AAPL', relatedHoldingId: 'gone' })]
    expect(ids(findHoldingTransactions(apple1, accounts, txs))).toEqual(['stale'])
  })

  it('matches by name alone for a holding without a ticker', () => {
    const bond = makeHolding({ id: 'bond', name: 'EDO0136', ticker: undefined, category: 'bond' })
    const accounts = [makeAccount('acc1', [bond])]
    const txs = [makeTx({ id: 'bond-buy', instrument: 'EDO0136' }), makeTx({ id: 'other', instrument: 'COI0128' })]
    expect(ids(findHoldingTransactions(bond, accounts, txs))).toEqual(['bond-buy'])
  })

  it('gives a synthetic holding no transactions', () => {
    expect(findHoldingTransactions(cash, sameTicker, sameTickerTxs)).toEqual([])
  })
})

describe('findHoldingTransactions — closed holdings', () => {
  // AAPL bought by hand, closed (a filled-in buy and the sale), then bought again as a new holding.
  const closed = makeHolding({ id: 'closed', closedAt: '2026-03-10' })
  const rebuy = makeHolding({ id: 'rebuy' })
  const accounts = [{ ...makeAccount('acc1', [rebuy]), closedHoldings: [closed] }]
  const closeBuy = makeTx({ id: 'close-buy', ticker: 'AAPL', relatedHoldingId: 'closed' })
  const closeSale = makeTx({ id: 'close-sale', type: 'sell', amountPLN: 150, ticker: 'AAPL', relatedHoldingId: 'closed' })
  const rebuyBuy = makeTx({ id: 'rebuy-buy', ticker: 'AAPL' })
  const txs = [closeBuy, closeSale, rebuyBuy]

  it('gives a closed holding its own sale and filled-in buy', () => {
    expect(ids(findHoldingTransactions(closed, accounts, txs))).toEqual(['close-buy', 'close-sale'])
    expect(describeTransactions(findHoldingTransactions(closed, accounts, txs))).toBe('2 transactions (1 buy, 1 sell)')
  })

  it('never lets the open holding take the closed one\'s rows', () => {
    // The unlinked rebuy buy is ambiguous (two AAPL holdings), and the linked rows belong to `closed`.
    expect(findHoldingTransactions(rebuy, accounts, txs)).toEqual([])
  })

  it('drops the closed holding when re-linking the log after its delete', () => {
    const kept = deleteHoldingFromLog(closed, accounts, txs)
    expect(ids(kept)).toEqual(['rebuy-buy'])
  })
})

// ─── deleteHoldingFromLog ─────────────────────────────────────────────────────

describe('deleteHoldingFromLog', () => {
  const apple1 = makeHolding({ id: 'apple-1' })
  const apple2 = makeHolding({ id: 'apple-2' })
  const accounts = [makeAccount('acc1', [apple1, apple2])]
  const txs = [
    makeTx({ id: 'buy-1', ticker: 'AAPL' }),
    makeTx({ id: 'buy-2', ticker: 'AAPL' }),
    makeTx({ id: 'div', type: 'dividend', amountPLN: 55, relatedTicker: 'AAPL', relatedHoldingId: 'apple-2' }),
    makeTx({ id: 'tax', type: 'withholding_tax', amountPLN: -8, relatedTicker: 'AAPL', relatedHoldingId: 'apple-2' }),
  ]
  const links = (log: Transaction[]) => log.map((t) => `${t.id}→${t.relatedHoldingId ?? '-'}`)

  it('re-links the kept dividends to the holding that remains', () => {
    expect(links(deleteHoldingFromLog(apple2, accounts, txs))).toEqual([
      'buy-1→-', 'buy-2→-', 'div→apple-1', 'tax→apple-1',
    ])
  })

  it('leaves the links alone when the holding they point at stays', () => {
    expect(links(deleteHoldingFromLog(apple1, accounts, txs))).toEqual([
      'buy-1→-', 'buy-2→-', 'div→apple-2', 'tax→apple-2',
    ])
  })

  it('removes what belongs to a unique holding', () => {
    const solo = [makeAccount('acc1', [apple1])]
    const log = [makeTx({ id: 'buy', ticker: 'AAPL' }), makeTx({ id: 'deposit', type: 'deposit', amountPLN: 10 })]
    expect(ids(deleteHoldingFromLog(apple1, solo, log))).toEqual(['deposit'])
  })
})

// ─── findAccountTransactions ──────────────────────────────────────────────────

describe('findAccountTransactions', () => {
  it('returns every transaction in the account and nothing else', () => {
    const txs = [makeTx({ id: 'a' }), makeTx({ id: 'b', accountId: 'acc2' }), makeTx({ id: 'c', type: 'deposit' })]
    expect(ids(findAccountTransactions('acc1', txs))).toEqual(['a', 'c'])
  })
})

// ─── describeTransactions ─────────────────────────────────────────────────────

describe('describeTransactions', () => {
  it('returns null when nothing goes', () => {
    expect(describeTransactions([])).toBeNull()
  })

  it('names a single type without a breakdown', () => {
    expect(describeTransactions([makeTx({ id: 'a' })])).toBe('1 buy')
    expect(describeTransactions([makeTx({ id: 'a' }), makeTx({ id: 'b' })])).toBe('2 buys')
  })

  it('totals mixed types with a breakdown in a fixed order', () => {
    const txs = [
      makeTx({ id: 'd', type: 'dividend' }),
      makeTx({ id: 'b1' }),
      makeTx({ id: 'w', type: 'withholding_tax' }),
      makeTx({ id: 'b2' }),
    ]
    expect(describeTransactions(txs)).toBe('4 transactions (2 buys, 1 dividend, 1 dividend tax)')
  })
})
