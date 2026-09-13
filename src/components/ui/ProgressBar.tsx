type ProgressBarVariant = 'default' | 'positive' | 'negative'

type ProgressBarProps = {
  value: number
  max: number
  variant?: ProgressBarVariant
}

const fillClasses: Record<ProgressBarVariant, string> = {
  default: 'bg-accent',
  positive: 'bg-positive',
  negative: 'bg-negative',
}

export function ProgressBar({ value, max, variant = 'default' }: ProgressBarProps) {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0

  return (
    <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-300 ${fillClasses[variant]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
