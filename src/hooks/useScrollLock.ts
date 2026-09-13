import { useEffect } from 'react'

// Shared lock count so nested/stacked overlays (e.g. a Modal opened over the
// Settings dialog) don't unlock the page while another overlay is still open.
let lockCount = 0
let previousOverflow = ''
let previousPaddingRight = ''

function lock() {
  if (lockCount === 0) {
    const { body } = document
    // Compensate for the scrollbar disappearing so the page doesn't shift.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    previousOverflow = body.style.overflow
    previousPaddingRight = body.style.paddingRight
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${current + scrollbarWidth}px`
    }
  }
  lockCount += 1
}

function unlock() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow
    document.body.style.paddingRight = previousPaddingRight
  }
}

/**
 * Locks scrolling of the page behind an overlay while `active` is true.
 * Prevents scroll chaining to the page underneath when the overlay's own
 * content reaches its scroll boundary or has nothing to scroll.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    lock()
    return unlock
  }, [active])
}
