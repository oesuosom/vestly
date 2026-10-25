import { useEffect, useState } from 'react'

/**
 * Drives a CSS enter/exit transition from a boolean `isOpen`.
 *
 * - `mounted` turns on with `isOpen` and stays on for `exitMs` after it turns
 *   off, so the element is still in the DOM while its exit transition plays
 *   (and e.g. a scroll lock can be held through it).
 * - `open` is the transition target: it turns on two animation frames after
 *   `isOpen`, and off immediately when `isOpen` turns off.
 *
 * Why two frames: a freshly mounted element has to be painted once in its
 * "from" state before `open` flips, or the browser skips the transition and
 * snaps straight to the end. Frame one commits the mount; frame two paints it.
 *
 * The synchronous halves (mount on open, un-open on close) are adjusted during
 * render — React's "adjust state when a prop changes" pattern — so the effect
 * only ever sets state from rAF/timeout callbacks. That's what keeps this off
 * `react-hooks/set-state-in-effect`, which the hand-rolled versions tripped.
 */
export function useEnterExit(isOpen: boolean, exitMs = 0) {
  const [mounted, setMounted] = useState(isOpen)
  const [open, setOpen] = useState(false)

  if (isOpen && !mounted) setMounted(true)
  if (!isOpen && open) setOpen(false)

  useEffect(() => {
    if (isOpen) {
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setOpen(true))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
    const id = setTimeout(() => setMounted(false), exitMs)
    return () => clearTimeout(id)
  }, [isOpen, exitMs])

  return { mounted, open }
}
