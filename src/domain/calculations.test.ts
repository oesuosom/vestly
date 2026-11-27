import { describe, it, expect } from 'vitest'
import type { Account, AssetCategory, Holding, Transaction } from '@/types'
import {
  getHoldingValue,
  getHoldingPnL,
  getAccountValue,
  getTotalValue,
  getCurrentAllocation,
  getCategoryAllocation,
  getGroupDrift,
  needsRebalancing,
  calculateAverageCostBasis,
  calculateNetCryptoQuantity,
  recalculateCostBases,
  getDividendIncomeForHolding,
  getTotalReturn,
  getIncomeSummary,
  getPositions,
  getRealizedPnL,
  affectsCash,
  computeAccountCashBalance,
} from './calculations'

// ─── Helpers ───────────────────────────────────────────────────────────────────
// Minimal valid objects — only the fields each test actually cares about.

function makeHolding(overrides: Partial<Holding>): Holding {
  return {
    id: 'h1',
    accountId: 'acc1',
    name: 'Test Holding',
    category: 'stock',
    quantity: 1,
    purchasePrice: 100,
    currentPrice: 100,
    purchaseDate: '2024-01-01',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAccount(overrides: Partial<Account> & { holdings?: Holding[] }): Account {
  return {
    id: 'acc1',
    name: 'Test Account',
    type: 'brokerage',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastUpdated: '2024-01-01T00:00:00.000Z',
    holdings: [],
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 't1',
    accountId: 'acc1',
    type: 'buy',
    date: '2025-01-15T10:00:00.000Z',
    amountPLN: -1000,
    externalId: 'ext1',
    source: 'manual',
    createdAt: '2025-01-15T10:00:00.000Z',
    ...overrides,
  }
}

// ─── getHoldingValue ───────────────────────────────────────────────────────────

describe('getHoldingValue', () => {
  it('multiplies quantity by current price', () => {
    const holding = makeHolding({ quantity: 10, currentPrice: 150 })
    expect(getHoldingValue(holding)).toBe(1500)
  })

  it('returns zero when quantity is zero', () => {
    const holding = makeHolding({ quantity: 0, currentPrice: 150 })
    expect(getHoldingValue(holding)).toBe(0)
  })
})

// ─── getHoldingPnL ─────────────────────────────────────────────────────────────

describe('getHoldingPnL', () => {
  it('calculates profit correctly', () => {
    // Bought 10 shares at 100 PLN, now worth 120 PLN each
    const holding = makeHolding({ quantity: 10, purchasePrice: 100, currentPrice: 120 })
    const { pnl, pnlPercent } = getHoldingPnL(holding)
    expect(pnl).toBe(200)        // (120 - 100) × 10
    expect(pnlPercent).toBe(20)  // 20% gain
  })

  it('calculates loss correctly', () => {
    const holding = makeHolding({ quantity: 5, purchasePrice: 100, currentPrice: 80 })
    const { pnl, pnlPercent } = getHoldingPnL(holding)
    expect(pnl).toBe(-100)       // (80 - 100) × 5
    expect(pnlPercent).toBe(-20) // 20% loss
  })

  it('returns zero percent when cost basis is zero — no division by zero', () => {
    // Guarded on line 14 of calculations.ts — this verifies that guard works
    const holding = makeHolding({ quantity: 1, purchasePrice: 0, currentPrice: 50 })
    const { pnlPercent } = getHoldingPnL(holding)
    expect(pnlPercent).toBe(0)
  })

  it('returns zero P&L when price is unchanged', () => {
    const holding = makeHolding({ quantity: 10, purchasePrice: 100, currentPrice: 100 })
    const { pnl, pnlPercent } = getHoldingPnL(holding)
    expect(pnl).toBe(0)
    expect(pnlPercent).toBe(0)
  })
})

// ─── getAccountValue / getTotalValue ──────────────────────────────────────────

describe('getAccountValue', () => {
  it('sums all holding values', () => {
    const account = makeAccount({
      holdings: [
        makeHolding({ id: 'h1', quantity: 10, currentPrice: 100 }), // 1000
        makeHolding({ id: 'h2', quantity: 5, currentPrice: 200 }),  // 1000
      ],
    })
    expect(getAccountValue(account)).toBe(2000)
  })

  it('returns zero for an account with no holdings', () => {
    expect(getAccountValue(makeAccount({ holdings: [] }))).toBe(0)
  })
})

describe('getTotalValue', () => {
  it('sums values across all accounts', () => {
    const accounts = [
      makeAccount({ id: 'a1', holdings: [makeHolding({ id: 'h1', quantity: 1, currentPrice: 1000 })] }),
      makeAccount({ id: 'a2', holdings: [makeHolding({ id: 'h2', quantity: 1, currentPrice: 2000 })] }),
    ]
    expect(getTotalValue(accounts)).toBe(3000)
  })

  it('returns zero for an empty portfolio', () => {
    expect(getTotalValue([])).toBe(0)
  })
})

// ─── getCurrentAllocation ─────────────────────────────────────────────────────

describe('getCurrentAllocation', () => {
  it('returns all zeros when there are no accounts', () => {
    expect(getCurrentAllocation([])).toEqual({ bonds: 0, stocks: 0, cash: 0, crypto: 0 })
  })

  it('returns all zeros when total portfolio value is zero', () => {
    const account = makeAccount({
      holdings: [makeHolding({ quantity: 0, currentPrice: 100 })],
    })
    expect(getCurrentAllocation([account])).toEqual({ bonds: 0, stocks: 0, cash: 0, crypto: 0 })
  })

  it('correctly splits allocation across categories', () => {
    // Total: 1000 PLN — 600 bonds, 300 stocks, 100 cash
    const account = makeAccount({
      holdings: [
        makeHolding({ id: 'h1', category: 'bond',  quantity: 1, currentPrice: 600 }),
        makeHolding({ id: 'h2', category: 'stock', quantity: 1, currentPrice: 300 }),
        makeHolding({ id: 'h3', category: 'cash',  quantity: 1, currentPrice: 100 }),
      ],
    })
    const alloc = getCurrentAllocation([account])
    expect(alloc.bonds).toBe(60)
    expect(alloc.stocks).toBe(30)
    expect(alloc.cash).toBe(10)
    expect(alloc.crypto).toBe(0)
  })

  it('counts ETF holdings under stocks (same bucket as stock)', () => {
    // Both 'stock' and 'etf' should count as stocks
    const account = makeAccount({
      holdings: [
        makeHolding({ id: 'h1', category: 'etf',  quantity: 1, currentPrice: 500 }),
        makeHolding({ id: 'h2', category: 'stock', quantity: 1, currentPrice: 500 }),
      ],
    })
    const alloc = getCurrentAllocation([account])
    expect(alloc.stocks).toBe(100)
    expect(alloc.bonds).toBe(0)
  })

  it('works correctly across multiple accounts', () => {
    const acc1 = makeAccount({ id: 'a1', holdings: [makeHolding({ id: 'h1', category: 'bond',  quantity: 1, currentPrice: 500 })] })
    const acc2 = makeAccount({ id: 'a2', holdings: [makeHolding({ id: 'h2', category: 'stock', quantity: 1, currentPrice: 500 })] })
    const alloc = getCurrentAllocation([acc1, acc2])
    expect(alloc.bonds).toBe(50)
    expect(alloc.stocks).toBe(50)
  })
})

// ─── getCategoryAllocation ────────────────────────────────────────────────────

describe('getCategoryAllocation', () => {
  it('returns all zeros when there are no accounts', () => {
    expect(getCategoryAllocation([])).toEqual({ bond: 0, stock: 0, etf: 0, cash: 0, crypto: 0 })
  })

  it('keeps etf separate from stock', () => {
    const account = makeAccount({
      holdings: [
        makeHolding({ id: 'h1', category: 'etf',   quantity: 1, currentPrice: 400 }),
        makeHolding({ id: 'h2', category: 'stock',  quantity: 1, currentPrice: 600 }),
      ],
    })
    const alloc = getCategoryAllocation([account])
    expect(alloc.etf).toBe(40)
    expect(alloc.stock).toBe(60)
    expect(alloc.bond).toBe(0)
  })

  it('sums correctly across all 5 categories', () => {
    const account = makeAccount({
      holdings: [
        makeHolding({ id: 'h1', category: 'bond',   quantity: 1, currentPrice: 500 }),
        makeHolding({ id: 'h2', category: 'stock',  quantity: 1, currentPrice: 200 }),
        makeHolding({ id: 'h3', category: 'etf',    quantity: 1, currentPrice: 100 }),
        makeHolding({ id: 'h4', category: 'cash',   quantity: 1, currentPrice: 100 }),
        makeHolding({ id: 'h5', category: 'crypto', quantity: 1, currentPrice: 100 }),
      ],
    })
    const alloc = getCategoryAllocation([account])
    expect(alloc.bond).toBe(50)
    expect(alloc.stock).toBe(20)
    expect(alloc.etf).toBe(10)
    expect(alloc.cash).toBe(10)
    expect(alloc.crypto).toBe(10)
  })
})

// ─── getGroupDrift ────────────────────────────────────────────────────────────

describe('getGroupDrift', () => {
  const groups = [
    { id: 'bonds',  name: 'Bonds',  categories: ['bond']         as AssetCategory[], target: 50 },
    { id: 'equity', name: 'Equity', categories: ['stock', 'etf'] as AssetCategory[], target: 40 },
    { id: 'cash',   name: 'Cash',   categories: ['cash']         as AssetCategory[], target: 5  },
    { id: 'crypto', name: 'Crypto', categories: ['crypto']       as AssetCategory[], target: 5  },
  ]

  it('computes current and drift per group', () => {
    const catAlloc = { bond: 60, stock: 20, etf: 10, cash: 5, crypto: 5 }
    const result = getGroupDrift(groups, catAlloc)
    const equity = result.find((d) => d.group.id === 'equity')!
    expect(equity.current).toBe(30)  // stock(20) + etf(10)
    expect(equity.drift).toBe(-10)   // 30 - 40
    const bonds = result.find((d) => d.group.id === 'bonds')!
    expect(bonds.current).toBe(60)
    expect(bonds.drift).toBe(10)     // 60 - 50
  })
})


// ─── needsRebalancing ─────────────────────────────────────────────────────────

describe('needsRebalancing', () => {
  it('triggers when any group exceeds the threshold', () => {
    const driftItems = [{ drift: 6 }, { drift: -6 }, { drift: 0 }]
    expect(needsRebalancing(driftItems, 5)).toBe(true)
  })

  it('does not trigger when all drift is within the threshold', () => {
    const driftItems = [{ drift: 2 }, { drift: -1 }, { drift: 0.5 }]
    expect(needsRebalancing(driftItems, 5)).toBe(false)
  })

  it('handles negative drift — uses Math.abs', () => {
    const driftItems = [{ drift: -6 }]
    expect(needsRebalancing(driftItems, 5)).toBe(true)
  })

  it('does not trigger when drift exactly equals threshold (strictly greater-than)', () => {
    const driftItems = [{ drift: 5 }]
    expect(needsRebalancing(driftItems, 5)).toBe(false)
  })
})

// ─── calculateAverageCostBasis ────────────────────────────────────────────────

describe('calculateAverageCostBasis', () => {
  it('calculates weighted average across multiple buys', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'buy', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }), // 100 PLN each
      makeTx({ id: 't2', type: 'buy', ticker: 'ETFW', quantity: 10, amountPLN: -1200 }), // 120 PLN each
    ]
    const result = calculateAverageCostBasis(transactions, 'acc1', 'ETFW')
    expect(result.quantity).toBe(20)
    expect(result.costPLN).toBe(2200)
    expect(result.averageCostPLN).toBe(110) // (1000 + 1200) / 20
  })

  it('is case-insensitive for tickers', () => {
    const transactions = [makeTx({ type: 'buy', ticker: 'etfw', quantity: 5, amountPLN: -500 })]
    const result = calculateAverageCostBasis(transactions, 'acc1', 'ETFW')
    expect(result.quantity).toBe(5)
  })

  it('uses the rebuy price after everything was sold', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: 'ETFW', quantity: 10, amountPLN: 1500 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-03-10', ticker: 'ETFW', quantity: 10, amountPLN: -2000 }),
    ]
    const result = calculateAverageCostBasis(transactions, 'acc1', 'ETFW')
    expect(result.averageCostPLN).toBe(200) // not (1000 + 2000) / 20 = 150
    expect(result.quantity).toBe(10)
    expect(result.costPLN).toBe(2000)
  })

  it('leaves the average cost unchanged after a partial sale', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'buy',      date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'dividend', date: '2025-01-20', ticker: 'ETFW', quantity: undefined, amountPLN: 50 }),
      makeTx({ id: 't3', type: 'sell',     date: '2025-02-10', ticker: 'ETFW', quantity: 4, amountPLN: 600 }),
    ]
    const result = calculateAverageCostBasis(transactions, 'acc1', 'ETFW')
    expect(result.averageCostPLN).toBe(100)
    expect(result.quantity).toBe(6)
    expect(result.costPLN).toBe(600)
  })

  it('counts only the given account when the same ticker is held in two', () => {
    const transactions = [
      makeTx({ id: 't1', accountId: 'acc1', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', accountId: 'acc2', ticker: 'ETFW', quantity: 10, amountPLN: -3000 }),
    ]
    expect(calculateAverageCostBasis(transactions, 'acc1', 'ETFW').averageCostPLN).toBe(100)
    expect(calculateAverageCostBasis(transactions, 'acc2', 'ETFW').averageCostPLN).toBe(300)
  })

  it('ignores other tickers in the same account', () => {
    const transactions = [
      makeTx({ id: 't1', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', ticker: 'OTHR', quantity: 10, amountPLN: -9000 }),
    ]
    expect(calculateAverageCostBasis(transactions, 'acc1', 'ETFW').averageCostPLN).toBe(100)
  })

  it('matches transactions that carry only an instrument name', () => {
    // Imported before the ticker was known: `instrument` is all there is.
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: undefined, instrument: 'KGH', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: undefined, instrument: 'KGH', quantity: 10, amountPLN: 1500 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-03-10', ticker: 'KGH', quantity: 10, amountPLN: -2000 }),
    ]
    expect(calculateAverageCostBasis(transactions, 'acc1', 'KGH').averageCostPLN).toBe(200)
  })

  it('returns zeroes when nothing is held', () => {
    const empty = { averageCostPLN: 0, quantity: 0, costPLN: 0 }
    expect(calculateAverageCostBasis([], 'acc1', 'ETFW')).toMatchObject(empty)

    const soldOut = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: 'ETFW', quantity: 10, amountPLN: 1500 }),
    ]
    expect(calculateAverageCostBasis(soldOut, 'acc1', 'ETFW')).toMatchObject(empty)
  })

  it('includes Revolut fees, which are stored as separate rows with no ticker', () => {
    // 0.4 ETH for 2,400 + 24 fee, then 0.28 ETH for 1,850 + 18.50 fee:
    // cost 2,424 + 1,868.50 = 4,292.50 for 0.68 ETH → 6,312.50 per ETH.
    const eth = { accountId: 'revolut', source: 'revolut_crypto' as const, instrument: 'Ethereum', ticker: 'ETH' }
    const fee = { accountId: 'revolut', source: 'revolut_crypto' as const, type: 'fee' as const }
    const transactions = [
      makeTx({ ...eth, id: 't1', externalId: 'revolut-stmt-ETH-buy-2024-09-10T10:00:00.000Z-0.4-1',      date: '2024-09-10T10:00:00.000Z', quantity: 0.4,  amountPLN: -2400 }),
      makeTx({ ...fee, id: 't2', externalId: 'revolut-stmt-ETH-buy-2024-09-10T10:00:00.000Z-0.4-1-fee',  date: '2024-09-10T10:00:00.000Z', amountPLN: -24 }),
      makeTx({ ...eth, id: 't3', externalId: 'revolut-stmt-ETH-buy-2024-12-01T10:00:00.000Z-0.28-1',     date: '2024-12-01T10:00:00.000Z', quantity: 0.28, amountPLN: -1850 }),
      makeTx({ ...fee, id: 't4', externalId: 'revolut-stmt-ETH-buy-2024-12-01T10:00:00.000Z-0.28-1-fee', date: '2024-12-01T10:00:00.000Z', amountPLN: -18.5 }),
    ]
    const result = calculateAverageCostBasis(transactions, 'revolut', 'ETH')
    expect(result.quantity).toBeCloseTo(0.68, 10)
    expect(result.costPLN).toBeCloseTo(4292.5, 6)
    expect(result.averageCostPLN).toBeCloseTo(6312.5, 6)
  })
})

