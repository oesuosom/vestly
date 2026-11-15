// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DatePickerInput } from '@/components/ui/DatePickerInput'

afterEach(cleanup)

/** Fires Tab on the focused element; returns whether the trap took over the key. */
const tab = (shiftKey = false) =>
  !fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey })

const trigger = () => screen.getByRole('button', { name: /All time/ })
/** The portalled panel: rendered straight into <body>, after the test's own container. */
const panel = () => document.body.lastElementChild as HTMLElement

describe.each(['input', 'button'] as const)('DatePickerInput (%s trigger) focus', (triggerVariant) => {
  function openPicker() {
    render(
      <>
        <DatePickerInput onChange={() => {}} triggerVariant={triggerVariant} />
        <button>Behind</button>
      </>,
    )
    trigger().focus()
    fireEvent.click(trigger())
  }

  it('steps from the trigger into the panel, not the page behind it', () => {
    openPicker()
    expect(tab()).toBe(true)
    expect(panel().contains(document.activeElement)).toBe(true)
  })

  it('wraps Shift+Tab from the first control to the last', () => {
    openPicker()
    tab()
    const first = document.activeElement
    expect(tab(true)).toBe(true)
    expect(document.activeElement).not.toBe(first)
    expect(panel().contains(document.activeElement)).toBe(true)
    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('returns focus to the trigger on Escape', () => {
    openPicker()
    panel().querySelector('button')!.focus()
    expect(panel().contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })
})
