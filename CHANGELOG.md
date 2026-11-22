# Changelog

All notable changes to Vestly are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Cash panel explains the balance** — clicking an account's Cash row used to open the same
  panel as a stock, with a quantity of 1, a price, "Not yet refreshed" and empty returns. It now
  shows the available cash with the account's name above it, a short table of how it adds up
  (deposits, withdrawals, buys, sales, income, taxes and fees, each with a count and a total),
  and the ten latest changes, with a link to the account's transactions in Activity. Trades
  that didn't come out of the account's cash, such as eMakler imports, are counted and explained
  in a note. A balance below zero comes with a hint that deposits may be missing, and an account
  with no cash transactions yet points to Activity. Activity can now open filtered to one account.

### Fixed

- **Provider switches are respected; nothing goes to Anthropic while AI is off** — the on/off
  switches in Settings › Market Data and AI Providers were saved but mostly ignored, so with AI
  off and a Claude key saved, Overview and the account pages still sent a summary of the
  portfolio to Anthropic, and EODHD, Yahoo Finance, CoinGecko and NBP were called whatever their
  switch said. Now a provider that's off is never contacted, key or not — prices, price history,
  dividends, news for AI insights and eMakler imports included — and switching one back on works
  without a reload.
  - **AI insights stay off until you switch Anthropic on, even if a key is saved.** On Overview
    the insight card is hidden while AI is off or has no key. On an account page the card says
    AI is off (and that nothing is sent), asks for a key when one is missing, shows a skeleton
    while it loads, and explains an error in plain words with a way to try again.
  - **New defaults:** a new install starts with Yahoo Finance, NBP and CoinGecko (free tier, no
    key needed) on, and Anthropic and EODHD off. Saved switches keep their values; only missing
    ones take these defaults. Installs that saved every switch off keep them off: switch the
    providers you want on in Settings › Market Data. The charts say which switch is off.
  - **History charts** leave out holdings without price history instead of drawing a straight
    line from purchase to today; the value above the chart still counts them. A note under the
    chart names what's left out and which provider is off, or says their price history couldn't
    be loaded when the provider is on. When nothing has history because providers are off, the
    chart is replaced by a message with a link to Market data; when it all failed to load, by a
    message with a Try again button that fetches it again without a reload.
  - **Holding panel:** when the holding's price provider is off, it says the price isn't
    updated automatically and hides Refresh Price.
  - Market Data now says what each provider is used for, CoinGecko can be switched on without a
    key, and eMakler imports warn before they start when NBP and EODHD are both off.

- **Primary buttons are readable in the dark theme** — their label was always white, so on the
  near-white dark-theme button it couldn't be read (Save, Add Account, Continue and the other main
  actions). The label now follows the theme. In dark mode the hover darkens the button and the
  glossy edge is a dark tint, so both still show. A disabled button's label is faded once instead
  of twice, so it stays readable in both themes.

- **The history chart no longer counts another instrument's shares when names overlap** — for a
  holding with no ticker, the chart matched transactions by part of the name, so a holding
  "Apple" also counted buys of "Apple Hospitality REIT", and the reverse. Names now have to match
  in full; case and extra spaces still don't matter.

- **Screen readers name the sidebar links and the Settings button** — the Overview, Portfolio
  and Activity links and the Settings button held only an icon, so they were announced as an
  unnamed "link" or "button". Each now carries its name and its keyboard shortcut, and the link
  for the page you're on is announced as the current page. The hover label looks the same.

## [0.0.2] — 2026-11-21

Recording sales, and safer data. You can mark a holding as sold, XTB imports now bring in sales
and fees, and imported trades update or close the holdings they belong to. No import deletes a
holding missing from a file any more. Average cost and realized return account for sales and
fees, per account. Backups are checked before they are restored, failed saves and unreadable data
are reported instead of passing silently, and keyboard focus stays in the open dialog or pop-up.

### Added

