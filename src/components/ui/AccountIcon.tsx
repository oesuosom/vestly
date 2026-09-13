import type { Account } from '@/types'
import { resolveIconId } from '@/utils/iconIds'
import { ACCOUNT_ICON_REGISTRY, TYPE_COLORS, TYPE_DEFAULTS } from './accountIconRegistry'

type AccountIconProps = {
  account: Account
  className?: string
  /** `lg` scales the badge up for the account preview (icon 32 / p-3 / rounded-xl). */
  size?: 'default' | 'lg'
  /** Crossfade the colour and glyph when the account type/icon changes (preview use). */
  animateSwap?: boolean
  /** Briefly scales the badge up to 1.08 — pulse on each name keystroke (preview use). */
  pulse?: boolean
}

export function AccountIcon({ account, className, size = 'default', animateSwap = false, pulse = false }: AccountIconProps) {
  const Icon =
    (account.iconId && ACCOUNT_ICON_REGISTRY[resolveIconId(account.iconId)]) ||
    TYPE_DEFAULTS[account.type]
  const { bg, icon } = TYPE_COLORS[account.type]
  const isLg = size === 'lg'
  const iconPx = isLg ? 32 : 20
  return (
    <div
      className={`${isLg ? 'p-3 rounded-xl' : 'p-2 rounded-lg'} shrink-0 ${animateSwap ? 'account-icon-badge ' : ''}${className ?? ''}`}
      style={{ backgroundColor: bg, color: icon, transform: pulse ? 'scale(1.08)' : undefined }}
    >
      {animateSwap ? (
        <span key={account.iconId ?? account.type} className="account-icon-swap-in block">
          <Icon size={iconPx} />
        </span>
      ) : (
        <Icon size={iconPx} />
      )}
    </div>
  )
}
