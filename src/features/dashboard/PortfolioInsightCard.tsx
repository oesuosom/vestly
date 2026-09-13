import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Synchronize, Sparkles } from '@/generated/icons'

type PortfolioInsightCardProps = {
  summary: string | null
  isLoading: boolean
  error: string | null
  cachedAt: string | null
  onRegenerate: () => void
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function PortfolioInsightCard({
  summary,
  isLoading,
  error,
  cachedAt,
  onRegenerate,
}: PortfolioInsightCardProps) {
  return (
    <div className="bg-surface border border-border border-l-2 border-l-accent rounded-lg px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-foregroundMuted">
          <Sparkles size={14} className="shrink-0" />
          <span className="text-xs font-medium uppercase tracking-wide">Portfolio Insight</span>
        </div>
        <Button
          variant="ghost"
          icon={Synchronize}
          iconPosition="only"
          onClick={onRegenerate}
          disabled={isLoading}
          title="Regenerate insight"
          className={isLoading ? '[&_svg]:animate-spin' : ''}
        />
      </div>

      {isLoading && !summary && (
        <div className="flex items-center gap-2 py-1">
          <LoadingSpinner size="sm" />
          <span className="text-xs text-accent">Generating insight…</span>
        </div>
      )}

      {summary && (
        <p className="text-sm text-foregroundMuted leading-relaxed">{summary}</p>
      )}

      {!summary && !isLoading && error && (
        <p className="text-xs text-negative font-mono break-all">{error}</p>
      )}

      <div className="flex items-center justify-between mt-3 min-h-[1rem]">
        {cachedAt && !isLoading && (
          <span className="text-xs text-accent">Generated {formatTimestamp(cachedAt)}</span>
        )}
        {error && summary && (
          <span className="text-xs text-negative ml-auto">Could not refresh — {error}</span>
        )}
      </div>
    </div>
  )
}
