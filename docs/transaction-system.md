# Vestly — Transaction System

*Last updated: September 2026 · Status: implemented; this is a reference, not a plan*

Parser-level detail for the transaction and import pipeline — file layouts, field mappings, and the decisions behind them. For data shapes see [data-schema.md](data-schema.md); for how the pieces fit together see [technical-architecture.md](technical-architecture.md). Type definitions are not restated here: [`src/types/index.ts`](../src/types/index.ts) is the source of truth.

---

## What the transaction system adds

V1 tracked portfolio *state* — holdings and current prices. Transactions add the *event history* that explains how the portfolio got there:

- Cost basis computed from actual buys (weighted average) instead of manual entry
- XTB cash balance derived automatically, surfaced as a synthetic holding
- Dividend income linked to the holding that produced it
- Total return per holding — price appreciation plus dividends received
- Income analytics by calendar year (dividends and interest, gross and net)
- Crypto acquisition and transfer history

Holdings remain the source of truth for portfolio *value*. Transactions are an audit log.

---

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Source of truth | Holdings, not transactions | Avoids requiring a complete, gap-free history; the schema supports migrating later |
| Dividend linking | Auto-linked to holdings by ticker | Enables per-holding total return |
| Ticker extraction | Five-level resolution chain | XTB buy comments carry no ticker; dividend rows do |
| Original currency | Stored as metadata only | `originalCurrency` / `pricePerUnitOriginal` are preserved but never used in math |
| XTB cash balance | Synthetic holding, recomputed after import | Flows into Total Wealth and the cash allocation slice automatically |
| Crypto accounts | No synthetic cash holding | They hold assets, not fiat |
| Sells | Weighted-average realized P&L; **no FIFO** | Sufficient for reporting; Polish tax filing needs FIFO and is not built |
| Cross-format duplicates | Matched on economic identity, surfaced not dropped | XTB reports the same trade twice under two ID spaces — see below |

### A caveat on `Transaction.date`

The type comment calls this a full ISO datetime, and most parsers emit one. **The XTB Cash Operations parser deliberately does not.** `parseXTBDateTime` returns a date-only `YYYY-MM-DD` string, because XTB timestamps are Warsaw local time and converting them to UTC without a timezone library risks shifting a transaction across a day boundary — which would corrupt tax-year attribution.

So the field holds a mix of `"2026-02-10"` and `"2026-02-10T10:59:02.277Z"`. Lexicographic sorting still works (a date-only string sorts before any same-day timestamp), and anything comparing days should `.slice(0, 10)` both sides. Do not assume the field parses as a full datetime.

---

## XTB Cash Operations (CSV / XLS)

Parser: [`src/importers/xtbParser.ts`](../src/importers/xtbParser.ts)

### File layout

```
Rows 1–4   metadata (account number, "Cash Operations", date from, date to)
Row 5      column headers: Type, Instrument, Time, Amount, ID, Comment, Product
Rows 6–N   transaction data
Last row   "Total,,,,57.67,," — a running balance, stripped before parsing
```

Warning row numbers shown to the user are offset by those five header rows, so they match what the user sees in a spreadsheet.

### Date formats

`parseXTBDateTime` accepts two, returning date-only in both cases:

1. `2026-02-10 10:59:02.277000` — `YYYY-MM-DD` with optional fractional seconds; the format real exports use
2. `10.02.2026 10:59:02` — `DD.MM.YYYY` fallback

### Type mapping

Rows whose `Type` is not in this map produce a warning and are skipped, never guessed:

| XTB `Type` | `TransactionType` |
|---|---|
| `Stock purchase` | `buy` |
| `Deposit` | `deposit` |
| `Withdrawal` | `withdrawal` |
| `Dividend` | `dividend` |
| `Withholding tax` | `withholding_tax` |
| `Free funds interest` | `interest` |
| `Free funds interest tax` | `interest_tax` |

### Comment parsing

- `parseBuyComment` — `"OPEN BUY 0.1724 @ 79.98"` → `quantity: 0.1724`, `pricePerUnitOriginal: 79.98`
- `parseTickerFromComment` — `"AGNC.US USD 0.1200/ SHR"` → `{ ticker: "AGNC", exchange: "US" }`

### Ticker resolution for buy rows

Buy comments carry no ticker, so it is resolved through a five-level fallback chain, tried in order. The same numbering appears as a comment at the resolution site in `xtbParser.ts`:

1. **Comment** — `parseTickerFromComment` on the buy row. Not present in real XTB buy rows; handled for robustness.
2. **`instrumentTickerMap`** — built in a pre-pass over dividend and withholding-tax rows *in the same file*, whose comments do name the instrument.
3. **`instrumentAliases`** — user-defined name→ticker mappings from Settings. Tried by exact key, then lowercased.
4. **`staticLookupInstrument`** — the built-in map in `domain/instrumentLookup.ts`, for common ETFs and stocks.
5. **`holdingNameMap`** — case-insensitive match against existing holdings that already carry a ticker. Covers buy-only instruments that never appear in dividend rows.

Levels 1–4 can supply an `exchange`; level 5 yields a ticker only, since a holding name match says nothing about the venue. When all five fail the transaction keeps `ticker: undefined` and surfaces as an unresolved instrument in the post-import cost-basis step, prompting the user to add an alias.

