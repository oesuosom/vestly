// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/layout/Sidebar'
import { SettingsProvider } from '@/context/SettingsContext'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

function renderSidebar(path = '/', onOpenSettings = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsProvider>
        <Sidebar onOpenSettings={onOpenSettings} />
      </SettingsProvider>
    </MemoryRouter>
  )
  return { onOpenSettings }
}

describe('Sidebar', () => {
  it('names each navigation link and the Settings button', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Portfolio' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Activity' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
  })

  it('exposes the keyboard shortcut without putting it in the name', () => {
    renderSidebar()
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-keyshortcuts')).toBe('O')
    expect(screen.getByRole('link', { name: 'Portfolio' }).getAttribute('aria-keyshortcuts')).toBe('P')
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-keyshortcuts')).toBe('A')
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-keyshortcuts')).toBe('S')
  })

  it('marks only the active page link as current', () => {
    renderSidebar('/portfolio')
    expect(screen.getByRole('link', { name: 'Portfolio' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Overview' }).hasAttribute('aria-current')).toBe(false)
    expect(screen.getByRole('link', { name: 'Activity' }).hasAttribute('aria-current')).toBe(false)
    expect(screen.getByRole('button', { name: 'Settings' }).hasAttribute('aria-current')).toBe(false)
  })

  it('opens settings from the named Settings button', () => {
    const { onOpenSettings } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
