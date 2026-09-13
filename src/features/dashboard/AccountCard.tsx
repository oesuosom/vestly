import type { Account, AccountType, Transaction } from '@/types'
import { getAccountValue, getTotalReturn } from '@/domain/calculations'
import { getAccountIconDisplay } from '@/utils/holdingIcon'
import { formatPLN, formatPercent } from '@/utils/formatters'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { CategoryBadge } from '@/components/ui/CategoryBadge'
import { AccountIcon } from '@/components/ui/AccountIcon'

type AccountCardProps = {
  account: Account
  transactions: Transaction[]
  onClick: () => void
}

const TYPE_LABELS: Record<AccountType, string> = {
  brokerage: 'Brokerage',
  ikze: 'IKZE',
  ike: 'IKE',
  crypto: 'Crypto',
  savings: 'Savings',
}

export function AccountCard({ account, transactions, onClick }: AccountCardProps) {
  const value = getAccountValue(account)
  const display = getAccountIconDisplay(account)

  // Synthetic cash is uninvested balance, not cost basis (same rule as getTotalCostBasis)
  const costBasis = account.holdings.reduce((sum, h) => h.isSynthetic ? sum : sum + h.purchasePrice * h.quantity, 0)
  const returnPLN = account.holdings.reduce((sum, h) => sum + getTotalReturn(h, transactions).totalPLN, 0)
  const returnPercent = costBasis > 0 ? (returnPLN / costBasis) * 100 : 0
  const returnColor = returnPLN > 0 ? 'text-positive' : returnPLN < 0 ? 'text-negative' : 'text-accent'

  return (
    <div
      className="group bg-surface border border-borderLight rounded-xl h-14 grid grid-cols-4 cursor-pointer hover:bg-muted transition-colors duration-150"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Details */}
      <div className="flex items-center gap-4 pl-[10px] pr-2 py-2 min-w-0 overflow-hidden">
        <AccountIcon account={account} />
        <div className="flex flex-col gap-1 min-w-0">
          <p className="text-sm leading-none font-semibold text-foreground tracking-[-0.35px] truncate">{account.name}</p>
          <p className="text-xs leading-none text-accent tracking-[-0.3px]">{TYPE_LABELS[account.type]}</p>
        </div>
      </div>

      {/* Holdings */}
      <div className="flex items-center justify-end p-2 overflow-hidden">
        {display.type === 'single-badge' ? (
          <CategoryBadge category={display.category} />
        ) : (
          <div className="flex items-center gap-2">
            {display.overflow > 0 && (
              <span className="text-xs text-accent font-medium">(+{display.overflow})</span>
            )}
            <div className="flex items-center pr-1">
              {display.holdings.map((holding, i) => (
                <div
                  key={holding.id}
                  style={{ zIndex: i + 1 }}
                  className="relative -mr-1 border-2 border-surface group-hover:border-muted rounded-full overflow-hidden size-6 shrink-0 transition-colors duration-150"
                >
                  <HoldingIcon holding={holding} size={20} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex items-center justify-end p-2 overflow-hidden">
        <p className="text-sm font-semibold text-foreground text-right whitespace-nowrap">
          {formatPLN(value)}
        </p>
      </div>

      {/* Return */}
      <div className="flex items-center justify-end pl-2 pr-4 py-2 gap-1 overflow-hidden">
        {account.holdings.length > 0 ? (
          <>
            <p className={`text-sm font-semibold ${returnColor} text-right whitespace-nowrap`}>
              {returnPLN > 0 ? '+' : ''}{formatPLN(returnPLN)}
            </p>
            <p className={`text-sm ${returnColor} text-right min-w-[64px]`}>
              ({formatPercent(returnPercent, true, 2)})
            </p>
          </>
        ) : (
          <span className="text-xs text-accent">—</span>
        )}
      </div>
    </div>
  )
}
