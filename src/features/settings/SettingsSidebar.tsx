import {
  ElementsBold,
  VaultBold,
  SparklesBold,
  StockBold,
  TargetBold,
  ToggleBold,
  PersonBold,
} from '@/generated/icons'
import { Avatar } from '@/components/ui/Avatar'
import { useSettings } from '@/context/SettingsContext'
import { SettingsSidebarItem } from './SettingsSidebarItem'

export type SettingsPage =
  | 'account'
  | 'general'
  | 'contributions'
  | 'portfolio'
  | 'backup'
  | 'market-data'
  | 'ai-providers'

type SettingsSidebarProps = {
  activePage: SettingsPage
  onNavigate: (page: SettingsPage) => void
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-[10px] pt-3 pb-1">
      <span className="text-xs font-medium text-accent tracking-[-0.35px]">{children}</span>
    </div>
  )
}

export function SettingsSidebar({ activePage, onNavigate }: SettingsSidebarProps) {
  const { userName, userAvatar } = useSettings()

  const initials = userName
    ? userName.slice(0, 2).toUpperCase()
    : undefined

  const avatarVariant = userAvatar ? 'image' : initials ? 'initials' : 'icon'

  return (
    <div className="w-[208px] h-[576px] flex flex-col gap-0.5 p-3">
      <SectionLabel>Settings</SectionLabel>
      <SettingsSidebarItem
        icon={PersonBold}
        label="Account"
        isActive={activePage === 'account'}
        onClick={() => onNavigate('account')}
      />
      <SettingsSidebarItem
        icon={ToggleBold}
        label="General"
        isActive={activePage === 'general'}
        onClick={() => onNavigate('general')}
      />

      <SectionLabel>Portfolio & Data</SectionLabel>
      <SettingsSidebarItem
        icon={TargetBold}
        label="Contributions"
        isActive={activePage === 'contributions'}
        onClick={() => onNavigate('contributions')}
      />
      <SettingsSidebarItem
        icon={ElementsBold}
        label="Portfolio"
        isActive={activePage === 'portfolio'}
        onClick={() => onNavigate('portfolio')}
      />
      <SettingsSidebarItem
        icon={VaultBold}
        label="Data Management"
        isActive={activePage === 'backup'}
        onClick={() => onNavigate('backup')}
      />

      <SectionLabel>Connections</SectionLabel>
      <SettingsSidebarItem
        icon={StockBold}
        label="Market Data"
        isActive={activePage === 'market-data'}
        onClick={() => onNavigate('market-data')}
      />
      <SettingsSidebarItem
        icon={SparklesBold}
        label="AI Providers"
        isActive={activePage === 'ai-providers'}
        onClick={() => onNavigate('ai-providers')}
      />

      <div className="flex-1" />

      {/* Footer: avatar + name */}
      <div className="flex items-center gap-2 p-[6px]">
        <Avatar
          size="sm"
          variant={avatarVariant}
          initials={initials}
          src={userAvatar}
        />
        {userName && (
          <span className="text-sm font-medium text-foreground tracking-[-0.35px] truncate">
            {userName}
          </span>
        )}
      </div>
    </div>
  )
}
