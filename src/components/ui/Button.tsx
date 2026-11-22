import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'

type IconComponent = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'md' | 'lg'
export type ButtonIconPosition = 'none' | 'left' | 'right' | 'only'

type BaseButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconComponent
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'>

/**
 * An icon-only button has no visible text, so it must be named for screen
 * readers: TypeScript requires `aria-label` (or `aria-labelledby`) here.
 */
type IconOnlyButtonProps = BaseButtonProps & {
  iconPosition: 'only'
} & ({ 'aria-label': string } | { 'aria-labelledby': string })

type TextButtonProps = BaseButtonProps & {
  iconPosition?: Exclude<ButtonIconPosition, 'only'>
}

export type ButtonProps = IconOnlyButtonProps | TextButtonProps

const PRIMARY_GRADIENT =
  'linear-gradient(to bottom, rgba(255,255,255,.5) 0%, rgba(255,255,255,.1) 35%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.25) 100%)'

type VariantConfig = {
  containerClass: string
  textClass: string
  iconClass?: string
  shadow: string
  gradient?: string
  /** Colour and hover opacity of the overlay that lightens or darkens the button. */
  overlayClass?: string
  /** Extra dimming on the label and icon when disabled, on top of the button's own opacity-50. */
  disabledContentClass?: string
}

const variantConfig: Record<ButtonVariant, VariantConfig> = {
  primary: {
    containerClass: 'bg-foreground gradient-border',
    // background is the counterpart of foreground, so the label flips with the theme.
    textClass: 'text-background',
    shadow: '0 0 0 1px var(--color-foreground), 0 8px 16px -4px rgba(10,10,10,0.05)',
    // Themed in index.css: a white edge on the dark light-theme button, a dark one on the near-white dark-theme button.
    gradient: 'var(--button-primary-sheen)',
    // Lighten on hover in light mode, darken in dark mode (white over near-white would not show).
    overlayClass: 'bg-white group-hover:opacity-20 dark:bg-black dark:group-hover:opacity-10',
    // The button's opacity-50 is enough; dimming the label again made it unreadable.
    disabledContentClass: '',
  },
  secondary: {
    containerClass: 'bg-background gradient-border hover:bg-muted',
    textClass: 'text-foreground',
    shadow: '0 0 0 1px var(--color-border), 0 8px 16px -4px rgba(10,10,10,0.05)',
    gradient: PRIMARY_GRADIENT,
  },
  ghost: {
    containerClass: 'hover:bg-muted',
    textClass: 'text-foreground',
    iconClass: 'text-accent group-hover:text-foreground transition-colors',
    shadow: '',
  },
  destructive: {
    containerClass: 'bg-negativeForeground gradient-border',
    textClass: 'text-negative',
    shadow: '0 0 0 1px var(--color-negative), 0 8px 16px -4px rgba(10,10,10,0.05)',
    gradient: PRIMARY_GRADIENT,
    overlayClass: 'bg-white group-hover:opacity-30',
  },
}

const heightClass: Record<ButtonSize, string> = {
  md: 'h-9',
  lg: 'h-10',
}

const paddingClass: Record<ButtonSize, Record<ButtonIconPosition, string>> = {
  md: {
    none:  'px-4 py-2',
    left:  'pl-3 pr-4 py-2',
    right: 'pl-4 pr-3 py-2',
    only:  'p-2',
  },
  lg: {
    none:  'px-4 py-2',
    left:  'pl-3 pr-4 py-2',
    right: 'pl-4 pr-3 py-2',
    only:  'p-[10px]',
  },
}

const gapClass: Record<ButtonIconPosition, string> = {
  none:  '',
  left:  'gap-1.5',
  right: 'gap-1.5',
  only:  '',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  iconPosition = 'none',
  icon: Icon,
  children,
  disabled,
  className = '',
  ...rest
}, ref) {
  const config = variantConfig[variant] ?? variantConfig.primary
  const safeSize = heightClass[size] ? size : 'md'
  const h = heightClass[safeSize]
  const padding = paddingClass[safeSize][iconPosition] ?? paddingClass.md.none
  const gap = gapClass[iconPosition] ?? ''
  const disabledContent = config.disabledContentClass ?? 'group-disabled:opacity-50'

  return (
    <button
      ref={ref}
      className={`group relative rounded-full overflow-clip flex items-center justify-center ${h} ${padding} ${gap} ${config.containerClass} disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${className}`}
      style={{
        ...(config.gradient ? { '--gradient-border': config.gradient } : {}),
        ...(config.shadow ? { boxShadow: config.shadow } : {}),
      } as React.CSSProperties}
      disabled={disabled}
      {...rest}
    >
      {config.overlayClass && (
        <div className={`absolute inset-0 opacity-0 ${config.overlayClass} transition-opacity pointer-events-none`} />
      )}

      {(iconPosition === 'left' || iconPosition === 'only') && Icon && (
        <Icon size={20} aria-hidden="true" className={`${config.iconClass ?? config.textClass} relative z-10 shrink-0 ${disabledContent}`} />
      )}

      {iconPosition !== 'only' && (
        <span
          className={`relative z-10 ${config.textClass} text-[14px] font-semibold tracking-[-0.35px] whitespace-nowrap ${disabledContent} [font-feature-settings:'lnum'_1,'tnum'_1]`}
        >
          {children}
        </span>
      )}

      {iconPosition === 'right' && Icon && (
        <Icon size={20} aria-hidden="true" className={`${config.iconClass ?? config.textClass} relative z-10 shrink-0 ${disabledContent}`} />
      )}
    </button>
  )
})
