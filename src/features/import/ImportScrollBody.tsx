import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The middle of an import step: the part that scrolls when the step is taller
 * than the dialog (576 px at most, less on short screens). A 32 px fade in the
 * surface colour shows at the bottom while there is more below, and at the top
 * once scrolled; the footer, a sibling after this, sits above it.
 *
 * `className` styles the content (padding, gap), as the step's body did before.
 */
export function ImportScrollBody({ className = '', children }: { className?: string; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })

  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }, [])

  useLayoutEffect(() => {
    update()
    if (typeof ResizeObserver === 'undefined') return
    // The viewport changes with the window; the content with what the step shows (e.g. warnings opened).
    const observer = new ResizeObserver(update)
    if (scrollRef.current) observer.observe(scrollRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [update])

  return (
    <div className="relative flex min-h-0 flex-col">
      <div ref={scrollRef} onScroll={update} data-import-scroll className="min-h-0 overflow-y-auto overscroll-contain">
        <div ref={contentRef} className={className}>
          {children}
        </div>
      </div>
      <div
        aria-hidden="true"
        data-fade="top"
        data-visible={fade.top}
        className={`pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-surface to-transparent transition-opacity duration-150 ${fade.top ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        aria-hidden="true"
        data-fade="bottom"
        data-visible={fade.bottom}
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent transition-opacity duration-150 ${fade.bottom ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}
