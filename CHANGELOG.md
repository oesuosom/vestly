# Changelog

All notable changes to Vestly are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Market Data settings** — "Update" and "Rebuild" no longer fail silently. When prices or
  quote history can't be fetched (offline, bad API key, provider down), a toast says so, with
  a Retry button; partial failures report how many holdings were affected.

## [0.0.1] — 2026-09-13

First tagged release. Everything runs client-side; no backend, no sign-up, no telemetry.

### Added

- **Multi-account dashboard** — brokerage, IKE, IKZE, crypto and savings accounts, with
  per-account and whole-portfolio views, plus per-account detail pages.
- **Broker imports**
  - XTB portfolio CSV (holdings), Cash Operations CSV (transaction history) and daily
    confirmation PDFs, with cross-format deduplication.
  - PKO IKE Obligacje Skarbowe CSV, with bond purchase dates derived from series tickers
    (EDO / COI / TOS / …).
  - eMakler portfolio and order-history CSVs, with PLN cost basis reconstructed from
    historical NBP exchange rates.
  - Revolut crypto statement PDFs, parsed in-browser with pdf.js.
- **Transactions** — dividends, withholding tax, interest and deposits; realized and
  unrealized P&L; per-year income summaries.
- **Allocation & rebalancing** — custom allocation groups with drift alerts.
- **IKE / IKZE contribution tracking** against configurable annual limits.
- **Daily snapshots** — upserted once per calendar day so historical trends are preserved
  without a full transaction log.
- **Market data** — live prices via EODHD, Yahoo Finance or CoinGecko; FX via NBP (keyless).
- **AI insights** *(optional)* — short portfolio and account summaries generated with your
  own Anthropic API key.
- **Backup / restore** — export and re-import everything as plain JSON, with validation on
  restore. API keys are never included in backups.

### Notes

- Vestly is built to run locally via `npm run dev`. Market-data and AI requests are routed
  through the Vite dev server proxy to sidestep browser CORS; a plain static build has no
  proxy, so price refresh and AI insights need an equivalent host to work.
- All portfolio data lives in `localStorage` (~47 KB in typical use).

[0.0.1]: https://github.com/oesuosom/vestly/releases/tag/v0.0.1
