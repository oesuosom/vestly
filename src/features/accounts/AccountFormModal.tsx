import { useEffect, useRef, useState } from 'react'
import { Controller, useForm, useWatch, type Control } from 'react-hook-form'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Dropdown } from '@/components/ui/Dropdown'
import { Button } from '@/components/ui/Button'
import { AccountIcon } from '@/components/ui/AccountIcon'
import { TYPE_COLORS } from '@/components/ui/accountIconRegistry'
import type { Account, AccountType } from '@/types'

type AccountFormValues = {
  name: string
  type: AccountType
  notes: string
}

type AccountFormModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  /** Label for the primary button — "Add" when creating, "Save" when editing. */
  submitLabel?: string
  defaultValues?: Partial<AccountFormValues>
  /** Existing account's custom icon (edit) — honoured in the preview alongside the type. */
  iconId?: string
  onSubmit: (data: AccountFormValues) => void
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'ikze', label: 'IKZE' },
  { value: 'ike', label: 'IKE' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'savings', label: 'Savings' },
]

/**
 * Live preview shown between the modal header and the form. The account icon and
 * gradient colour follow the selected `Account Type`; the name updates as the user types.
 */
function AccountPreview({
  control,
  iconId,
  pulse,
}: {
  control: Control<AccountFormValues>
  iconId?: string
  pulse: boolean
}) {
  const type = useWatch({ control, name: 'type' })
  const name = useWatch({ control, name: 'name' })
  return (
    <div className="flex flex-col items-center gap-2 px-6 pb-4">
      <AccountIcon account={{ type, iconId } as Account} size="lg" animateSwap pulse={pulse} />
      <p className="max-w-full break-words text-center text-sm font-semibold text-foreground [font-feature-settings:'lnum'_1,'tnum'_1]">
        {name.trim() || 'Account Name'}
      </p>
    </div>
  )
}

export function AccountFormModal({
  isOpen,
  onClose,
  title,
  submitLabel = 'Save',
  defaultValues,
  iconId,
  onSubmit,
}: AccountFormModalProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormValues>({
    defaultValues: {
      name: defaultValues?.name ?? '',
      type: defaultValues?.type ?? 'brokerage',
      notes: defaultValues?.notes ?? '',
    },
  })

  const type = useWatch({ control, name: 'type' })

  // Pulse the preview badge on each name keystroke: add → remove after 200ms.
  const [pulse, setPulse] = useState(false)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function triggerPulse() {
    setPulse(true)
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulse(false), 200)
  }
  useEffect(() => () => { if (pulseTimer.current) clearTimeout(pulseTimer.current) }, [])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      variant="card"
      accentColor={TYPE_COLORS[type].bg}
      preview={<AccountPreview control={control} iconId={iconId} pulse={pulse} />}
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="bg-surface rounded-lg shadow-xs overflow-hidden">
          <div className="p-5 flex flex-col gap-5">
            <Input
              label="Account Name"
              placeholder="Account Name"
              error={errors.name?.message}
              {...register('name', { required: 'Name is required' })}
              onInput={triggerPulse}
            />
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Dropdown
                  label="Account Type"
                  options={ACCOUNT_TYPE_OPTIONS}
                  value={field.value}
                  onChange={field.onChange}
                  portal
                />
              )}
            />
            <Input
              label="Description"
              placeholder="Optional account description"
              {...register('notes')}
            />
          </div>

          <div className="border-t border-borderLight p-5 flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose} className="w-20">
              Cancel
            </Button>
            <Button variant="primary" type="submit" className="w-20">
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
