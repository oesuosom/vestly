import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { parseAccountInsightMarkup } from '@/services/claude'
import { Synchronize } from '@/generated/icons'

/**
 * - `off`: Anthropic is switched off (whether or not a key is saved)
 * - `no-key`: switched on, but no key saved
 * - `on`: switched on with a key
 */
export type AiAvailability = 'off' | 'no-key' | 'on'

type AccountInsightPanelProps = {
  availability: AiAvailability
  summary: string | null
  isLoading: boolean
  error: string | null
  onOpenSettings: () => void
  onRetry: () => void
}

// ─────────────────────────────────────────
// Inline rich-text renderer for AI insight
// ─────────────────────────────────────────

function InsightText({ text }: { text: string }) {
  const parts = parseAccountInsightMarkup(text)
  return (
    <p className="text-[20px] leading-relaxed text-foreground tracking-[-0.5px]">
      {parts.map((part, i) => {
        if (typeof part === 'string') return <span key={i}>{part}</span>
        if (part.type === 'positive') return <span key={i} className="text-positive">{part.text}</span>
        if (part.type === 'negative') return <span key={i} className="text-negative">{part.text}</span>
        return (
          <span
            key={i}
            className="underline decoration-dotted decoration-border underline-offset-2"
          >
            {part.text}
          </span>
        )
      })}
    </p>
  )
}

/** Title, explanation and actions — the layout shared by the off, no-key and error states. */
function Message({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-base font-medium leading-normal tracking-[-0.4px] text-foreground">{title}</p>
      <p className="text-sm leading-normal tracking-[-0.35px] text-foregroundMuted">{children}</p>
      <div className="flex items-start gap-2">{actions}</div>
    </div>
  )
}

/** Four bars in place of the text while an insight is generated. */
function InsightSkeleton() {
  return (
    <div className="flex flex-col gap-3 overflow-clip" aria-busy="true" aria-label="Generating insight" role="status">
      {[
        { width: 'w-[360px]', opacity: '' },
        { width: 'w-[264px]', opacity: '' },
        { width: 'w-[296px]', opacity: 'opacity-80' },
        { width: 'w-[360px]', opacity: 'opacity-40' },
      ].map((line, i) => (
        <div key={i} className={`flex h-[30px] items-center ${line.opacity}`}>
          <div className={`h-6 max-w-full rounded-lg bg-muted ${line.width}`} />
        </div>
      ))}
    </div>
  )
}

/** The text area of the account page's insight card, in each of its states. */
export function AccountInsightPanel({
  availability,
  summary,
  isLoading,
  error,
  onOpenSettings,
  onRetry,
}: AccountInsightPanelProps) {
  if (availability === 'off') {
    return (
      <Message
        title="AI insights are off"
        actions={<Button variant="secondary" onClick={onOpenSettings}>Open AI settings</Button>}
      >
        Turn on Anthropic in Settings to get a short written summary of this account. While it’s off, nothing about your portfolio is sent to Anthropic.
      </Message>
    )
  }

  if (availability === 'no-key') {
    return (
      <Message
        title="Add an API key to get insights"
        actions={<Button variant="secondary" onClick={onOpenSettings}>Add API key</Button>}
      >
        Anthropic is switched on, but there’s no API key yet. The key stays in this browser and is only sent to Anthropic.
      </Message>
    )
  }

  if (summary) {
    return (
      <div className="flex flex-col gap-2">
        <InsightText text={summary} />
        {/* An older insight stays when a refresh fails. */}
        {error && !isLoading && (
          <p className="text-xs text-negative">Could not refresh — {error}</p>
        )}
      </div>
    )
  }

  if (isLoading) return <InsightSkeleton />

  if (error) {
    return (
      <Message
        title="Couldn’t generate an insight"
        actions={
          <>
            <Button variant="secondary" onClick={onOpenSettings}>Open AI settings</Button>
            <Button
              variant="secondary"
              icon={Synchronize}
              iconPosition="only"
              aria-label="Try again"
              title="Try again"
              onClick={onRetry}
            />
          </>
        }
      >
        {error}
      </Message>
    )
  }

  return null
}
