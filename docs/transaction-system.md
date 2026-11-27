# Vestly — Transaction System

*Last updated: November 2026 · Status: implemented; this is a reference, not a plan*

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
| Ticker extraction | Six-level resolution chain | Only some XTB trade comments carry a ticker; dividend rows do |
| Original currency | Stored as metadata only | `originalCurrency` / `pricePerUnitOriginal` are preserved but never used in math |
| XTB cash balance | Synthetic holding, recomputed after import | Flows into Total Wealth and the cash allocation slice automatically |
| Crypto accounts | No synthetic cash holding | They hold assets, not fiat |
| Sells | Weighted-average realized P&L, per account and ticker; **no FIFO** | Sufficient for reporting; Polish tax filing needs FIFO and is not built |
| Cross-format duplicates | Matched on economic identity, surfaced not dropped | XTB reports the same trade twice under two ID spaces — see below |

### A caveat on `Transaction.date`

The type comment calls this a full ISO datetime, and most parsers emit one. **XTB Cash Operations rows imported before #29 do not**: that parser used to keep only the date, so those rows are stored date-only (`"2026-02-10"`) and stay that way. It now keeps the time, as UTC: XTB labels the file's date range `(UTC)`, as it does the times on its other sheets.

So the field holds a mix of `"2026-02-10"` and `"2026-02-10T10:59:02.277Z"`. Lexicographic sorting still works (a date-only string sorts before any same-day timestamp), and anything comparing days should `.slice(0, 10)` both sides. Do not assume the field parses as a full datetime.

**The stored day is the day.** Cash on a past day, the position walk, the chart, tax-year totals and Activity (its dates and its date filter) all use `date.slice(0, 10)`, never the day in the viewer's time zone. For XTB rows that is the UTC day the file shows: a deposit at 23:30 UTC on 31 December counts in that year, although it was already 1 January in Warsaw. Before #29, Activity converted to local time, so such a row would have shown on a different day than it was counted on.

Every screen shows that same day, screen-reader labels included: read it with `transactionDay(t)` (`src/domain/transactionDay.ts`) and format it with `formatDate(transactionDay(t))`. A bare `yyyy-MM-dd` parses as local midnight of that day, so nothing shifts it. Never pass the full timestamp to `formatDate` or `new Date(…).toLocale…`: that is the viewer's local day, a day off near midnight (#78). Time maths that needs real instants (duplicate matching within a time tolerance) still uses the full timestamp.

"Today" is the viewer's local day (`todayISO()`), so the two can differ by a day. East of UTC a row is never stored after the local today. West of UTC it can be: 21:00 on 11 November in New York is stored under 12 November. Wherever a stored day is compared with today, that row must not count as being in the future. Close position and "Mark as sold" allow dates up to `latestCloseDate(earliest, today)`, the later of today and the last purchase's stored day. The chart's change treats every flow as included in today's live value.

---

## XTB Cash Operations (XLSX / CSV)

Parser: [`src/importers/xtbParser.ts`](../src/importers/xtbParser.ts). Statement structure (finding sheets, separators, account currency): [`src/importers/xtbStatement.ts`](../src/importers/xtbStatement.ts).

### Sources

- **XTB's original .xlsx statement.** One workbook with **Closed Positions**, **Cash Operations** and **Open Positions** sheets. The Cash Operations sheet is found by name and confirmed by its header row (any sheet with that header row will do), wherever it is in the file. It is read cell by cell ([`xlsReader.ts`](../src/importers/xlsReader.ts) `readWorkbook`), not through CSV: amounts are numbers, ids text, and `Time` cells Excel date serials, converted to UTC with `excelSerialToISO` (to the millisecond, no local time). SheetJS logs "Bad uncompressed size" while unzipping XTB's file; the reader drops that message, as the file reads correctly.
- **The sheet saved as CSV by hand.** Comma or semicolon separated (found from the header row); with `;`, numbers may use decimal commas and space / non-breaking space thousands separators. A byte-order mark is stripped; text that isn't valid UTF-8 is read as windows-1250.

Both sources become the same table of typed rows, and everything after that (type mapping, dedup, transfer pairing, the confirmation and Close position passes, the Total check) is shared.

**Account number.** Row 1 of every sheet holds it. The workbook reader blanks it as it reads, and the CSV route never reads the header block beyond the period, so it is never stored, logged or shown.

**Account currency.** Vestly stores PLN. When the statement says its account is in another currency, the import is refused before anything is parsed (`StatementCurrencyError`). Sources, in order: the Currency column of Open Positions' summary table, then a file name starting with a currency code (`USD_…`). When neither says, the import proceeds.