- **Close position: record that you sold a holding** — "Close position" sits next to Edit and
  Delete, in the holdings table menu and the holding panel. Enter the date, the sale amount and
  an optional fee, and Vestly records one sale, keeps the holding's buys and dividends, and
  moves it to a new Closed positions list under the holdings table on the account page. Before
  you confirm, it shows the proceeds, the realized profit and what happens to Cash. Proceeds go
  to the account's Cash only when the purchases came out of it (XTB trades you imported): sell
  10 shares bought for 1,000 PLN for 1,600 PLN with a 10 PLN fee, and Cash rises by 1,590 PLN
  while Realized return on Overview rises by 590 PLN. Bonds, eMakler and crypto holdings and
  holdings you entered by hand leave Cash unchanged. A closed holding drops out of totals,
  allocation, price refresh, imports and the Portfolio page, but the chart still shows it up to
  the day you sold it. Open one from Closed positions to see its sale and transactions, or
  Reopen it if you closed it by mistake. Delete is still there, for holdings that should never
  have existed. For a bond, enter the amount PKO paid out: it already has the early-redemption
  fee (and any tax) taken out, so the fee you add is recorded but not taken off again. Each bond
  lot closes on its own, at its own cost, even when you hold several lots of one series. And an
  XTB import no longer offers to create a holding for an instrument you have sold: a closed or
  sold-out one isn't proposed, and a partly sold one is proposed at the units you still hold and
  their average cost.

### Changed

- **Faster repeat visits after an update** — React, Recharts, framer-motion and the web3icons
  metadata now ship as separate vendor chunks, so an app update no longer re-downloads them.
  Main bundle 1.90 MB → 761 KB (589 → 238 KB gzip).

### Fixed

- **XTB Cash Operations imports sales, fees and every buy** — the import skipped every sale with
  an "Unknown transaction type" warning, so Cash was short by the proceeds of each sale, sold
  shares still counted in the chart's history, and Realized return never saw them. Sales now
  import with their quantity, ticker and proceeds, and the holding-changes step after the import
  offers to close a holding sold in full, or lower the quantity of one sold in part. Buys whose
  comment names the ticker (`OPEN BUY ACME.US 2 @ 10.00`) or is one fill of a larger order
  (`0.5/2.5`) import too, instead of being skipped with "Could not parse buy comment". Commission,
  SEC fee and Tax IFTT rows import as fees, so they come out of Cash and show in Activity.
  Transfers between XTB accounts import as a deposit or withdrawal, and older spellings of the
  row types are read too. CFD rows are skipped with a warning saying so. Rows now keep their time
  of day (as UTC, as XTB labels it), so a sale and a rebuy on the same day run in the right
  order: sell 10 shares bought for 1,000 PLN, then buy 10 back for 2,000 PLN the same day, and
  the holding costs 200 PLN a share, not 150. Rows you imported before keep their date only.
  The preview warns when the rows don't add up to the file's Total row, so a row the import
  can't read never goes missing silently. A sale you already recorded with Close position is
  shown as a likely duplicate and not imported again. A trade that also came in from a daily
  confirmation is counted once, in either order of import, even when the export splits it into
  fills (`0.5/2.5` and `2/2.5`) or lists its commission as a separate row: the fills and the
  commission are skipped together. Two transfer rows that move money between parts of the same
  XTB account, in and out at the same time, are skipped instead of counting as a deposit and a
  withdrawal. Activity shows each transaction on the day it is counted
  on, in any time zone: a date-only row no longer shows the day before in time zones behind UTC.

- **The last holding's ⋯ menu is no longer cut off** — on an account page, the menu of the
  bottom row in the holdings table opened inside the table's rounded border, which hid Edit,
  Close position and Delete for that holding. The menu now opens on top of the page, below the
  ⋯ button, or above it when there isn't room below, and stays next to the button as the page
  scrolls. Escape closes it and puts focus back on the ⋯ button.

- **The Cash row can't be edited or deleted** — an account's Cash row is calculated from its
  transactions, but the holdings table and the holding panel still offered Edit and Delete. Both
  changed the account total until the next reload, and the day's snapshot was saved with the
  wrong value in between. The row no longer has a menu, and its panel says where the number
  comes from instead.

