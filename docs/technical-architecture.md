# Vestly — Technical Architecture

*Last updated: September 2026*

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | React 19 + Vite 7 | SPA, no SSR |
| Language | TypeScript 5.9 | Strict mode |
| Routing | React Router 7 | Declarative routes in `app/App.tsx` |
| Styling | Tailwind CSS 4 | Via `@tailwindcss/vite`; design tokens in `utils/tokens.ts` |
| State | React Context | `PortfolioContext`, `SettingsContext` |
| Storage | localStorage | All data local, no backend of our own |
| Charts | Recharts 3 | Area charts, donut |
| Tables | TanStack Table 8 | Sorting and filtering on holdings/activity |
| Forms | React Hook Form 7 | |
| Animation | Framer Motion 12 | |
| Dates | date-fns 4 + React Day Picker 10 | |
| Icons | Generated set in `src/generated/icons` | Built from Figma by `npm run icons`; `@web3icons/react` for crypto logos |
| PDF parsing | pdfjs-dist 5 | Revolut statements, XTB daily confirmations |
| Spreadsheets | SheetJS (`xlsx`) | Installed from the SheetJS CDN tarball, not npm |
| Testing | Vitest 4 + Playwright | |
| Package manager | npm | |

---

## Project structure

Directories, not files — `ls` is always more current than a checked-in tree. What matters is which directory a thing belongs in:

| Directory | Holds | Rule |
|---|---|---|
| `src/app/` | `App.tsx` (routes), `main.tsx`, `ErrorBoundary`, global CSS | Entry point only |
| `src/pages/` | One component per route | Route-level composition; no business logic |
| `src/features/` | Feature-scoped UI: `accounts/`, `dashboard/`, `import/`, `settings/` | Used by one feature |
| `src/components/` | `ui/` primitives, `charts/`, `layout/` | Reusable across features; no domain knowledge |
| `src/domain/` | Pure financial math and portfolio logic | **No side effects, no I/O, no React** |
| `src/importers/` | File parsing: format detection, CSV/PDF/XLS parsers, dedup | Input → `Transaction[]` / `Holding[]` |
| `src/services/` | Outbound network calls: `market-data/`, `news/`, `claude.ts`, `nbp.ts` | Everything that leaves the browser |
| `src/storage/` | localStorage read/write and schema migrations | Only place that touches persistence |
| `src/context/` | `PortfolioContext`, `SettingsContext` | App-wide state |
| `src/hooks/` | Shared React hooks | |
| `src/utils/` | Formatting, tokens, icon helpers, `appStorage` | Generic, domain-free |
| `src/types/` | `index.ts` — every shared type | Source of truth for data shapes |
| `src/generated/` | Icon and logo components built by `scripts/build-icons.ts` | **Never hand-edit** |
| `src/dev/` | `DevShowcase` and import fixtures | Dev-only, mounted at `/dev` |

Imports use the `@/` alias throughout — no `../` traversal.

---

## Routes

Defined in [`src/app/App.tsx`](../src/app/App.tsx).

| Path | Page | Notes |
|---|---|---|
| `/` | `Overview` | Total wealth, area chart, allocation, account cards, AI insight card |
| `/portfolio` | `Portfolio` | Holdings across all accounts; allocation groups and drift |
| `/activity` | `Activity` | Transaction log with filters and summary bar |
| `/accounts/:accountSlug` | `AccountDetail` | Per-account holdings, chart, per-account AI insight |
| `/dev` | `DevShowcase` | Component showcase, dev builds only |

The sidebar exposes three destinations — Overview (`O`), Portfolio (`P`), Activity (`A`) — each with a keyboard shortcut. **Settings is a dialog, not a route**: `SettingsDialog` in `features/settings/` with its own sidebar over seven panes (General, Portfolio, Market Data, AI Providers, Accounts, Contributions, Data Management).

---

## State management

### PortfolioContext

Owns accounts, snapshots, and transactions. Each slice persists to localStorage through its own `useEffect`, written on every change without debouncing.

State: `accounts`, `snapshots`, `transactions`, `isLoading`, `error`, and `lastImportUndo` (in-memory only, never persisted).

Actions: account and holding CRUD, `importHoldings` (diff-based bulk import), `importTransactions` (merge plus post-processing), `undoLastImport` / `clearImportUndo`, `deleteTransaction`, `setTransactions`, `replaceAccounts` (after cost-basis recalculation), `relinkDividends`, `importSnapshot`.

