import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronGrabberVertical } from '@/generated/icons'
import { DropdownItem, DropdownMenu, DropdownMenuGroup } from '@/components/ui/Dropdown'
import { useSettings } from '@/context/SettingsContext'
import { z } from '@/utils/tokens'
import type { ThemeMode } from '@/types'
import themeLightUrl from '@/assets/themes/theme-light.svg'
import themeDarkUrl from '@/assets/themes/theme-dark.svg'
import themeSystemUrl from '@/assets/themes/theme-system.svg'

// ─────────────────────────────────────────
// Timezone dropdown
// ─────────────────────────────────────────

const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone')

type TimezoneDropdownProps = {
  value: string
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onSelect: (tz: string) => void
  onClose: () => void
}

function TimezoneDropdown({ value, anchorRef, onSelect, onClose }: TimezoneDropdownProps) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const filtered = search
    ? ALL_TIMEZONES.filter(tz => tz.toLowerCase().includes(search.toLowerCase()))
    : ALL_TIMEZONES

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (!panelRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [anchorRef, onClose])

  // Read anchor geometry after commit (not during render) so positioning stays
  // correct; useLayoutEffect runs before paint, so there's no visible flicker.
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect())
  }, [anchorRef])

  if (!rect) return null

  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 4,
    right: window.innerWidth - rect.right,
    zIndex: z.popover,
  }

  return createPortal(
    <div ref={panelRef} style={style}>
      <DropdownMenu className="w-72 max-h-64 overflow-hidden flex flex-col">
        <DropdownMenuGroup divider>
          <DropdownItem type="search" value={search} onChange={setSearch} placeholder="Search timezones…" autoFocus />
        </DropdownMenuGroup>
        <div className="overflow-y-auto flex-1">
          <DropdownMenuGroup>
            {filtered.map(tz => (
              <DropdownItem
                key={tz}
                type="radio"
                label={tz}
                checked={tz === value}
                onChange={() => { onSelect(tz); onClose() }}
                name="timezone"
                value={tz}
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-xs text-accent text-center">No timezones found</div>
            )}
          </DropdownMenuGroup>
        </div>
      </DropdownMenu>
    </div>,
    document.body,
  )
}

// ─────────────────────────────────────────
// GeneralSettingsPage
// ─────────────────────────────────────────

const THEME_OPTIONS: { value: ThemeMode; label: string; url: string }[] = [
  { value: 'light',  label: 'Light',  url: themeLightUrl  },
  { value: 'dark',   label: 'Dark',   url: themeDarkUrl   },
  { value: 'system', label: 'System', url: themeSystemUrl },
]

export function GeneralSettingsPage() {
  const { theme, timezone, updateTheme, updateTimezone } = useSettings()
  const [tzOpen, setTzOpen] = useState(false)
  const tzButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="w-full h-full bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)] p-6 flex flex-col gap-6 overflow-y-auto scrollbar-none">
      {/* Header */}
      <div className="flex flex-col gap-0">
        <div className="h-9 flex items-center">
          <h1 className="text-[18px] font-medium tracking-[-0.45px] text-foreground leading-none">General</h1>
        </div>
        <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
          Manage your timezone and appearance preferences.
        </p>
      </div>

      {/* Timezone */}
      <div className="flex flex-col gap-0">
        <div className="w-full rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 h-14 px-3 bg-muted border-b border-surface">
            <div className="flex-1 px-1">
              <span className="text-sm font-semibold tracking-[-0.35px] text-foreground opacity-50">
                Timezone
              </span>
            </div>
            <button
              ref={tzButtonRef}
              type="button"
              onClick={() => setTzOpen(v => !v)}
              className="rounded-full h-9 pl-4 pr-3 flex items-center gap-1.5 text-sm font-semibold tracking-[-0.35px] text-foreground hover:bg-black/5 transition-colors"
            >
              {timezone}
              <ChevronGrabberVertical size={16} className="text-foreground" />
            </button>
          </div>
        </div>

        {tzOpen && (
          <TimezoneDropdown
            value={timezone}
            anchorRef={tzButtonRef}
            onSelect={updateTimezone}
            onClose={() => setTzOpen(false)}
          />
        )}
      </div>

      {/* Theme */}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium tracking-[-0.35px] text-foreground leading-none">Theme</p>
        <div className="w-full rounded-lg overflow-hidden flex">
          {THEME_OPTIONS.map(({ value, label, url }, idx) => (
            <button
              key={value}
              type="button"
              onClick={() => updateTheme(value)}
              className={`group flex-1 bg-muted flex flex-col items-center justify-center gap-4 p-6 ${idx < THEME_OPTIONS.length - 1 ? 'border-r border-surface' : ''}`}
            >
              <img src={url} alt="" className="w-[144px] h-[112px] shrink-0 drop-shadow-[0px_8px_16px_rgba(10,10,10,0.05)]" draggable={false} />
              <span
                className={`text-sm font-semibold tracking-[-0.35px] leading-none transition-colors ${
                  theme === value ? 'text-foreground' : 'text-accent group-hover:text-foreground'
                }`}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
