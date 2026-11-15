import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

type Layer = RefObject<() => void>

/** Open layers, oldest first. Only the last one handles Escape. */
const layers: Layer[] = []

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  layers[layers.length - 1]?.current()
}

/**
 * Runs `onEscape` when Escape is pressed while `active` — but only for the
 * topmost open layer. Overlays (modals, dialogs, panels, dropdowns, pickers)
 * register here in the order they open, so with a dropdown open inside a
 * modal, Escape closes the dropdown and leaves the modal (and its form) alone;
 * the next Escape then reaches the modal.
 *
 * A single shared `document` listener does the dispatch, since separate
 * per-overlay listeners on the same node all fire, oldest first, and
 * `stopPropagation()` can't stop them.
 *
 * The latest `onEscape` is always used, but changing it doesn't re-register
 * the layer: a modal re-rendering with a fresh inline `onClose` keeps its
 * place below a dropdown that opened after it. Only `active` turning on puts
 * a layer on top.
 */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape)
  useLayoutEffect(() => {
    handlerRef.current = onEscape
  })

  useEffect(() => {
    if (!active) return
    const layer = handlerRef
    layers.push(layer)
    if (layers.length === 1) document.addEventListener('keydown', onKeyDown)
    return () => {
      const i = layers.lastIndexOf(layer)
      if (i !== -1) layers.splice(i, 1)
      if (layers.length === 0) document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