**Statement period.** "Date from (UTC)" and "Date to (UTC)" from the header block are returned as `ParseResult.period` and shown in the preview.

### File layout

```
Rows 1–4   metadata (account number, "Cash Operations", date from (UTC), date to (UTC))
Row 5      column headers: Type, Instrument, Time, Amount, ID, Comment, Product
Rows 6–N   transaction data, newest first
Last row   "Total" — the sum of the Amount column
```

XTB has shipped several layouts (7, 8 and 10 columns, some with a `Ticker` column), so the header row is found by its names (`Type` and `Amount`) and every column is read by name, case-insensitively. Warning row numbers are the file's own line numbers, so they match what the user sees in a spreadsheet.

**Transfers that cancel out.** Two `Transfer` / `Subaccount transfer` rows with the same time and comment, opposite amounts and a different Product are money moved between two parts of the same account (say, from trading to an investment plan). They are left out: imported, they would net to zero but inflate deposits and withdrawals. A transfer with no partner in the file imports as a deposit or withdrawal by its sign.

**The Total check.** The rows imported, plus the rows left out on purpose (already imported, CFD rows, transfers that cancel out, duplicates of a confirmation or of a Close position sale, and fee rows skipped with them), must add up to the Total row. When they don't, the preview's first warning says how much is missing: that catches a row type dropped in future, not only the ones the parser already warns about.

### Date formats

`parseCashOperationsTime` reads the time as UTC and returns a full ISO timestamp (`2026-01-02 14:37:04` → `2026-01-02T14:37:04.000Z`). It accepts:

1. `2026-02-10 10:59:02`, optionally with fractional seconds (`.277000`, kept to the millisecond) — the format real exports use
2. `2026-02-10T10:59:02.277Z` — the .xlsx sheet's date cells, once converted
3. `10.02.2026 10:59:02` — `DD.MM.YYYY` fallback
4. One-digit hours and no seconds (`2026-02-10 9:59`), as a spreadsheet app may save them

A bare date stays date-only.

### Type mapping

Matched case-insensitively. Rows whose `Type` is not in this map produce a warning and are skipped, never guessed:

| XTB `Type` | `TransactionType` |
|---|---|
| `Stock purchase`, `Stocks/ETF purchase` | `buy` |
| `Stock sale`, `Stock sell`, `Stocks/ETF sale` | `sell` — `amountPLN` is the whole proceeds (quantity × price), positive |
| `Deposit` | `deposit` |
| `Withdrawal` | `withdrawal` |
| `Transfer`, `Subaccount transfer` | `deposit` when money comes in, `withdrawal` when it goes out |
| `Dividend`, `DIVIDENT`, `Spinoff` | `dividend` |
| `Withholding tax` | `withholding_tax` |
| `Free funds interest`, `Free funds interests` | `interest` |
| `Free funds interest tax`, `Free funds interests tax` | `interest_tax` |
| `Commission`, `SEC fee`, `Tax IFTT` | `fee` — a separate row next to the trade; it moves Cash and shows in Activity, but is not added to the trade's cost |

**CFD rows are not imported**: `Swap`, `Close trade` and `Profit/Loss (FX/CFD)`, and a share row whose comment is a short trade (`OPEN SELL`, `CLOSE SELL`). Each gets a warning; nothing is guessed.

### Comment parsing

- `parseTradeComment` — one parser for buys and sales: `(OPEN|CLOSE) (BUY|SELL) [TICKER.EX ]qty[/total] @ price`.
  - `"OPEN BUY 0.25 @ 100.00"` → a buy of 0.25
  - `"OPEN BUY ACME.US 2 @ 10.00"` → a buy of 2, ticker `ACME` on `US`
  - `"OPEN BUY ACME.US 0.5/2.5 @ 10.00"` → a buy of 0.5: one fill of an order of 2.5. The first number is the units in this row, and that is what is imported.
  - `"CLOSE BUY 6/12 @ 55.00"` → a sale of 6 (closing a long position)

  A purchase must open (`OPEN BUY`) and a sale must close (`CLOSE BUY`); a row whose comment says otherwise gets a warning.
- `parseTickerFromComment` — `"AGNC.US USD 0.1200/ SHR"` → `{ ticker: "AGNC", exchange: "US" }`

### Ticker resolution for trade rows

Only some trade comments name the instrument, so the ticker is resolved through a six-level fallback chain, tried in order. The same numbering appears as a comment at the resolution site in `xtbParser.ts`:

