import { useSettings } from '@/context/SettingsContext'
import type { ThemeMode } from '@/types'
import themeLightUrl from '@/assets/themes/theme-light.svg'
import themeDarkUrl from '@/assets/themes/theme-dark.svg'
import themeSystemUrl from '@/assets/themes/theme-system.svg'

// ─────────────────────────────────────────
// GeneralSettingsPage
// ─────────────────────────────────────────

const THEME_OPTIONS: { value: ThemeMode; label: string; url: string }[] = [
  { value: 'light',  label: 'Light',  url: themeLightUrl  },
  { value: 'dark',   label: 'Dark',   url: themeDarkUrl   },
  { value: 'system', label: 'System', url: themeSystemUrl },
]

export function GeneralSettingsPage() {
  const { theme, updateTheme } = useSettings()

  return (
    <div className="w-full h-full bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)] p-6 flex flex-col gap-6 overflow-y-auto scrollbar-none">
      {/* Header */}
      <div className="flex flex-col gap-0">
        <div className="h-9 flex items-center">
          <h1 className="text-[18px] font-medium tracking-[-0.45px] text-foreground leading-none">General</h1>
        </div>
        <p className="text-sm text-foregroundMuted tracking-[-0.35px]">
          Manage your appearance preferences.
        </p>
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
