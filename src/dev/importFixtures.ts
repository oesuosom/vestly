/**
 * Mock data for the Add & Import Flows showcase in DevShowcase.
 *
 * Each fixture matches the exported `*DevState` type of its flow so the flow
 * can be frozen at a given step with realistic content. Consumed only by
 * [DevShowcase.tsx] via the flows' dev-only `devSeed` prop (see devSeed.ts).
 */
import type { Holding, Transaction } from '@/types'
import type {
  CSVImportFlowDevState,
  CSVPreviewRow,
} from '@/features/import/CSVImportFlow'
import type {
  EMaklerImportFlowDevState,
  EMaklerPreviewRow,
} from '@/features/import/EMaklerImportFlow'
import type { XTBTransactionFlowDevState } from '@/features/import/XTBTransactionFlow'
import type { RevolutBtcFlowDevState } from '@/features/import/RevolutBtcFlow'
import type { RevolutCryptoFlowDevState } from '@/features/import/RevolutCryptoFlow'
import type { XTBConfirmationFlowDevState } from '@/features/import/XTBConfirmationFlow'
import type { ConfirmationParseResult, ParsedTrade } from '@/importers/xtbConfirmationParser'
import type { EMaklerHoldingResult } from '@/importers/eMaklerImport'
import type { KnownFormat } from '@/importers/csvParser'

// ─────────────────────────────────────────
// Factories
// ─────────────────────────────────────────

let seq = 0
const id = (prefix: string) => `${prefix}-${seq++}`

function holding(
  p: Partial<Holding> &
    Pick<Holding, 'name' | 'category' | 'quantity' | 'purchasePrice' | 'currentPrice'>,
): Holding {
  return {
    id: id('h'),
    accountId: 'dev',
    purchaseDate: '2024-03-15',
    createdAt: '2024-03-15T00:00:00.000Z',
    updatedAt: '2024-03-15T00:00:00.000Z',
    ...p,
  }
}

function tx(
  p: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amountPLN'>,
): Transaction {
  return {
    id: id('t'),
    accountId: 'dev',
    externalId: id('ext'),
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...p,
  }
}

// ─────────────────────────────────────────
// CSV (PKO IKE / XTB holdings / unknown CSV)
// ─────────────────────────────────────────

/** A recognised format, so the mapping step shows the "Format detected" alert. */
export const csvDetectedFormat: KnownFormat = {
  id: 'pko_ike',
  name: 'PKO IKE (Treasury Bonds)',
  detectHeaders: [],
  mapping: {
    ticker: 'Ticker',
    quantity: 'Quantity',
    purchasePrice: 'Avg Price',
    currentPrice: 'Last Price',
  },
}

/** Sample headers + rows for the mapping step (passed as real props). */
export const csvHeaders = ['Ticker', 'Name', 'Quantity', 'Avg Price', 'Last Price', 'Date']
export const csvRows: Record<string, string>[] = [
  { Ticker: 'CDR', Name: 'CD Projekt', Quantity: '40', 'Avg Price': '98,40', 'Last Price': '142,10', Date: '2024-02-10' },
  { Ticker: 'PKN', Name: 'Orlen', Quantity: '120', 'Avg Price': '61,20', 'Last Price': '58,90', Date: '2024-05-22' },
  { Ticker: 'DNP', Name: 'Dino Polska', Quantity: '15', 'Avg Price': '410,00', 'Last Price': '455,00', Date: '2023-11-03' },
]

const csvPreviewRows: CSVPreviewRow[] = [
  {
    action: 'update',
    holding: holding({ name: 'CD Projekt', ticker: 'CDR', exchange: 'PL', category: 'stock', quantity: 40, purchasePrice: 98.4, currentPrice: 142.1 }),
    existing: holding({ name: 'CD Projekt', ticker: 'CDR', exchange: 'PL', category: 'stock', quantity: 30, purchasePrice: 98.4, currentPrice: 121.0 }),
  },
  {
    action: 'new',
    holding: holding({ name: 'Dino Polska', ticker: 'DNP', exchange: 'PL', category: 'stock', quantity: 15, purchasePrice: 410, currentPrice: 455 }),
  },
  {
    action: 'remove',
    holding: holding({ name: 'Orlen', ticker: 'PKN', exchange: 'PL', category: 'stock', quantity: 120, purchasePrice: 61.2, currentPrice: 58.9 }),
  },
]

