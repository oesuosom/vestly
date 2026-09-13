# Vestly — Data Schema

*Last updated: September 2026 · Schema version: 5.0.0*

> **Type definitions live in [`src/types/index.ts`](../src/types/index.ts)** — that file is the source of truth and is compiler-enforced. This document deliberately does not restate it. What lives here is the knowledge the types can't carry: which localStorage keys exist and how long they live, why the migrations exist, and how derived values are calculated.

---

## Design decisions

- **All monetary values in PLN** — convert at entry, never store foreign currency. Original-currency fields on `Transaction` are metadata only, never used in math.
- **Purchase date only** — a holding stores its cost basis and purchase date, not a price series. Historical prices are fetched and cached separately, keyed by holding.
- **Holdings are the source of truth for value; transactions are an audit log.** Imports populate `ft_transactions`, but portfolio value is always computed from `Holding.quantity × currentPrice`.
- **Daily snapshots** — upserted on app open and on every holding change, one per calendar day. Past days are never modified.
- **localStorage only** — no server, no sync. Everything is per-browser.
- **IKE/IKZE contribution tracking** — annual limits per Polish tax law, entered manually.

---

## localStorage keys

Vestly owns **every key prefixed `ft_`**. That prefix is the authoritative definition, enumerated at runtime by `listAppKeys()` in [`src/utils/appStorage.ts`](../src/utils/appStorage.ts) — the crash-recovery path in `ErrorBoundary` depends on it. Prefer that function over the table below; a hand-maintained list has already gone stale once.

### Core data

| Key | Holds | Defined in |
|-----|-------|-----------|
| `ft_version` | `SchemaVersion` — drives the migration chain | `storage/portfolioStore.ts` |
| `ft_accounts` | `Account[]`, each with its nested `holdings` | `storage/portfolioStore.ts` |
| `ft_snapshots` | `Snapshot[]` — one per calendar day | `storage/portfolioStore.ts` |
| `ft_settings` | `Settings` | `storage/portfolioStore.ts` |
| `ft_contribution` | `ContributionTracking` — IKE/IKZE annual totals | `storage/portfolioStore.ts` |
| `ft_transactions` | `Transaction[]` — the import audit log | `storage/portfolioStore.ts` |

### Caches (all expendable — deleting any of them costs only a refetch)

| Key | Holds | TTL | Defined in |
|-----|-------|-----|-----------|
| `ft_price_cache_v2` | live prices, PLN | **23 h** | `services/market-data/priceFetcher.ts` |
| `ft_historical_prices_v6` | per-holding daily price series | **7 d** | `storage/historicalPriceStorage.ts` |
| `ft_insight_cache` | portfolio-level AI summary | **4 h** | `hooks/usePortfolioInsight.ts` |
| `ft_account_insight_<accountId>` | per-account AI summary | **7 d** | `hooks/useAccountInsight.ts` |
| `ft_dividend_calendar_cache` | upcoming ex-dividend dates | **24 h** | `hooks/usePortfolioInsight.ts` |
| `ft_news_cache` | headlines for held tickers | **1 h** | `hooks/usePortfolioInsight.ts` |
| `ft_no_div_cache` | negative cache: tickers known to pay no dividend | **7 d** | `services/market-data/eodhdDividends.ts` |
| `ft_emakler_order_keys` | eMakler order keys, for cross-import dedup | none | `importers/eMaklerImport.ts` |

> **Two price-cache keys exist and both are live.** `ft_price_cache_v2` is where the fetcher reads and writes. `ft_price_cache` (`KEYS.PRICE_CACHE` in `portfolioStore.ts`) backs a separate read/clear path. When debugging a stale price, look in **v2**.

AI-insight caches are additionally keyed by an `inputHash`: a cache entry is discarded early if the portfolio it was generated from has changed, even while still inside its TTL.

---

## Migrations

`migrateIfNeeded()` in [`src/storage/migrations.ts`](../src/storage/migrations.ts) runs on every app open and applies steps in sequence.

| From → To | What changed |
|-----------|-------------|
| 1.0.0 → 2.0.0 | Added `transactions: []` to the store (empty; populated by import) |
| 2.0.0 → 3.0.0 | Added `priceProvider` and `exchangeRateProvider` blocks to `Settings` |
| 3.0.0 → 4.0.0 | Remapped `Account.iconId` through `ICON_ID_RENAMES` (first icon-rename batch) |
| 4.0.0 → 5.0.0 | Same remap, re-run for the second icon-rename batch |

Steps 3→4 and 4→5 are now no-ops in effect — icon renames are resolved at read time via `iconIds` — but they remain so stores already stamped 3.0.0 or 4.0.0 still advance.

