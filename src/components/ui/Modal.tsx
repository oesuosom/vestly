import { useEffect, type CSSProperties, type DragEventHandler, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { Cross } from '@/generated/icons'
import { useEnterExit } from '@/hooks/useEnterExit'
import { useScrollLock } from '@/hooks/useScrollLock'

type ModalSize = 'sm' | 'md' | 'lg'
type ModalVariant = 'default' | 'card'

type ModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  size?: ModalSize
  variant?: ModalVariant
  /** `card` variant only — colour for the top gradient wash behind the header/preview. */
  accentColor?: string
  /** `card` variant only — centred block rendered between the header and the content. */
  preview?: ReactNode
  /** `card` variant only — hide the header/close and let children fill the panel
   *  (e.g. a full-bleed success card). */
  hideHeader?: boolean
  /** Drag handlers forwarded to the modal panel (e.g. a full-modal file drop zone). */
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDragLeave?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
  /** When true, highlights the panel to signal an active drag-over. */
  dragActive?: boolean
  children: ReactNode
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'w-[400px]',
  md: 'w-[560px]',
  lg: 'w-[720px]',
}

const cardWidthClasses: Record<ModalSize, string> = {
  sm: 'w-[384px]',
  md: 'w-[512px]',
  lg: 'w-[640px]',
}

function ModalContent({ isOpen, onClose, title, size = 'sm', variant = 'default', accentColor, preview, hideHeader, onDragOver, onDragLeave, onDrop, dragActive, children }: ModalProps) {
  const { mounted, open } = useEnterExit(isOpen, 350)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  useScrollLock(mounted)

  if (!mounted) return null

  const isCard = variant === 'card'
  const widthClass = isCard ? cardWidthClasses[size] : sizeClasses[size]

  return (
    <div
      className={`fixed inset-0 bg-black/20 z-modal flex items-center justify-center transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClose}
    >
      <div
        className={`relative ${isCard ? 'bg-background' : 'bg-surface'} rounded-xl shadow-md border ${dragActive ? 'border-foreground ring-1 ring-foreground' : 'border-border'} ${widthClass} max-h-[90vh] overflow-y-auto overscroll-contain t-dialog-slide transition-colors`}
        data-open={open}
        onClick={(e) => e.stopPropagation()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isCard ? (
          <>
            {accentColor && (
              <div
                className="t-modal-accent pointer-events-none absolute inset-x-0 top-0 h-48"
                style={{
                  '--modal-accent': accentColor,
                  background: 'linear-gradient(to bottom, var(--modal-accent), rgba(255,255,255,0.1))',
                } as CSSProperties}
              />
            )}
            {!hideHeader && (
              <div className="relative flex items-center gap-2 px-6 pt-5 pb-3">
                <p className="flex-1 text-sm font-semibold text-foreground [font-feature-settings:'lnum'_1,'tnum'_1]">
                  {title}
                </p>
                <button
                  onClick={onClose}
                  className="text-accent hover:text-foreground transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <Cross size={20} />
                </button>
              </div>
            )}
            {preview && <div className="relative">{preview}</div>}
            {hideHeader ? (
              <div className="relative">{children}</div>
            ) : (
              <div className="relative p-1.5">{children}</div>
            )}
          </>
        ) : (
          <>
            <div className="px-6 pt-6 pb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">{title}</h2>
              <Button variant="ghost" icon={Cross} iconPosition="only" onClick={onClose} />
            </div>

            {children}
          </>
        )}
      </div>
    </div>
  )
}

export function Modal(props: ModalProps) {
  return createPortal(<ModalContent {...props} />, document.body)
}
