import { DitheredLogo } from '@/components/ui/dithered-logo'
import { Button } from './Button'

type EmptyStateProps = {
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <DitheredLogo size={184} style="fine" pushRadius={96} maxDisp={40} density={0.2} dotScale={2} />
      <h3 className="text-base font-semibold text-foreground mt-4">{title}</h3>
      <p className="text-sm text-accent mt-2 max-w-xs">{description}</p>
      {action && (
        <div className="mt-6">
          <Button variant="primary" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  )
}
