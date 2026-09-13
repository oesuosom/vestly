import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SettingsSidebar, type SettingsPage } from './SettingsSidebar'
import { AccountSettingsPage } from '@/features/settings/AccountSettingsPage'
import { ContributionsSettingsPage } from '@/features/settings/ContributionsSettingsPage'
import { GeneralSettingsPage } from '@/features/settings/GeneralSettingsPage'
import { PortfolioSettingsPage } from '@/features/settings/PortfolioSettingsPage'
import { AiProvidersSettingsPage } from '@/features/settings/AiProvidersSettingsPage'
import { DataManagementSettingsPage } from '@/features/settings/DataManagementSettingsPage'
import { MarketDataSettingsPage } from '@/features/settings/MarketDataSettingsPage'
import { useScrollLock } from '@/hooks/useScrollLock'

type SettingsDialogProps = {
  isOpen: boolean
  onClose: () => void
}

function SettingsContent({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  const [activePage, setActivePage] = useState<SettingsPage>('account')

  useScrollLock(isOpen)

  useEffect(() => {
    if (isOpen) {
      const id = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(id)
    }
    setOpen(false)
  }, [isOpen])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className={`fixed inset-0 bg-black/5 z-dialog flex items-center justify-center transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClose}
    >
      <div
        className="flex flex-row bg-background rounded-xl border border-border shadow-md overflow-hidden t-dialog-slide"
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
