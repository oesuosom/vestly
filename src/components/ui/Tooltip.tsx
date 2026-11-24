import { useCallback, useId, useRef, useState } from 'react'
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
  /**
   * `default`: the chart tooltip's style. `message`: the small message pill
   * (12 px regular text on surface with the small shadow), for notes.
   */
  variant?: 'default' | 'message'
  /** The trigger's accessible name, when its content has none (e.g. an icon). It is then an image. */
  ariaLabel?: string
  /** Gap between trigger and bubble, px. Default 6. Larger to clear what the trigger sits on (an icon it badges). */
  offset?: number
}

/** Gap between trigger and bubble (matches mb-1.5/mt-1.5), and min distance kept from the viewport edge. */
const GAP = 6
const EDGE = 8

const BUBBLE_STYLES = {
  default: 'rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs font-medium text-foregroundMuted shadow-sm',
  message:
    'rounded-md bg-surface px-2 py-1 text-xs leading-normal tracking-[-0.3px] text-foregroundMuted ' +
    'shadow-[0_0_0_1px_var(--color-border-light),0_8px_16px_-4px_rgba(10,10,10,0.05)]',
} as const

/**
 * Lightweight hover/focus tooltip. The bubble fades in via a named CSS group
 * (`group/tooltip`, so a hovered ancestor `group`, like a table row, doesn't open it)
 * (so it works for keyboard focus too), while a small measurement on open
 * resolves placement: it uses the preferred side, flipping to the opposite
 * side only when the preferred one doesn't fit, and shifts horizontally to
 * stay within the viewport.
 *
 * Reuses the chart tooltip's visual style (surface + border + shadow), or the
 * message pill's. The bubble is linked to the trigger with aria-describedby,
 * so screen readers read it with the trigger.
 */
export function Tooltip({ label, children, placement = 'top', className = '', variant = 'default', ariaLabel, offset = GAP }: TooltipProps) {
  const bubbleId = useId()
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
    const needed = b.height + offset + EDGE
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
  }, [placement, offset])

  return (
    <span
      ref={triggerRef}
      className={`group/tooltip relative inline-flex ${className}`}
      tabIndex={0}
      aria-describedby={bubbleId}
      {...(ariaLabel && { role: 'img', 'aria-label': ariaLabel })}
      onMouseEnter={reposition}
      onFocus={reposition}
    >
      {children}
      <span
        ref={bubbleRef}
        id={bubbleId}
        role="tooltip"
        style={{
          transform: `translateX(calc(-50% + ${shiftX}px))`,
          [resolved === 'top' ? 'marginBottom' : 'marginTop']: offset,
        }}
        className={`
          pointer-events-none absolute left-1/2 z-10 whitespace-nowrap ${BUBBLE_STYLES[variant]}
          opacity-0 transition-opacity duration-150
          group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100
          ${resolved === 'top' ? 'bottom-full' : 'top-full'}
        `}
      >
        {label}
      </span>
    </span>
  )
}