// ─── recalculateCostBases ─────────────────────────────────────────────────────

describe('recalculateCostBases', () => {
  /** Two accounts that each hold 10 ETFW with a stale purchase price of 1. */
  function twoAccounts(): Account[] {
    return [
      makeAccount({ id: 'acc1', holdings: [makeHolding({ id: 'h1', accountId: 'acc1', ticker: 'ETFW', quantity: 10, purchasePrice: 1 })] }),
      makeAccount({ id: 'acc2', holdings: [makeHolding({ id: 'h2', accountId: 'acc2', ticker: 'ETFW', quantity: 10, purchasePrice: 1 })] }),
    ]
  }
  const transactions = [
    makeTx({ id: 't1', accountId: 'acc1', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
    makeTx({ id: 't2', accountId: 'acc2', ticker: 'ETFW', quantity: 10, amountPLN: -3000 }),
  ]

  it("gives the same ticker in two accounts each account's own cost", () => {
    const accounts = twoAccounts()
    const afterFirst = recalculateCostBases(accounts, transactions, 'acc1')
    const afterBoth = recalculateCostBases(afterFirst, transactions, 'acc2')
    expect(afterBoth[0].holdings[0].purchasePrice).toBe(100) // not the blended 200
    expect(afterBoth[1].holdings[0].purchasePrice).toBe(300)
  })

  it('changes only the given account', () => {
    const accounts = twoAccounts()
    const result = recalculateCostBases(accounts, transactions, 'acc1')
    expect(result[0].holdings[0].purchasePrice).toBe(100)
    expect(result[1]).toBe(accounts[1]) // same object: nothing rewritten, updatedAt not bumped
    expect(result[1].holdings[0].purchasePrice).toBe(1)
  })

  it('uses the rebuy price after everything was sold', () => {
    const accounts = [makeAccount({ holdings: [makeHolding({ ticker: 'ETFW', quantity: 10, purchasePrice: 150 })] })]
    const sellAndRebuy = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: 'ETFW', quantity: 10, amountPLN: 1500 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-03-10', ticker: 'ETFW', quantity: 10, amountPLN: -2000 }),
    ]
    const result = recalculateCostBases(accounts, sellAndRebuy, 'acc1')
    expect(result[0].holdings[0].purchasePrice).toBe(200)
  })

  it('leaves holdings alone when the log has no open position for them', () => {
    const untouched = [
      makeHolding({ id: 'h-cash', ticker: 'CASH', isSynthetic: true, purchasePrice: 1 }),
      makeHolding({ id: 'h-noticker', ticker: undefined, purchasePrice: 2 }),
      makeHolding({ id: 'h-notx', ticker: 'NOTX', purchasePrice: 3 }),
      makeHolding({ id: 'h-sold', ticker: 'SOLD', purchasePrice: 4 }),
    ]
    const accounts = [makeAccount({ holdings: untouched })]
    const log = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'CASH', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'buy',  date: '2025-01-10', ticker: 'SOLD', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't3', type: 'sell', date: '2025-02-10', ticker: 'SOLD', quantity: 10, amountPLN: 1500 }),
    ]
    const result = recalculateCostBases(accounts, log, 'acc1')
    expect(result[0].holdings).toEqual(untouched)
  })

  it('returns the accounts unchanged for an unknown account id', () => {
    const accounts = twoAccounts()
    expect(recalculateCostBases(accounts, transactions, 'missing')).toEqual(accounts)
  })
})

