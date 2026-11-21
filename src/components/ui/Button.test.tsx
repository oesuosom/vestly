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
