// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountInsightPanel, type AiAvailability } from './AccountInsightPanel'

afterEach(cleanup)

function renderPanel(props: Partial<Parameters<typeof AccountInsightPanel>[0]> & { availability: AiAvailability }) {
  const onOpenSettings = vi.fn()
  const onRetry = vi.fn()
  render(
    <AccountInsightPanel
      summary={null}
      isLoading={false}
      error={null}
      onOpenSettings={onOpenSettings}
      onRetry={onRetry}
      {...props}
    />,
  )
  return { onOpenSettings, onRetry }
}

describe('AccountInsightPanel', () => {
  it('AI off: says so, says nothing is sent, and links to AI settings', () => {
    const { onOpenSettings } = renderPanel({ availability: 'off', summary: 'An older insight.' })
    expect(screen.getByText('AI insights are off')).toBeTruthy()
    expect(screen.getByText(/While it’s off, nothing about your portfolio is sent to Anthropic\./)).toBeTruthy()
    // An insight from before AI was switched off isn't shown.
    expect(screen.queryByText('An older insight.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('AI on without a key: asks for one', () => {
    const { onOpenSettings } = renderPanel({ availability: 'no-key' })
    expect(screen.getByText('Add an API key to get insights')).toBeTruthy()
    expect(screen.getByText(/The key stays in this browser and is only sent to Anthropic\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add API key' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('loading: four skeleton bars, no caption', () => {
    renderPanel({ availability: 'on', isLoading: true })
    const skeleton = screen.getByRole('status', { name: 'Generating insight' })
    expect(skeleton.children).toHaveLength(4)
    expect(skeleton.textContent).toBe('')
  })

  it('error: the reason, then Open AI settings and an icon-only Try again', () => {
    const reason = 'Anthropic answered: invalid API key (401). Check the key in Settings → AI Providers, then try again.'
    const { onOpenSettings, onRetry } = renderPanel({ availability: 'on', error: reason })
    expect(screen.getByText('Couldn’t generate an insight')).toBeTruthy()
    expect(screen.getByText(reason)).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Open AI settings', 'Try again'])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open AI settings' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('ready: the insight text', () => {
    renderPanel({ availability: 'on', summary: 'Your account is up {+5%} led by [EXMP].' })
    expect(screen.getByText('5%').className).toContain('text-positive')
    expect(screen.getByText('EXMP')).toBeTruthy()
  })

  it('keeps an older insight when a refresh fails, with a could-not-refresh line', () => {
    renderPanel({ availability: 'on', summary: 'An older insight.', error: 'Anthropic answered: too many requests (429).' })
    expect(screen.getByText('An older insight.')).toBeTruthy()
    expect(screen.getByText(/Could not refresh — Anthropic answered: too many requests/)).toBeTruthy()
  })
})