export const csvSeed = {
  mapping: { step: 'mapping' } as const,
  preview: {
    step: 'preview',
    state: {
      category: 'stock',
      previewRows: csvPreviewRows,
      parseErrors: [{ row: 7, reason: 'Invalid quantity "—"' }],
      doneStats: { updated: 0, added: 0, removed: 0 },
    } satisfies Partial<CSVImportFlowDevState>,
  } as const,
  done: {
    step: 'done',
    state: {
      doneStats: { updated: 1, added: 1, removed: 1 },
    } satisfies Partial<CSVImportFlowDevState>,
  } as const,
}

// ─────────────────────────────────────────
// eMakler (portfolio + order history)
// ─────────────────────────────────────────

function eMaklerHolding(p: Partial<EMaklerHoldingResult> & Pick<EMaklerHoldingResult, 'name' | 'quantity' | 'purchasePrice' | 'currentPrice'>): EMaklerHoldingResult {
  return {
    exchange: 'US',
    purchaseDate: '2024-01-18',
    priceCurrency: 'USD',
    originalPurchasePrice: 0,
    nbpRateUsed: 4.0,
    status: 'complete',
    category: 'stock',
    ...p,
  }
}

const eMaklerImportResult: EMaklerImportFlowDevState['importResult'] = {
  holdings: [
    eMaklerHolding({ name: 'Apple Inc.', quantity: 12, purchasePrice: 712.4, currentPrice: 824.1, originalPurchasePrice: 178.1, priceCurrency: 'USD', nbpRateUsed: 4.0 }),
    eMaklerHolding({ name: 'Allegro.eu', quantity: 50, purchasePrice: 31.2, currentPrice: 34.8, priceCurrency: 'PLN', nbpRateUsed: 1, exchange: 'PL' }),
    eMaklerHolding({ name: 'iShares Core MSCI World', quantity: 8, purchasePrice: 0, currentPrice: 0, status: 'missing_cost_basis', category: 'etf' }),
  ],
  transactions: [],
  duplicatesSkipped: 3,
  warnings: ['NBP rate for 2024-01-18 unavailable for 1 holding — used nearest prior day.'],
}

const eMaklerPreviewRows: EMaklerPreviewRow[] = [
  { action: 'update', importHolding: eMaklerImportResult.holdings[0], existingHolding: holding({ name: 'Apple Inc.', ticker: 'AAPL', exchange: 'US', category: 'stock', quantity: 10, purchasePrice: 700, currentPrice: 800 }) },
  { action: 'add', importHolding: eMaklerImportResult.holdings[1] },
  { action: 'add', importHolding: eMaklerImportResult.holdings[2] },
  { action: 'remove', existingHolding: holding({ name: 'Tesla Inc.', ticker: 'TSLA', exchange: 'US', category: 'stock', quantity: 5, purchasePrice: 900, currentPrice: 1010 }) },
]

export const eMaklerSeed = {
  processing: { step: 'processing' } as const,
  preview: {
    step: 'preview',
    state: {
      importResult: eMaklerImportResult,
      previewRows: eMaklerPreviewRows,
      ordersOnlyMode: false,
    } satisfies Partial<EMaklerImportFlowDevState>,
  } as const,
  done: {
    step: 'done',
    state: { doneStats: { updated: 1, added: 2, removed: 1 } } satisfies Partial<EMaklerImportFlowDevState>,
  } as const,
}

// ─────────────────────────────────────────
// XTB transactions (cash operations)
// ─────────────────────────────────────────

const xtbParseResult: XTBTransactionFlowDevState['parseResult'] = {
  transactions: [
    tx({ type: 'buy', date: '2025-02-10T10:59:02.277Z', amountPLN: -1378.4, instrument: 'Fortinet', ticker: 'FTNT', exchange: 'US', quantity: 4 }),
    tx({ type: 'buy', date: '2025-03-04T13:12:00.000Z', amountPLN: -902.1, instrument: 'AGNC Investment', ticker: 'AGNC', exchange: 'US', quantity: 60 }),
    tx({ type: 'dividend', date: '2025-04-01T09:00:00.000Z', amountPLN: 42.18, relatedInstrument: 'AGNC Investment', relatedTicker: 'AGNC' }),
    tx({ type: 'deposit', date: '2025-01-02T08:00:00.000Z', amountPLN: 5000 }),
  ],
  skipped: 6,
  crossFormatSkipped: 0,
  warnings: [
    { row: 14, message: 'Could not parse quantity from comment.', rawData: 'OPEN BUY @ market' },
  ],
}

