import { Check } from '@/generated/icons'

type CheckboxProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, label, disabled = false, className = '' }: CheckboxProps) {
  return (
    <label
      className={`inline-flex items-center gap-2 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer group'
      } ${className}`}
    >
      <span className="relative flex items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <span
          className={`
            relative flex items-center justify-center h-4 w-4 shrink-0 rounded
            border transition-colors duration-150
            peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2
            ${checked
              ? 'bg-foreground border-foreground'
              : 'bg-surface border-input group-hover:border-[#C4C4C8]'
            }
          `}
        >
          {checked && (
            <span className="absolute inset-0 rounded-[3px] bg-white opacity-0 group-hover:opacity-20 transition-opacity duration-150 pointer-events-none" />
          )}
          {checked && (
            <Check size={16} className="relative text-background" />
          )}
        </span>
      </span>
      {label && <span className="text-sm text-foreground select-none tracking-[-0.35px] truncate min-w-0">{label}</span>}
    </label>
  )
}
