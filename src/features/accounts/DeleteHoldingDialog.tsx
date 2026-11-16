import { useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { usePortfolio } from '@/context/PortfolioContext'
import { describeTransactions, findHoldingTransactions } from '@/domain/holdingDeletion'
import type { Holding } from '@/types'

type DeleteHoldingDialogProps = {
  holding: Holding | null
  isOpen: boolean
  onClose: () => void
  /** Runs after the holding is deleted, e.g. to close the panel it was opened from. */
  onDeleted?: () => void
}

/**
 * The one "delete holding" confirmation, shared by the holdings table and the
 * holding panel. It counts the transactions that go with the holding using the
 * same function `deleteHolding` removes them with, so the two can't disagree.
 */
export function DeleteHoldingDialog({ holding, isOpen, onClose, onDeleted }: DeleteHoldingDialogProps) {
  const { accounts, transactions, deleteHolding } = usePortfolio()

  const summary = useMemo(
    () => (holding ? describeTransactions(findHoldingTransactions(holding, accounts, transactions)) : null),
    [holding, accounts, transactions],
  )

  // Hold the copy steady while the dialog animates out: by then the holding
  // (and its transactions) may already be gone, which would blank the name and
  // drop the count mid-fade. Same "store previous value" pattern as the panel.
  const [shown, setShown] = useState({ name: holding?.name ?? '', summary })
  if (isOpen && holding && (shown.name !== holding.name || shown.summary !== summary)) {
    setShown({ name: holding.name, summary })
  }

  function handleConfirm() {
    if (holding) deleteHolding(holding.id)
    onClose()
    onDeleted?.()
  }

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Delete Holding"
      message={
        <>
          Are you sure you want to delete{' '}
          <span className="font-medium text-foreground">{shown.name}</span>?{' '}
          {shown.summary && (
            <>
              This also deletes <span className="font-medium text-foreground">{shown.summary}</span>.{' '}
            </>
          )}
          This cannot be undone.
        </>
      }
      confirmLabel="Delete"
    />
  )
}
