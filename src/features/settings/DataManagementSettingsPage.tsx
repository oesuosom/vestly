import { useCallback, useRef, useState } from 'react'
import { ArrowBoxIn, ArrowBoxOut, CircleInfo } from '@/generated/icons'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { getStore } from '@/storage/portfolioStore'
import { applyBackup, validateBackup, type BackupField } from '@/storage/backupValidation'
import { clearAppKeys } from '@/utils/appStorage'
import { downloadJson } from '@/utils/download'
import type { Settings } from '@/types'

/** Blank out API keys so backups can be shared without leaking credentials. */
function stripApiKeys(settings: Settings): Settings {
  return {
    ...settings,
    coinGeckoApiKey: '',
    claudeApiKey: '',
    priceProvider: { ...settings.priceProvider, apiKey: '' },
    exchangeRateProvider: { ...settings.exchangeRateProvider, apiKey: undefined },
  }
}

/** Restore the current session's API keys when an imported backup has none. */
function mergeApiKeys(imported: Settings, current: Settings): Settings {
  return {
    ...imported,
    coinGeckoApiKey: imported.coinGeckoApiKey || current.coinGeckoApiKey,
    claudeApiKey: imported.claudeApiKey || current.claudeApiKey,
    priceProvider: {
      ...imported.priceProvider,
      apiKey: imported.priceProvider?.apiKey || current.priceProvider.apiKey,
    },
    exchangeRateProvider: {
      ...imported.exchangeRateProvider,
      apiKey: imported.exchangeRateProvider?.apiKey ?? current.exchangeRateProvider.apiKey,
    },
  }
}

function BackupCard({
  icon: Icon,
  title,
  description,
  buttonLabel,
  onClick,
  isLast,
}: {
  icon: React.FC<{ className?: string }>
  title: string
  description: string
  buttonLabel: string
  onClick: () => void
  isLast?: boolean
}) {
  return (
    <div
      className={`flex-1 bg-muted flex flex-col items-center justify-center gap-4 p-8 ${!isLast ? 'border-r border-surface' : ''}`}
    >
      <Icon className="size-5 text-foreground" />
      <div className="flex flex-col items-center gap-1 text-center w-full">
        <span className="text-sm font-medium text-foreground tracking-[-0.35px]">{title}</span>
        <span className="text-xs text-foregroundMuted leading-[1.5] tracking-[-0.3px]">{description}</span>
      </div>
      <Button variant="secondary" className="w-full" onClick={onClick}>
        {buttonLabel}
      </Button>
    </div>
  )
}

