// @vitest-environment jsdom
import { useRef, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusTrap } from '@/hooks/useFocusTrap'

afterEach(cleanup)

function Harness({ open, children }: { open: boolean; children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(containerRef, open, { returnFocusTo: triggerRef })
  return (
    <>
      <button ref={triggerRef}>Trigger</button>
      <button>Outside</button>
      {open && (
        <div ref={containerRef} data-testid="trap">
          {children ?? (
            <>
              <input placeholder="Search" />
              <button>Middle</button>
              <button>Last</button>
            </>
          )}
        </div>
      )}
    </>
  )
}

const el = (name: string) =>
  screen.queryByRole('button', { name }) ?? screen.getByPlaceholderText(name)

/** Fires Tab on the focused element; returns whether the hook took over the key. */
function tab(shift = false) {
  const target = document.activeElement ?? document.body
  return !fireEvent.keyDown(target, { key: 'Tab', shiftKey: shift })
}

describe('useFocusTrap', () => {
  it('wraps Tab from the last focusable to the first', () => {
    render(<Harness open />)
    el('Last').focus()
    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(el('Search'))
  })

  it('wraps Shift+Tab from the first focusable to the last', () => {
    render(<Harness open />)
    el('Search').focus()
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(el('Last'))
  })

  it('leaves Tab between the ends to the browser', () => {
    render(<Harness open />)
    el('Search').focus()
    expect(tab()).toBe(false)
    el('Last').focus()
    expect(tab(true)).toBe(false)
  })

  it('re-reads the focusables on every keypress', () => {
    const { rerender } = render(<Harness open />)
    rerender(
      <Harness open>
        <input placeholder="Filter" />
        <button>New last</button>
      </Harness>,
    )
    el('New last').focus()
    tab()
    expect(document.activeElement).toBe(el('Filter'))
    tab(true)
    expect(document.activeElement).toBe(el('New last'))
  })

  it('skips disabled, tabindex="-1", inert and hidden elements', () => {
    render(
      <Harness open>
        <button disabled>Disabled first</button>
        <button tabIndex={-1}>Programmatic only</button>
        <button>Real first</button>
        <button>Real last</button>
        <div inert>
          <button>Inert</button>
        </div>
        <button hidden>Hidden</button>
      </Harness>,
    )
    el('Real last').focus()
    tab()
    expect(document.activeElement).toBe(el('Real first'))
    tab(true)
    expect(document.activeElement).toBe(el('Real last'))
  })

  it('pulls focus back in when it is outside the container', () => {
    render(<Harness open />)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(el('Search'))

    el('Outside').focus()
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(el('Last'))
  })

  it('treats focus on the container itself as outside', () => {
    render(<Harness open />)
    const trap = screen.getByTestId('trap')
    trap.tabIndex = -1
    trap.focus()
    expect(tab(true)).toBe(true)
    expect(document.activeElement).toBe(el('Last'))

    trap.focus()
    expect(tab()).toBe(true)
    expect(document.activeElement).toBe(el('Search'))
  })

  it('does nothing while inactive', () => {
    render(<Harness open={false} />)
    el('Outside').focus()
    expect(tab()).toBe(false)
    expect(document.activeElement).toBe(el('Outside'))
  })

  it('returns focus to the trigger when it closes', () => {
    const { rerender } = render(<Harness open />)
    el('Middle').focus()
    rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(el('Trigger'))
  })

  it('leaves focus alone when an outside click closed it', () => {
    const { rerender } = render(<Harness open />)
    el('Middle').focus()
    fireEvent.pointerDown(el('Outside'))
    el('Outside').focus()
    rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(el('Outside'))
  })

  it('leaves focus alone after an outside click on a non-focusable area', () => {
    const { rerender } = render(<Harness open />)
    el('Middle').focus()
    fireEvent.pointerDown(document.body)
    ;(document.activeElement as HTMLElement | null)?.blur()
    rerender(<Harness open={false} />)
    expect(document.activeElement).toBe(document.body)
  })
})
