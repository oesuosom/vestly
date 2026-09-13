type RadioButtonProps = {
  checked: boolean
  onChange: () => void
  label?: string
  disabled?: boolean
  name?: string
  value?: string
  className?: string
}

export function RadioButton({ checked, onChange, label, disabled = false, name, value, className = '' }: RadioButtonProps) {
  return (
    <label
      className={`inline-flex items-center gap-2 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer group'
      } ${className}`}
    >
      <span className="relative flex items-center justify-center">
        <input
          type="radio"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          name={name}
          value={value}
          className="sr-only peer"
        />
        <span
          className={`
            relative flex items-center justify-center h-4 w-4 shrink-0 rounded-full
            border transition-colors duration-150
            peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2
            ${checked
              ? 'bg-foreground border-foreground'
              : 'bg-surface border-input group-hover:border-[#C4C4C8]'
            }
          `}
        >
          {checked && (
            <span className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-20 transition-opacity duration-150 pointer-events-none" />
          )}
          {checked && (
            <span className="relative h-2 w-2 rounded-full bg-background" />
          )}
        </span>
      </span>
      {label && <span className="text-sm text-foreground select-none tracking-[-0.35px] truncate min-w-0">{label}</span>}
    </label>
  )
}
