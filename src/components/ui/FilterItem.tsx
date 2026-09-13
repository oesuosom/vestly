import type { MouseEvent, ReactNode } from 'react'
import { CircleCross } from '@/generated/icons'

type FilterItemProps = {
  label: string
  values: string[]
  valueLabel: string
  stackItems?: ReactNode[]
  onRemove: () => void
  onEdit: (anchor: HTMLElement) => void
  className?: string
}

function formatValue(values: string[], valueLabel: string): string {
  if (values.length === 0) return ''
  if (values.length <= 2) return values.join(', ')
  return `${values.length} ${valueLabel}`
}

export function FilterItem({
  label,
  values,
  valueLabel,
  stackItems,
  onRemove,
  onEdit,
  className = '',
}: FilterItemProps) {
  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    if (relX <= 0.25) onRemove()
    else onEdit(e.currentTarget)
  }

  const formattedValue = formatValue(values, valueLabel)
  const visibleStack = stackItems?.slice(0, 3) ?? []

  return (
    <div
      className={`group relative flex items-center gap-1 h-9 px-4 rounded-full overflow-hidden cursor-pointer hover:bg-muted transition-colors ${className}`}
      onClick={handleClick}
    >
      <span className="text-sm font-medium tracking-tight text-accent shrink-0 whitespace-nowrap">
        {label}
      </span>

      {visibleStack.length > 0 && (
        <div className="flex items-center">
          {visibleStack.map((item, i) => (
            <div
              key={i}
              className="relative rounded-full ring-1 ring-background group-hover:ring-muted shrink-0"
              style={{ marginRight: i < visibleStack.length - 1 ? -4 : 0, zIndex: visibleStack.length - i }}
            >
              {item}
            </div>
          ))}
        </div>
      )}

      {formattedValue && (
        <span className="text-sm font-medium tracking-tight text-foreground shrink-0 whitespace-nowrap">
          {formattedValue}
        </span>
      )}

      {/* Hover overlay — left zone shows remove affordance */}
      <div className="absolute left-0 inset-y-0 w-[72px] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="relative h-full bg-[linear-gradient(to_right,var(--color-muted)_50%,transparent)]">
          <CircleCross
            size={20}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-foregroundMuted"
          />
        </div>
      </div>
    </div>
  )
}
