/**
 * Spinner — the Geist "load-more" style loader: 12 radial bars whose opacity
 * fades in sequence, giving a smooth rotating shimmer. Colour follows
 * `currentColor`, so set it via a text-colour class on the parent.
 */
type SpinnerProps = {
  /** Diameter in pixels. */
  size?: number
  className?: string
}

const BARS = 12

export function Spinner({ size = 20, className = '' }: SpinnerProps) {
  const barW = size * 0.08
  const barH = size * 0.28

  return (
    <div
      role="status"
      aria-label="Loading"
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: BARS }).map((_, i) => (
        <span
          key={i}
          className="t-spinner-bar absolute block"
          style={{
            width: barW,
            height: barH,
            left: (size - barW) / 2,
            top: 0,
            borderRadius: barW,
            background: 'currentColor',
            transformOrigin: `${barW / 2}px ${size / 2}px`,
            transform: `rotate(${i * (360 / BARS)}deg)`,
            animationDelay: `${(i / BARS) * 1.2 - 1.2}s`,
          }}
        />
      ))}
    </div>
  )
}