`originalCurrency` is inferred from the resolved exchange — `PL` → `PLN`, `US` → `USD`, otherwise left undefined.

### Signature

```typescript
parseXTBCashOperations(
  file: File,
  accountId: string,
  existingExternalIds: Set<string>,
  accounts?: Account[],                                 // for holdingNameMap (level 5)
  instrumentAliases?: Record<string, InstrumentAlias>,  // from Settings (level 3)
  existingTransactions?: Transaction[]                  // for cross-format dedup
): Promise<ParseResult>
```

`ParseResult` reports `skipped` (duplicate `externalId`s already in the store) separately from `crossFormatSkipped` (trades already imported from a confirmation PDF), plus per-row `warnings`.

---

## XTB daily confirmations (PDF)

Parser: [`src/importers/xtbConfirmationParser.ts`](../src/importers/xtbConfirmationParser.ts)

These PDFs are rotated, so the parser reads by geometric layout rather than text order. The buy/sell direction is a **raster badge, not text** — it is read from the badge's hue, and when that is inconclusive the row is left with `direction: null` and must be confirmed by hand before import. Guessing would invert a trade.

### Cross-format deduplication

XTB reports the same purchase through two documents that **share no identifier**: the Cash Operations export dedups on its own `ID` column, while a daily confirmation carries a *Numer zlecenia* (order number). Different ID spaces, so `externalId` equality cannot catch a trade arriving by both routes — and importing a confirmation today plus the monthly export later would double-count the buy, corrupting both quantity and cost basis.

[`src/importers/tradeDedup.ts`](../src/importers/tradeDedup.ts) matches on economic identity instead: account, type, ticker, quantity, cash amount, and date. **Tolerances are deliberately loose, so a match is a strong hint, not a verdict** — matches are surfaced in the import preview, unticked by default, rather than dropped silently. `features/import/useXTBReconcile.tsx` drives that UI.

---

## Revolut

**Crypto statements** ([`revolutCryptoParser.ts`](../src/importers/revolutCryptoParser.ts), PDF via pdfjs-dist) — each statement produces two transactions: a `buy` for the net fiat paid and a `fee`, both negative PLN, both `source: 'revolut_crypto'`. `externalId` derives from the filename and date so re-imports dedup.

**BTC transfers** ([`revolutBtcParser.ts`](../src/importers/revolutBtcParser.ts), CSV) — produces `send` and `receive` records. `send` carries `amountPLN: 0` (no fiat proceeds); `receive` carries the cost basis in PLN, or `0` when unknown.

---

## eMakler

[`eMaklerParser.ts`](../src/importers/eMaklerParser.ts) reads CP1250-encoded CSV; [`eMaklerImport.ts`](../src/importers/eMaklerImport.ts) diffs the parsed portfolio against existing holdings and converts order history into transactions, using NBP rates for historical PLN conversion. Order keys persist in `ft_emakler_order_keys` so re-imports dedup across files.

---

## Synthetic cash holding

[`src/domain/holdings.ts`](../src/domain/holdings.ts)

After every transaction import the account's cash balance is recomputed and written as a holding:

- `computeAccountCashBalance` sums every `amountPLN` for the account — deposits, dividends and interest positive; buys, taxes and fees negative
- `upsertSyntheticCashHolding` writes it under the stable id `cash_<accountId>`, so repeated imports update rather than duplicate
- `isSynthetic: true` — never manually editable
- `quantity: 1`, with `purchasePrice === currentPrice === balance`
- `category: 'cash'`, so it flows into the cash allocation slice automatically
- Accounts of type `crypto` are skipped entirely

**Smoke test:** after importing a full XTB Cash Operations export, `computeAccountCashBalance` should equal the value in the file's stripped `Total` row. A mismatch means rows were skipped — check the import warnings.

---

## Dividend linking

`resolveDividendLinks` in [`src/domain/transactions.ts`](../src/domain/transactions.ts) builds a ticker→holdingId map from all holdings and sets `relatedHoldingId` on unlinked dividend and withholding-tax transactions, skipping any already linked.

It runs after every import, on app mount (a holding may not have existed when the transactions were imported), and whenever a holding is added or edited, via the `relinkDividends` action.

---

## Cost basis recalculation

After an XTB transaction import, `XTBTransactionFlow` offers to rebuild holding cost bases from the log: a diff table of current versus calculated average, then a single confirm that writes `holding.purchasePrice` from the weighted average of buys. Holdings that are synthetic or have no matching buys are skipped. Applied through `replaceAccounts()` as one atomic update.

---

## Activity page

[`src/pages/Activity.tsx`](../src/pages/Activity.tsx), routed at `/activity`.

Full transaction log with a summary bar (net income, dividends net, deposits) that reflects the filtered view and defaults to the current year. Filters: type multi-select, account, and a date range.

**Deleting a transaction** is more than one row. If the deleted transaction was the last `buy` for a ticker, the matching non-synthetic holding is orphaned and deleted too — and `deleteHolding` itself cascades to every transaction matching that holding's ticker or name, including its dividends and taxes. Because one delete can touch both stores, undo restores a pre-delete snapshot of transactions *and* accounts rather than re-inserting a single row.