// ─── calculateNetCryptoQuantity ───────────────────────────────────────────────

describe('calculateNetCryptoQuantity', () => {
  it('adds buys and receives, subtracts sells and sends', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'buy',     ticker: 'BTC', quantity: 1.0 }),
      makeTx({ id: 't2', type: 'receive', ticker: 'BTC', quantity: 0.5 }),
      makeTx({ id: 't3', type: 'sell',    ticker: 'BTC', quantity: 0.2 }),
      makeTx({ id: 't4', type: 'send',    ticker: 'BTC', quantity: 0.1 }),
    ]
    // 1.0 + 0.5 - 0.2 - 0.1 = 1.2
    expect(calculateNetCryptoQuantity(transactions, 'BTC')).toBeCloseTo(1.2)
  })

  it('ignores transactions for other tickers', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'buy', ticker: 'BTC', quantity: 1.0 }),
      makeTx({ id: 't2', type: 'buy', ticker: 'ETH', quantity: 5.0 }),
    ]
    expect(calculateNetCryptoQuantity(transactions, 'BTC')).toBe(1.0)
  })

  it('returns zero for an empty transaction list', () => {
    expect(calculateNetCryptoQuantity([], 'BTC')).toBe(0)
  })
})

// ─── getDividendIncomeForHolding ──────────────────────────────────────────────

