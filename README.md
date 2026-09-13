# Vestly

A client-only personal portfolio tracker built for Polish investors. Track stocks, ETFs, treasury bonds (Obligacje Skarbowe), crypto, and retirement accounts (IKE / IKZE) in one dashboard — with **all data stored locally in your browser**. No backend, no sign-up, no telemetry.

## Why

Polish investors juggle accounts across XTB, eMakler, PKO (IKE bonds), Revolut, and banks — with no unified view. Tools that do aggregate either don't understand Polish investment vehicles (IKZE limits, Obligacje Skarbowe) or want your money in their cloud. Vestly keeps everything on your machine.

## Features

- **Multi-account dashboard** — brokerage, IKE, IKZE, crypto, and savings accounts with per-account and total portfolio views
- **Broker imports**
  - XTB: portfolio CSV (holdings) and Cash Operations CSV (full transaction history)
  - PKO IKE: Obligacje Skarbowe CSV, with bond purchase dates derived from series tickers (EDO/COI/TOS/…)
  - eMakler: portfolio and order-history CSVs, with automatic PLN cost basis via historical NBP exchange rates
  - Revolut: crypto statement PDFs (parsed in-browser with pdf.js)
- **Transactions** — dividends, withholding tax, interest, deposits; realized and unrealized P&L; income summaries per year
- **Allocation & rebalancing** — custom allocation groups with drift alerts
- **IKE / IKZE contribution tracking** against your configured annual limits
- **Market data** — live prices via EODHD, Yahoo Finance, or CoinGecko; FX via NBP (no key needed)
- **AI insights** *(optional)* — short portfolio and account summaries generated with your own Anthropic API key
- **Backup / restore** — export everything as a plain JSON file (API keys are never included)

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5175.

> **Note:** Vestly is designed to run locally via `npm run dev`. Market-data and AI requests are routed through the Vite dev server's proxy (see `vite.config.ts`) to avoid browser CORS restrictions — a static production build has no proxy, so price refresh and AI insights won't work there without hosting your own equivalent.

### API keys (all optional)

The app is fully usable without any keys — prices can be entered or imported manually. To enable live data, add keys in **Settings**:

| Provider | Used for | Free tier |
|----------|----------|-----------|
| [EODHD](https://eodhd.com) | Stock/ETF prices, FX, dividend calendar | yes |
| [CoinGecko](https://www.coingecko.com/en/api) | Crypto prices & history | yes (keyless works too) |
| [Anthropic](https://console.anthropic.com) | AI portfolio insights | pay-as-you-go |

Yahoo Finance and NBP (exchange rates) require no keys. All keys are stored in your browser's localStorage and sent only to the respective provider — never to any third party.

## Privacy model

- All portfolio data lives in `localStorage` — nothing is uploaded anywhere
- Price/AI providers are called directly with your own keys, only when you enable them
- Backups are plain JSON files you control; API keys are excluded from them

## Project structure

```
src/
├── app/          Composition root — App, main, ErrorBoundary, index.css
├── assets/       Static files imported by URL (logo, provider marks, theme previews)
├── generated/    Codegen output from `npm run icons` — never edited by hand
│   ├── icons/    Monochrome UI icons      → @/generated/icons
│   └── logos/    Full-colour brand marks  → @/generated/logos
├── components/   Presentation only — ui/ (primitives), charts/, layout/
├── features/     Feature modules — accounts/, dashboard/, import/, settings/
├── pages/        Routed screens
├── domain/       Pure portfolio logic (calculations, holdings, transactions, snapshots)
├── importers/    Broker file parsing (XTB, eMakler, PKO, Revolut) + format detection
├── services/     External I/O — market-data/, news/, nbp, claude
├── storage/      localStorage persistence and schema migrations
├── context/      React context providers
├── hooks/  utils/  types/
└── dev/          Dev-only component showcase and fixtures (excluded from the bundle)
```

Two conventions worth knowing: every internal import uses the `@/` alias
(no `../../..` chains), and unit tests sit next to the code they cover
(`domain/calculations.test.ts`).

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · Recharts · TanStack Table · pdf.js · SheetJS

```bash
npm test        # vitest unit tests
npm run lint    # eslint
npm run build   # type-check + production build
```

## License

MIT — see [LICENSE](LICENSE). Provider logos are third-party assets with their own licenses (see the LICENSE file's third-party section).

## Disclaimer

Vestly is a personal tracking tool, not financial advice. Figures it computes (P&L, cost basis, contribution limits) may contain errors — always verify against your broker's statements.
