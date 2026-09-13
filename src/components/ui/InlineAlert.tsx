import type { ReactNode } from 'react'
import { CircleInfo } from '@/generated/icons'

type InlineAlertVariant = 'warning' | 'negative' | 'neutral'

const INLINE_ALERT_STYLES: Record<InlineAlertVariant, string> = {
  warning: 'bg-warningForeground text-warning',
  negative: 'bg-negativeForeground text-negative',
  neutral: 'bg-muted text-foregroundMuted',
}

/** Inline alert banner — leading message, trailing info icon. */
export function InlineAlert({ variant, children }: { variant: InlineAlertVariant; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg ${INLINE_ALERT_STYLES[variant]}`}>
      <p className="flex-1 text-sm leading-normal tracking-[-0.35px]">{children}</p>
      <CircleInfo size={20} className="shrink-0" />
    </div>
  )
}
