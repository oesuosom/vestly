// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/app/ErrorBoundary'

function Boom(): never {
  throw new Error('render exploded')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('renders the shared recovery screen with the error message when a child throws', () => {
    // React and the boundary both log the caught error.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByText('render exploded')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download backup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset all app data' })).toBeTruthy()
  })
})
