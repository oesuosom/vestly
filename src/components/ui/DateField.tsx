import { forwardRef, type ChangeEventHandler, type FocusEventHandler, type ReactNode } from 'react'
import { Calendar } from '@/generated/icons'

type DateFieldProps = {
  id: string
  label: string
  /** `yyyy-MM-dd`, or '' when nothing is picked. */
  value: string
  onChange: ChangeEventHandler<HTMLInputElement>
  onBlur?: FocusEventHandler<HTMLInputElement>
  name?: string
  /** Earliest and latest pickable day, `yyyy-MM-dd`. */
  min?: string
  max?: string
  error?: string
  /** Muted helper line under the field, shown when there is no error. */
  hint?: ReactNode
}

/**
 * A single-date field in the form style of `Input`: the date reads as
 * DD/MM/YYYY with the app's calendar icon, and the browser's own date picker
 * does the picking (a transparent native input sits on top). Spreads straight
 * from a react-hook-form `Controller` field.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(
  ({ id, label, value, onChange, onBlur, name, min, max, error, hint }, ref) => (
    <div className="flex flex-col">
      <label htmlFor={id} className="text-sm font-medium text-foregroundMuted mb-1 tracking-[-0.35px]">
        {label}
      </label>
      <div className="relative rounded-md focus-within:ring-1 focus-within:ring-foreground">
        {/* Visual layer — custom placeholder + app calendar icon */}
        <div
          className={`w-full px-3 py-2 text-sm border rounded-md bg-surface flex items-center justify-between gap-1.5 tracking-[-0.35px] ${
            error ? 'border-negative' : 'border-border'
          }`}
        >
          <span className={value ? 'text-foreground' : 'text-accent'}>
            {value ? value.split('-').reverse().join('/') : 'DD/MM/YYYY'}
          </span>
          <Calendar size={16} className="text-accent shrink-0" />
        </div>
        {/* Interaction layer — transparent native date input drives the value/picker */}
        <input
          id={id}
          type="date"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onClick={(e) => e.currentTarget.showPicker?.()}
          name={name}
          ref={ref}
          value={value}
          min={min}
          max={max}
          onChange={onChange}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error ? (
        <p className="text-xs text-negative mt-1">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-accent">{hint}</p>
      )}
    </div>
  ),
)

DateField.displayName = 'DateField'
