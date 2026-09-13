import { useState } from 'react'
import { useSettings } from '@/context/SettingsContext'
import { AllocationIcon } from '@/components/ui/AllocationIcon'
import type { AllocationType } from '@/components/ui/AllocationIcon'
import type { AssetCategory } from '@/types'
import { DEFAULT_ALLOCATION_GROUPS } from '@/types'
import { Button } from '@/components/ui/Button'

const CATEGORY_CONFIG: Record<AssetCategory, { label: string; color: string }> = {
  bond:   { label: 'Bond',   color: 'var(--color-blue)'    },
  stock:  { label: 'Stock',  color: 'var(--color-purple)'  },
  etf:    { label: 'ETF',    color: 'var(--color-purple)'  },
  cash:   { label: 'Cash',   color: 'var(--color-neutral)' },
  crypto: { label: 'Crypto', color: 'var(--color-orange)'  },
}

const THRESHOLD_OPTIONS: { value: number; label: string }[] = [
  { value: 2.5, label: '2,5' },
  { value: 5,   label: '5,0' },
  { value: 7.5, label: '7,5' },
  { value: 10,  label: '10'  },
  { value: 15,  label: '15'  },
]

// Pixels dragged per 1% change. Lower = more sensitive.
const DRAG_SENSITIVITY = 4

type ScrubInputProps = {
  value: number
  max: number
  onChange: (value: number) => void
  onCommit: (value: number) => void
}

function ScrubInput({ value, max, onChange, onCommit }: ScrubInputProps) {
  const [editDraft, setEditDraft] = useState<string | null>(null)

  function handleMouseDown(e: React.MouseEvent) {
    // Prevent text selection and default focus during drag detection
    e.preventDefault()
    const startX = e.clientX
    const startValue = value
    let hasDragged = false
    let latest = value

    document.body.style.cursor = 'ew-resize'

    function handleMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX
      if (!hasDragged && Math.abs(delta) < 4) return
      hasDragged = true
      latest = Math.round(Math.max(0, Math.min(max, startValue + delta / DRAG_SENSITIVITY)))
      onChange(latest)
    }

    function handleMouseUp() {
      document.body.style.cursor = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (!hasDragged) {
        // Plain click — enter text editing mode
        setEditDraft(String(startValue))
      } else {
        onCommit(latest)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setEditDraft(e.target.value)
    const n = parseInt(e.target.value, 10)
    if (!isNaN(n)) onChange(Math.max(0, Math.min(max, n)))
  }

  function handleInputBlur() {
    const n = parseInt(editDraft ?? '', 10)
    const clamped = Math.max(0, Math.min(max, isNaN(n) ? 0 : n))
    setEditDraft(null)
    onCommit(clamped)
  }

  if (editDraft !== null) {
    return (
      <input
        type="number"
        value={editDraft}
        min={0}
        max={max}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        autoFocus
        className="w-8 bg-transparent outline-none text-sm font-medium text-foreground tracking-[-0.35px] text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    )
  }

  return (
    <span
      onMouseDown={handleMouseDown}
      className="w-8 inline-block text-right text-sm font-medium text-foreground tracking-[-0.35px] cursor-ew-resize select-none"
    >
      {value}
    </span>
  )
}

export function PortfolioSettingsPage() {
  const { allocationGroups, rebalancingThreshold, updateAllocationGroups, updateRebalancingThreshold } =
    useSettings()

  const [drafts, setDrafts] = useState<Record<string, number>>(() =>
    Object.fromEntries(allocationGroups.map((g) => [g.id, g.target])),
  )

  // Max a group can be set to without pushing the total above 100%
  function maxForGroup(id: string): number {
    const othersTotal = allocationGroups
      .filter((g) => g.id !== id)
      .reduce((sum, g) => sum + g.target, 0)
    return Math.max(0, 100 - othersTotal)
  }

  function handleTargetChange(id: string, value: number) {
    setDrafts((prev) => ({ ...prev, [id]: value }))
  }

  function handleTargetCommit(id: string, value: number) {
    setDrafts((prev) => ({ ...prev, [id]: value }))
    updateAllocationGroups(allocationGroups.map((g) => (g.id === id ? { ...g, target: value } : g)))
  }

  function handleResetDefaults() {
    updateAllocationGroups(DEFAULT_ALLOCATION_GROUPS)
    updateRebalancingThreshold(5)
    setDrafts(Object.fromEntries(DEFAULT_ALLOCATION_GROUPS.map((g) => [g.id, g.target])))
  }

  return (
    <div className="w-full h-full bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)] p-6 flex flex-col gap-6 overflow-y-auto scrollbar-none">
      {/* Header */}
      <div className="flex flex-col">
        <div className="h-9 flex items-center gap-2">
          <h1 className="flex-1 min-w-0 text-lg font-medium text-foreground tracking-[-0.45px]">Portfolio</h1>
          <Button variant="secondary" onClick={handleResetDefaults}>
            Reset defaults
          </Button>
        </div>
        <p className="text-sm text-foregroundMuted tracking-[-0.35px] whitespace-nowrap">
          Manage your allocation groups and rebalancing settings.
        </p>
      </div>

      {/* Allocation Groups */}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-foreground tracking-[-0.35px]">Allocation Groups</p>
        <div className="rounded-lg overflow-hidden">
          {allocationGroups.map((group, i) => {
            const iconType = (group.id.charAt(0).toUpperCase() + group.id.slice(1)) as AllocationType
            const isLast = i === allocationGroups.length - 1
            return (
              <div
                key={group.id}
                className={`h-14 bg-muted flex items-center gap-3 px-3${isLast ? '' : ' border-b border-surface'}`}
              >
                <AllocationIcon type={iconType} />
                <span className="flex-1 min-w-0 text-sm font-medium text-foreground tracking-[-0.35px]">
                  {group.name}
                </span>
                <div className="flex items-center gap-3 pr-1">
                  {group.categories.map((cat) => {
                    const { label, color } = CATEGORY_CONFIG[cat]
                    return (
                      <div key={cat} className="bg-surface px-2 py-1.5 rounded-full flex items-center gap-1.5 shrink-0">
                        <span className="size-1.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-xs font-medium text-foreground whitespace-nowrap">{label}</span>
                      </div>
                    )
                  })}
                  <div className="flex items-center gap-0.5 justify-end">
                    <ScrubInput
                      value={drafts[group.id] ?? group.target}
                      max={maxForGroup(group.id)}
                      onChange={(v) => handleTargetChange(group.id, v)}
                      onCommit={(v) => handleTargetCommit(group.id, v)}
                    />
                    <span className="text-sm font-medium text-foreground tracking-[-0.35px]">%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Rebalancing */}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-foreground tracking-[-0.35px]">Rebalancing</p>
        <div className="rounded-lg overflow-hidden">
          <div className="h-14 bg-muted pl-4 pr-3 flex items-center gap-3">
            <p className="flex-1 min-w-0 text-sm font-medium text-foregroundMuted tracking-[-0.35px]">
              Alert threshold (%)
            </p>
            <div className="flex gap-0.5 items-center">
              {THRESHOLD_OPTIONS.map(({ value, label }) => {
                const isActive = value === rebalancingThreshold
                return (
                  <button
                    key={value}
                    onClick={() => updateRebalancingThreshold(value)}
                    className={`h-7 px-2 rounded-md min-w-[40px] text-sm font-semibold text-center tracking-[-0.35px] transition-colors${
                      isActive
                        ? ' bg-surface text-foreground shadow-[0px_0px_0px_1px_var(--color-border)]'
                        : ' text-foregroundMuted'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
