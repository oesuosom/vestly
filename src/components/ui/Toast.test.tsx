// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toast } from '@/components/ui/Toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toast', () => {
  it('has a named Dismiss button that closes it', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<Toast isOpen message="Transaction deleted" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    // The toast slides out before telling its parent it closed.
    act(() => { vi.runAllTimers() })
    expect(onClose).toHaveBeenCalled()
  })
})
