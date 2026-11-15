import { InlineAlert } from '@/components/ui/InlineAlert'
import { usePortfolio } from '@/context/PortfolioContext'

/**
 * Persistent banner for a failed portfolio save (today: a full quota).
 *
 * Deliberately not dismissible: until a save succeeds, every edit the user
 * makes is lost on reload, so the warning has to stay in view. It disappears
 * on its own once the provider clears `saveError`.
 */
export function StorageErrorBanner() {
  const { saveError } = usePortfolio()
  if (!saveError) return null

  return (
    // Same content column as the pages (`max-w-[896px]`), so it lines up with them.
    <div role="alert" className="mx-auto max-w-[896px] w-full mb-8">
      <InlineAlert variant="negative">{saveError}</InlineAlert>
    </div>
  )
}