- **Imported trades now update or close their holdings** — after an XTB import (Cash
  Operations or daily confirmations) a later buy or sale of something you already held was
  recorded in Activity, but the holding kept its old quantity. Now the import shows what the
  trades change before anything is saved: "10 → 15 shares", or "Sold out → close" with the
  sale's date and proceeds. Confirm, and the quantity and average cost are updated, or the
  holding moves to Closed positions. A holding whose transactions don't add up to what you
  hold (for example, bought before your first import) is listed and left as it is. Revolut BTC
  and eMakler order history (uploaded without the portfolio file) use the same step. Selling or sending all your BTC now closes the holding instead of leaving
  the old quantity. After a partial sale the cost per BTC stays the same: buy 2 BTC for
  200,000 PLN and sell 1, and the holding keeps 100,000 PLN per BTC, not 200,000. A new BTC
  holding's cost now includes buy fees, as ETH's already did.
- **Imports no longer delete holdings missing from a file** — an eMakler order-history upload
  removed every holding it had no buy order for: upload one order for one stock and the others
  disappeared, and upload the same file twice and the whole account was emptied. A holding it
  did have orders for was overwritten with just those orders (10 units became 1 unit at 0 PLN).
  A PKO IKE
  (or other holdings CSV) import listed holdings missing from the file as "Remove", ticked by
  default, so a matured bond was deleted with its history instead of closed. Now no import
  deletes a holding. Order history alone keeps the holdings you have as they are and records
  their orders; it only adds holdings for instruments you don't have yet. A full
  holdings file (eMakler portfolio, PKO IKE) lists what it lacks under "Not in this file",
  each set to Keep, so importing as usual changes nothing. Pick Mark as sold to close one: the
  amount starts at its last known value and the date at today, and both can be changed. It
  then moves to Closed positions. Upload an eMakler portfolio with an order history that sells
  a holding the portfolio lacks, and that sale closes it on its own date, with its proceeds.
  If the sale covered only part of it, the rest is listed with what is left (for example 7 of
  10), and Mark as sold sells just those.
  A file that shares no holdings with the account shows a warning that it may be the wrong
  account, and lists nothing as missing.
- **The recovery screen's backup restores, without your API keys** — the file saved by
  Download backup on the "Something went wrong" and "couldn't be read" screens now restores
  through Settings → Data Management → Restore Backup, with the same checks as a normal backup.
  Before, Restore Backup answered "Not a Vestly backup — no recognised data". The file also
  leaves out your Anthropic, EODHD, CoinGecko and exchange-rate keys, as Export Backup always
  has, and leaves out settings it can't read, since they could hold one. If part of your data
  was already unreadable when the file was saved, Restore Backup names it and changes nothing,
  so you can fix that entry in the file and try again. Cached prices and AI summaries in the
  file are skipped; they refill on their own.
- **Realized return counted the wrong costs** — the figure on Overview (also part of Total
  return, and sent to the AI summary) is now worked out separately for each account. Before,
  the same ticker held in two accounts shared one average: buy 10 for 1,000 PLN and sell them
  for 1,500 PLN in one account, hold 10 bought for 3,000 PLN in another, and the sale showed
  a 500 PLN loss instead of a 500 PLN profit. Three more cases are fixed. Selling more units
  than your history records no longer counts the extra proceeds as profit: with 1 unit bought
  for 100 PLN and 10 sold for 1,000 PLN, only that 1 unit is counted. Crypto you sent away no
  longer stays in the average cost of what you buy afterwards. And Revolut fees now count: a
  buy's fee is part of what the coins cost, a sale's fee comes off what it brought in.
  Purchase prices proposed at the end of a Revolut ETH import include the buy fees too.
