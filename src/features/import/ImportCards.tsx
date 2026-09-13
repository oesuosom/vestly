/**
 * The three screens every import flow shows: working, failed, finished.
 *
 * Each flow used to carry its own copy of this markup, and they had already
 * drifted apart. Keeping them here means a change to the success screen lands in
 * every flow at once.
 *
 * The step markup is unchanged from what the flows rendered individually — these
 * are presentational only, so a flow keeps full control of its own wording.
 */
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { CircleCheck } from '@/generated/icons'

/**
 * Message plus optional second line, used by the spinner and done cards.
 *
 * `tabularNumerals` is on for the done screen, which reports counts and amounts
 * that should line up, and off for the spinner — matching what each card used
 * before they were shared.
 */
function CardMessage({
  message,
  detail,
  tabularNumerals = false,
}: {
  message: string
  detail?: string
  tabularNumerals?: boolean
}) {
  const primary = (
    <p
      className={`text-sm font-medium text-foreground tracking-[-0.35px] ${
        tabularNumerals ? "[font-feature-settings:'lnum'_1,'tnum'_1]" : ''
      }`}
    >
      {message}
    </p>
  )
  if (!detail) return primary
  return (
    <div className="flex flex-col gap-1">
      {primary}
      <p className="text-sm text-accent tracking-[-0.35px]">{detail}</p>
    </div>
  )
}

/** Work in progress — parsing files, fetching rates. */
export function ImportSpinnerCard({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden">
      <div className="px-6 py-12 flex flex-col items-center gap-4 text-center">
        <Spinner size={16} className="text-accent" />
        <CardMessage message={message} detail={detail} />
      </div>
    </div>
  )
}

/** Parsing failed — the only way on is back. */
export function ImportErrorCard({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
      <div className="p-5">
        <InlineAlert variant="negative">{message}</InlineAlert>
      </div>
      <div className="border-t border-borderLight p-5 flex items-center">
        <Button variant="secondary" onClick={onBack} className="w-20">Back</Button>
      </div>
    </div>
  )
}

/**
 * Success. Rendered headerless by the modal, so it carries its own gradient
 * wash instead of the usual card chrome.
 */
export function ImportDoneCard({
  message,
  detail,
  onDone,
}: {
  message: string
  detail?: string
  onDone: () => void
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-48"
        style={{ background: 'linear-gradient(to bottom, var(--color-positive-foreground), rgba(255,255,255,0))' }}
      />
      <div className="relative px-6 py-12 flex flex-col items-center gap-4 text-center">
        <CircleCheck size={24} className="text-positive" />
        <CardMessage message={message} detail={detail} tabularNumerals />
        <Button variant="primary" onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
