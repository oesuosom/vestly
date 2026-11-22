// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MissingHistoryPill, NoPriceHistory } from './HistoryNotices'

afterEach(cleanup)

describe('NoPriceHistory', () => {
  it('names the providers that are off and opens Market data', () => {
    const onOpen = vi.fn()
    render(<NoPriceHistory off={['yahoo', 'eodhd']} onOpenMarketData={onOpen} />)
    expect(screen.getByText('No price history')).toBeTruthy()
    expect(screen.getByText("Yahoo Finance and EODHD are off, so the chart can't show how prices moved. Values today are still correct.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Market data' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('MissingHistoryPill', () => {
  it('shows the message on a warning pill over a gradient into the card surface', () => {
    render(<MissingHistoryPill message="Bitcoin isn't in this chart: CoinGecko is off." />)
    const pill = screen.getByRole('status')
    expect(pill.textContent).toBe("Bitcoin isn't in this chart: CoinGecko is off.")
    expect(pill.className).toContain('bg-warningForeground')
    expect(pill.className).toContain('text-warning')
    expect(pill.parentElement!.className).toContain('to-surface')
  })

  it('fades into the page background on Overview', () => {
    render(<MissingHistoryPill message="x" surface="background" />)
    expect(screen.getByRole('status').parentElement!.className).toContain('to-background')
  })
})

describe('PriceHistoryLoadFailed', () => {
  it('says history couldn’t be loaded and offers Try again', async () => {
    const { PriceHistoryLoadFailed } = await import('./HistoryNotices')
    const onRetry = vi.fn()
    render(<PriceHistoryLoadFailed onRetry={onRetry} />)
    expect(screen.getByText("Couldn't load price history")).toBeTruthy()
    expect(screen.getByText("Price history couldn't be loaded just now. Values today are still correct.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
