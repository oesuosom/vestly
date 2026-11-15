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
