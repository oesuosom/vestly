/**
 * eMakler preview rules: how an upload compares with the account. Kept apart
 * from the flow component so the rules can be tested on their own.
 */
import { planCloseFromSales } from '@/domain/closePosition'
import { findMissingHoldings } from '@/domain/missingHoldings'
import type { EMaklerHoldingResult, EMaklerImportResult } from '@/importers/eMaklerImport'
import type { Account, Holding, Transaction } from '@/types'

/**
 * `sold`: a holding the portfolio file no longer lists whose sale is in the
 * uploaded order history, so the import closes it with that sale.
 */
export type RowAction = 'update' | 'add' | 'sold'

export type PreviewRow = {
  action: RowAction
  importHolding?: EMaklerHoldingResult
  existingHolding?: Holding
}

/** What the preview compares the files against, worked out once per upload. */
export type PreviewPlan = {
  rows: PreviewRow[]
  /** Holdings the portfolio file doesn't list and no upload sale explains. */
  missing: Holding[]
  /** The portfolio file shares no holding with the account. */
  noOverlap: boolean
}

/** Exported for dev fixtures. */
export type EMaklerPreviewRow = PreviewRow

export const holdingKey = (name: string, exchange: string | undefined) => `${name.toLowerCase()}|${exchange ?? ''}`

/**
 * The upload's executed orders as log rows. A row for an instrument the
 * account holds carries that holding's ticker (or the one typed for a new
 * holding), so the position walk files it under the same position as the
 * holding — the name alone often resolves to a different key.
 */
export function eMaklerTransactions(
  result: EMaklerImportResult,
  accountId: string,
  tickerFor: (name: string, exchange: string) => string | undefined,
  now: string,
): Transaction[] {
  return result.transactions.map((t) => {
    const ticker = tickerFor(t.name, t.exchange)
    return {
      id: crypto.randomUUID(),
      accountId,
      type: t.side,
      date: t.date,
      amountPLN: t.amountPLN,
      instrument: t.name,
      ...(ticker && { ticker }),
      exchange: t.exchange,
      quantity: t.quantity,
      pricePerUnitPLN: t.pricePerUnitPLN,
      originalCurrency: t.originalCurrency,
      pricePerUnitOriginal: t.pricePerUnitOriginal,
      externalId: t.deduplicationKey,
      source: 'emakler_import' as const,
      createdAt: now,
    }
  })
}

/**
 * Compare an upload with the account. The portfolio file lists everything
 * held, so a holding it lacks is either sold by a sale in the same upload
 * (closed with that sale) or listed under "Not in this file". Order history
 * alone lists only what it has orders for: it never lists missing holdings.
 */
export function planEMaklerPreview(
  result: EMaklerImportResult,
  ordersOnlyMode: boolean,
  account: Account | undefined,
  transactions: Transaction[],
): PreviewPlan {
  const existing = (account?.holdings ?? []).filter((h) => !h.isSynthetic)
  const byKey = new Map(existing.map((h) => [holdingKey(h.name, h.exchange), h]))

  const rows: PreviewRow[] = result.holdings.map((h) => {
    const existingHolding = byKey.get(holdingKey(h.name, h.exchange))
    return { action: existingHolding ? 'update' : 'add', importHolding: h, existingHolding }
  })
  if (ordersOnlyMode || !account) return { rows, missing: [], noOverlap: false }

  const matched = new Set(rows.flatMap((r) => (r.existingHolding ? [r.existingHolding.id] : [])))
  const { missing, noOverlap } = findMissingHoldings(existing, matched, result.holdings.length > 0)
  if (missing.length === 0) return { rows, missing, noOverlap }

  // Which missing holdings an upload sale closes: try it against the log as
  // the import would leave it.
  // Rows already in the log (Reimport All) are skipped, as importTransactions does.
  const known = new Set(transactions.map((t) => t.externalId))
  const uploaded = eMaklerTransactions(result, account.id, (name, exchange) => byKey.get(holdingKey(name, exchange))?.ticker, '')
  const log = [...transactions, ...uploaded.filter((t) => !known.has(t.externalId))]
  const stillMissing: Holding[] = []
  for (const holding of missing) {
    if (planCloseFromSales(holding, account, log, uploaded)) rows.push({ action: 'sold', existingHolding: holding })
    else stillMissing.push(holding)
  }
  return { rows, missing: stillMissing, noOverlap }
}
