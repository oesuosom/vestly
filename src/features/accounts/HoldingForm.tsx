import { Controller, useForm } from 'react-hook-form'
import { Input } from '@/components/ui/Input'
import { Dropdown } from '@/components/ui/Dropdown'
import { Button } from '@/components/ui/Button'
import { Calendar } from '@/generated/icons'
import type { AssetCategory } from '@/types'

type HoldingFormValues = {
  name: string
  ticker: string
  exchange: string
  category: AssetCategory
  quantity: number
  purchasePrice: number
  currentPrice: number
  purchaseDate: string
}

type HoldingFormProps = {
  onSubmit: (data: HoldingFormValues) => void
  onCancel: () => void
  defaultValues?: Partial<HoldingFormValues>
  transactionBacked?: boolean
}

const CATEGORY_OPTIONS = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: 'Bond' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'cash', label: 'Cash' },
]

const EXCHANGE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'US', label: 'US (NYSE / NASDAQ)' },
  { value: 'PL', label: 'PL (Warsaw / GPW)' },
  { value: 'UK', label: 'UK (London / LSE)' },
  { value: 'XETRA', label: 'XETRA (Frankfurt)' },
  { value: 'Other', label: 'Other' },
]

/**
 * HoldingForm — Add/Edit Holding form.
 *
 * The fields and actions sit inside a white inner card (`surface` + `shadow-xs`)
 * that floats on the modal's gray `background`, with the action row separated by a
 * top border. Intended to be rendered inside the `card` modal chrome.
 */
export function HoldingForm({ onSubmit, onCancel, defaultValues, transactionBacked }: HoldingFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<HoldingFormValues>({
    defaultValues: {
      name: defaultValues?.name ?? '',
      ticker: defaultValues?.ticker ?? '',
      exchange: defaultValues?.exchange ?? '',
      category: defaultValues?.category ?? 'stock',
      quantity: defaultValues?.quantity ?? undefined,
      purchasePrice: defaultValues?.purchasePrice ?? undefined,
      currentPrice: defaultValues?.currentPrice ?? undefined,
      purchaseDate: defaultValues?.purchaseDate ?? '',
    },
  })

  function handleFormSubmit(data: HoldingFormValues) {
    onSubmit({
      ...data,
      ticker: data.ticker.trim().toUpperCase(),
      exchange: data.exchange.trim() || '',
      quantity: Number(data.quantity),
      purchasePrice: Number(data.purchasePrice),
      currentPrice: Number(data.currentPrice),
    })
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)}>
      <div className="bg-surface rounded-lg shadow-xs overflow-hidden">
        <div className="p-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Name"
              placeholder="e.g. Apple Inc."
              error={errors.name?.message}
              {...register('name', { required: 'Name is required' })}
            />
            <Input
              label="Ticker (optional)"
              placeholder="e.g. AAPL"
              {...register('ticker')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Dropdown
                  label="Category"
                  options={CATEGORY_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  portal
                />
              )}
            />
            <Controller
              control={control}
              name="exchange"
              render={({ field }) => (
                <Dropdown
                  label="Exchange (for price fetching)"
                  options={EXCHANGE_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  portal
                />
              )}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Quantity"
              type="number"
              step="any"
              placeholder="0"
              error={errors.quantity?.message}
              {...register('quantity', {
                required: 'Required',
                min: { value: 0, message: 'Min 0' },
                valueAsNumber: true,
              })}
            />
            <Input
              label="Avg. Cost (PLN)"
              type="number"
              step="any"
              placeholder="0.00"
              error={errors.purchasePrice?.message}
              {...register('purchasePrice', {
                required: 'Required',
                min: { value: 0, message: 'Min 0' },
                valueAsNumber: true,
              })}
            />
            <Input
              label="Current Price (PLN)"
              type="number"
              step="any"
              placeholder="0.00"
              error={errors.currentPrice?.message}
              {...register('currentPrice', {
                required: 'Required',
                min: { value: 0, message: 'Min 0' },
                valueAsNumber: true,
              })}
            />
          </div>

          <div className="flex flex-col">
            <label
              htmlFor="purchaseDate"
              className="text-sm font-medium text-foregroundMuted mb-1 tracking-[-0.35px]"
            >
              First Purchase Date
            </label>
            <Controller
              control={control}
              name="purchaseDate"
              rules={{ required: 'Date is required' }}
              render={({ field }) => (
                <div className="relative rounded-md focus-within:ring-1 focus-within:ring-foreground">
                  {/* Visual layer — custom placeholder + app calendar icon */}
                  <div
                    className={`w-full px-3 py-2 text-sm border rounded-md bg-surface flex items-center justify-between gap-1.5 tracking-[-0.35px] ${
                      errors.purchaseDate ? 'border-negative' : 'border-border'
                    }`}
                  >
                    <span className={field.value ? 'text-foreground' : 'text-accent'}>
                      {field.value ? field.value.split('-').reverse().join('/') : 'DD/MM/YYYY'}
                    </span>
                    <Calendar size={16} className="text-accent shrink-0" />
                  </div>
                  {/* Interaction layer — transparent native date input drives the value/picker */}
                  <input
                    id="purchaseDate"
                    type="date"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                </div>
              )}
            />
            {errors.purchaseDate && (
              <p className="text-xs text-negative mt-1">{errors.purchaseDate.message}</p>
            )}
            {transactionBacked && (
              <p className="mt-1 text-xs text-accent">
                Derived from transaction history. Edit to override.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-borderLight p-5 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel} className="w-20">
            Cancel
          </Button>
          <Button variant="primary" type="submit" className="w-20">
            Save
          </Button>
        </div>
      </div>
    </form>
  )
}
