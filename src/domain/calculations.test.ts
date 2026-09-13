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
  getDividendIncomeForHolding,
  getTotalReturn,
  getIncomeSummary,
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
    const result = calculateAverageCostBasis(transactions, 'ETFW')
    expect(result.totalQuantity).toBe(20)
    expect(result.totalCostPLN).toBe(2200)
    expect(result.averageCostPLN).toBe(110) // (1000 + 1200) / 20
  })

  it('is case-insensitive for tickers', () => {
    const transactions = [makeTx({ type: 'buy', ticker: 'etfw', quantity: 5, amountPLN: -500 })]
    const result = calculateAverageCostBasis(transactions, 'ETFW')
    expect(result.totalQuantity).toBe(5)
  })

  it('ignores non-buy transactions (dividends, sells, etc.)', () => {
    const transactions = [
      makeTx({ id: 't1', type: 'buy',      ticker: 'ETFW', quantity: 10, amountPLN: -1000 }),
      makeTx({ id: 't2', type: 'dividend', ticker: 'ETFW', quantity: undefined, amountPLN: 50 }),
      makeTx({ id: 't3', type: 'sell',     ticker: 'ETFW', quantity: 5, amountPLN: 600 }),
    ]
    const result = calculateAverageCostBasis(transactions, 'ETFW')
    expect(result.totalQuantity).toBe(10) // only the buy counts
  })

  it('returns zeroes when no buy transactions exist', () => {
    const result = calculateAverageCostBasis([], 'ETFW')
    expect(result.averageCostPLN).toBe(0)
    expect(result.totalQuantity).toBe(0)
    expect(result.totalCostPLN).toBe(0)
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