### Unversioned migrations

These run on app open without bumping `ft_version`. They're easy to miss precisely because they don't appear in the table above:

- **`migrateSnapshots()`** ([`storage/portfolioStore.ts`](../src/storage/portfolioStore.ts)) — strips the legacy `realEstate` key from snapshot allocations; drops empty snapshots (`totalValue === 0` with no `accountValues`).
- **`PortfolioContext` mount** ([`context/PortfolioContext.tsx`](../src/context/PortfolioContext.tsx)) — rewrites old `"yyyy-MM"` snapshot dates to `"yyyy-MM-01"`; flips `receive` transactions that were historically stored with a negative `amountPLN`.
- **`SettingsContext` load** ([`context/SettingsContext.tsx`](../src/context/SettingsContext.tsx)) — converts the old fixed-bucket `allocationTargets` into `allocationGroups`. The allocation model is now **user-definable groups** (`{id, name, categories[], target}`), not four hardcoded buckets; a group maps one or more `AssetCategory` values to a single target percentage.

---

## Snapshot upsert

`upsertTodaySnapshot()` in [`src/domain/snapshots.ts`](../src/domain/snapshots.ts):

1. Look in `ft_snapshots` for an entry matching today's `YYYY-MM-DD`.
2. Found → replace its values, keeping the same `id`.
3. Not found → append a new entry with a fresh uuid.

Past-day snapshots are never rewritten, so the history is append-only in practice.

---

## Calculation reference

All derived — never stored, always computed.

```
// Single holding
value        = quantity × currentPrice
costBasis    = quantity × purchasePrice
pnl          = value − costBasis
pnlPercent   = pnl / costBasis × 100

// Aggregates
accountValue = Σ holding.value
totalValue   = Σ accountValue
categoryValue(c) = Σ value where category === c    // 'stocks' spans 'stock' + 'etf'
allocationPct(c) = categoryValue(c) / totalValue × 100

// Rebalancing — evaluated per allocation GROUP, not per category
groupValue(g)  = Σ categoryValue(c) for c in g.categories
drift(g)       = groupPct(g) − g.target
needsRebalancing = any |drift(g)| > settings.rebalancingThreshold

// XTB synthetic cash holding
cashBalance  = Σ amountPLN over all transactions in the account
// deposits/dividends/interest are positive; buys/taxes/fees negative.
// Crypto accounts are excluded — they get no synthetic cash holding.

// Ticker resolution (resolveTransactionTicker)
ticker = t.ticker ?? staticLookupInstrument(t.instrument)?.ticker

// Cost basis and crypto quantity
avgCost(ticker) = totalCostPLN(buys) / totalQty(buys)
netQty(ticker)  = Σ(buy + receive qty) − Σ(sell + send qty)

// Income, per calendar year — the tax legs are already negative
dividendsNet = Σ(dividend amountPLN) + Σ(withholding_tax amountPLN)
interestNet  = Σ(interest amountPLN)  + Σ(interest_tax amountPLN)

// Total return
totalReturn  = pnl + dividendsNet(holding.id)
totalPct     = totalReturn / costBasis × 100

// Historical quantity, for chart reconstruction
qtyAtDate(h, d) = Σ(buy + receive qty on or before d) − Σ(sell + send qty on or before d)
// Falls back to h.quantity when no transactions match.
```

---

## Notes on specific types

Details worth knowing that aren't obvious from reading the type alone:

- **`Holding.isSynthetic`** — auto-managed, never manually edited. Currently only the XTB Cash holding, derived from transaction history.
- **`Transaction.externalId`** — the deduplication key. On import, any row whose `externalId` already exists is skipped. XTB supplies its own ID column; Revolut and eMakler rows get one generated.
- **`Transaction.source`** — `'xtb_import' | 'xtb_confirmation' | 'manual' | 'revolut_crypto' | 'emakler_import' | 'bond_holding'`. XTB has two distinct sources because the Cash Operations CSV and the daily-confirmation PDF overlap and must be deduped against each other.
- **`send` / `receive`** — crypto transfers. `send` carries `amountPLN: 0` (no fiat proceeds); `receive` carries the cost basis in PLN, or 0 when unknown.
- **`sell`** — defined in the type union but carries no FIFO logic; no sells have occurred yet.
- **`ImportUndoData`** — in-memory only, never persisted. Backs the single-step undo after an import.

---

## Storage footprint

Roughly 47 KB in the current real portfolio (5 accounts, ~20 holdings, ~300 transactions). A worst case with a full year of daily snapshots and complete price history for every holding lands near 450 KB — still well inside localStorage's 5 MB budget, so size has never been a design constraint.
