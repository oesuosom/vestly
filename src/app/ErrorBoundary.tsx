import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { clearAppKeys, listAppKeys } from '@/utils/appStorage'
import { downloadJson } from '@/utils/download'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
  /** Second click on "Reset all app data" confirms; the first only arms it. */
  resetArmed: boolean
}

/**
 * Read every app-owned key straight out of localStorage and hand it back as a
 * downloadable file.
 *
 * Deliberately bypasses `storage/portfolioStore.ts`: the boundary exists to
 * catch failures whose cause may be the store itself (a bad restore, a
 * half-written migration), so the rescue path must not depend on the code that
 * can be broken. Values are re-parsed where possible and passed through as raw
 * strings where not, so even corrupt entries survive into the backup.
 */
function downloadRawBackup(): void {
  const dump: Record<string, unknown> = {}
  for (const key of listAppKeys()) {
    const raw = localStorage.getItem(key)
    if (raw === null) continue
    try {
      dump[key] = JSON.parse(raw)
    } catch {
      dump[key] = raw
    }
  }
  downloadJson('vestly-recovery', dump)
}

/**
 * Top-level crash guard.
 *
 * Vestly keeps everything in localStorage, so a render crash caused by bad
 * persisted data would otherwise be unrecoverable: a blank page with no UI left
 * to fix the data through. The fallback always offers a raw backup download
 * before the destructive reset, so a user can never be forced to choose between
 * a broken app and losing their records.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetArmed: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry by design — this is the user's own console only.
    console.error('[Vestly] Unhandled render error:', error, info.componentStack)
  }

  private handleReset = () => {
    if (!this.state.resetArmed) {
      this.setState({ resetArmed: true })
      return
    }
    clearAppKeys()
    window.location.reload()
  }

  render() {
    const { error, resetArmed } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6 py-20">
        <div className="w-full max-w-md text-center">
          <h1 className="text-base font-semibold text-foreground tracking-[-0.35px]">
            Something went wrong
          </h1>
          <p className="text-sm text-accent mt-2">
            Vestly hit an error it couldn&apos;t recover from. Your data is still
            in this browser — download a backup before trying anything else.
          </p>

          <pre className="mt-6 max-h-40 overflow-auto rounded-lg bg-muted px-4 py-3 text-left text-xs text-accent whitespace-pre-wrap break-words">
            {error.message || String(error)}
          </pre>

          <div className="mt-6 flex flex-col gap-2">
            <Button variant="primary" className="w-full" onClick={downloadRawBackup}>
              Download backup
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
            <Button variant="destructive" className="w-full" onClick={this.handleReset}>
              {resetArmed ? 'Click again to erase everything' : 'Reset all app data'}
            </Button>
          </div>

          <p className="text-xs text-accent mt-4">
            Resetting erases every account, holding and transaction stored in
            this browser. It cannot be undone.
          </p>
        </div>
      </div>
    )
  }
}
