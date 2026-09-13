import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type Placement = 'top' | 'bottom'

type TooltipProps = {
  /** Text shown in the tooltip bubble. */
  label: string
  /** The trigger element the tooltip describes. */
  children: ReactNode
  /** Preferred side. Auto-flips to the opposite side only if this one doesn't fit. Default 'top'. */
  placement?: Placement
  className?: string
}

/** Gap between trigger and bubble (matches mb-1.5/mt-1.5), and min distance kept from the viewport edge. */
const GAP = 6
const EDGE = 8

/**
 * Lightweight hover/focus tooltip. The bubble fades in via CSS `group` state
 * (so it works for keyboard focus too), while a small measurement on open
 * resolves placement: it uses the preferred side, flipping to the opposite
 * side only when the preferred one doesn't fit, and shifts horizontally to
 * stay within the viewport.
 *
 * Reuses the chart tooltip's visual style (surface + border + shadow).
 */
export function Tooltip({ label, children, placement = 'top', className = '' }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [resolved, setResolved] = useState<Placement>(placement)
  const [shiftX, setShiftX] = useState(0)

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    const bubble = bubbleRef.current
    if (!trigger || !bubble) return
    const t = trigger.getBoundingClientRect()
    const b = bubble.getBoundingClientRect()

    // Vertical: keep the preferred side unless the bubble wouldn't fit there.
    const needed = b.height + GAP + EDGE
    const fitsAbove = t.top >= needed
    const fitsBelow = window.innerHeight - t.bottom >= needed
    if (placement === 'top') setResolved(!fitsAbove && fitsBelow ? 'bottom' : 'top')
    else setResolved(!fitsBelow && fitsAbove ? 'top' : 'bottom')

    // Horizontal: the bubble is centered on the trigger; nudge it back in if
    // either edge would overflow the viewport.
    const center = t.left + t.width / 2
    const half = b.width / 2
    let shift = 0
    if (center - half < EDGE) shift = EDGE - (center - half)
    else if (center + half > window.innerWidth - EDGE) shift = window.innerWidth - EDGE - (center + half)
    setShiftX(shift)
  }, [placement])

  return (
    <span
      ref={triggerRef}
      className={`group relative inline-flex ${className}`}
      tabIndex={0}
      onMouseEnter={reposition}
      onFocus={reposition}
    >
      {children}
      <span
        ref={bubbleRef}
        role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${shiftX}px))` }}
        className={`
          pointer-events-none absolute left-1/2 whitespace-nowrap rounded-md
          border border-border bg-surface px-3 py-2 font-mono text-xs font-medium text-foregroundMuted shadow-sm
          opacity-0 transition-opacity duration-150
          group-hover:opacity-100 group-focus-within:opacity-100
          ${resolved === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
        `}
      >
        {label}
      </span>
    </span>
  )
}
