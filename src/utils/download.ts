/**
 * Hand the browser a JSON file to save.
 *
 * Dependency-free on purpose — the crash-recovery path uses this, so it must
 * not import anything that could itself be broken. `filenameBase` is stamped
 * with today's date: `vestly-backup` → `vestly-backup-2026-09-12.json`.
 */
export function downloadJson(filenameBase: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const today = new Date().toISOString().split('T')[0]

  const a = document.createElement('a')
  a.href = url
  a.download = `${filenameBase}-${today}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
