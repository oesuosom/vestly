import { useCallback } from 'react'
import { usePortfolio } from '@/context/PortfolioContext'
import { actionableSyncRows, type HoldingSyncRow } from '@/domain/holdingSync'
import type { Transaction } from '@/types'

/**
 * Apply the rows of the holding-sync step: quantity and average cost for the
 * updates, Close position for the holdings sold out (with the sales the file
 * brought). Returns how many were updated and closed.
 *
 * `transactions` is the log as the import left it.
 */
export function useApplyHoldingSync() {
  const { importHoldings, closeImportedHoldings } = usePortfolio()
  return useCallback(
    (accountId: string, rows: HoldingSyncRow[], transactions: Transaction[]) => {
      const actionable = actionableSyncRows(rows)
      const updates = actionable.flatMap((r) =>
        r.kind === 'update'
          ? [{
              type: 'update' as const,
              existingId: r.holding.id,
              quantity: r.quantity,
              currentPrice: r.holding.currentPrice,
              purchasePrice: r.averageCostPLN,
            }]
          : [],
      )
      if (updates.length > 0) importHoldings(accountId, updates)
      const closes = actionable.flatMap((r) => (r.kind === 'close' ? [{ holdingId: r.holding.id, sales: r.sales }] : []))
      const closed = closeImportedHoldings(accountId, closes, transactions)
      return { updated: updates.length, closed: closed.length }
    },
    [importHoldings, closeImportedHoldings],
  )
}

/** "ACME holding updated", "2 holdings updated · 1 closed" — the done screen's clause. */
export function syncClause(result: { updated: number; closed: number }): string[] {
  const parts: string[] = []
  if (result.updated > 0) parts.push(`${result.updated} holding${result.updated !== 1 ? 's' : ''} updated`)
  if (result.closed > 0) parts.push(`${result.closed} holding${result.closed !== 1 ? 's' : ''} closed`)
  return parts
}