describe('getDividendIncomeForHolding', () => {
  it('separates gross dividends and withholding tax', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'dividend',        relatedHoldingId: 'h1', amountPLN: 100 }),
      makeTx({ id: 't2', type: 'withholding_tax', relatedHoldingId: 'h1', amountPLN: -15 }),
    ]
    const result = getDividendIncomeForHolding(transactions, 'h1')
    expect(result.gross).toBe(100)
    expect(result.tax).toBe(-15)
    expect(result.net).toBe(85) // 100 + (-15)
  })

  it('ignores transactions linked to other holdings', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'dividend', relatedHoldingId: 'h1', amountPLN: 100 }),
      makeTx({ id: 't2', type: 'dividend', relatedHoldingId: 'h2', amountPLN: 999 }), // different holding
    ]
    const result = getDividendIncomeForHolding(transactions, 'h1')
    expect(result.gross).toBe(100)
  })

  it('returns zeroes when no related transactions exist', () => {
    const result = getDividendIncomeForHolding([], 'h1')
    expect(result).toEqual({ gross: 0, tax: 0, net: 0 })
  })
})

// ─── getTotalReturn ───────────────────────────────────────────────────────────

describe('getTotalReturn', () => {
  it('combines unrealised P&L with net dividend income', () => {
    // 10 shares: bought at 100, now 110 → +100 PLN unrealised
    // Dividend: 50 gross, -10 tax → 40 PLN net
    const holding = makeHolding({ id: 'h1', quantity: 10, purchasePrice: 100, currentPrice: 110 })
    const transactions = [
      makeTx({ id: 't1', type: 'dividend',        relatedHoldingId: 'h1', amountPLN: 50 }),
      makeTx({ id: 't2', type: 'withholding_tax', relatedHoldingId: 'h1', amountPLN: -10 }),
    ]
    const result = getTotalReturn(holding, transactions)
    expect(result.totalPLN).toBe(140)         // 100 P&L + 40 net dividends
    expect(result.totalPercent).toBeCloseTo(14) // 140 / (10 × 100) × 100
  })

  it('returns only P&L when there are no dividends', () => {
    const holding = makeHolding({ quantity: 1, purchasePrice: 100, currentPrice: 200 })
    const result = getTotalReturn(holding, [])
    expect(result.totalPLN).toBe(100)
    expect(result.totalPercent).toBe(100)
  })
})

