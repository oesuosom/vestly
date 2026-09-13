import type { ComponentType } from 'react'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { animate, motion, useMotionValue } from 'framer-motion'

type IconComponent = ComponentType<{ size?: number; className?: string }>

type SidebarButtonProps = {
  to?: string
  onClick?: () => void
  icon: IconComponent
  activeIcon: IconComponent
  label: string
  shortcutKey: string
}

export function SidebarButton({ to, onClick, icon: Icon, activeIcon: ActiveIcon, label, shortcutKey }: SidebarButtonProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = to ? location.pathname === to : false
  const DisplayIcon = isActive ? ActiveIcon : Icon

  const scale = useMotionValue(1)
  const springRef = useRef<ReturnType<typeof animate> | null>(null)

  const pressDown = () => {
    springRef.current?.stop()
    scale.set(0.85)
  }
  const pressUp = () => {
    springRef.current = animate(scale, 1, { type: 'spring', stiffness: 400, damping: 15 })
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key.toUpperCase() === shortcutKey.toUpperCase() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (onClick) onClick()
        else if (to) navigate(to)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [to, onClick, shortcutKey, navigate])

  return (
    <div className="relative group flex items-center">
      <motion.div
        style={{ scale }}
        onPointerDown={pressDown}
        onPointerUp={pressUp}
        onPointerLeave={pressUp}
      >
        {to ? (
          <Link
            to={to}
            className={`
              flex items-center justify-center size-9 rounded-full transition-colors duration-150
              ${isActive ? 'text-foreground' : 'text-foregroundMuted hover:text-foreground'}
            `}
          >
            <DisplayIcon size={20} />
          </Link>
        ) : (
          <button
            onClick={onClick}
            className="flex items-center justify-center size-9 rounded-full transition-colors duration-150 text-foregroundMuted hover:text-foreground"
          >
            <DisplayIcon size={20} />
          </button>
        )}
      </motion.div>

      {/* Hover label + shortcut key, revealed by the parent's `group` hover. */}
      <div className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-[44px] top-1/2 -translate-y-1/2 z-popover flex items-center gap-1">
        <span className="text-sm text-foreground whitespace-nowrap">{label}</span>
        <div className="flex items-center justify-center size-6 bg-surface border border-borderLight rounded-md shadow-sm">
          <span className="text-xs font-semibold text-foreground">{shortcutKey}</span>
        </div>
      </div>
    </div>
  )
}
