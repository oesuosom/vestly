# Vestly - North Star Document

*Last Updated: September 2026*

## Product Vision

A privacy-first, desktop portfolio tracker that provides unified visibility across fragmented Polish investment accounts. Designed for people early in their investing journey — money scattered across a broker, an IKE or IKZE, some crypto and a savings account — who want to see all of it clearly in one place, with clean, accurate analytics and without juggling an ageing spreadsheet.

### The Core Problem

Starting investors in Poland accumulate accounts faster than clarity: a brokerage account here, an IKZE there, a bit of crypto, cash in a savings account — spread across platforms (XTB, eMakler IKZE, PKO IKE, Revolut crypto, bank deposits) with no unified dashboard. The usual fallback is a hand-maintained spreadsheet that goes stale. Existing solutions either:
- Don't support Polish investment vehicles (IKZE, IKE, Obligacje Skarbowe)
- Require cloud storage and data sharing
- Lack proper asset allocation and rebalancing features
- Have cluttered, overwhelming interfaces

### Success Definition

**Opening the app and instantly seeing:**
- Total wealth across all accounts
- Asset allocation vs. target percentages
- Individual asset performance with clear profit/loss
- Rebalancing needs at a glance
- Income from dividends and interest
- Portfolio value history with per-holding price resolution

All achieved with minimal monthly maintenance (under 15 minutes).

---

## Product Principles

1. **Privacy First** — Local storage only. No cloud, no accounts, no telemetry, no server of our own. Two things reach the network, both narrow and both visible in Settings: market-data lookups, which carry ticker symbols but never amounts; and AI insights, which send portfolio totals and top holdings to Anthropic under the user's own API key. AI insights are **off by default** and the only feature that transmits holdings data — see [technical-architecture.md](technical-architecture.md#ai-insights).
2. **Truth Over Comfort** — Show accurate numbers, even uncomfortable ones. No gamification.
3. **Minimal Maintenance** — Monthly updates in <15 minutes. CSV imports preferred over manual entry.
4. **Clean and Focused** — Linear-inspired minimal UI. Information density appropriate to task.
5. **Desktop First** — Optimized for desktop. No mobile requirements.

---

## What's Built (Current State)

### Core Portfolio Tracking
- [x] Account management (add/edit/delete)
- [x] Holdings management with full CRUD (stock, ETF, bond, crypto, cash)
- [x] Total wealth calculation across all accounts
- [x] Asset allocation visualization (donut chart + breakdown table)
- [x] Current vs. target allocation comparison
- [x] Rebalancing alert on the Portfolio page when drift exceeds threshold
- [x] Individual asset performance (P&L in PLN and %)
- [x] Total return column on the Portfolio table (unrealised P&L + dividends)
- [x] Realised P&L from sells (average cost basis)
- [x] Portfolio value area chart over time
- [x] Account detail pages with per-account stats and holdings

### Import System
- [x] XTB Portfolio CSV (holdings snapshot)
- [x] XTB Cash Operations CSV (transaction history)
- [x] PKO IKE Obligacje Skarbowe CSV (holdings)
- [x] eMakler Portfolio CSV (holdings, with NBP FX conversion)
- [x] eMakler Order History CSV (holdings, with NBP FX conversion)
- [x] XTB daily confirmation PDFs (transactions — rotated-layout parsing, hue-read buy/sell)
- [x] Revolut individual crypto statement PDFs (transactions — via pdfjs-dist)
- [x] Revolut BTC transfer CSV (transactions)
- [x] Generic CSV / spreadsheet fallback with manual column mapping
- [x] XLS/XLSX reading (via SheetJS) alongside CSV
- [x] Unified Import Modal with auto-format detection
- [x] Instrument alias mapping (XTB instrument name → ticker/exchange), resolved inside the import flow

### Transaction History
- [x] Full XTB Cash Operations import and deduplication
- [x] Cross-format duplicate detection — the same XTB trade arriving via CSV and confirmation PDF is matched on economic identity and surfaced for review
- [x] Revolut crypto (ETH/BTC/etc.) transaction import from PDFs
- [x] Revolut BTC transfer import
- [x] Transaction types: buy, sell, deposit, withdrawal, dividend, withholding_tax, interest, interest_tax, fee, send, receive
- [x] Activity page with two-level filter panel and summary bar
- [x] Automatic cost basis recalculation from transaction history
- [x] Dividend income tracking, linked to holdings by ticker
- [x] Total return per holding (unrealised P&L + dividends)
- [x] Automatic XTB cash balance (synthetic holding from transactions)

### Price & Market Data
- [x] EODHD price provider (primary — supports Polish stocks, live price)
- [x] CoinGecko crypto price + market history (free tier, optional API key)
- [x] Yahoo Finance historical prices for stocks/ETFs
- [x] NBP exchange rates, wired into eMakler import with a 3-step fallback
- [x] Portfolio chart
- [x] Upcoming dividends via EODHD
- [x] News headlines for holdings (Yahoo Finance for US, Bankier for PL)

### AI Insights (Opt-In)
- [x] Portfolio insight card on Overview
- [x] Per-account insight on account detail pages
- [x] Bring-your-own Anthropic API key

### Contributions
- [x] Annual IKE / IKZE contribution tracking against user-set limits

### Settings
- [x] Account: display name and avatar
- [x] General: theme (light/dark/system) and timezone
- [x] Contributions: IKE / IKZE annual limits
- [x] Portfolio: allocation group targets + rebalancing threshold
- [x] Market Data: EODHD, Yahoo Finance, NBP and CoinGecko providers
- [x] AI Providers: Anthropic API key and enable toggle
- [x] Data Management: backup export, restore, and clear-all

---

## Portfolio Targets (Current Defaults)

Allocation is modelled as **allocation groups** — a named group maps one or more asset categories to a target percentage. Groups and targets are user-configurable in Settings → Portfolio, with a reset to the defaults below.

| Group | Categories | Target |
|---|---|---|
| Bonds | `bond` | 50% |
| Equity | `stock`, `etf` | 40% |
| Cash | `cash` | 5% |
| Crypto | `crypto` | 5% |

Default rebalancing threshold: **5%** drift.

---

## Pending / Future Work

- Rebalancing trade suggestions, tax-loss harvesting indicators
- Secondary price providers (Alpha Vantage, Tiingo)
- Goal tracking (emergency fund, house purchase, etc.)
- Mobile-responsive design
- Automated broker API integration