// ─── getIncomeSummary ─────────────────────────────────────────────────────────

describe('getIncomeSummary', () => {
  it('aggregates income correctly for a given year', () => {
    const transactions = [
      // 2025 transactions — should be included
      makeTx({ id: 't1', type: 'dividend',        date: '2025-03-01T00:00:00.000Z', amountPLN: 200 }),
      makeTx({ id: 't2', type: 'withholding_tax', date: '2025-03-01T00:00:00.000Z', amountPLN: -30 }),
      makeTx({ id: 't3', type: 'interest',        date: '2025-06-01T00:00:00.000Z', amountPLN: 100 }),
      makeTx({ id: 't4', type: 'interest_tax',    date: '2025-06-01T00:00:00.000Z', amountPLN: -19 }),
      // 2024 transaction — should be excluded
      makeTx({ id: 't5', type: 'dividend',        date: '2024-12-31T00:00:00.000Z', amountPLN: 999 }),
    ]
    const summary = getIncomeSummary(transactions, 2025)
    expect(summary.dividendsGross).toBe(200)
    expect(summary.withholdingTax).toBe(-30)
    expect(summary.dividendsNet).toBe(170)
    expect(summary.interest).toBe(100)
    expect(summary.interestTax).toBe(-19)
    expect(summary.interestNet).toBe(81)
    expect(summary.totalNet).toBe(251) // 170 + 81
  })

  it('returns all zeroes for a year with no transactions', () => {
    const summary = getIncomeSummary([], 2025)
    expect(summary.totalNet).toBe(0)
  })
})

