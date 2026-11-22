// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioInsightCard } from './PortfolioInsightCard'

afterEach(cleanup)

describe('PortfolioInsightCard', () => {
  it('has a named Regenerate insight button', () => {
    const onRegenerate = vi.fn()
    render(<PortfolioInsightCard summary="A synthetic summary." isLoading={false} error={null} cachedAt={null} onRegenerate={onRegenerate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate insight' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })
})
