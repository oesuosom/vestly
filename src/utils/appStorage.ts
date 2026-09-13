/**
 * The localStorage namespace Vestly owns.
 *
 * Deliberately dependency-free: the crash-recovery path in
 * `app/ErrorBoundary.tsx` uses these helpers, and it must keep working when
 * `storage/portfolioStore.ts` is the thing that failed. Enumerating by prefix
 * rather than listing keys means new keys are covered automatically — a
 * hand-maintained list silently goes stale (it already had, missing
 * `ft_no_div_cache`, the per-account `ft_account_insight_*` keys, and a bumped
 * historical-prices version).
 */
export const APP_KEY_PREFIX = 'ft_'

/** Every localStorage key the app owns, snapshotted so callers can mutate safely. */
export function listAppKeys(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith(APP_KEY_PREFIX))
}

/** Remove every key the app owns. Irreversible. */
export function clearAppKeys(): void {
  listAppKeys().forEach((key) => localStorage.removeItem(key))
}