// ─── getRealizedPnL ───────────────────────────────────────────────────────────

/** A Revolut-style row: generated externalId, fee rows without a ticker. */
function revolutTx(overrides: Partial<Transaction> & { externalId: string }): Transaction {
  return makeTx({
    id: overrides.externalId,
    accountId: 'revolut',
    source: 'revolut_crypto',
    ...(overrides.type === 'fee' ? {} : { instrument: 'Bitcoin', ticker: 'BTC' }),
    ...overrides,
  })
}

describe('getRealizedPnL', () => {
  it('is zero when nothing was sold', () => {
    expect(getRealizedPnL([])).toBe(0)
    expect(getRealizedPnL([makeTx({ ticker: 'ETFW', quantity: 10, amountPLN: -1000 })])).toBe(0)
  })

  it('takes a sale\'s cost from the selling account only', () => {
    // acc1 buys 10 for 1,000 and sells them for 1,500: 1,500 − 1,000 = +500.
    // acc2's 10 for 3,000 are a different position. Pooled by ticker, the
    // average would be 4,000 / 20 = 200 and the sale would show 1,500 − 2,000 = −500.
    const transactions = [
      makeTx({ id: 't1', accountId: 'acc1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', accountId: 'acc2', type: 'buy',  date: '2025-02-10', ticker: 'ETFW', quantity: 10, amountPLN: -3000 }),
      makeTx({ id: 't3', accountId: 'acc1', type: 'sell', date: '2025-03-10', ticker: 'ETFW', quantity: 10, amountPLN: 1500 }),
    ]
    expect(getRealizedPnL(transactions)).toBe(500)
  })

  it('adds up every account and ticker', () => {
    // acc1 / ETFW: 10 for 1,000, 5 sold for 600   →   600 −   500 = +100
    // acc2 / ETFW: 10 for 3,000, all sold for 2,500 → 2,500 − 3,000 = −500
    // acc1 / KGH :  4 for   800, all sold for 1,000 → 1,000 −   800 = +200
    // Total: 100 − 500 + 200 = −200
    const transactions = [
      makeTx({ id: 't1', accountId: 'acc1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', accountId: 'acc1', type: 'sell', date: '2025-02-10', ticker: 'ETFW', quantity: 5,  amountPLN: 600 }),
      makeTx({ id: 't3', accountId: 'acc2', type: 'buy',  date: '2025-01-11', ticker: 'ETFW', quantity: 10, amountPLN: -3000 }),
      makeTx({ id: 't4', accountId: 'acc2', type: 'sell', date: '2025-02-11', ticker: 'ETFW', quantity: 10, amountPLN: 2500 }),
      makeTx({ id: 't5', accountId: 'acc1', type: 'buy',  date: '2025-01-12', ticker: 'KGH',  quantity: 4,  amountPLN: -800 }),
      makeTx({ id: 't6', accountId: 'acc1', type: 'sell', date: '2025-02-12', ticker: 'KGH',  quantity: 4,  amountPLN: 1000 }),
    ]
    expect(getRealizedPnL(transactions)).toBe(-200)
  })

  it('counts no profit on units that were sold but never recorded as bought', () => {
    // 1 bought for 100, 10 sold for 1,000. The log explains 1 of the 10, so it
    // earns 1/10 of the proceeds: 100 − 100 = 0. Not 1,000 − 100 = +900.
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 1,  amountPLN: -100 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: 'ETFW', quantity: 10, amountPLN: 1000 }),
    ]
    expect(getRealizedPnL(transactions)).toBe(0)
  })

  it('uses only the rebuy\'s cost after everything was sent away', () => {
    // Buy 1 for 100,000 and send it away: nothing realized, nothing left.
    // Buy 1 for 200,000 and sell it for 250,000: 250,000 − 200,000 = +50,000.
    // If the send were ignored the average would be 300,000 / 2 = 150,000 and
    // the sale would show +100,000.
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'BTC', quantity: 1, amountPLN: -100000 }),
      makeTx({ id: 't2', type: 'send', date: '2025-02-10', ticker: 'BTC', quantity: 1, amountPLN: 0 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-03-10', ticker: 'BTC', quantity: 1, amountPLN: -200000 }),
      makeTx({ id: 't4', type: 'sell', date: '2025-04-10', ticker: 'BTC', quantity: 1, amountPLN: 250000 }),
    ]
    expect(getRealizedPnL(transactions)).toBe(50000)
  })

  it('takes Revolut fees off the profit: the buy\'s fee as cost, the sale\'s fee off the proceeds', () => {
    // Buy 0.5 BTC for 100,000 + 1,000 fee → cost 101,000.
    // Sell 0.5 BTC for 150,000 − 1,500 fee → proceeds 148,500.
    // 148,500 − 101,000 = +47,500 (it was +50,000 with the fees left out).
    const transactions = [
      revolutTx({ externalId: 'revolut-stmt-BTC-buy-2025-01-10T09:00:00.000Z-0.5-1',      type: 'buy',  date: '2025-01-10T09:00:00.000Z', quantity: 0.5, amountPLN: -100000 }),
      revolutTx({ externalId: 'revolut-stmt-BTC-buy-2025-01-10T09:00:00.000Z-0.5-1-fee',  type: 'fee',  date: '2025-01-10T09:00:00.000Z', amountPLN: -1000 }),
      revolutTx({ externalId: 'revolut-stmt-BTC-sell-2025-03-10T09:00:00.000Z-0.5-1',     type: 'sell', date: '2025-03-10T09:00:00.000Z', quantity: 0.5, amountPLN: 150000 }),
      revolutTx({ externalId: 'revolut-stmt-BTC-sell-2025-03-10T09:00:00.000Z-0.5-1-fee', type: 'fee',  date: '2025-03-10T09:00:00.000Z', amountPLN: -1500 }),
    ]
    expect(getRealizedPnL(transactions)).toBe(47500)
  })

  it('matches rows that carry only an instrument name, and leaves out rows with no ticker at all', () => {
    // "KGH" resolves to the ticker KGH: 2,500 − 2,000 = +500.
    // "Some Unknown Fund" resolves to nothing, so its sale is not counted.
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', instrument: 'KGH', quantity: 10, amountPLN: -2000 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: 'KGH',     quantity: 10, amountPLN: 2500 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-01-10', instrument: 'Some Unknown Fund', quantity: 1, amountPLN: -100 }),
      makeTx({ id: 't4', type: 'sell', date: '2025-02-10', instrument: 'Some Unknown Fund', quantity: 1, amountPLN: 900 }),
    ]
    expect(getRealizedPnL(transactions)).toBe(500)
  })
})

