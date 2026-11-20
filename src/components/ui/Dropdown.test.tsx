// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dropdown, DropdownItem, DropdownMenu, DropdownPopover } from '@/components/ui/Dropdown'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

// ─────────────────────────────────────────
// DropdownPopover — a row's ⋯ menu inside a clipping table container
// ─────────────────────────────────────────

function RowMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <div data-testid="clip" style={{ overflow: 'hidden' }}>
        <button ref={ref} type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}>More</button>
        <DropdownPopover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
          <DropdownMenu>
            <DropdownItem type="default" icon={null} label="Edit" />
            <DropdownItem type="default" icon={null} label="Delete" />
          </DropdownMenu>
        </DropdownPopover>
      </div>
      <input placeholder="Elsewhere" />
    </>
  )
}

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** Stubs layout: the trigger's box, and a 120×100 panel (jsdom has no layout of its own). */
function stubLayout(trigger: DOMRect) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-dropdown-popover')) return rect(0, 0, 120, 100)
    if (this.textContent === 'More') return trigger
    return rect(0, 0, 0, 0)
  })
}

const more = () => screen.getByRole('button', { name: 'More' })
const popover = () => document.querySelector<HTMLElement>('[data-dropdown-popover]')

describe('DropdownPopover', () => {
  it('renders outside the clipping container, on <body>', () => {
    render(<RowMenu />)
    fireEvent.click(more())
    const panel = popover()!
    expect(panel.parentElement).toBe(document.body)
    expect(screen.getByTestId('clip').contains(panel)).toBe(false)
    expect(within(panel).getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('opens below the trigger, right-aligned, when there is room', () => {
    // jsdom's window is 1024×768.
    stubLayout(rect(200, 900, 28, 28))
    render(<RowMenu />)
    fireEvent.click(more())
    expect(popover()!.style.top).toBe('232px')   // 228 bottom + 4 gap
    expect(popover()!.style.left).toBe('808px')  // 928 right − 120 wide
    expect(popover()!.style.visibility).toBe('')
  })

  it('opens above the trigger when there is no room below', () => {
    stubLayout(rect(700, 900, 28, 28))
    render(<RowMenu />)
    fireEvent.click(more())
    expect(popover()!.style.top).toBe('596px')   // 700 top − 4 gap − 100 tall
  })

  it('stays inside the viewport sideways', () => {
    stubLayout(rect(200, 10, 28, 28))
    render(<RowMenu />)
    fireEvent.click(more())
    expect(popover()!.style.left).toBe('8px')
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<RowMenu />)
    more().focus()
    fireEvent.click(more())
    within(popover()!).getByRole('button', { name: 'Delete' }).focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(more())
    expect(more().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on an outside press without taking focus back', () => {
    render(<RowMenu />)
    more().focus()
    fireEvent.click(more())
    const elsewhere = screen.getByPlaceholderText('Elsewhere')
    fireEvent.pointerDown(elsewhere)
    elsewhere.focus()
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(elsewhere)
  })

  it('toggles closed from its own trigger', () => {
    render(<RowMenu />)
    fireEvent.click(more())
    fireEvent.pointerDown(more())
    fireEvent.click(more())
    expect(popover()).toBeNull()
  })
})
