// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Modal } from '@/components/ui/Modal'
import { ImportScrollBody } from './ImportScrollBody'
import { IMPORT_CARD } from './importLayout'

afterEach(cleanup)

/** jsdom lays nothing out: give the scroll area the sizes a browser would. */
function size(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
}

function Step({ rows }: { rows: number }) {
  return (
    <Modal isOpen onClose={() => {}} title="Import" variant="card" size="lg" capHeight>
      <div className={IMPORT_CARD}>
        <ImportScrollBody className="p-5 flex flex-col gap-5">
          {Array.from({ length: rows }, (_, i) => <p key={i}>Row {i + 1}</p>)}
        </ImportScrollBody>
        <div className="border-t border-borderLight p-5">
          <button type="button">Continue</button>
        </div>
      </div>
    </Modal>
  )
}

const scrollArea = () => document.querySelector<HTMLElement>('[data-import-scroll]')!
const fade = (edge: 'top' | 'bottom') => document.querySelector<HTMLElement>(`[data-fade="${edge}"]`)!

describe('import dialog height and scrolling', () => {
  it('caps the dialog at 576 px, less on short screens, and keeps header and footer out of the scroll area', () => {
    render(<Step rows={3} />)
    const panel = scrollArea().closest('[data-open]') as HTMLElement
    expect(panel.className).toContain('max-h-[min(576px,calc(100dvh-32px))]')
    expect(panel.className).toContain('overflow-hidden')
    // The header ("Import") and the footer's button are outside the part that scrolls.
    expect(scrollArea().contains(screen.getByText('Import'))).toBe(false)
    expect(scrollArea().contains(screen.getByRole('button', { name: 'Continue' }))).toBe(false)
    expect(scrollArea().className).toContain('overflow-y-auto')
  })

  it('shows the bottom fade while there is more below, and the top fade once scrolled', () => {
    render(<Step rows={40} />)
    const el = scrollArea()
    size(el, { scrollHeight: 1200, clientHeight: 400 })

    el.scrollTop = 0
    fireEvent.scroll(el)
    expect([fade('top').dataset.visible, fade('bottom').dataset.visible]).toEqual(['false', 'true'])

    el.scrollTop = 300
    fireEvent.scroll(el)
    expect([fade('top').dataset.visible, fade('bottom').dataset.visible]).toEqual(['true', 'true'])

    el.scrollTop = 800
    fireEvent.scroll(el)
    expect([fade('top').dataset.visible, fade('bottom').dataset.visible]).toEqual(['true', 'false'])
  })

  it('shows no fade when everything fits', () => {
    render(<Step rows={2} />)
    const el = scrollArea()
    size(el, { scrollHeight: 200, clientHeight: 200 })
    fireEvent.scroll(el)
    expect([fade('top').dataset.visible, fade('bottom').dataset.visible]).toEqual(['false', 'false'])
  })

  it('fades into the surface colour token, not a fixed white, so dark mode works', () => {
    render(<Step rows={2} />)
    expect(fade('bottom').className).toContain('from-surface')
    expect(fade('top').className).toContain('from-surface')
    expect(fade('bottom').getAttribute('aria-hidden')).toBe('true')
  })

  it('leaves other dialogs as they were', () => {
    render(<Modal isOpen onClose={() => {}} title="Add Holding"><p>Form</p></Modal>)
    const panel = screen.getByText('Form').closest('[data-open]') as HTMLElement
    expect(panel.className).toContain('max-h-[90vh]')
  })
})
