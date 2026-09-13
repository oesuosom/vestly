import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Adjust, AdjustBold, Clock, ClockBold, Home, HomeBold, DonutChart, DonutChartBold } from '@/generated/icons'
import { AnimatedButton } from '@/components/ui/animated-button'
import { Avatar } from '@/components/ui/Avatar'
import { useSettings } from '@/context/SettingsContext'
import { SidebarButton } from './SidebarButton'
import logoSvg from '@/assets/logo.svg'

const NAV_ITEMS = [
  { icon: Home, activeIcon: HomeBold, label: 'Overview', to: '/', shortcutKey: 'O' },
  { icon: DonutChart, activeIcon: DonutChartBold, label: 'Portfolio', to: '/portfolio', shortcutKey: 'P' },
  { icon: Clock, activeIcon: ClockBold, label: 'Activity', to: '/activity', shortcutKey: 'A' },
] as const

type SidebarProps = {
  onImportClick?: () => void
  onOpenSettings: () => void
}

export function Sidebar({ onImportClick, onOpenSettings }: SidebarProps) {
  const navigate = useNavigate()
  const { userName, userAvatar } = useSettings()

  const initials = userName ? userName.slice(0, 2).toUpperCase() : undefined
  const avatarVariant = userAvatar ? 'image' : initials ? 'initials' : 'icon'

  useEffect(() => {
    if (!import.meta.env.DEV) return
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key.toUpperCase() === 'D' && !e.metaKey && !e.ctrlKey && !e.altKey) navigate('/dev')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])

  return (
    <aside className="w-24 h-screen flex flex-col items-center justify-between py-8 fixed left-0 top-0 z-chrome">
      {/* SidebarLogo */}
      <div className="flex items-center justify-center size-9">
        <img src={logoSvg} width={24} height={24} alt="Vestly" />
      </div>

      {/* SidebarContent */}
      <div className="flex flex-col items-center gap-4">
        <div className="flex flex-col gap-4">
          {NAV_ITEMS.map((item) => (
            <SidebarButton
              key={item.to}
              to={item.to}
              icon={item.icon}
              activeIcon={item.activeIcon}
              label={item.label}
              shortcutKey={item.shortcutKey}
            />
          ))}
          <SidebarButton
            onClick={onOpenSettings}
            icon={Adjust}
            activeIcon={AdjustBold}
            label="Settings"
            shortcutKey="S"
          />
        </div>
        <AnimatedButton theme="light" mode="auto" onClick={onImportClick} />
      </div>

      {/* SidebarFooter */}
      <div className="flex items-center justify-center size-9">
        <Avatar size="sm" variant={avatarVariant} initials={initials} src={userAvatar} />
      </div>
    </aside>
  )
}
