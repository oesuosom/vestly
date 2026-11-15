import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RecoveryScreen } from '@/components/layout/RecoveryScreen'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

/**
 * Top-level crash guard.
 *
 * Vestly keeps everything in localStorage, so a render crash caused by bad
 * persisted data would otherwise be unrecoverable: a blank page with no UI left
 * to fix the data through. The fallback is the shared `RecoveryScreen`, which
 * always offers a raw backup download before the destructive reset.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry by design — this is the user's own console only.
    console.error('[Vestly] Unhandled render error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <RecoveryScreen
        title="Something went wrong"
        description="Vestly hit an error it couldn't recover from. Your data is still in this browser — download a backup before trying anything else."
        details={error.message || String(error)}
      />
    )
  }
}
