type ColorVariant =
  | 'default'
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

type ColorDotProps = {
  variant: ColorVariant
  size?: number
  className?: string
}

export function ColorDot({ variant, size = 12, className = '' }: ColorDotProps) {
  const resolved = variant === 'default' ? 'neutral' : variant
  return (
    <div
      className={`shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: `var(--color-${resolved}-foreground)`,
        border: `1px solid var(--color-${resolved})`,
      }}
    />
  )
}
