import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { getStore, saveContributions } from '@/storage/portfolioStore'
import { formatPLN } from '@/utils/formatters'
import type { Account, ContributionTracking } from '@/types'

function calcContributed(accounts: Account[], accountType: 'ike' | 'ikze'): number {
  const year = new Date().getFullYear()
  return accounts
    .filter((a) => a.type === accountType)
    .flatMap((a) => a.holdings)
    .filter((h) => !h.isSynthetic && h.purchaseDate.startsWith(String(year)))
    .reduce((sum, h) => sum + h.purchasePrice * h.quantity, 0)
}

function formatNum(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

type ContributionRowProps = {
  label: string
  contributed: number
  limit: number
  isLast: boolean
  onLimitChange: (value: number) => void
  onLimitBlur: () => void
}

function ContributionRow({
  label,
  contributed,
  limit,
  isLast,
  onLimitChange,
  onLimitBlur,
}: ContributionRowProps) {
  const currentYear = new Date().getFullYear()
  const progress = limit > 0 ? Math.min(100, (contributed / limit) * 100) : 0
  const remaining = limit - contributed
  const overLimit = contributed > limit && limit > 0

  return (
    <>
      {/* Row A: name / contributed / limit */}
      <div className="h-14 bg-muted px-4 py-3 flex items-center gap-1">
        <p className="flex-1 min-w-0 text-sm font-medium text-foregroundMuted tracking-[-0.35px]">
          {label}
        </p>
        <p className="flex-1 min-w-0 text-sm font-medium text-accent text-right">
          {formatNum(contributed)}&nbsp;/
        </p>
        <input
          type="number"
          min={0}
          value={limit || ''}
          onChange={(e) => onLimitChange(Number(e.target.value) || 0)}
          onBlur={onLimitBlur}
          placeholder="0"
          className="shrink-0 [field-sizing:content] min-w-[1ch] bg-transparent outline-none text-sm font-medium text-foreground tracking-[-0.35px] text-right placeholder:text-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>

      {/* Row B: progress bar */}
      <div className="h-[6px] bg-muted px-3 flex items-center">
        <div className="flex-1 relative h-[6px] bg-surface rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-foregroundMuted rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Row C: dates / remaining */}
      <div
        className={`h-14 bg-muted px-4 py-3 flex items-center gap-2 text-xs text-foregroundMuted tracking-[-0.3px]${!isLast ? ' border-b border-surface' : ''}`}
      >
        <span className="whitespace-nowrap">1/1/{currentYear}</span>
        <span className="whitespace-nowrap">→</span>
        <span className="whitespace-nowrap">31/12/{currentYear}</span>
        <span className="flex-1 min-w-0 text-right">
          {limit > 0
            ? overLimit
              ? `${formatPLN(Math.abs(remaining))} over limit`
              : `${formatPLN(Math.max(0, remaining))} remaining`
            : '—'}
        </span>
      </div>
    </>
  )
}

export function ContributionsSettingsPage() {
  const currentYear = new Date().getFullYear()

  const [accounts] = useState<Account[]>(() => getStore().accounts)
  const ikeContributed = calcContributed(accounts, 'ike')
  const ikzeContributed = calcContributed(accounts, 'ikze')

  const [contributions, setContributions] = useState<ContributionTracking>(() => {
    try {
      return getStore().contributions
    } catch {
      return { ikze: [], ike: [], updatedAt: new Date().toISOString() }
    }
  })

  const ikeLimit = contributions.ike.find((y) => y.year === currentYear)?.limit ?? 0
  const ikzeLimit = contributions.ikze.find((y) => y.year === currentYear)?.limit ?? 0

  const [ikeLimitDraft, setIkeLimitDraft] = useState(ikeLimit)
  const [ikzeLimitDraft, setIkzeLimitDraft] = useState(ikzeLimit)

  function saveLimit(type: 'ike' | 'ikze', value: number) {
    setContributions((prev) => {
      const entries = [...prev[type]]
      const idx = entries.findIndex((e) => e.year === currentYear)
      if (idx >= 0) {
        entries[idx] = { ...entries[idx], limit: value }
      } else {
        entries.push({ year: currentYear, contributed: 0, limit: value })
      }
      const updated: ContributionTracking = {
        ...prev,
        [type]: entries,
        updatedAt: new Date().toISOString(),
      }
      saveContributions(updated)
      return updated
    })
  }

  return (
    <div className="w-full h-full bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)] p-6 flex flex-col gap-6 overflow-y-auto scrollbar-none">
      {/* Header */}
      <div className="flex flex-col">
        <div className="h-9 flex items-center">
          <h1 className="text-lg font-medium text-foreground tracking-[-0.45px]">
            Contribution Limits
          </h1>
        </div>
        <p className="text-sm text-foregroundMuted tracking-[-0.35px] whitespace-nowrap">
          Manage your contribution limits.
        </p>
      </div>

      {/* IKE + IKZE stack */}
      <div className="rounded-lg overflow-hidden">
        <ContributionRow
          label="IKE"
          contributed={ikeContributed}
          limit={ikeLimitDraft}
          isLast={false}
          onLimitChange={setIkeLimitDraft}
          onLimitBlur={() => saveLimit('ike', ikeLimitDraft)}
        />
        <ContributionRow
          label="IKZE"
          contributed={ikzeContributed}
          limit={ikzeLimitDraft}
          isLast={true}
          onLimitChange={setIkzeLimitDraft}
          onLimitBlur={() => saveLimit('ikze', ikzeLimitDraft)}
        />
      </div>

      {/* Custom section */}
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-foreground tracking-[-0.35px]">Custom</p>
        <div className="rounded-lg overflow-hidden">
          <div className="h-14 bg-muted border-b border-surface pl-4 pr-3 py-3 flex items-center gap-3">
            <p className="flex-1 min-w-0 text-sm font-semibold text-foreground tracking-[-0.35px] opacity-50">
              Add a new contribution limit
            </p>
            <Badge variant="blue">Coming Soon</Badge>
          </div>
        </div>
      </div>
    </div>
  )
}