1. **`Ticker` column** — in layouts that have one (`ACME.US`).
2. **Comment** — `"OPEN BUY ACME.US 2 @ 10.00"`. Some rows have it and some don't, for the same kind of trade.
3. **`instrumentTickerMap`** — built in a pre-pass over the other rows *in the same file* that name the instrument: trade comments with a ticker, a `Ticker` column, and dividend and withholding-tax comments.
4. **`instrumentAliases`** — user-defined name→ticker mappings from Settings. Tried by exact key, then lowercased.
5. **`staticLookupInstrument`** — the built-in map in `domain/instrumentLookup.ts`, for common ETFs and stocks.
6. **`holdingNameMap`** — case-insensitive match against existing holdings that already carry a ticker. Covers buy-only instruments that never appear in dividend rows.

Levels 1–5 can supply an `exchange`; level 6 yields a ticker only, since a holding name match says nothing about the venue. When all six fail the transaction keeps `ticker: undefined` and surfaces as an unresolved instrument in the post-import cost-basis step, prompting the user to add an alias.

`originalCurrency` is inferred from the resolved exchange — `PL` → `PLN`, `US` → `USD`, otherwise left undefined.

### Signature

```typescript
parseXTBCashOperations(
  file: File,
  accountId: string,
  existingExternalIds: Set<string>,
  accounts?: Account[],                                 // for holdingNameMap (level 5)
  instrumentAliases?: Record<string, InstrumentAlias>,  // from Settings (level 3)
  existingTransactions?: Transaction[]                  // for cross-format and Close position dedup
): Promise<ParseResult>
```

`ParseResult` reports `skipped` (duplicate `externalId`s already in the store) separately from `crossFormatSkipped` (trades already imported from a confirmation PDF) and `closedByHand` (sales already recorded with Close position), plus per-row `warnings`.

**Sales already recorded with Close position.** A holding closed by hand has a `sell` with `externalId` `close-sell-<holdingId>`. An imported sale with the same account, ticker and quantity, on a day at most one apart, is left out and listed in the preview as a likely duplicate (`findClosedByHandSales` in `tradeDedup.ts`). The amount isn't compared: Close position stores the proceeds after the fee, the file the gross proceeds.

---

## XTB daily confirmations (PDF)

Parser: [`src/importers/xtbConfirmationParser.ts`](../src/importers/xtbConfirmationParser.ts)

These PDFs are rotated, so the parser reads by geometric layout rather than text order. The buy/sell direction is a **raster badge, not text** — it is read from the badge's hue, and when that is inconclusive the row is left with `direction: null` and must be confirmed by hand before import. Guessing would invert a trade.

### Cross-format deduplication

XTB reports the same purchase through two documents that **share no identifier**: the Cash Operations export dedups on its own `ID` column, while a daily confirmation carries a *Numer zlecenia* (order number). Different ID spaces, so `externalId` equality cannot catch a trade arriving by both routes — and importing a confirmation today plus the monthly export later would double-count the buy, corrupting both quantity and cost basis.

[`src/importers/tradeDedup.ts`](../src/importers/tradeDedup.ts) matches on economic identity instead: account, type, ticker, quantity, cash amount, and date. **Tolerances are deliberately loose, so a match is a strong hint, not a verdict** — matches are surfaced in the import preview, unticked by default, rather than dropped silently. `features/import/useXTBReconcile.tsx` drives that UI.

The two documents don't cut a trade the same way, so the matcher compares **orders**, not rows (`findDuplicateTradeGroups`), in both directions:

- **Fills.** A confirmation line is one whole order: the parser keeps one line per order number. Cash Operations can list that order as fills, each with the order's size after a slash (`0.5/2.5` and `2/2.5`). Fills with the same account, side, ticker and order size, within the date tolerance, are one order once their quantities add up to the size. A confirmation line matches one row, or all of an order's fills together, and the amount tolerance grows with the number of rows added up. A confirmation per fill still matches fill to fill.
- **Commission.** A confirmation's amount has the order's costs inside it. Cash Operations has the trade at gross, with a separate `Commission` row (a `fee`) on the same instrument at the same timestamp. The matcher tries the export's amount with and without those fee rows. When the export is the one being imported and its fee rows made the match, they are skipped with the trade: the confirmation already counted them.

A sale already recorded with Close position takes the file's fee rows charged on it along only when a fee was entered in Close position; with no fee entered there, the file's fee rows import.

---

## Revolut

