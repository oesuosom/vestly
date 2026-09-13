// ─────────────────────────────────────────
// SCHEMA VERSION
// Drives the migration chain in storage/migrations.ts (currently at 5.0.0).
// ─────────────────────────────────────────

export type SchemaVersion = {
  version: string
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────
// ACCOUNTS
// ─────────────────────────────────────────

export type AccountType =
  | 'brokerage'
  | 'ikze'
  | 'ike'
  | 'crypto'
  | 'savings'

export type Account = {
  id: string
  name: string
  type: AccountType
  iconId?: string
  notes?: string
  createdAt: string
  lastUpdated: string
  holdings: Holding[]
}

// ─────────────────────────────────────────
// HOLDINGS
// ─────────────────────────────────────────

export type AssetCategory =
  | 'stock'
  | 'etf'
  | 'bond'
  | 'crypto'
  | 'cash'

export type BondSubType = 'government' | 'corporate'

export type Holding = {
  id: string
  accountId: string
  name: string
  ticker?: string
  exchange?: string        // e.g. 'US', 'PL' — used for price fetching
  category: AssetCategory
  bondSubType?: BondSubType // only relevant when category === 'bond'
  quantity: number
  purchasePrice: number
  currentPrice: number
  purchaseDate: string
  createdAt: string
  updatedAt: string
  isSynthetic?: boolean   // true = auto-managed, never manually edited
                          // used for XTB Cash holding derived from transactions
}

// ─────────────────────────────────────────
// PORTFOLIO SNAPSHOTS
// ─────────────────────────────────────────

export type Snapshot = {
  id: string
  date: string
  totalValue: number
  allocation: {
    bonds: number
    stocks: number
    cash: number
    crypto: number
  }
  accountValues: {
    [accountId: string]: number
  }
  createdAt: string
}

// ─────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────

/**
 * The fixed four-bucket allocation shape. Still current: it is what
 * `getCurrentAllocation` returns and what `Snapshot.allocation` stores.
 *
 * Only *settings targets* moved to the user-definable `AllocationGroup[]` —
 * `SettingsContext` migrates the old `allocationTargets` field on load.
 */
export type AllocationTargets = {
  bonds: number
  stocks: number
  cash: number
  crypto: number
}

export type AllocationGroup = {
  id: string
  name: string
  categories: AssetCategory[]
  target: number
}

export type CategoryAllocation = Record<AssetCategory, number>

export type PriceProviderId = 'eodhd'
export type ExchangeRateProviderId = 'yahoo'

export type InstrumentAlias = {
  ticker: string
  exchange: string
}

export type ThemeMode = 'light' | 'dark' | 'system'

export type Settings = {
  allocationGroups: AllocationGroup[]
  rebalancingThreshold: number
  coinGeckoApiKey: string
  claudeApiKey: string
  anthropicEnabled: boolean
  priceProvider: {
    id: PriceProviderId
    apiKey: string
    enabled: boolean
  }
  exchangeRateProvider: {
    id: ExchangeRateProviderId
    apiKey?: string
    enabled: boolean
  }
  nbpEnabled: boolean
  coinGeckoEnabled: boolean
  /** Map of XTB instrument names → { ticker, exchange } for import resolution */
  instrumentAliases: Record<string, InstrumentAlias>
  userName?: string
  userAvatar?: string
  theme: ThemeMode
  timezone: string
  createdAt: string
  updatedAt: string
}

export const DEFAULT_ALLOCATION_GROUPS: AllocationGroup[] = [
  { id: 'bonds',  name: 'Bonds',  categories: ['bond'],          target: 50 },
  { id: 'equity', name: 'Equity', categories: ['stock', 'etf'],  target: 40 },
  { id: 'cash',   name: 'Cash',   categories: ['cash'],          target: 5  },
  { id: 'crypto', name: 'Crypto', categories: ['crypto'],        target: 5  },
]

export const DEFAULT_SETTINGS: Settings = {
  allocationGroups: DEFAULT_ALLOCATION_GROUPS,
  rebalancingThreshold: 5,
  coinGeckoApiKey: '',
  claudeApiKey: '',
  anthropicEnabled: false,
  priceProvider: {
    id: 'eodhd',
    apiKey: '',
    enabled: false,
  },
  exchangeRateProvider: {
    id: 'yahoo',
    apiKey: undefined,
    enabled: false,
  },
  nbpEnabled: false,
  coinGeckoEnabled: false,
  instrumentAliases: {},
  userName: undefined,
  userAvatar: undefined,
  theme: 'light',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

// ─────────────────────────────────────────
// HISTORICAL PRICE CACHE
// ─────────────────────────────────────────

export type HoldingPricePoint = {
  date: string      // yyyy-MM-dd
  pricePLN: number
}

export type HoldingPriceHistory = {
  holdingId: string
  prices: HoldingPricePoint[]   // sorted ascending by date
}

export type HistoricalPricesCache = {
  histories: HoldingPriceHistory[]
  fetchedAt: string
  expiresAt: string
}

// ─────────────────────────────────────────
// CONTRIBUTION TRACKING
// ─────────────────────────────────────────

export type ContributionYear = {
  year: number
  contributed: number
  limit: number
}

export type ContributionTracking = {
  ikze: ContributionYear[]
  ike: ContributionYear[]
  updatedAt: string
}

// ─────────────────────────────────────────
// IMPORT UNDO
// ─────────────────────────────────────────

export type ImportUndoData = {
  updates: { holdingId: string; oldQuantity: number; oldCurrentPrice: number }[]
  adds: string[] // holding IDs that were added
  removes: Holding[] // complete holding objects that were removed
  accountId: string
}

// ─────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────

export type TransactionType =
  | 'buy'
  | 'sell'              // realized P&L uses average cost; FIFO is not implemented
  | 'deposit'
  | 'withdrawal'
  | 'dividend'
  | 'withholding_tax'   // always paired with a dividend, always negative
  | 'interest'
  | 'interest_tax'      // always paired with interest, always negative
  | 'fee'
  | 'send'              // outbound crypto transfer — amountPLN: 0 (no fiat proceeds)
  | 'receive'           // inbound crypto transfer — amountPLN: +(cost basis PLN) or 0 if unknown

export type Transaction = {
  id: string                    // uuid, generated on import
  accountId: string             // which account this belongs to

  type: TransactionType
  date: string                  // full ISO datetime ("2026-02-10T10:59:02.277Z")

  // Cash impact — always PLN, always signed
  // negative = money out (buy, tax, fee)
  // positive = money in (deposit, dividend, interest)
  amountPLN: number

  // Buy/sell fields (undefined for non-trade transactions)
  instrument?: string           // XTB instrument name ("Fortinet", "AGNC Investment")
  ticker?: string               // parsed: "AGNC" from "AGNC.US"
  exchange?: string             // parsed: "US" | "PL" — stored for future use
  quantity?: number             // parsed from Comment ("OPEN BUY 0.1724 @ 79.98" → 0.1724)
  pricePerUnitPLN?: number      // Math.abs(amountPLN) / quantity — stored for convenience

  // Original currency metadata — display only, never used in calculations
  originalCurrency?: string     // "USD" for US stocks, "PLN" for Polish
  pricePerUnitOriginal?: number // the raw price from Comment ("@ 79.98" → 79.98)

  // For dividend/withholding_tax/interest transactions
  relatedInstrument?: string    // instrument name from Comment ("AGNC Investment")
  relatedTicker?: string        // parsed from Comment ("AGNC.US" → "AGNC")

  // Linking — resolved after import by matching ticker to holdings
  relatedHoldingId?: string     // nullable; set when a matching holding is found

  // Deduplication — XTB's own transaction ID
  // On import: skip any row whose externalId already exists in ft_transactions
  externalId: string            // the "ID" column from XTB CSV

  comment?: string              // raw XTB comment, preserved for debugging
  source: 'xtb_import' | 'xtb_confirmation' | 'manual' | 'revolut_crypto' | 'emakler_import' | 'bond_holding'
  createdAt: string             // ISO datetime — when added to app
}

// ─────────────────────────────────────────
// ROOT STORE SHAPE
// ─────────────────────────────────────────

export type PortfolioStore = {
  version: SchemaVersion
  accounts: Account[]
  snapshots: Snapshot[]
  settings: Settings
  contributions: ContributionTracking
  transactions: Transaction[]
}

// ─────────────────────────────────────────
// UI TYPES
// ─────────────────────────────────────────

export const DATE_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'] as const
export type DateRange = typeof DATE_RANGES[number]
