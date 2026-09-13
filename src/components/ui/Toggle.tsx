import { motion } from 'framer-motion'

type ToggleProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        group relative inline-flex h-6 w-10 shrink-0 rounded-full
        transition-colors duration-200
        focus:outline-none focus-visible:ring-2 focus-visible:ring-positive focus-visible:ring-offset-2
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${checked ? 'bg-positive' : 'bg-input'}
      `}
    >
      {!disabled && (
        <span className="pointer-events-none absolute inset-0 rounded-full bg-white opacity-0 transition-opacity duration-150 group-hover:opacity-20" />
      )}
      {label && <span className="sr-only">{label}</span>}
      <motion.span
        className="pointer-events-none absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface shadow-xs"
        initial={false}
        animate={{ x: checked ? 19 : 3 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
      />
    </button>
  )
}
