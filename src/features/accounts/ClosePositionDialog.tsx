import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { format } from 'date-fns'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { DateField } from '@/components/ui/DateField'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { usePortfolio } from '@/context/PortfolioContext'
import { earliestCloseDate, findSharedPositionHolding, planClose } from '@/domain/closePosition'
import { formatDate, formatPLNDetail, formatPercent } from '@/utils/formatters'
import type { Holding } from '@/types'

type ClosePositionDialogProps = {
  holding: Holding | null
  isOpen: boolean
  onClose: () => void
  /** Runs after the position is closed, e.g. to close the panel it was opened from. */
  onClosed?: () => void
}

type FormValues = {
  date: string
  saleAmount: number
  fee: number
}

/**
 * Close position: record that the whole holding was sold. Shared by the
 * holdings table and the holding panel, like `DeleteHoldingDialog`.
 *
 * The preview under the fields is the same `planClose` the context action
 * runs, so the profit and the Cash change it shows are what gets recorded.
 */
export function ClosePositionDialog({ holding, isOpen, onClose, onClosed }: ClosePositionDialogProps) {
  // Hold the last holding through the exit animation, when the parent has
  // already cleared it. Same "store previous value" pattern as the panel.
  const [shown, setShown] = useState(holding)
  if (isOpen && holding && holding !== shown) setShown(holding)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Close Position" size="sm" variant="card">
      {shown && (
        // Keyed by holding, so each opening starts from fresh defaults.
        <ClosePositionForm key={shown.id} holding={shown} onCancel={onClose} onClosed={() => { onClosed?.(); onClose() }} />
      )}
    </Modal>
  )
}

function ClosePositionForm({
  holding,
  onCancel,
  onClosed,
}: {
  holding: Holding
  onCancel: () => void
  onClosed: () => void
}) {
  const { accounts, transactions, closePosition } = usePortfolio()
  const account = accounts.find((a) => a.id === holding.accountId)
  const isBond = holding.category === 'bond'

  const [today] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const earliest = account ? earliestCloseDate(holding, account, transactions) : holding.purchaseDate
  const shared = account ? findSharedPositionHolding(holding, account) : undefined

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { date: today, saleAmount: undefined, fee: 0 },
  })
  const [date, saleAmount, fee] = useWatch({ control, name: ['date', 'saleAmount', 'fee'] })

  // Live preview, only once the numbers make a valid close.
  const preview = useMemo(() => {
    if (!account || shared) return null
    const feePLN = Number.isFinite(fee) ? fee : 0
    if (!Number.isFinite(saleAmount) || saleAmount < 0 || feePLN < 0 || (!isBond && feePLN > saleAmount)) return null
    if (!date || date < earliest || date > today) return null
    return planClose(holding, account, transactions, { date, saleAmountPLN: saleAmount, feePLN })
  }, [account, shared, isBond, holding, transactions, date, saleAmount, fee, earliest, today])

  function onSubmit(values: FormValues) {
    const plan = closePosition(holding.id, {
      date: values.date,
      saleAmountPLN: values.saleAmount,
      feePLN: Number.isFinite(values.fee) ? values.fee : 0,
    })
    if (plan) onClosed()
  }

  const profit = preview?.result.profitPLN ?? 0
  const profitPercent = preview && preview.result.costPLN > 0 ? (profit / preview.result.costPLN) * 100 : 0
  const profitColor = profit > 0 ? 'text-positive' : profit < 0 ? 'text-negative' : 'text-foreground'

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="bg-surface rounded-lg shadow-xs overflow-hidden">
        <div className="p-5 flex flex-col gap-5">
          <p className="text-sm text-foregroundMuted leading-normal tracking-[-0.35px]">
            Record that you sold all of <span className="font-medium text-foreground">{holding.name}</span>. It moves
            to Closed positions with its history, and you can reopen it later.
          </p>

          {shared ? (
            <InlineAlert variant="warning">
              {shared.name} in this account has the same ticker. Profit is worked out per ticker, so Vestly
              can&rsquo;t tell which one you sold. Combine them into one holding first.
            </InlineAlert>
          ) : (
            <>
              <Controller
                control={control}
                name="date"
                rules={{
                  required: 'Pick the day of the sale',
                  validate: (v) =>
                    v > today ? 'The sale can’t be in the future'
                      : v < earliest ? `Pick ${formatDate(earliest)} or later: the last purchase was then`
                        : true,
                }}
                render={({ field }) => (
                  <DateField id="closeDate" label="Date" min={earliest} max={today} error={errors.date?.message} {...field} />
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="saleAmount"
                  label={isBond ? 'Amount received (PLN)' : 'Sale amount (PLN)'}
                  type="number"
                  step="any"
                  min={0}
                  placeholder="0.00"
                  autoFocus
                  error={errors.saleAmount?.message}
                  {...register('saleAmount', {
                    required: 'Required',
                    valueAsNumber: true,
                    validate: (v) => (Number.isFinite(v) ? v >= 0 || 'Min 0' : 'Required'),
                  })}
                />
                <Input
                  id="saleFee"
                  label="Fee (PLN)"
                  type="number"
                  step="any"
                  min={0}
                  placeholder="0.00"
                  error={errors.fee?.message}
                  {...register('fee', {
                    valueAsNumber: true,
                    validate: (v, all) =>
                      !Number.isFinite(v) ? true
                        : v < 0 ? 'Min 0'
                          : !isBond && Number.isFinite(all.saleAmount) && v > all.saleAmount ? 'More than the sale'
                            : true,
                  })}
                />
              </div>
              <p className="-mt-3 text-xs text-accent leading-normal">
                {isBond
                  ? 'What was paid out, after the 19% tax where it applies (IKE bonds have none) and after any early-redemption fee. Enter the fee too, for the record: it isn’t taken off again.'
                  : 'The total before fees. Fee is optional.'}
              </p>

              <dl className="bg-muted rounded-lg p-3 flex flex-col gap-2 text-sm tracking-[-0.35px] [font-feature-settings:'lnum'_1,'tnum'_1]">
                <PreviewRow label="Proceeds">
                  {preview ? formatPLNDetail(preview.sale.amountPLN) : '—'}
                </PreviewRow>
                <PreviewRow label="Realized profit">
                  {preview ? (
                    <span className={profitColor}>
                      {profit > 0 ? '+' : ''}{formatPLNDetail(profit)} ({formatPercent(profitPercent, true, 2)})
                    </span>
                  ) : '—'}
                </PreviewRow>
                <PreviewRow label="Cash">
                  {!preview ? '—' : preview.addsToCash ? `+${formatPLNDetail(preview.sale.amountPLN)}` : 'No change'}
                </PreviewRow>
                {preview && !preview.addsToCash && (
                  <p className="text-xs text-accent leading-normal">
                    {account?.type === 'crypto'
                      ? 'Crypto accounts have no Cash row.'
                      : 'This holding wasn’t bought with the account’s cash, so the sale doesn’t add to it.'}
                  </p>
                )}
              </dl>
            </>
          )}
        </div>

        <div className="border-t border-borderLight p-5 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel} className="w-20">
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!!shared}>
            Close Position
          </Button>
        </div>
      </div>
    </form>
  )
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-accent">{label}</dt>
      <dd className="font-medium text-foreground text-right">{children}</dd>
    </div>
  )
}
