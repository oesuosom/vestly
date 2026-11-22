// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types'
import { AiProvidersSettingsPage } from './AiProvidersSettingsPage'

const settings = {
  ...DEFAULT_SETTINGS,
  updateAnthropicEnabled: vi.fn(),
  updateClaudeApiKey: vi.fn(),
}
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => settings }))

afterEach(cleanup)

describe('AiProvidersSettingsPage — controls are named', () => {
  it('names the switch, the settings button and the key button', () => {
    render(<AiProvidersSettingsPage />)
    expect(screen.getByRole('switch', { name: 'Anthropic' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show Anthropic settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show Anthropic API key' }))
    expect(screen.getByRole('button', { name: 'Hide Anthropic API key' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide Anthropic settings' })).toBeTruthy()
  })
})
