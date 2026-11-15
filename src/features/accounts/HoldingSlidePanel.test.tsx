// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HoldingSlidePanel } from '@/features/accounts/HoldingSlidePanel'
import type { Holding } from '@/types'

vi.mock('@/context/PortfolioContext', () => ({
  usePortfolio: () => ({
    accounts: [],
    transactions: [],
    updateHolding: vi.fn(),
    deleteHolding: vi.fn(),
    replaceAccounts: vi.fn(),
  }),
}))

vi.mock('@/context/SettingsContext', () => ({
  useSettings: () => ({ priceProvider: { enabled: false, apiKey: '' } }),
}))

afterEach(cleanup)

const holding: Holding = {
  id: 'h1',
  accountId: 'a1',
  name: 'Test Holding',
  category: 'stock',
  quantity: 10,
  purchasePrice: 100,
  currentPrice: 120,
  purchaseDate: '2026-01-02',
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
}

/** The panel and its backdrop: the two direct children the panel portals into <body>. */
function overlayRoots() {
  const panel = screen.getByText('Test Holding').closest('.t-panel-slide')!
  return { panel, backdrop: panel.previousElementSibling! }
}

describe('HoldingSlidePanel', () => {
  it('leaves the panel reachable while open', () => {
    render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    const { panel, backdrop } = overlayRoots()
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(backdrop.hasAttribute('inert')).toBe(false)
  })

  it('keeps the closed panel rendered but inert', () => {
    const { rerender } = render(<HoldingSlidePanel holding={holding} isOpen onClose={() => {}} />)
    // The parent clears the holding and closes at the same time.
    rerender(<HoldingSlidePanel holding={null} isOpen={false} onClose={() => {}} />)

    const { panel, backdrop } = overlayRoots()
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(backdrop.hasAttribute('inert')).toBe(true)
  })
})
