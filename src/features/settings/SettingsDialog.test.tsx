// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '@/features/settings/SettingsDialog'

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({
    userName: '',
    userAvatar: null,
    updateUserName: vi.fn(),
    updateUserAvatar: vi.fn(),
  }),
}))

afterEach(cleanup)

// `hidden: true` so the query doesn't depend on how testing-library treats inert.
const generalTab = () => screen.getByRole('button', { name: /General/, hidden: true })

describe('SettingsDialog', () => {
  it('takes its controls out of the tab order while closed', () => {
    render(<SettingsDialog isOpen={false} onClose={() => {}} />)
    expect(generalTab().closest('[inert]')).not.toBeNull()
  })

  it('leaves its controls reachable while open', () => {
    render(<SettingsDialog isOpen onClose={() => {}} />)
    expect(generalTab().closest('[inert]')).toBeNull()
  })

  it('becomes inert again after closing', () => {
    const { rerender } = render(<SettingsDialog isOpen onClose={() => {}} />)
    rerender(<SettingsDialog isOpen={false} onClose={() => {}} />)
    expect(generalTab().closest('[inert]')).not.toBeNull()
  })

  it('ignores Escape while closed', () => {
    const onClose = vi.fn()
    render(<SettingsDialog isOpen={false} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape while open', () => {
    const onClose = vi.fn()
    render(<SettingsDialog isOpen onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsDialog focus', () => {
  function App({ isOpen }: { isOpen: boolean }) {
    return (
      <>
        <button>Open settings</button>
        <SettingsDialog isOpen={isOpen} onClose={() => {}} />
      </>
    )
  }

  const opener = () => screen.getByRole('button', { name: 'Open settings' })
  const dialog = () => screen.getByRole('dialog', { name: 'Settings' })
  /** Fires Tab on the focused element; returns whether the trap took over the key. */
  const tab = (shiftKey = false) =>
    !fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })
  const tabbables = () =>
    [...dialog().querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter(
      (e) => e.tabIndex >= 0 && !e.matches(':disabled'),
    )

  /** Renders closed with the opener focused, then opens — like clicking the sidebar button. */
  function open() {
    const utils = render(<App isOpen={false} />)
    opener().focus()
    utils.rerender(<App isOpen />)
    return utils
  }

  it('moves focus into the dialog when it opens', () => {
    open()
    expect(document.activeElement).toBe(dialog())
  })

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    open()
    const items = tabbables()
    const first = items[0]
    const last = items[items.length - 1]

    // From the just-opened dialog, Shift+Tab goes to its last control, not the page behind.
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(last)

    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(first)

    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it('returns focus to whatever opened it on close', () => {
    const { rerender } = open()
    tab()
    rerender(<App isOpen={false} />)
    expect(document.activeElement).toBe(opener())
  })

  it('leaves focus alone when a click on the backdrop closed it', () => {
    const { rerender } = open()
    fireEvent.pointerDown(dialog().parentElement!)
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender(<App isOpen={false} />)
    expect(document.activeElement).toBe(document.body)
  })
})
