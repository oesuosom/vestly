import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { Cross } from '@/generated/icons'

type ToastProps = {
  isOpen: boolean
  onClose: () => void
  message: string
  onUndo?: () => void
  /** Optional secondary action button rendered alongside Undo. */
  action?: { label: string; onClick: () => void }
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
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredRef = useRef(false)

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!hoveredRef.current) {
        setVisible(false)
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

  // Open animation
  useEffect(() => {
    if (isOpen) {
      // Small delay to trigger CSS transition
      requestAnimationFrame(() => setVisible(true))
      startTimer()
    } else {
      setVisible(false)
      clearTimer()
    }
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
    setVisible(false)
    setTimeout(onClose, 200)
  }

  function handleAction() {
    clearTimer()
    action?.onClick()
    setVisible(false)
    setTimeout(onClose, 200)
  }

  function handleClose() {
    clearTimer()
    setVisible(false)
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
          <Button variant="destructive" onClick={handleAction}>{action.label}</Button>
        )}
        <Button variant="ghost" icon={Cross} iconPosition="only" onClick={handleClose} />
      </div>
    </div>,
    document.body
  )
}
