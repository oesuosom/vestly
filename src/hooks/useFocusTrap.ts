import { useEffect, type RefObject } from 'react'

type FocusTrapOptions = {
  /** Gets focus back when the trap deactivates, unless an outside click closed it. */
  returnFocusTo?: RefObject<HTMLElement | null>
}

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

/** Elements Tab can land on inside `container`, in DOM (= tab) order. */
function getTabbables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(CANDIDATES)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(':disabled') &&
      !el.closest('[inert], [hidden]') &&
      // Not in jsdom; in the browser it also catches display/visibility hiding.
      (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })),
  )
}

/**
 * Keeps keyboard focus inside `ref` while `active`, for portaled popovers that
 * sit at the end of <body>, where Tab would otherwise leave them for whatever
 * comes next in the document.
 *
 * - Tab on the last tabbable wraps to the first, Shift+Tab on the first wraps
 *   to the last; in between, the browser's own order applies.
 * - Focusables are re-queried on every keypress, so views that swap their
 *   content (or a search that filters it) are always current.
 * - If focus is outside the container (e.g. it fell to <body> when the focused
 *   item unmounted), Tab / Shift+Tab bring it back to the first / last item.
 * - On deactivation, focus returns to `returnFocusTo` — unless the trap was
 *   closed by a pointer press outside it, so a click elsewhere keeps its focus.
 *
 * Escape and outside-click closing stay with the caller.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  { returnFocusTo }: FocusTrapOptions = {},
) {
  useEffect(() => {
    if (!active) return

    // Captured now: by cleanup time an unmounted container's ref is already null.
    const container = ref.current
    const returnTarget = returnFocusTo?.current
    let pressedOutside = false

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const root = ref.current
      if (!root) return

      const tabbables = getTabbables(root)
      if (tabbables.length === 0) {
        e.preventDefault()
        return
      }
      const first = tabbables[0]
      const last = tabbables[tabbables.length - 1]
      const current = document.activeElement

      if (!current || !root.contains(current)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) pressedOutside = true
    }

    document.addEventListener('keydown', onKeyDown)
    // Capture phase: runs before the caller's own outside-click handler closes it.
    document.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)

      if (pressedOutside || !returnTarget?.isConnected) return
      // Only reclaim focus that was in the container, or that fell to <body>
      // because the focused item unmounted with it.
      const current = document.activeElement
      if (!current || current === document.body || container?.contains(current)) {
        returnTarget.focus()
      }
    }
  }, [ref, active, returnFocusTo])
}
