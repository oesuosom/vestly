import type { ReactNode } from 'react'

type BadgeVariant =
  | 'purple'
  | 'positive'
  | 'negative'
  | 'warning'
  | 'neutral'
  | 'blue'
  | 'fuchsia'
  | 'teal'
  | 'lime'
  | 'orange'
  | 'ghost'

type BadgeProps = {
  variant?: BadgeVariant
  children: ReactNode
  showDot?: boolean
  dotColor?: BadgeVariant
}

const variantClasses: Record<BadgeVariant, string> = {
  purple:   'bg-purpleForeground text-purple',
  positive: 'bg-positiveForeground text-positive',
  negative: 'bg-negativeForeground text-negative',
  warning:  'bg-warningForeground text-warning',
  neutral:  'bg-neutralForeground text-neutral',
  blue:     'bg-blueForeground text-blue',
  fuchsia:  'bg-fuchsiaForeground text-fuchsia',
  teal:     'bg-tealForeground text-teal',
  lime:     'bg-limeForeground text-lime',
  orange:   'bg-orangeForeground text-orange',
  ghost:    'bg-surface text-foreground',
}

const dotColorClasses: Record<BadgeVariant, string> = {
  purple:   'bg-purple',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning:  'bg-warning',
  neutral:  'bg-neutral',
  blue:     'bg-blue',
  fuchsia:  'bg-fuchsia',
  teal:     'bg-teal',
  lime:     'bg-lime',
  orange:   'bg-orange',
  ghost:    'bg-foreground',
}

export function Badge({ variant = 'neutral', children, showDot = false, dotColor }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs leading-none font-medium ${variantClasses[variant]}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor ? dotColorClasses[dotColor] : 'bg-current'}`} />}
      {children}
    </span>
  )
}
