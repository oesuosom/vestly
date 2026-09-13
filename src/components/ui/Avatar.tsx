import { colors } from '@/utils/tokens'
import { FaceID } from '@/generated/icons'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
export type AvatarVariant = 'icon' | 'image' | 'initials'

type AvatarProps = {
  size?: AvatarSize
  variant?: AvatarVariant
  initials?: string
  src?: string
  alt?: string
  className?: string
}

const sizeClass: Record<AvatarSize, string> = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-16',
  xl: 'size-24',
}

const iconSize: Record<AvatarSize, number> = {
  xs: 12,
  sm: 16,
  md: 16,
  lg: 24,
  xl: 36,
}

const initialsFontSize: Record<AvatarSize, string> = {
  xs: '8px',
  sm: '10px',
  md: '10px',
  lg: '16px',
  xl: '20px',
}

export function Avatar({
  size = 'md',
  variant = 'icon',
  initials,
  src,
  alt,
  className = '',
}: AvatarProps) {
  const base = `rounded-full flex items-center justify-center shrink-0 overflow-hidden ${sizeClass[size]}${className ? ` ${className}` : ''}`

  if (variant === 'image') {
    return (
      <div className={base}>
        <img className="size-full object-cover" src={src} alt={alt ?? ''} />
      </div>
    )
  }

  return (
    <div
      className={base}
      style={{ background: colors.blueForeground, color: colors.blue }}
    >
      {variant === 'icon' && <FaceID size={iconSize[size]} />}
      {variant === 'initials' && (
        <span className="font-bold leading-none select-none" style={{ fontSize: initialsFontSize[size] }}>
          {initials}
        </span>
      )}
    </div>
  )
}
