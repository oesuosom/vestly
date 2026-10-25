import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, type ButtonVariant } from '@/components/ui/Button'
import { Cross } from '@/generated/icons'
import { useEnterExit } from '@/hooks/useEnterExit'

type ToastProps = {
  isOpen: boolean
  onClose: () => void
  message: string
  onUndo?: () => void
  /** Optional secondary action button rendered alongside Undo. Defaults to the destructive variant. */
  action?: { label: string; onClick: () => void; variant?: ButtonVariant }
  duration?: number
}

export function Toast({
  isOpen,
  onClose,
  message,
  onUndo,
  action,
  duration = 5000,
}: ToastProps) {
  // The toast unmounts as soon as `isOpen` turns off, so its slide-out plays
  // *before* that: dismissing sets `leaving`, and onClose fires 200ms later.
  const { open: entered } = useEnterExit(isOpen)
  const [leaving, setLeaving] = useState(false)
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setLeaving(false) // re-opened: a fresh toast slides in again
  }
  const visible = entered && !leaving

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredRef = useRef(false)

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!hoveredRef.current) {
        setLeaving(true)
        setTimeout(onClose, 200) // wait for slide-out
      }
    }, duration)
  }, [duration, onClose])

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Auto-dismiss timer
  useEffect(() => {
    if (isOpen) startTimer()
    else clearTimer()
    return clearTimer
  }, [isOpen, startTimer, clearTimer])

  function handleMouseEnter() {
    hoveredRef.current = true
    clearTimer()
  }

  function handleMouseLeave() {
    hoveredRef.current = false
    startTimer()
  }

  function handleUndo() {
    clearTimer()
    onUndo?.()
    setLeaving(true)
    setTimeout(onClose, 200)
  }

  function handleAction() {
    clearTimer()
    action?.onClick()
    setLeaving(true)
    setTimeout(onClose, 200)
  }

  function handleClose() {
    clearTimer()
    setLeaving(true)
    setTimeout(onClose, 200)
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className={`
        fixed bottom-6 right-6 z-toast
        min-w-[320px] max-w-[480px]
        bg-surface border border-border shadow-md rounded-lg
        px-4 py-3
        flex items-center gap-3
        transition-all duration-200 ease-out
        ${visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}
      `}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <p className="text-sm text-foreground flex-1">{message}</p>

      <div className="flex items-center gap-1 shrink-0">
        {onUndo && (
          <Button variant="ghost" onClick={handleUndo}>Undo</Button>
        )}
        {action && (
          <Button variant={action.variant ?? 'destructive'} onClick={handleAction}>{action.label}</Button>
        )}
        <Button variant="ghost" icon={Cross} iconPosition="only" onClick={handleClose} />
      </div>
    </div>,
    document.body
  )
}