// ─── getPositions ─────────────────────────────────────────────────────────────

describe('getPositions', () => {
  it('returns one position per account and ticker', () => {
    const transactions = [
      makeTx({ id: 't1', accountId: 'acc1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', accountId: 'acc2', type: 'buy',  date: '2025-02-10', ticker: 'etfw', quantity: 10, amountPLN: -3000 }),
      makeTx({ id: 't3', accountId: 'acc1', type: 'sell', date: '2025-03-10', ticker: 'ETFW', quantity: 10, amountPLN: 1500 }),
      makeTx({ id: 't4', accountId: 'acc1', type: 'deposit', date: '2025-01-01', amountPLN: 5000 }), // no ticker: no position
    ]
    const positions = getPositions(transactions)
    expect(positions).toHaveLength(2)
    // acc1: 1,500 − 1,000 = +500, nothing left. acc2: still holds 10 at 300.
    expect(positions.find((p) => p.accountId === 'acc1')).toMatchObject({
      ticker: 'ETFW',
      position: { quantity: 0, realizedProfitPLN: 500 },
    })
    expect(positions.find((p) => p.accountId === 'acc2')).toMatchObject({
      ticker: 'ETFW',
      position: { quantity: 10, averageCostPLN: 300, realizedProfitPLN: 0 },
    })
  })

  it('reports how many units a position sold without a recorded buy', () => {
    // 1 bought, 10 sold: 9 units have no recorded purchase.
    const transactions = [
      makeTx({ id: 't1', type: 'buy',  date: '2025-01-10', ticker: 'ETFW', quantity: 1,  amountPLN: -100 }),
      makeTx({ id: 't2', type: 'sell', date: '2025-02-10', ticker: 'ETFW', quantity: 10, amountPLN: 1000 }),
      makeTx({ id: 't3', type: 'buy',  date: '2025-01-10', ticker: 'KGH',  quantity: 5,  amountPLN: -500 }),
    ]
    const incomplete = getPositions(transactions).filter((p) => p.position.unexplainedQuantity > 0)
    expect(incomplete).toEqual([
      { accountId: 'acc1', ticker: 'ETFW', position: expect.objectContaining({ unexplainedQuantity: 9 }) },
    ])
  })
})