**On mount:** `upsertTodaySnapshot`, `resolveDividendLinks`, plus two unversioned migrations — old `"yyyy-MM"` snapshot dates become `"yyyy-MM-01"`, and `receive` transactions stored with a negative `amountPLN` are sign-corrected.

**On any holding add/update/delete and account delete:** `upsertTodaySnapshot`, so today's snapshot always reflects current state. Holding add/update also re-runs `resolveDividendLinks` to catch dividends that had no matching holding at import time.

### SettingsContext

A typed wrapper over `Settings`, persisted to `ft_settings` on every change. It also migrates the legacy fixed-bucket `allocationTargets` into `allocationGroups` on load — see [data-schema.md](data-schema.md).

---

## Import system

`UnifiedImportModal` in `features/import/` is the single entry point. Three steps: **upload** (CSV/XLS/XLSX/PDF, drag-drop or picker, format auto-detected), **account** (target account, pre-filtered to types that suit the detected format), then **flow** (delegates to the matching flow component).

### Detected formats

[`src/importers/formatDetector.ts`](../src/importers/formatDetector.ts) — `DetectedFormat` is the authoritative union.

| Format | Description | Produces |
|---|---|---|
| `pko_ike` | PKO IKE Obligacje Skarbowe CSV | Holdings |
| `xtb_holdings` | XTB Portfolio CSV | Holdings |
| `xtb_transactions` | XTB Cash Operations CSV | Transactions |
| `xtb_confirmation` | XTB daily confirmation PDF | Transactions |
| `emakler_portfolio` | eMakler Portfolio CSV (CP1250) | Holdings |
| `emakler_order_history` | eMakler Order History CSV (CP1250) | Holdings |
| `revolut_crypto` | Revolut crypto statement PDF | Transactions |
| `revolut_btc_transfer` | Revolut BTC transfer CSV | Transactions |
| `unknown_csv` | Generic CSV — user maps columns manually | Holdings |
| `unsupported` | Unrecognised; carries a `reason` | — |

`detectFileFormats()` handles multi-file selection, which matters for XTB confirmations — they arrive one PDF per day.

### XTB transactions

Parser: `importers/xtbParser.ts`. Post-import steps inside `importTransactions`:

1. Dedup by `externalId` — skip rows already in the store.
2. `resolveDividendLinks` — attach dividends to holdings by ticker.
3. `upsertSyntheticCashHolding` — derive the XTB cash balance and write it as a synthetic holding.

