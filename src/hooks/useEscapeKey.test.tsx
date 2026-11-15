// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEscapeKey } from '@/hooks/useEscapeKey'

afterEach(cleanup)

function Layer({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  useEscapeKey(active, onEscape)
  return null
}

/** An always-open outer layer with an inner one (opened later) on top of it. */
function Pair({ outer, inner, innerActive }: { outer: () => void; inner: () => void; innerActive: boolean }) {
  return (
    <>
      <Layer active onEscape={outer} />
      <Layer active={innerActive} onEscape={inner} />
    </>
  )
}

const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

describe('useEscapeKey', () => {
  it('calls the handler of a single active layer', () => {
    const onEscape = vi.fn()
    render(<Layer active onEscape={onEscape} />)
    escape()
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys and inactive layers', () => {
    const onEscape = vi.fn()
    const { rerender } = render(<Layer active onEscape={onEscape} />)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    rerender(<Layer active={false} onEscape={onEscape} />)
    escape()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('calls only the most recently activated layer', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const { rerender } = render(<Pair outer={outer} inner={inner} innerActive={false} />)
    rerender(<Pair outer={outer} inner={inner} innerActive />)
    escape()
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('hands Escape to the layer below once the top one deactivates', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    const { rerender } = render(<Pair outer={outer} inner={inner} innerActive={false} />)
    rerender(<Pair outer={outer} inner={inner} innerActive />)
    rerender(<Pair outer={outer} inner={inner} innerActive={false} />)
    escape()
    expect(outer).toHaveBeenCalledTimes(1)
    expect(inner).not.toHaveBeenCalled()
  })

  it('keeps a layer in place when it re-renders with a new handler', () => {
    // An outer layer passing a fresh inline callback each render (as Modal's
    // callers do) must not jump above a layer that opened after it.
    const outer = vi.fn()
    const inner = vi.fn()
    const { rerender } = render(
      <Pair outer={() => outer('first')} inner={inner} innerActive={false} />,
    )
    rerender(<Pair outer={() => outer('second')} inner={inner} innerActive />)
    rerender(<Pair outer={() => outer('third')} inner={inner} innerActive />)
    escape()
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()

    // …and once the top layer closes, the outer one runs its latest handler.
    rerender(<Pair outer={() => outer('fourth')} inner={inner} innerActive={false} />)
    escape()
    expect(outer).toHaveBeenCalledExactlyOnceWith('fourth')
  })
})
