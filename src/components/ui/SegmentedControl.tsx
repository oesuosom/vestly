import { useState, useRef, useLayoutEffect } from 'react'
import { motion } from 'framer-motion'

type SegmentedControlProps<T extends string> = {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const [hovered, setHovered] = useState<T | null>(null)
  const [pressed, setPressed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Map<T, HTMLButtonElement>>(new Map())
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  const target = hovered ?? value

  useLayoutEffect(() => {
    const btn = buttonRefs.current.get(target)
    if (!btn) return
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [target])

  return (
    <motion.div
      ref={containerRef}
      animate={{ scale: pressed ? 0.95 : 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 15 }}
      className="relative flex gap-0.5"
      onMouseLeave={() => setHovered(null)}
    >
      {pill && (
        <span
          className="absolute top-0 h-full rounded-md pointer-events-none transition-[left,width] duration-200 ease-out bg-muted"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {options.map((option) => (
        <button
          key={option}
          ref={(el) => { if (el) buttonRefs.current.set(option, el) }}
          onClick={() => onChange(option)}
          onMouseEnter={() => setHovered(option)}
          onPointerDown={() => setPressed(true)}
          onPointerUp={() => setPressed(false)}
          onPointerLeave={() => setPressed(false)}
          className={`
            relative z-10 h-7 px-2 py-1.5 rounded-md
            text-sm font-semibold leading-none whitespace-nowrap
            lining-nums tabular-nums cursor-pointer transition-colors duration-200
            ${value === option ? 'text-foreground' : 'text-foregroundMuted'}
          `}
        >
          {option}
        </button>
      ))}
    </motion.div>
  )
}
