import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

type ConfirmDialogProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  /** Body copy — may include inline emphasis (`<strong>`, coloured `<span>`, …).
   *  Optional: omit it when the body is driven entirely by `children`. */
  message?: ReactNode
  confirmLabel: string
  /** 'destructive' (default) for deletes, 'primary' for neutral confirmations. */
  confirmVariant?: 'destructive' | 'primary'
  confirmDisabled?: boolean
  cancelLabel?: string
  /** Optional extra content between the message and the footer (e.g. a "type DELETE" input). */
  children?: ReactNode
}

/**
 * ConfirmDialog — the shared confirm/destructive dialog. Renders in the `card`
 * modal chrome (compact header, white inner card, bordered footer) with a
 * Cancel + confirm button pair. Pass `children` for extra content such as a
 * type-to-confirm input; keep that input's state in the parent and drive the
 * confirm button with `confirmDisabled`.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  confirmVariant = 'destructive',
  confirmDisabled = false,
  cancelLabel = 'Cancel',
  children,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm" variant="card">
      <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
        <div className="p-5 flex flex-col gap-4">
          {message && <p className="text-sm text-foregroundMuted leading-normal tracking-[-0.35px]">{message}</p>}
          {children}
        </div>
        <div className="border-t border-borderLight p-5 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} className="w-20">{cancelLabel}</Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
