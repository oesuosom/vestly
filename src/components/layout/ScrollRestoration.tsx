import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/**
 * Resets scroll to top on forward navigation (PUSH/REPLACE) and restores the
 * previous scroll position on back/forward navigation (POP), matching native
 * browser behavior. The app scrolls the window, so positions are tracked there.
 */
export function ScrollRestoration() {
  const location = useLocation()
  const navType = useNavigationType()
  const positions = useRef<Map<string, number>>(new Map())
  // Keep the current history key available to the scroll listener's closure.
  const currentKey = useRef(location.key)

  // Continuously record the scroll position for the active history entry.
  useEffect(() => {
    const onScroll = () => {
      positions.current.set(currentKey.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    // Update the key BEFORE scrolling: the scrollTo below fires scroll events,
    // and recording them under the old key would corrupt its saved position.
    // (A ref write during render would be torn by concurrent rendering.)
    currentKey.current = location.key
    if (navType === 'POP') {
      window.scrollTo(0, positions.current.get(location.key) ?? 0)
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.key, navType])

  return null
}
