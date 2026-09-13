import { TagBold } from '@/generated/icons'

export type AllocationType = 'Bonds' | 'Equity' | 'Cash' | 'Crypto'

const TYPE_CONFIG: Record<AllocationType, { bg: string; icon: string }> = {
  Bonds:  { bg: 'var(--color-blue-foreground)',    icon: 'var(--color-blue)'    },
  Equity: { bg: 'var(--color-purple-foreground)',  icon: 'var(--color-purple)'  },
  Cash:   { bg: 'var(--color-neutral-foreground)', icon: 'var(--color-neutral)' },
  Crypto: { bg: 'var(--color-orange-foreground)',  icon: 'var(--color-orange)'  },
}

type AllocationIconProps = {
  type: AllocationType
  className?: string
}

export function AllocationIcon({ type, className }: AllocationIconProps) {
  const { bg, icon } = TYPE_CONFIG[type]
  return (
    <div
      className={`p-1.5 rounded-lg border border-black/8 shrink-0${className ? ` ${className}` : ''}`}
      style={{ background: bg, color: icon }}
    >
      <TagBold size={20} />
    </div>
  )
}