**Crypto Account Statement** (PDF). Parser: [`revolutStatement.ts`](../src/importers/revolutStatement.ts); rows, ids and the holdings check: [`revolutStatementImport.ts`](../src/importers/revolutStatementImport.ts); flow: [`RevolutStatementFlow.tsx`](../src/features/import/RevolutStatementFlow.tsx). One PDF for a chosen period lists every crypto transaction of every coin, and each coin's amounts at the start and end of the period. It replaces the per-transaction PDFs (one statement per buy or sell, one transfer confirmation per send or receive), which had no transaction id and covered only BTC and ETH buys; that import was removed in #81.

**Recognised by content**, not file name (the name is only an id): the title "Crypto Account Statement" and the Transactions table's header (`Symbol Type Quantity Price Value Fees Date`). The PDF is read with `extractPDFLayout`, one line of text per row.

**Sections.** *Account summary* (per coin: opening value, amount out, amount in, closing value; each value cell has the coin amount and, under it, PLN), *Portfolio breakdown* (amount, price, value, % of portfolio; may list only coins still held), *Transactions* (runs over several pages, its header repeated on each), *Staking rewards*. Lines repeated on every page (title, "Generated on…", "Period…", page numbers) are skipped.

**Rows.** `ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 2.49 PLN Jan 5, 2025, 3:04:12PM`: comma thousands, dot decimals, quantities to 8 decimals or none, no space before AM/PM (one is accepted). A row whose date wrapped onto the next line is joined. Anything that can't be read — the coin, the type, the quantity, the date, amounts in a currency other than PLN — becomes a warning with its page, row and raw text; nothing is dropped silently. Staking rewards are counted per coin and not imported (the Transactions table's staking rows, or else the Staking rewards section's).

**Times are local** (the owner checked them against the app). Each is converted to a real UTC instant with the browser's time zone and stored as such; rows count on their UTC day (`transactionDay`, #78), like XTB.

**What the columns mean.** Quantity is Value ÷ Price, Value being the PLN paid (buy) or received (sell). The fee is taken in coins, so a buy brings fewer coins than Quantity and a sell removes more. Price is rounded to 2 decimals and the statement's fee is a grosz below the app's, so quantities are close, not exact; the holdings check closes the gap.

| Type | `amountPLN` | fee row | `quantity` |
|---|---|---|---|
| `buy` | −(Value − Fee) | −Fee | Quantity × (Value − Fee) ÷ Value |
| `sell` | Value + Fee | −Fee | Quantity × (Value + Fee) ÷ Value |
| `send` | 0 | — | Quantity |
| `receive` | its cost: the statement's Value, editable in the preview | — | Quantity |

So the position walk gives cost = buy Value and proceeds = sell Value. Fee rows carry the coin in `relatedInstrument`/`relatedTicker` (Activity shows it) and pair with their trade through the id. Sends and receives have `affectsCash: false`. Rows are `source: 'revolut_crypto'`.

**Ids.** `revolut-stmt-{coin}-{type}-{utcISO}-{quantity}-{n}`, the fee row's is the trade's plus `-fee` (`pairTradeFees` in [`tradeFees.ts`](../src/domain/tradeFees.ts)). There are no transaction ids in the statement; coin, type, time to the second and quantity are practically unique, and `{n}` (1, 2, …) counts identical rows within one statement so both import. Re-importing an overlapping period gives the same ids, so it adds nothing.

**Holdings check** (`checkStatementHoldings`). After the rows are imported, each coin's quantity in the log as of the statement's end date (the end of that UTC day, or the statement's last row if later) is compared with its closing amount: Account summary's closing value, else Portfolio breakdown's amount (a coin the breakdown doesn't list is then 0). The tolerance is one satoshi (1e-8). For each coin that differs the step offers, ticked, one **adjustment row**: a `receive` (to add coins) or `send` (to remove them) of the difference at 0 PLN, dated `{end date}T23:59:59Z`, with `affectsCash: false`, the note "Adjustment to match Revolut statement" in `comment` and the id `revolut-stmt-adjust-{coin}-{end date}-{difference}`. At 0 PLN it doesn't change what was paid: the walk adds received coins at no cost and removes sent ones at the average, realizing nothing. Activity shows the note on the row (`holdingsCheckNote`). Coins with no closing amount are listed in the preview as not checked.

**Holdings.** Coins the account doesn't hold yet become crypto holdings (`exchange: 'CC'`, so CoinGecko prices them) with the walk's quantity and average cost, and the Portfolio breakdown's price as the current price. The preview warns about coins CoinGecko doesn't know (`getCoinGeckoId`). Holdings the account already had go through the shared holding-changes step (below).

**Rows from the retired per-transaction import** (`revolut-btc-…`, `revolut-eth-…`) still load and show, but their fees are no longer paired with their trades.