Buy rows carry no ticker, so it is resolved through a **five-level fallback chain** — comment, then a dividend-row pre-pass, then user aliases, then a static map, then existing holding names. Each level and its failure mode is documented in [transaction-system.md](transaction-system.md#ticker-resolution-for-buy-rows), alongside the numbered comment at the resolution site in `xtbParser.ts`.

### XTB daily confirmations

Parser: `importers/xtbConfirmationParser.ts`. These PDFs are rotated and must be read by geometric layout rather than text order; buy and sell rows are told apart by cell hue. `importers/tradeDedup.ts` reconciles them against Cash Operations rows, since the same trade appears in both formats. `features/import/useXTBReconcile.tsx` drives the reconciliation UI.

### Revolut

`revolutCryptoParser.ts` turns each crypto statement PDF into two transactions — a `buy` for the net fiat paid and a `fee` — both negative PLN. `revolutBtcParser.ts` handles BTC transfer CSVs as `send` / `receive` records.

---

## Market data

### Live prices

Orchestrated by [`services/market-data/priceFetcher.ts`](../src/services/market-data/priceFetcher.ts). Eligible holdings have both `ticker` and `exchange` set and are not synthetic. Results cache to `ft_price_cache_v2` for **23 hours**.

**EODHD is the only implemented price provider** — `PriceProviderId` is the single-member union `'eodhd'`. It also performs its own FX: USD/PLN and EUR/PLN rates are fetched upfront and applied per exchange, so prices land in the cache already converted. Crypto tickers route to CoinGecko instead, since EODHD doesn't cover them; CoinGecko returns PLN directly, so no conversion is applied to those.

The cache key carries its own version because the conversion logic is baked into stored values: v1 → v2 fixed the UK→LSE exchange code and added per-exchange EUR conversion, and bumping the key discards prices computed the old way. Change conversion behaviour and you must bump it again.

NBP (`services/nbp.ts`, free, no key) supplies historical PLN rates by date and is used by the eMakler importer and by `yahooHistorical.ts`.

### Historical prices

Managed by `hooks/useHistoricalPrices.ts`, cached in `ft_historical_prices_v6` for **7 days**, refetched when the cache goes stale or the set of holding IDs changes.

Stocks and ETFs come from Yahoo Finance (`yahooHistorical.ts`), crypto from the CoinGecko market-chart endpoint (`coinGecko.ts`).

`PortfolioAreaChart` reconstructs portfolio value at each point by multiplying each holding's price on that date by the quantity held on that date (`domain/historicalQuantity.ts`), falling back to linear interpolation between `purchasePrice` and `currentPrice` where no market data exists.

### News and dividends

`services/news/` pulls headlines for held tickers from Yahoo and Bankier. `market-data/eodhdDividends.ts` fetches upcoming ex-dividend dates and keeps a negative cache of tickers known to pay nothing, so they aren't re-queried for a week.

---

## AI insights

Opt-in, and **the only feature that transmits portfolio data**. Disabled unless the user enables `anthropicEnabled` and supplies their own Anthropic API key, stored in localStorage like every other setting.

[`services/claude.ts`](../src/services/claude.ts) calls the Anthropic Messages API from the browser (`anthropic-dangerous-direct-browser-access`), using `claude-haiku-4-5-20251001`. Three call sites: a portfolio-level insight, a per-account insight, and a shorter summary.

**What is sent:** portfolio or account total in PLN, the change over the selected period, and top holdings by weight with their tickers. **What is not sent:** account numbers, transaction-level history, or any personally identifying information.

Responses are cached in `ft_insight_cache` (4 h) and `ft_account_insight_<accountId>` (7 d), keyed by an `inputHash` so a changed portfolio invalidates the entry before its TTL expires. Replies use a small markup convention — `{+X}` / `{-X}` for signed values, `[TICKER]` for instruments — parsed at render time for styling.

---

## Domain layer

`src/domain/` holds all financial math as pure functions. Anything that needs a number about the portfolio belongs here, not in a component.

- **Values and P&L** — `getHoldingValue`, `getHoldingPnL`, `getAccountValue(s)`, `getTotalValue`, `getTotalCostBasis`, `getUnrealizedPnL`, `getRealizedPnL`, `getTotalReturn`, `getAllTimeSummary`
- **Allocation** — `getCurrentAllocation`, `getCategoryAllocation`, `getGroupDrift`, `needsRebalancing`
- **Transactions** — `resolveTransactionTicker`, `calculateAverageCostBasis`, `calculateNetCryptoQuantity`, `computeAccountCashBalance`, `resolveDividendLinks`, `getDividendIncomeForHolding`, `getIncomeSummary`, `recalculateCostBases`
- **Time series** — `quantityAtDate`, `computePortfolioAt`, `buildHistoriesMap`
- **Snapshots and holdings** — `upsertTodaySnapshot`, `upsertSyntheticCashHolding`, `upsertBondBuyTransaction`, `buildBondBuyTransaction`

`calculations.test.ts` covers this layer; `csvParser`, `tradeDedup`, `xtbConfirmationParser`, and `formatters` have their own suites.

---

## Security

- **No backend.** Everything runs in the browser; there is no server component and no account system.
- **No telemetry.** No analytics, no error reporting, no tracking of any kind.
- **Market data requests carry only ticker symbols and an API key** — standard public market-data calls that reveal what you hold, but not how much.
- **AI insights transmit portfolio totals and top holdings to Anthropic** when the user explicitly enables the feature and supplies a key. See [AI insights](#ai-insights) for exactly what leaves the browser. This is the single exception to data staying local, and it is off by default.
- **API keys live in localStorage**, since there is no server to hold them and no build-time env vars. Anyone with access to the browser profile can read them.
- **Imported statements are parsed entirely in-browser.** No uploaded file is ever transmitted.

---

## Pending work

- **FIFO cost basis** — `getRealizedPnL` handles sells using a running weighted-average cost. Polish tax reporting requires FIFO, which is not implemented.
- **Tax reporting export** — not built.
- **Mobile layout** — out of scope for the current version; the app assumes a desktop viewport.
- **Additional price providers** — EODHD is the only one. The Alpha Vantage and Tiingo placeholders were removed; `PriceProviderId` would need widening to add another.
