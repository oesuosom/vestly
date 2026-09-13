import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TriangleRightBold, Check, ChevronDownSmall, MagnifyingGlass } from '@/generated/icons'
import { Checkbox } from './Checkbox'
import { RadioButton } from './RadioButton'
import { z } from '@/utils/tokens'

// ─────────────────────────────────────────
// DropdownItem
// ─────────────────────────────────────────

type DropdownItemDefaultProps = {
  type: 'default'
  icon: ReactNode
  label: string
  showArrow?: boolean
  disabled?: boolean
  onClick?: () => void
}

type DropdownItemCheckboxProps = {
  type: 'checkbox'
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}

type DropdownItemRadioProps = {
  type: 'radio'
  label: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  name?: string
  value?: string
}

type DropdownItemSearchProps = {
  type: 'search'
  placeholder?: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}

export type DropdownItemProps =
  | DropdownItemDefaultProps
  | DropdownItemCheckboxProps
  | DropdownItemRadioProps
  | DropdownItemSearchProps

export function DropdownItem(props: DropdownItemProps) {
  if (props.type === 'search') {
    return (
      <div className="flex items-center gap-2 h-8 px-2">
        <input
          type="text"
          value={props.value}
          onChange={e => props.onChange(e.target.value)}
          placeholder={props.placeholder ?? 'Search...'}
          autoFocus={props.autoFocus}
          className="flex-1 min-w-0 text-sm bg-transparent outline-none text-foregroundMuted placeholder:text-foregroundMuted tracking-[-0.35px]"
        />
        <MagnifyingGlass size={16} className="shrink-0 text-foregroundMuted" />
      </div>
    )
  }

  if (props.type === 'checkbox') {
    return (
      <div
        className={`flex items-center h-8 px-2 rounded-md hover:bg-muted cursor-pointer ${props.disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); props.onChange(!props.checked) } }}
      >
        <Checkbox
          checked={props.checked}
          onChange={props.onChange}
          label={props.label}
          disabled={props.disabled}
          className="w-full"
        />
      </div>
    )
  }

  if (props.type === 'radio') {
    return (
      <div
        className={`flex items-center h-8 px-2 rounded-md hover:bg-muted cursor-pointer ${props.disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); props.onChange() } }}
      >
        <RadioButton
          checked={props.checked}
          onChange={props.onChange}
          label={props.label}
          disabled={props.disabled}
          name={props.name}
          value={props.value}
          className="w-full"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`group flex items-center gap-2 h-8 w-full px-2 rounded-md text-left hover:bg-muted cursor-pointer ${props.disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <span className="shrink-0 size-4 flex items-center justify-center text-foregroundMuted group-hover:text-foreground transition-colors">
        {props.icon}
      </span>
      <span className="flex-1 min-w-0 text-sm text-foreground tracking-[-0.35px]">{props.label}</span>
      {props.showArrow && <TriangleRightBold size={16} className="shrink-0 text-accent" />}
    </button>
  )
}

// ─────────────────────────────────────────
// DropdownMenuGroup
// ─────────────────────────────────────────

type DropdownMenuGroupProps = {
  children: ReactNode
  divider?: boolean
}

export function DropdownMenuGroup({ children, divider }: DropdownMenuGroupProps) {
  return (
    <div className={`p-1 flex flex-col gap-0.5 w-full${divider ? ' border-b border-borderLight' : ''}`}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────
// DropdownMenu
// ─────────────────────────────────────────

type DropdownMenuProps = {
  children: ReactNode
  className?: string
}

export function DropdownMenu({ children, className = '' }: DropdownMenuProps) {
  return (
    <div className={`bg-surface border border-borderLight rounded-xl shadow-sm flex flex-col w-44 ${className}`}>
      {children}
    </div>
  )
}

export type DropdownOption = { value: string; label: string }

type DropdownProps = {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  /** Optional form label rendered above the trigger */
  label?: string
  /** Optional error message rendered below the trigger */
  error?: string
  /** Extra classes applied to the trigger button */
  className?: string
  /**
   * 'sm' (default) — px-3 py-2 text-sm, matches filter bar & form fields
   * 'xs' — px-2 py-1 text-xs, for compact table-cell selects
   */
  size?: 'sm' | 'xs'
  /**
   * 'default' — bordered, self-contained trigger.
   * 'cell' — borderless trigger that fills its table cell (the whole cell acts
   *   as the select). The cell supplies the border/height; the panel must be
   *   portalled to escape the table's overflow clip.
   */
  variant?: 'default' | 'cell'
  /** Text shown (in accent colour) when `value` is empty. */
  placeholder?: string
  /**
   * When true the trigger shows border-accent / text-accent to signal an
   * active (non-default) selection, i.e. something other than the default is
   * chosen. Callers own the comparison; this only styles the trigger.
   */
  active?: boolean
  /**
   * Render the panel via a React portal into document.body with fixed
   * positioning. Required for selects inside overflow:hidden containers
   * (e.g. import-preview table cells) so the panel is not clipped.
   */
  portal?: boolean
}

export function Dropdown({
  options,
  value,
  onChange,
  label,
  error,
  className = '',
  size = 'sm',
  active = false,
  portal = false,
  variant = 'default',
  placeholder,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [fixedPos, setFixedPos] = useState<{ top: number; left: number; width: number } | null>(null)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef  = useRef<HTMLButtonElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)

  // Close when clicking outside both the trigger and the (possibly portalled) panel
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        !(wrapperRef.current?.contains(target)) &&
        !(panelRef.current?.contains(target))
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function handleToggle() {
    if (!open && portal && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      // The cell variant's panel sits 8px narrower than the cell (4px inset each side).
      const inset = variant === 'cell' ? 4 : 0
      setFixedPos({ top: r.bottom + 4, left: r.left + inset, width: r.width - inset * 2 })
    }
    setOpen(v => !v)
  }

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''
  const cell = variant === 'cell'
  const sm = size === 'sm'
  // Panel item sizing: the cell variant uses the roomier `sm` rhythm.
  const panelSm = sm || cell

  const borderCls = open
    ? 'border-foreground'
    : active
      ? 'border-accent'
      : 'border-border'

  const triggerCls = cell
    ? [
        'group flex items-center gap-1.5 w-full h-full px-3 text-xs text-left cursor-pointer',
        'focus:outline-none',
        className,
      ].join(' ')
    : [
        'flex items-center gap-1.5 border rounded-md bg-surface transition-colors cursor-pointer',
        'focus:outline-none focus:border-foreground w-full',
        sm ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs',
        active ? 'text-accent' : 'text-foreground',
        borderCls,
        className,
      ].join(' ')

  const panel = (
    <div
      ref={panelRef}
      className="bg-surface border border-borderLight rounded-xl shadow-sm overflow-hidden"
      style={
        portal && fixedPos
          ? {
              position: 'fixed',
              top: fixedPos.top,
              left: fixedPos.left,
              // cell panels are pinned to an exact (cell − 8px) width; others may grow.
              ...(cell ? { width: fixedPos.width } : { minWidth: fixedPos.width }),
              zIndex: z.popover,
            }
          : { position: 'absolute', top: '100%', marginTop: '4px', left: 0, minWidth: '100%', zIndex: 10 }
      }
    >
      <DropdownMenuGroup>
        {options.map(opt => {
          const selected = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={[
                'flex items-center gap-2 w-full px-2 rounded-md text-left cursor-pointer hover:bg-muted',
                panelSm ? 'h-8' : 'h-7',
              ].join(' ')}
            >
              <span
                className={[
                  'flex-1 whitespace-nowrap tracking-[-0.35px] text-foreground',
                  panelSm ? 'text-sm' : 'text-xs',
                  selected ? 'font-medium' : '',
                ].join(' ')}
              >
                {opt.label}
              </span>
              {selected && (
                <Check size={panelSm ? 16 : 14} className="shrink-0 text-foreground" />
              )}
            </button>
          )
        })}
      </DropdownMenuGroup>
    </div>
  )

  const showPlaceholder = value === '' && placeholder !== undefined

  return (
    <div ref={wrapperRef} className={cell ? 'relative w-full h-full' : 'relative'}>
      {label && (
        <label className="text-sm font-medium text-foregroundMuted mb-1 block tracking-[-0.35px]">
          {label}
        </label>
      )}
      <button ref={buttonRef} type="button" onClick={handleToggle} className={triggerCls}>
        <span
          className={`flex-1 text-left truncate tracking-[-0.35px] ${
            cell && (showPlaceholder || value === '') ? 'text-accent' : ''
          }`}
        >
          {showPlaceholder ? placeholder : selectedLabel}
        </span>
        <ChevronDownSmall
          size={sm || cell ? 16 : 12}
          className={`shrink-0 ${cell ? 'transition-[transform,color] text-accent group-hover:text-foreground' : 'transition-transform'} ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (portal ? createPortal(panel, document.body) : panel)}
      {error && <p className="text-xs text-negative mt-1">{error}</p>}
    </div>
  )
}
