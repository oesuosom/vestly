import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { Calendar } from './Calendar'
import type { DateRange } from './Calendar'
import { Button } from './Button'
import { Calendar as CalendarIcon } from '@/generated/icons'
import { z } from '@/utils/tokens'

export type { DateRange }

type DatePickerInputProps = {
  value?: DateRange
  onChange: (value: DateRange | undefined) => void
  showPanel?: boolean
  numberOfMonths?: 1 | 2
  placeholder?: string
  className?: string
  triggerVariant?: 'input' | 'button'
  disabled?: boolean
}

function formatRange(range: DateRange | undefined, placeholder: string): string {
  if (!range?.from) return placeholder
  if (!range.to) return `From ${format(range.from, 'MMM d')}`
  return `${format(range.from, 'MMM d')} – ${format(range.to, 'MMM d, yyyy')}`
}

export function DatePickerInput({
  value,
  onChange,
  showPanel = false,
  numberOfMonths = 2,
  placeholder = 'All time',
  className = '',
  triggerVariant = 'input',
  disabled = false,
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null)

  const triggerRef = useRef<HTMLElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
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

  // Keep panel anchored to the trigger while scrolling
  useEffect(() => {
    if (!open) return
    function updatePos() {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect()
        setPanelPos({ top: r.bottom + 8, right: window.innerWidth - r.right - 8 })
      }
    }
    window.addEventListener('scroll', updatePos, true)
    return () => window.removeEventListener('scroll', updatePos, true)
  }, [open])

  function handleToggle() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPanelPos({ top: r.bottom + 8, right: window.innerWidth - r.right - 8 })
    }
    setOpen(v => !v)
  }

  function handleSelect(range: DateRange | undefined) {
    onChange(range)
    if (!range) setOpen(false)
  }

  const isActive = !!value?.from
  const label    = formatRange(value, placeholder)

  const triggerCls = [
    'flex items-center gap-1.5 border rounded-md bg-surface px-3 py-2 text-sm cursor-pointer',
    'focus:outline-none focus:ring-1 focus:ring-accent transition-colors',
    'disabled:opacity-50 disabled:pointer-events-none',
    isActive ? 'border-accent text-accent' : 'border-border text-foreground',
    className,
  ].join(' ')

  const panel = (
    <div
      ref={panelRef}
      style={
        panelPos
          ? { position: 'fixed', top: panelPos.top, right: panelPos.right, zIndex: z.popover }
          : { display: 'none' }
      }
    >
      <Calendar
        mode="range"
        selected={value}
        onSelect={handleSelect}
        showPanel={showPanel}
        numberOfMonths={numberOfMonths}
      />
    </div>
  )

  if (triggerVariant === 'button') {
    return (
      <div ref={triggerRef as React.RefObject<HTMLDivElement>} className="relative inline-flex">
        <Button
          variant="secondary"
          icon={CalendarIcon}
          iconPosition="left"
          onClick={handleToggle}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {label}
        </Button>
        {open && createPortal(panel, document.body)}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef as React.RefObject<HTMLButtonElement>}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={triggerCls}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarIcon size={14} className="shrink-0" />
        <span>{label}</span>
      </button>
      {open && createPortal(panel, document.body)}
    </div>
  )
}
