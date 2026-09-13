/**
 * doneSummary — shared copy builders for the "done" screen of transaction
 * import flows (XTB, Revolut BTC, Revolut crypto).
 *
 * Keeps the success messaging consistent across flows:
 *   • a rolled-up lead clause   → "4 transactions imported"
 *   • a per-type detail subtitle → "2 buys · 2 fees"  (only when >1 type)
 *   • a holding clause that names the ticker when a single holding is created,
 *     and falls back to a count otherwise → "BTC holding created" / "2 holdings created"
 */

/** Pluralize `noun` by `n` ("1 buy", "2 buys"). */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n !== 1 ? 's' : ''}`
}

/**
 * Roll a per-type breakdown of imported transactions into a single lead clause
 * plus an optional detail subtitle.
 *
 * @param counts ordered map of singular type noun → count (e.g. { buy: 2, fee: 2 })
 * @returns lead ("4 transactions imported"), and detail ("2 buys · 2 fees") which
 *          is empty unless more than one type was imported.
 */
export function buildImportSummary(counts: Record<string, number>): {
  lead: string
  detail: string
} {
  const entries = Object.entries(counts).filter(([, n]) => n > 0)
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  const lead = total > 0 ? `${plural(total, 'transaction')} imported` : ''
  const detail =
    entries.length > 1 ? entries.map(([noun, n]) => plural(n, noun)).join(' · ') : ''
  return { lead, detail }
}

/**
 * Join the accumulated clauses into the sentence shown on the done screen,
 * falling back to the no-op message when nothing happened.
 */
export function joinDoneParts(parts: string[]): string {
  return parts.length > 0 ? parts.join('. ') + '.' : 'No changes were made.'
}

/**
 * Holding clause for the lead line. Names the ticker when exactly one holding
 * was created (and a ticker is known), otherwise gives a count.
 */
export function holdingClause(count: number, ticker?: string): string {
  if (count === 1 && ticker) return `${ticker} holding created`
  return `${plural(count, 'holding')} created`
}

/**
 * Lead line for holdings *syncs* (CSV, eMakler) that diff against existing
 * holdings, e.g. "Updated 1, Added 2, Removed 1 holdings in {account}".
 * Distinct from imports: a sync reports a net diff, not what was ingested.
 */
export function buildSyncSummary(
  stats: { updated: number; added: number; removed: number },
  accountName: string,
): string {
  const total = stats.updated + stats.added + stats.removed
  if (total === 0) return 'No changes were made.'
  const parts = [
    stats.updated > 0 && `Updated ${stats.updated}`,
    stats.added > 0 && `Added ${stats.added}`,
    stats.removed > 0 && `Removed ${stats.removed}`,
  ].filter(Boolean)
  return `${parts.join(', ')} holding${total !== 1 ? 's' : ''} in ${accountName}`
}