const xtbUnmatchedRows: XTBTransactionFlowDevState['unmatchedRows'] = [
  { instrument: 'Fortinet', ticker: 'FTNT', exchange: 'US', totalQuantity: 4, avgCostPLN: 344.6, earliestDate: '2025-02-10', suggestedCategory: 'stock' },
  { instrument: 'AGNC Investment', ticker: 'AGNC', exchange: 'US', totalQuantity: 60, avgCostPLN: 15.03, earliestDate: '2025-03-04', suggestedCategory: 'stock' },
]

const xtbUnresolvedRows: XTBTransactionFlowDevState['unresolvedRows'] = [
  { instrument: 'Some Exotic Fund', totalQuantity: 3, avgCostPLN: 210.5, earliestDate: '2025-02-20' },
]

const xtbCostBasisRows: XTBTransactionFlowDevState['costBasisRows'] = [
  { holdingId: 'h-cb-1', holdingName: 'Fortinet', ticker: 'FTNT', currentPricePLN: 360.0, calculatedPricePLN: 344.6, quantity: 4 },
  { holdingId: 'h-cb-2', holdingName: 'AGNC Investment', ticker: 'AGNC', currentPricePLN: 14.5, calculatedPricePLN: 15.03, quantity: 60 },
]

export const xtbSeed = {
  parsing: { step: 'parsing' } as const,
  preview: {
    step: 'preview',
    state: { parseResult: xtbParseResult } satisfies Partial<XTBTransactionFlowDevState>,
  } as const,
  unmatched: {
    step: 'unmatched',
    state: {
      unmatchedRows: xtbUnmatchedRows,
      unresolvedRows: xtbUnresolvedRows,
    } satisfies Partial<XTBTransactionFlowDevState>,
  } as const,
  costBasis: {
    step: 'cost_basis',
    state: { costBasisRows: xtbCostBasisRows } satisfies Partial<XTBTransactionFlowDevState>,
  } as const,
  done: {
    step: 'done',
    state: { doneParts: ['3 transactions imported', '2 holdings created'] } satisfies Partial<XTBTransactionFlowDevState>,
  } as const,
}

// ─────────────────────────────────────────
// Revolut BTC
// ─────────────────────────────────────────

const btcParseResult: RevolutBtcFlowDevState['parseResult'] = {
  transactions: [
    tx({ type: 'buy', date: '2024-11-02T12:00:00.000Z', amountPLN: -8200, ticker: 'BTC', quantity: 0.05 }),
    tx({ type: 'receive', date: '2025-01-15T09:30:00.000Z', amountPLN: 0, ticker: 'BTC', quantity: 0.012 }),
  ],
  skipped: 1,
  warnings: [],
  buyQty: 0.05,
  sellQty: 0,
  sendQty: 0,
  receiveQty: 0.012,
}

export const btcSeed = {
  parsing: { step: 'parsing' } as const,
  preview: {
    step: 'preview',
    state: { parseResult: btcParseResult } satisfies Partial<RevolutBtcFlowDevState>,
  } as const,
  receiveCost: {
    step: 'receive_cost',
    state: { parseResult: btcParseResult, receiveIndex: 0 } satisfies Partial<RevolutBtcFlowDevState>,
  } as const,
  createHolding: {
    step: 'create_holding',
    state: {
      proposed: { netQty: 0.062, avgCostPLN: 145000, totalCostPLN: 8990, earliestDate: '2024-11-02', existingHoldingId: null },
    } satisfies Partial<RevolutBtcFlowDevState>,
  } as const,
  done: {
    step: 'done',
    state: { doneParts: ['2 transactions imported', 'BTC holding created'], doneDetail: '1 buy · 1 receive' } satisfies Partial<RevolutBtcFlowDevState>,
  } as const,
}

// ─────────────────────────────────────────
// Revolut ETH (crypto statements)
// ─────────────────────────────────────────

