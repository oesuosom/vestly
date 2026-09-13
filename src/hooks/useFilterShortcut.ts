import { useEffect } from 'react'

/**
 * Registers the "F" keyboard shortcut to toggle a page's filter panel.
 *
 * Ignores the keypress while the user is typing (input/textarea/contenteditable
 * or an open <select>) and when a modifier key is held, so it never hijacks
 * browser shortcuts (⌘F, Ctrl+F) or text entry.
 */
export function useFilterShortcut(onToggle: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'f' && e.key !== 'F') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
      }

      e.preventDefault()
      onToggle()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onToggle])
}
