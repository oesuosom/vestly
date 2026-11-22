import { Button } from '@/components/ui/Button'
import { noHistoryMessage } from '@/domain/historyCoverage'
import type { ProviderId } from '@/services/providers'

/** Centred title, explanation and one action: takes the history chart's (and range picker's) place. */
function ChartMessage({ title, body, actionLabel, onAction }: {
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 w-full max-w-[360px] mx-auto text-center">
      <p className="text-sm font-medium leading-normal tracking-[-0.35px] text-foreground">{title}</p>
      <p className="text-sm leading-normal tracking-[-0.35px] text-foregroundMuted">{body}</p>
      <div className="h-1" aria-hidden="true" />
      <Button variant="secondary" onClick={onAction}>{actionLabel}</Button>
    </div>
  )
}

/** Replaces the history chart when nothing has price history because providers are off. */
export function NoPriceHistory({ off, onOpenMarketData }: { off: ProviderId[]; onOpenMarketData: () => void }) {
  return (
    <ChartMessage
      title="No price history"
      body={noHistoryMessage(off)}
      actionLabel="Open Market data"
      onAction={onOpenMarketData}
    />
  )
}

/** Replaces the history chart when every holding's price history failed to load (nothing is off). */
export function PriceHistoryLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <ChartMessage
      title="Couldn't load price history"
      body="Price history couldn't be loaded just now. Values today are still correct."
      actionLabel="Try again"
      onAction={onRetry}
    />
  )
}

/**
 * Pill over the bottom of a chart that leaves holdings out, on a gradient that
 * fades from transparent to the surface behind the chart. Positioned by the caller.
 */
export function MissingHistoryPill({
  message,
  surface = 'surface',
  className = '',
}: {
  message: string
  /** Colour the gradient fades into: the card's surface, or the page background. */
  surface?: 'surface' | 'background'
  className?: string
}) {
  const fade = surface === 'surface' ? 'to-surface' : 'to-background'
  return (
    <div className={`flex items-end justify-center px-6 pt-8 pb-2 bg-gradient-to-b from-transparent ${fade} pointer-events-none ${className}`}>
      <p
        role="status"
        className="rounded-full bg-warningForeground px-2 py-1 text-xs leading-normal tracking-[-0.3px] text-warning text-center shadow-[0_0_0_1px_var(--color-warning-foreground),0_8px_16px_-4px_rgba(10,10,10,0.05)] pointer-events-auto"
      >
        {message}
      </p>
    </div>
  )
}