export function DataManagementSettingsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importData, setImportData] = useState<string | null>(null)
  const [clearStep, setClearStep] = useState<0 | 1 | 2>(0)
  const [confirmText, setConfirmText] = useState('')

  const handleExport = useCallback(() => {
    const store = getStore()
    downloadJson('vestly-backup', { ...store, settings: stripApiKeys(store.settings) })
  }, [])

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        alert('Invalid JSON file. Please select a valid backup.')
        return
      }
      // Validate before opening the confirm dialog: a bad file should be
      // rejected while nothing has been touched, not after the user commits.
      const result = validateBackup(parsed)
      if (!result.ok) {
        alert(`This file can\u2019t be restored.\n\n${result.error}`)
        return
      }
      setImportData(text)
      setImportModalOpen(true)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleImportConfirm() {
    if (!importData) return

    try {
      const parsed = JSON.parse(importData) as Record<string, unknown>

      // Re-checked here rather than trusted from handleFileSelect, so the
      // validation can never be bypassed by a change to how the dialog opens.
      const result = validateBackup(parsed)
      if (!result.ok) {
        alert(`This file can\u2019t be restored.\n\n${result.error}`)
        return
      }

      // Backups are exported with API keys stripped; keep the current session's.
      const currentSettings = getStore().settings
      applyBackup(parsed, result.fields as BackupField[], {
        settings: (value) => mergeApiKeys(value as Settings, currentSettings),
      })

      setImportModalOpen(false)
      setImportData(null)
      window.location.reload()
    } catch {
      alert('Failed to import data. Your existing data has been left unchanged.')
    }
  }

  function handleClearAll() {
    // Enumerated by prefix rather than a hand-written list — the old list had
    // already gone stale (wrong historical-prices version, missing the
    // no-dividend cache and the per-account insight keys), so "clear all" was
    // silently leaving data behind.
    clearAppKeys()
    setClearStep(0)
    setConfirmText('')
    window.location.reload()
  }

  return (
    <div className="w-full h-full bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)] flex flex-col gap-6 p-6 overflow-y-auto scrollbar-none">
      {/* Header */}
      <div className="flex flex-col gap-0 shrink-0">
        <div className="h-9 flex items-center">
          <span className="text-lg font-medium text-foreground tracking-[-0.45px]">Data Management</span>
        </div>
        <span className="text-sm text-foregroundMuted tracking-[-0.35px]">
          Manage your financial data — create backups and restore when needed.
        </span>
      </div>

      {/* Backup cards + notes */}
      <div className="flex flex-col gap-4 shrink-0">
        {/* Export / Restore cards */}
        <div className="flex rounded-lg overflow-hidden">
          <BackupCard
            icon={ArrowBoxOut}
            title="Export Backup"
            description="Download all your data as a JSON backup file you can store anywhere."
            buttonLabel="Export Backup"
            onClick={handleExport}
          />
          <BackupCard
            icon={ArrowBoxIn}
            title="Restore Backup"
            description="Restore data from a previous backup file. This will replace all current data."
            buttonLabel="Restore Backup"
            onClick={() => fileInputRef.current?.click()}
            isLast
          />
        </div>

        {/* Backup notes */}
        <div className="flex flex-col rounded-lg overflow-hidden">
          <div className="bg-[#e1e4fe] border-b border-surface px-3 py-3 flex items-center justify-between">
            <span className="text-sm text-[#5d42c7] tracking-[-0.35px]">Backup notes</span>
            <CircleInfo className="size-5 text-[#5d42c7] shrink-0" />
          </div>
          <div className="bg-[#e1e4fe] px-3 py-3">
            <p className="text-sm text-[#5d42c7] leading-[1.5] tracking-[-0.35px]">
              Backups are plain JSON files — human-readable and portable.<br />
              Backup includes accounts, transactions, snapshots and settings.<br />
              API keys are never included — they stay on this device.<br />
              Import will replace ALL current data with the backup.<br />
              After import, the app reloads automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="flex flex-col gap-4 shrink-0">
        <span className="text-sm font-medium text-foreground tracking-[-0.35px]">Danger Zone</span>
        <div className="rounded-lg overflow-hidden">
          <div className="bg-muted border-b border-surface flex items-center gap-3 h-14 px-3">
            <span className="flex-1 text-xs text-foregroundMuted tracking-[-0.3px]">
              Permanently delete all portfolio data and caches.
            </span>
            <button
              onClick={() => setClearStep(1)}
              className="text-sm font-semibold text-negative tracking-[-0.35px] whitespace-nowrap cursor-pointer bg-transparent border-0 p-0"
            >
              Clear All Data
            </button>
          </div>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Import Confirmation Modal */}
      <ConfirmDialog
        isOpen={importModalOpen}
        onClose={() => { setImportModalOpen(false); setImportData(null) }}
        onConfirm={handleImportConfirm}
        title="Import Backup"
        message="This will replace all your current data. Are you sure?"
        confirmLabel="Import"
        confirmVariant="primary"
      />

      {/* Clear All — Step 1 */}
      <ConfirmDialog
        isOpen={clearStep === 1}
        onClose={() => setClearStep(0)}
        onConfirm={() => setClearStep(2)}
        title="Clear All Data"
        message="This will permanently delete all your portfolio data."
        confirmLabel="Continue"
      />

      {/* Clear All — Step 2 */}
      <ConfirmDialog
        isOpen={clearStep === 2}
        onClose={() => { setClearStep(0); setConfirmText('') }}
        onConfirm={handleClearAll}
        title="Confirm Deletion"
        confirmLabel="Delete Everything"
        confirmDisabled={confirmText !== 'Delete'}
      >
        <Input
          label="Type Delete to confirm."
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Delete"
          autoFocus
        />
      </ConfirmDialog>
    </div>
  )
}
