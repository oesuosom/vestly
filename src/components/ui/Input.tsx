import { forwardRef, type InputHTMLAttributes } from 'react'

type InputProps = {
  label?: string
  error?: string
} & InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-foregroundMuted mb-1 tracking-[-0.35px]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3 py-2 text-sm border border-border rounded-md
            bg-surface text-foreground tracking-[-0.35px] transition-colors
            placeholder:text-accent
            focus:outline-none focus:border-foreground
            ${error ? 'border-negative' : ''}
            ${className}
          `}
          {...rest}
        />
        {error && <p className="text-xs text-negative mt-1">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
