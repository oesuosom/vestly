import type { ComponentType } from 'react'

type IconComponent = ComponentType<{ size?: number; className?: string }>

type SettingsSidebarItemProps = {
  icon: IconComponent
  label: string
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
}

export function SettingsSidebarItem({
  icon: Icon,
  label,
  isActive = false,
  disabled = false,
  onClick,
}: SettingsSidebarItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        group w-full flex flex-row items-center gap-2 px-[10px] h-9 rounded-lg transition-colors duration-100 text-left
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
        ${isActive ? 'bg-black/[0.08]' : 'hover:bg-black/[0.08]'}
      `}
    >
      <Icon
        size={20}
        className={isActive
          ? 'text-foregroundMuted'
          : 'text-accent group-hover:text-foregroundMuted'
        }
      />
      <span className={`text-sm font-medium tracking-[-0.35px] leading-none ${isActive ? 'text-foreground' : 'text-foregroundMuted group-hover:text-foreground'}`}>
        {label}
      </span>
    </button>
  )
}