---

## eMakler

[`eMaklerParser.ts`](../src/importers/eMaklerParser.ts) reads CP1250-encoded CSV; [`eMaklerImport.ts`](../src/importers/eMaklerImport.ts) diffs the parsed portfolio against existing holdings and converts order history into transactions, using NBP rates for historical PLN conversion. Order keys persist in `ft_emakler_order_keys` so re-imports dedup across files. A row for an instrument the account holds carries that holding's ticker, so it lands in the holding's position.

### Holdings missing from a file

No import deletes a holding ([`domain/missingHoldings.ts`](../src/domain/missingHoldings.ts)). Only a file that lists everything an account holds — the eMakler portfolio, PKO IKE and other holdings CSVs — can say a holding is gone, and even then the preview lists it under "Not in this file" with **Keep** selected. **Mark as sold** closes it through Close position (`planClose`) with an amount prefilled from quantity × current price and a date prefilled from the file's statement date. Neither format carries one today, so the date is today; with a statement date, holdings bought after it would not be listed. When the file shares no holding with the account, the preview warns that it may be the wrong account and lists none. Files that list only some instruments (eMakler order history, XTB trade files) never list missing holdings; the Revolut statement checks its coins against their closing amounts instead. eMakler order history alone doesn't change existing holdings either: they show as "Kept", and their orders are recorded as transactions.

When an eMakler upload has both files and the order history sells a holding the portfolio lacks, `accountForUploadSales` works out what those sales leave, after a buy filled in for units the log never recorded (dated no later than the first sale). Nothing left — or more sold than held — closes it on the last sale's day with no sale of its own (`planCloseFromSales`). Units left keep it under "Not in this file" with that remaining quantity: Mark as sold then sells only those (`planClose` with `priorSales`), on or after the last upload sale.

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

## Trades update their holdings

[`domain/holdingSync.ts`](../src/domain/holdingSync.ts). After an import that brings trades — XTB Cash Operations, XTB confirmations, the Revolut statement, eMakler order history on its own — every open holding the file traded is walked again (`walkPosition`) with the new rows. Where the quantity differs from the holding's, a shared step (`HoldingSyncStep`) proposes the change before anything is written: "10 → 15 shares" (new quantity and average cost), or "Sold out → close" when nothing is left, which closes the holding with the file's own sales (`planCloseFromSales`: closed on the last sale's or send's day, no extra sale added). A holding is touched only when the log explained its quantity *before* the import; otherwise (bought before the first import, entered by hand, edited since) it is listed as left alone. Two open holdings with one ticker are left alone too. For XTB the step runs between "create holdings for new instruments" and the purchase-price step; for the Revolut statement it follows the holdings check, for coins the account already held; for eMakler it follows an orders-only import, for the holdings shown as Kept (with a portfolio file, the portfolio sets the quantities). Quantities are rounded to 8 decimals.

## Cost basis recalculation

After an XTB transaction import, `XTBTransactionFlow` offers to rebuild holding cost bases from the log: a diff table of current versus calculated average, then a single confirm that writes `holding.purchasePrice` from the average cost of the units still held (`walkPosition`: sales remove units at the running average, and a sold-out position starts again from the next buy). Both the diff and the confirm are scoped to the importing account — the same ticker in another account keeps its own cost. Holdings that are synthetic or have no open position in the log are skipped. Applied through `replaceAccounts()` as one atomic update.

---

## Activity page

[`src/pages/Activity.tsx`](../src/pages/Activity.tsx), routed at `/activity`.

Full transaction log with a summary bar (net income, dividends net, deposits) that reflects the filtered view and defaults to the current year. Filters: type multi-select, account, and a date range.

**Deleting a transaction** is more than one row. If the deleted transaction was the last `buy` for a ticker, the matching non-synthetic holding is orphaned and deleted too — and `deleteHolding` itself cascades to the transactions that belong to that holding: everything linked by `relatedHoldingId`, plus unlinked rows in the same account matching its ticker or name — but only when no other holding in the account shares that ticker or name (`findHoldingTransactions` in [`domain/holdingDeletion.ts`](../src/domain/holdingDeletion.ts), which the delete dialogs also count with). When the ticker is shared, a dividend, tax or interest row whose link `resolveDividendLinks` derived from `relatedTicker` is not ownership — it just points at the last holding with that ticker — so it stays and is re-linked to the holding that remains. Because one delete can touch both stores, undo restores a pre-delete snapshot of transactions *and* accounts rather than re-inserting a single row. Deleting, and undoing, recalculate the account's Cash row straight away.