const ethParseResult: RevolutCryptoFlowDevState['parseResult'] = {
  transactions: [
    tx({ type: 'buy', date: '2024-09-10T11:00:00.000Z', amountPLN: -2400, ticker: 'ETH', quantity: 0.4 }),
    tx({ type: 'fee', date: '2024-09-10T11:00:00.000Z', amountPLN: -24, ticker: 'ETH' }),
    tx({ type: 'buy', date: '2024-12-01T16:30:00.000Z', amountPLN: -1850, ticker: 'ETH', quantity: 0.28 }),
    tx({ type: 'fee', date: '2024-12-01T16:30:00.000Z', amountPLN: -18.5, ticker: 'ETH' }),
  ],
  skipped: 0,
  warnings: [],
  totalEthFromPDFs: 0.68,
}

export const ethSeed = {
  parsing: { step: 'parsing' } as const,
  preview: {
    step: 'preview',
    state: { parseResult: ethParseResult } satisfies Partial<RevolutCryptoFlowDevState>,
  } as const,
  createHolding: {
    step: 'create_holding',
    state: {
      proposed: { totalQty: 0.68, avgCostPLN: 6262, totalCostPLN: 4292.5, earliestDate: '2024-09-10', existingHoldingId: null },
    } satisfies Partial<RevolutCryptoFlowDevState>,
  } as const,
  done: {
    step: 'done',
    state: { doneParts: ['4 transactions imported', 'ETH holding created'], doneDetail: '2 buys · 2 fees' } satisfies Partial<RevolutCryptoFlowDevState>,
  } as const,
}

// ─────────────────────────────────────────
// XTB daily confirmations (PDF)
// ─────────────────────────────────────────

/**
 * Covers the first of the two things unique to this flow: a trade whose
 * Kupno/Sprzedaż badge could not be read (`direction: null`), which the preview
 * forces the user to resolve by hand.
 *
 * The other — cross-format duplicate flagging — cannot be seeded here. The flow
 * computes duplicates against live `transactions` from PortfolioContext, not
 * from `devSeed`, so a duplicate row appears in /dev only if the developer's own
 * store happens to hold a matching trade.
 */
function trade(over: Partial<ParsedTrade> & { id: string }): ParsedTrade {
  return {
    direction: 'buy',
    orderNo: '000000000',
    ticker: 'KRU',
    exchange: 'PL',
    instrument: 'KRUK',
    quantity: 10,
    unitPriceOriginal: 400,
    currency: 'PLN',
    fxRate: 1,
    totalCosts: 3.8,
    date: '2026-09-08T09:02:54.000Z',
    grossPLN: 4000,
    ...over,
  }
}

const confirmationParseResult: ConfirmationParseResult = {
  trades: [
    trade({ id: 'cf-1', orderNo: '512340011' }),
    // Badge hue was inconclusive — the preview forces a manual choice.
    trade({
      id: 'cf-2', orderNo: '512340012', direction: null,
      ticker: 'DNP', instrument: 'DINO POLSKA', quantity: 4,
      unitPriceOriginal: 382.5, grossPLN: 1530, date: '2026-09-08T10:14:07.000Z',
    }),
    trade({
      id: 'cf-3', orderNo: '512340013', direction: 'sell',
      ticker: 'PKO', instrument: 'PKO BP', quantity: 25,
      unitPriceOriginal: 62.4, grossPLN: 1560, totalCosts: 4.2,
      date: '2026-09-08T15:41:20.000Z',
    }),
  ],
  warnings: [],
  statement: { freeCash: 1284.55 },
}

export const xtbConfirmationSeed = {
  parsing: { step: 'parsing' } as const,
  preview: {
    step: 'preview',
    state: { parseResult: confirmationParseResult } satisfies Partial<XTBConfirmationFlowDevState>,
  } as const,
  previewResolved: {
    step: 'preview',
    state: {
      parseResult: confirmationParseResult,
      directions: new Map([['cf-2', 'buy' as const]]),
    } satisfies Partial<XTBConfirmationFlowDevState>,
  } as const,
  done: {
    step: 'done',
    state: {
      doneParts: ['3 transactions imported'],
      doneDetail: '2 buys · 1 sell',
    } satisfies Partial<XTBConfirmationFlowDevState>,
  } as const,
}
