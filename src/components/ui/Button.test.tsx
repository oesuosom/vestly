// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/Button'
import { Plus } from '@/generated/icons'

afterEach(cleanup)

describe('Button primary variant', () => {
  // The button is bg-foreground, so a fixed text-white label disappeared in
  // dark mode (#39). The label must use the theme counterpart, text-background.
  it('uses the background theme token for its label, not a fixed colour', () => {
    render(<Button variant="primary">Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    const label = screen.getByText('Save')

    expect(button.className).toContain('bg-foreground')
    expect(label.className).toContain('text-background')
    expect(label.className).not.toContain('text-white')
  })

  it('gives the icon the same theme token', () => {
    render(<Button variant="primary" icon={Plus} iconPosition="only" aria-label="Add" />)
    const icon = screen.getByRole('button', { name: 'Add' }).querySelector('svg')

    expect(icon?.getAttribute('class')).toContain('text-background')
  })

  it('dims a disabled button once, not again on the label', () => {
    render(<Button variant="primary" disabled>Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('disabled:opacity-50')
    expect(screen.getByText('Save').className).not.toContain('group-disabled:opacity-50')
  })

  it('keeps the double dim on other variants', () => {
    render(<Button variant="secondary" disabled>Cancel</Button>)

    expect(screen.getByText('Cancel').className).toContain('group-disabled:opacity-50')
  })
})

describe('Button icon-only', () => {
  it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)(
    'is named by its label and hides the icon (%s)',
    (variant) => {
      render(<Button variant={variant} icon={Plus} iconPosition="only" aria-label="Add" />)
      const icon = screen.getByRole('button', { name: 'Add' }).querySelector('svg')
      expect(icon?.getAttribute('aria-hidden')).toBe('true')
    },
  )

  it('can be named by another element', () => {
    render(
      <>
        <span id="add-label">Add account</span>
        <Button icon={Plus} iconPosition="only" aria-labelledby="add-label" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Add account' })).toBeTruthy()
  })

  it('hides the icon next to a text label too', () => {
    render(<Button icon={Plus} iconPosition="left">Add</Button>)
    expect(screen.getByRole('button', { name: 'Add' }).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  // Type-level: `tsc -b` (npm run build) fails if an unnamed icon-only Button compiles.
  it('needs aria-label or aria-labelledby to type-check', () => {
    // @ts-expect-error an icon-only Button has no visible text, so it must be named
    const unnamed = <Button icon={Plus} iconPosition="only" />
    expect(unnamed).toBeTruthy()
  })
})
