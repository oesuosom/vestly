import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SettingsSidebar, type SettingsPage } from './SettingsSidebar'
import { AccountSettingsPage } from '@/features/settings/AccountSettingsPage'
import { ContributionsSettingsPage } from '@/features/settings/ContributionsSettingsPage'
import { GeneralSettingsPage } from '@/features/settings/GeneralSettingsPage'
import { PortfolioSettingsPage } from '@/features/settings/PortfolioSettingsPage'
import { AiProvidersSettingsPage } from '@/features/settings/AiProvidersSettingsPage'
import { DataManagementSettingsPage } from '@/features/settings/DataManagementSettingsPage'
import { MarketDataSettingsPage } from '@/features/settings/MarketDataSettingsPage'
import { useEnterExit } from '@/hooks/useEnterExit'
import { useScrollLock } from '@/hooks/useScrollLock'
import { useFocusTrap } from '@/hooks/useFocusTrap'

type SettingsDialogProps = {
  isOpen: boolean
  onClose: () => void
}

function SettingsContent({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  // Always rendered (the backdrop fades on `isOpen`), so only `open` is used.
  const { open } = useEnterExit(isOpen)
  const [activePage, setActivePage] = useState<SettingsPage>('account')

  useScrollLock(isOpen)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // On open, remember what had focus (the sidebar button, or <body> after the
  // S shortcut) so closing can hand it back, then move focus into the dialog.
  // The panel itself takes focus, not its first control, so opening doesn't
  // light up a focus ring on the sidebar. Declared before the trap so the
  // trap reads the opener when it activates.
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!isOpen) return
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
  }, [isOpen])

  // Portalled to the end of <body>, so without a trap Tab walks the page
  // behind the open dialog.
  useFocusTrap(panelRef, isOpen, { returnFocusTo: openerRef })

  // `inert` while closed: the dialog stays mounted for its exit animation, but
  // `pointer-events-none` only blocks the mouse, so without it the hidden
  // controls would stay in the tab order and the accessibility tree.
  return (
    <div
      className={`fixed inset-0 bg-black/5 z-dialog flex items-center justify-center transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      inert={!isOpen}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        className="flex flex-row bg-background rounded-xl border border-border shadow-md overflow-hidden t-dialog-slide outline-none"
        style={{ width: 800, height: 576 }}
        data-open={open}
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsSidebar activePage={activePage} onNavigate={setActivePage} />

        <div className="flex-1 h-full p-[6px]">
          {activePage === 'account' && <AccountSettingsPage />}
          {activePage === 'general' && <GeneralSettingsPage />}
          {activePage === 'contributions' && <ContributionsSettingsPage />}
          {activePage === 'portfolio' && <PortfolioSettingsPage />}
          {activePage === 'backup' && <DataManagementSettingsPage />}
          {activePage === 'market-data' && <MarketDataSettingsPage />}
          {activePage === 'ai-providers' && <AiProvidersSettingsPage />}
        </div>
      </div>
    </div>
  )
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  return createPortal(<SettingsContent isOpen={isOpen} onClose={onClose} />, document.body)
}
