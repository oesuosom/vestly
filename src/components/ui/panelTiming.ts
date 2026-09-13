// Kept in its own module rather than inside a panel component: mixing a plain
// function into a file that exports components breaks React Fast Refresh.

/**
 * Read the close animation duration from the CSS var so this stays in sync with
 * `.t-panel-slide` in index.css. Falls back to 350ms if unavailable.
 */
export function readCloseDuration() {
  if (typeof window === 'undefined') return 350
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--panel-close-dur')
    .trim()
  const ms = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN
  return Number.isFinite(ms) ? ms : 350
}
