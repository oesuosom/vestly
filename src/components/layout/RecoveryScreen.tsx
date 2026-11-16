import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { clearAppKeys, listAppKeys } from '@/utils/appStorage'
import { downloadJson } from '@/utils/download'

// ─────────────────────────────────────────────────────────────────────────────
// Dependency rule: this screen is shown when the app cannot trust its own
// storage layer — a render crash (`app/ErrorBoundary.tsx`) or unreadable data
// on load (`context/PortfolioContext.tsx`). It must keep working when
// `storage/portfolioStore.ts` is the thing that failed, so it must NEVER import
// from `@/storage/*` or any context. Only dependency-free helpers belong here.
// ─────────────────────────────────────────────────────────────────────────────

/** Where the app keeps its settings, including the user's API keys. */
const SETTINGS_KEY = 'ft_settings'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Blank the API keys in a stored settings object, so the recovery file can be
 * shared when asking for help. The same fields `stripApiKeys` clears for a
 * normal export in `DataManagementSettingsPage.tsx` (kept local: see the rule
 * above); a test fails if the two drift apart. Only fields that exist are
 * touched, so the file stays a faithful copy of what was stored.
 */
function blankApiKeys(settings: Record<string, unknown>): Record<string, unknown> {
  const blanked = { ...settings }
  if ('coinGeckoApiKey' in blanked) blanked.coinGeckoApiKey = ''
  if ('claudeApiKey' in blanked) blanked.claudeApiKey = ''
  if (isPlainObject(blanked.priceProvider)) {
    blanked.priceProvider = { ...blanked.priceProvider, apiKey: '' }
  }
  if (isPlainObject(blanked.exchangeRateProvider)) {
    const { apiKey: _apiKey, ...provider } = blanked.exchangeRateProvider
    blanked.exchangeRateProvider = provider
  }
  return blanked
}

/**
 * Read every app-owned key straight out of localStorage and hand it back as a
 * downloadable file, which Settings → Data Management → Restore Backup accepts.
 *
 * Values are re-parsed where possible and passed through as raw strings where
 * not, so even corrupt entries survive into the backup exactly as stored. The
 * one exception is settings: API keys are blanked, and settings that can't be
 * read are left out entirely, since there is no reliable way to find a key
 * inside damaged text.
 */
function downloadRawBackup(): void {
  const dump: Record<string, unknown> = {}
  for (const key of listAppKeys()) {
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      value = raw
    }
    if (key === SETTINGS_KEY) {
      if (!isPlainObject(value)) continue
      value = blankApiKeys(value)
    }
    dump[key] = value
  }
  downloadJson('vestly-recovery', dump)
}

type RecoveryScreenProps = {
  title: string
  description: string
  /** Technical detail shown in a monospace block, typically the error message. */
  details?: string
}

/**
 * Full-page recovery screen: raw backup download, reload, and a two-step reset.
 *
 * Nothing here writes to localStorage except the confirmed reset. The backup
 * is always offered first, so a user is never forced to choose between a
 * broken app and losing their records.
 */
export function RecoveryScreen({ title, description, details }: RecoveryScreenProps) {
  // Second click on "Reset all app data" confirms; the first only arms it.
  const [resetArmed, setResetArmed] = useState(false)

  const handleReset = () => {
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    clearAppKeys()
    window.location.reload()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-20">
      <div className="w-full max-w-md text-center">
        <h1 className="text-base font-semibold text-foreground tracking-[-0.35px]">{title}</h1>
        <p className="text-sm text-accent mt-2">{description}</p>

        {details && (
          <pre className="mt-6 max-h-40 overflow-auto rounded-lg bg-muted px-4 py-3 text-left text-xs text-accent whitespace-pre-wrap break-words">
            {details}
          </pre>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" className="w-full" onClick={downloadRawBackup}>
            Download backup
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
          <Button variant="destructive" className="w-full" onClick={handleReset}>
            {resetArmed ? 'Click again to erase everything' : 'Reset all app data'}
          </Button>
        </div>

        <p className="text-xs text-accent mt-4 text-balance">
          If the file is readable, you can restore it later in
          Settings&nbsp;→&nbsp;Data&nbsp;Management. It leaves out API keys, and any
          settings that can&rsquo;t be read, since those could hold one.
        </p>
        <p className="text-xs text-accent mt-2">
          Resetting erases every account, holding and transaction stored in
          this browser. It cannot be undone.
        </p>
      </div>
    </div>
  )
}
