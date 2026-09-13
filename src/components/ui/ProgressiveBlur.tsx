type ProgressiveBlurProps = {
  className?: string
  backgroundColor?: string
  position?: 'top' | 'bottom' | 'left' | 'right'
  size?: string
  blurAmount?: string
  fixed?: boolean
}

const gradientFrom: Record<NonNullable<ProgressiveBlurProps['position']>, string> = {
  top: 'to top',
  bottom: 'to bottom',
  left: 'to left',
  right: 'to right',
}

const maskFrom: Record<NonNullable<ProgressiveBlurProps['position']>, string> = {
  top: 'to bottom',
  bottom: 'to top',
  left: 'to right',
  right: 'to left',
}

export function ProgressiveBlur({
  className = '',
  backgroundColor = 'var(--color-background)',
  position = 'top',
  size = '120px',
  blurAmount = '4px',
  fixed = false,
}: ProgressiveBlurProps) {
  const isVertical = position === 'top' || position === 'bottom'
  const isStart = position === 'top' || position === 'left'

  const sizeStyle = isVertical
    ? {
        [isStart ? 'top' : 'bottom']: 0,
        ...(fixed ? {} : { left: 0, width: '100%' }),
        height: size,
      }
    : {
        [isStart ? 'left' : 'right']: 0,
        top: 0,
        width: size,
        height: '100%',
      }

  return (
    <div
      className={`pointer-events-none select-none ${fixed ? 'fixed' : 'absolute'} ${className}`}
      style={{
        ...sizeStyle,
        background: `linear-gradient(${gradientFrom[position]}, transparent, ${backgroundColor})`,
        WebkitMaskImage: `linear-gradient(${maskFrom[position]}, black 50%, transparent)`,
        maskImage: `linear-gradient(${maskFrom[position]}, black 50%, transparent)`,
        WebkitBackdropFilter: `blur(${blurAmount})`,
        backdropFilter: `blur(${blurAmount})`,
      }}
    />
  )
}