- **Deleting a holding asks first and keeps other holdings' transactions** — Delete in the
  holdings table now asks before removing anything, like the holding panel already did, and
  both say how many transactions go with it (e.g. "3 transactions (2 buys, 1 dividend)"). The
  Delete Account dialog now counts the account's transactions too. Only transactions that
  clearly belong to the holding are removed: with two holdings of the same ticker, deleting
  either one no longer takes the other's buys or dividends. Cash now updates as soon as a
  holding or transaction is deleted, or a delete is undone, instead of jumping on the next
  reload.
- **Restoring a damaged backup no longer breaks the app** — Restore Backup now checks every
  account, holding, snapshot and transaction for the details the app needs (an account's type, a
  holding's category, quantity and prices, a snapshot's allocation, a transaction's type and
  date) and refuses the file before anything is replaced, naming the record at fault, e.g.
  "Holding 3 (“Apple”) in “Broker” has no quantity." Previously such a file restored, then
  crashed every page, the account page or Portfolio after the reload, or showed "Invalid Date"
  in Activity. Backups from earlier versions still restore, and a stored snapshot missing its
  allocation no longer stops Vestly from starting.
- **Purchase prices after a sale, and across accounts** — the "update purchase prices" step
  at the end of an XTB import now works out the average cost of the units you still hold.
  Units you sold no longer count: buy 10 for 1,000 PLN, sell them all, buy 10 again for
  2,000 PLN, and the holding costs 200 per unit rather than 150. A partial sale leaves the
  average unchanged. The step also changes only the account you are importing into, and
  writes exactly the prices it previewed; before, confirming it blended the same ticker's
  buys from every account and rewrote purchase prices in accounts the preview never showed.
- **Escape closes only the top pop-up** — with a drop-down or date picker open inside a
  dialog (e.g. Category in Add Holding), Escape now closes just that list and puts focus back
  on its button; the dialog stays open and keeps what you typed. Press Escape again to close
  the dialog. The same goes for a dialog opened from a holding's side panel or from Settings:
  Escape closes the dialog and leaves the panel or Settings open.
- **Keyboard focus stays in the other pop-ups and the Settings dialog too** — the Portfolio
  filter panel, the date range picker, drop-down selects (e.g. Category when adding a holding)
  and the Settings dialog now keep Tab and Shift+Tab inside while open, instead of moving
  through the page or form behind them. Opening Settings moves focus into it. Closing any of
  them with Escape or a selection puts focus back on the button that opened it; clicking
  elsewhere still closes them and leaves focus where you clicked.
- **Keyboard focus stays in the Activity filter panel** — Tab and Shift+Tab now cycle through
  the panel's items (in every view, and while searching) instead of jumping to the page behind
  it while it stays open. Closing it with Escape or the F shortcut puts focus back on the
  Filter button.
- **Hidden dialogs no longer catch keyboard focus** — after the Settings dialog or a holding's
  side panel closes, Tab no longer moves onto their invisible buttons and inputs, and screen
  readers no longer announce them. Escape also no longer reaches the Settings dialog while it's
  closed.
- **Unreadable portfolio data no longer looks like an empty portfolio** — if stored accounts,
  snapshots or transactions can't be read, Vestly now shows the recovery screen (download a raw
  backup, reload, or reset) instead of "No portfolio data yet", and nothing is written until you
  choose to reset. Previously, edits made from that empty screen were silently lost.
- **Failed saves are no longer silent** — when browser storage is full, a banner explains that
  changes aren't being saved and what to do. It disappears after the next successful save.
- **Market Data settings** — "Update" and "Rebuild" no longer fail silently. When prices or
  quote history can't be fetched (offline, bad API key, provider down), a toast says so, with
  a Retry button; partial failures report how many holdings were affected.
- **XTB import: missing exchanges** — when creating holdings for instruments the importer
  couldn't identify, the Exchange dropdown now offers UK (LSE) and XETRA alongside US and PL,
  so London- and Frankfurt-listed ETFs get the right price feed.

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

[Unreleased]: https://github.com/oesuosom/vestly/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/oesuosom/vestly/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/oesuosom/vestly/releases/tag/v0.0.1