// ─── Cash ──────────────────────────────────────────────────────────────────────

describe('affectsCash', () => {
  it('counts imported XTB and Revolut rows, and rows with no other rule', () => {
    expect(affectsCash(makeTx({ source: 'xtb_import' }))).toBe(true)
    expect(affectsCash(makeTx({ source: 'xtb_confirmation' }))).toBe(true)
    expect(affectsCash(makeTx({ source: 'manual' }))).toBe(true)
  })

  it('skips the buys behind bond holdings and eMakler trades', () => {
    expect(affectsCash(makeTx({ source: 'bond_holding' }))).toBe(false)
    expect(affectsCash(makeTx({ source: 'emakler_import' }))).toBe(false)
  })

  it('lets a row created by Close position decide for itself', () => {
    expect(affectsCash(makeTx({ source: 'manual', affectsCash: false }))).toBe(false)
    expect(affectsCash(makeTx({ source: 'emakler_import', affectsCash: true }))).toBe(true)
  })
})

describe('computeAccountCashBalance', () => {
  const txs = [
    makeTx({ id: 'd', type: 'deposit', date: '2026-01-02', amountPLN: 2000, source: 'xtb_import' }),
    makeTx({ id: 'b', type: 'buy', date: '2026-01-05T10:00:00.000Z', amountPLN: -1000, source: 'xtb_import' }),
    makeTx({ id: 'bond', type: 'buy', date: '2026-01-06', amountPLN: -500, source: 'bond_holding' }),
    makeTx({ id: 'filled', type: 'buy', date: '2026-01-07', amountPLN: -300, source: 'manual', affectsCash: false }),
    makeTx({ id: 's', type: 'sell', date: '2026-03-10', amountPLN: 1490, source: 'manual', affectsCash: true }),
    makeTx({ id: 'other', accountId: 'acc2', type: 'deposit', date: '2026-01-02', amountPLN: 9999, source: 'xtb_import' }),
  ]

  it('sums the account\'s rows that move cash', () => {
    // 2 000 − 1 000 + 1 490 = 2 490; the bond buy, the filled-in buy and acc2 don't count.
    expect(computeAccountCashBalance(txs, 'acc1')).toBe(2490)
  })

  it('stops at a date, for the chart, including that whole day', () => {
    // 2 000 − 1 000 = 1 000 on 5 Jan (the 10:00 buy counts); the sale is not in yet on 9 Mar.
    expect(computeAccountCashBalance(txs, 'acc1', '2026-01-04')).toBe(2000)
    expect(computeAccountCashBalance(txs, 'acc1', '2026-01-05')).toBe(1000)
    expect(computeAccountCashBalance(txs, 'acc1', '2026-03-09')).toBe(1000)
    expect(computeAccountCashBalance(txs, 'acc1', '2026-03-10')).toBe(2490)
  })
})

describe('getPositions — bond lots', () => {
  it('keeps each lot of a series as its own position, even with a shared ticker', () => {
    const buy = (id: string, holdingId: string, amountPLN: number) =>
      makeTx({ id, ticker: 'EDO0535', quantity: 10, amountPLN, source: 'bond_holding', relatedHoldingId: holdingId })
    const positions = getPositions([buy('a', 'lot-a', -1000), buy('b', 'lot-b', -999)])
    expect(positions.map((p) => [p.ticker, p.position.quantity, p.position.costPLN])).toEqual([
      ['#lot-a', 10, 1000],
      ['#lot-b', 10, 999],
    ])
  })
})
