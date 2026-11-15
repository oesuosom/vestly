// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dropdown } from '@/components/ui/Dropdown'

afterEach(cleanup)

const OPTIONS = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: 'Bond' },
]

function Form() {
  const [value, setValue] = useState('stock')
  return (
    <>
      <Dropdown options={OPTIONS} value={value} onChange={setValue} portal />
      <input placeholder="Next field" />
    </>
  )
}

const trigger = () => screen.getAllByRole('button')[0]
/** An option in the portalled panel, which is rendered after the test's own container. */
const option = (name: string) =>
  within(document.body.lastElementChild as HTMLElement).getByRole('button', { name })
/** Fires Tab on the focused element; returns whether the trap took over the key. */
const tab = (shiftKey = false) =>
  !fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })

/** Focuses the trigger and opens the panel, as a click on it would. */
function openPanel() {
  render(<Form />)
  trigger().focus()
  fireEvent.click(trigger())
}

describe('Dropdown (portal) focus', () => {
  it('steps from the trigger into the options, not the next field', () => {
    openPanel()
    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(option('Stock'))

    trigger().focus()
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(option('Bond'))
  })

  it('wraps Tab and Shift+Tab inside the options', () => {
    openPanel()
    option('Bond').focus()
    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(option('Stock'))
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(option('Bond'))
  })

  it('returns focus to the trigger on Escape', () => {
    openPanel()
    option('ETF').focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'ETF' })).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('returns focus to the trigger after picking an option', () => {
    openPanel()
    option('ETF').focus()
    fireEvent.click(option('ETF'))
    expect(trigger().textContent).toContain('ETF')
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on an outside click without taking focus back', () => {
    openPanel()
    option('ETF').focus()
    const next = screen.getByPlaceholderText('Next field')
    fireEvent.pointerDown(next)
    next.focus()
    expect(screen.queryByRole('button', { name: 'ETF' })).toBeNull()
    expect(document.activeElement).toBe(next)
  })
})
