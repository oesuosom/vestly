// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatePickerInput, type DateRange } from '@/components/ui/DatePickerInput'
import { Dropdown } from '@/components/ui/Dropdown'
import { Modal } from '@/components/ui/Modal'

afterEach(cleanup)

const OPTIONS = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
]

function HoldingModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('stock')
  const [range, setRange] = useState<DateRange>()
  return (
    <Modal isOpen onClose={onClose} title="Add Holding">
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Dropdown options={OPTIONS} value={category} onChange={setCategory} />
      <DatePickerInput value={range} onChange={setRange} placeholder="Pick dates" />
    </Modal>
  )
}

/**
 * Modal's Escape handling turns on with its enter transition, two frames after
 * mount. `data-open` reaches the DOM at commit, but the Escape layer registers
 * in a passive effect React may run a tick later — and `waitFor` re-checks on
 * DOM mutation, so it can resolve in between. The empty `act` flushes it.
 */
async function waitForModalOpen(count = 1) {
  await waitFor(() => expect(document.querySelectorAll('[data-open="true"]')).toHaveLength(count))
  await act(async () => {})
}

function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
}

function openPopover(trigger: HTMLElement) {
  trigger.focus()
  fireEvent.click(trigger)
}

describe('Modal — Escape with nested overlays', () => {
  it('closes a single modal on Escape', async () => {
    const onClose = vi.fn()
    render(<Modal isOpen onClose={onClose} title="Solo"><p>Body</p></Modal>)
    await waitForModalOpen()
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the dropdown first, then the modal', async () => {
    const onClose = vi.fn()
    render(<HoldingModal onClose={onClose} />)
    await waitForModalOpen()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Typed value' } })
    const trigger = screen.getByRole('button', { name: 'Stock' })
    openPopover(trigger)
    expect(screen.getByRole('button', { name: 'ETF' })).toBeTruthy()

    pressEscape()
    expect(screen.queryByRole('button', { name: 'ETF' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Typed value')

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the date picker first, then the modal', async () => {
    const onClose = vi.fn()
    render(<HoldingModal onClose={onClose} />)
    await waitForModalOpen()

    const trigger = screen.getByRole('button', { name: /Pick dates/ })
    openPopover(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    pressEscape()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes a modal stacked on another one without closing the one below', async () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    const { rerender } = render(
      <Modal isOpen onClose={closeOuter} title="Outer"><p>Outer</p></Modal>,
    )
    await waitForModalOpen()
    rerender(
      <>
        <Modal isOpen onClose={closeOuter} title="Outer"><p>Outer</p></Modal>
        <Modal isOpen onClose={closeInner} title="Inner"><p>Inner</p></Modal>
      </>,
    )
    await waitForModalOpen(2)

    pressEscape()
    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
  })
})

describe('Modal — close button', () => {
  it.each(['default', 'card'] as const)('is named Close and closes the %s modal', (variant) => {
    const onClose = vi.fn()
    render(<Modal isOpen onClose={onClose} title="Solo" variant={variant}><p>Body</p></Modal>)
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
