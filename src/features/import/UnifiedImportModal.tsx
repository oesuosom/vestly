/**
 * UnifiedImportModal — single entry point for all file imports.
 *
 * Wizard steps:
 * 1. upload  — full-modal drop zone, auto-detects format, tags each file
 * 2. account — select (or confirm) the target account, with a holding-type preview
 * 3. flow    — delegates to CSVImportFlow / EMaklerImportFlow / XTBTransactionFlow
 */
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown'
import { usePortfolio } from '@/context/PortfolioContext'
import { IMPORT_FILE_ACCEPT } from '@/importers/xlsReader'
import { fileToCSVText } from '@/importers/xlsReader'
import { parseCSVRaw, detectFormat } from '@/importers/csvParser'
import {
  detectFileFormats,
  type DetectedFormat,
  type DetectedFormatType,
} from '@/importers/formatDetector'
import { CSVImportFlow } from './CSVImportFlow'
import { EMaklerImportFlow } from './EMaklerImportFlow'
import { XTBTransactionFlow } from './XTBTransactionFlow'
import { XTBConfirmationFlow } from './XTBConfirmationFlow'
import { FORMAT_SPECS, type BadgeVariant } from './importFormats'
import { RevolutCryptoFlow } from './RevolutCryptoFlow'
import { RevolutBtcFlow } from './RevolutBtcFlow'
import { InlineAlert } from '@/components/ui/InlineAlert'
import type { AccountType } from '@/types'
import { Cross, Clipboard, FolderOpenedBold } from '@/generated/icons'

// ─────────────────────────────────────────
// Props
// ─────────────────────────────────────────

export type UnifiedImportModalProps = {
  isOpen: boolean
  onClose: () => void
  preselectedAccountId?: string
  onImportDone?: (message: string) => void
}

// ─────────────────────────────────────────
// Types & metadata
// ─────────────────────────────────────────

type Step = 'upload' | 'account' | 'flow'

type UploadedFile = {
  file: File
  format: DetectedFormat
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  brokerage: 'Brokerage',
  ikze: 'IKZE',
  ike: 'IKE',
  crypto: 'Crypto',
  savings: 'Savings',
}

/** Card gradient wash colour for each badge variant (matches the account-modal pattern). */
const VARIANT_ACCENT: Record<BadgeVariant, string> = {
  blue: 'var(--color-blue-foreground)',
  teal: 'var(--color-teal-foreground)',
  purple: 'var(--color-purple-foreground)',
  orange: 'var(--color-orange-foreground)',
  neutral: 'var(--color-neutral-foreground)',
  warning: 'var(--color-warning-foreground)',
  negative: 'var(--color-negative-foreground)',
}

// ─────────────────────────────────────────
// Component
// ─────────────────────────────────────────

export function UnifiedImportModal({
  isOpen,
  onClose,
  preselectedAccountId,
  onImportDone,
}: UnifiedImportModalProps) {
  const { accounts } = usePortfolio()

  // Wizard
  const [step, setStep] = useState<Step>('upload')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Upload
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [detecting, setDetecting] = useState(false)

  // Account selection
  const [selectedAccountId, setSelectedAccountId] = useState<string>(preselectedAccountId ?? '')

  // CSV data prepared for CSVImportFlow (populated when advancing from account step)
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])

  // True while the delegated CSV flow shows its full-bleed success card (header hidden).
  const [flowDone, setFlowDone] = useState(false)

  // ─── Derived ───────────────────────────

  /** The "primary" detected format (first non-unsupported file). */
  const primaryFormat: DetectedFormat | null = useMemo(() => {
    for (const uf of uploadedFiles) {
      if (uf.format.type !== 'unsupported') return uf.format
    }
    return null
  }, [uploadedFiles])

  const primaryFormatType: DetectedFormatType | null = primaryFormat?.type ?? null

  /** Suggested account types for the detected format. */
  const suggestedAccountTypes: AccountType[] = useMemo(() => {
    if (!primaryFormatType) return []
    return FORMAT_SPECS[primaryFormatType].accounts
  }, [primaryFormatType])

  /** Accounts filtered to suggested types (or all if no suggestion). */
  const accountOptions: DropdownOption[] = useMemo(() => {
    const filtered =
      suggestedAccountTypes.length > 0
        ? accounts.filter((a) => suggestedAccountTypes.includes(a.type))
        : accounts

    // If suggestion yields no accounts, show all
    const list = filtered.length > 0 ? filtered : accounts

    return list.map((a) => ({
      value: a.id,
      label: `${a.name} (${ACCOUNT_TYPE_LABELS[a.type]})`,
    }))
  }, [accounts, suggestedAccountTypes])

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId],
  )

  const hasUnsupported = uploadedFiles.some((uf) => uf.format.type === 'unsupported')
  const allUnsupported = uploadedFiles.length > 0 && uploadedFiles.every((uf) => uf.format.type === 'unsupported')
  const isEMakler = primaryFormatType === 'emakler_portfolio' || primaryFormatType === 'emakler_order_history'

  // ─── Helpers ───────────────────────────

  function reset() {
    setStep('upload')
    setDragOver(false)
    setUploadedFiles([])
    setDetecting(false)
    setSelectedAccountId(preselectedAccountId ?? '')
    setCsvHeaders([])
    setCsvRows([])
    setFlowDone(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ─── File detection ────────────────────

  const detectFiles = useCallback(async (files: File[]) => {
    setDetecting(true)
    // Files are independent, and PDF detection decodes the document — detect in
    // parallel rather than one at a time.
    const formats = await detectFileFormats(files)
    const results: UploadedFile[] = files.map((file, i) => ({ file, format: formats[i] }))
    setUploadedFiles((prev) => [...prev, ...results])
    setDetecting(false)
  }, [])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length > 0) void detectFiles(files)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) void detectFiles(files)
  }

  function removeFile(index: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // ─── Navigation ────────────────────────

  function handleContinueToAccount() {
    // Auto-select account if preselected or only one matching account
    if (preselectedAccountId) {
      setSelectedAccountId(preselectedAccountId)
    } else if (accountOptions.length === 1) {
      setSelectedAccountId(accountOptions[0].value)
    } else if (!selectedAccountId && accountOptions.length > 0) {
      setSelectedAccountId(accountOptions[0].value)
    }
    setStep('account')
  }

  async function handleContinueToFlow() {
    if (!selectedAccountId || !primaryFormat) return

    // For CSV-based formats, pre-parse the CSV text
    const csvFormats: DetectedFormatType[] = ['pko_ike', 'xtb_holdings', 'unknown_csv']
    if (csvFormats.includes(primaryFormat.type)) {
      const file = uploadedFiles.find((uf) => uf.format.type === primaryFormat.type)?.file
      if (file) {
        const text = await fileToCSVText(file)
        const { headers, rows } = parseCSVRaw(text)
        setCsvHeaders(headers)
        setCsvRows(rows)
      }
    }

    setStep('flow')
  }

  function handleFlowComplete(message: string) {
    onImportDone?.(message)
    reset()
    onClose()
  }

  function handleFlowBack() {
    setFlowDone(false)
    setStep('account')
  }

  // ─── Render ────────────────────────────

  const isCardStep = step === 'upload' || step === 'account'
  const holdingMeta = primaryFormatType ? FORMAT_SPECS[primaryFormatType].badge : null

  const canContinueUpload =
    uploadedFiles.length > 0 &&
    uploadedFiles.some((uf) => uf.format.type !== 'unsupported') &&
    !detecting

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import"
      size="lg"
      variant="card"
      accentColor={step === 'account' && holdingMeta ? VARIANT_ACCENT[holdingMeta.variant] : undefined}
      preview={isCardStep ? (step === 'upload' ? uploadPreview() : accountPreview()) : undefined}
      hideHeader={step === 'flow' && flowDone}
      onDragOver={step === 'upload' ? handleDragOver : undefined}
      onDragLeave={step === 'upload' ? () => setDragOver(false) : undefined}
      onDrop={step === 'upload' ? handleDrop : undefined}
      dragActive={step === 'upload' && dragOver}
    >
      {/* ── Step 1: Upload ─────────────────────────────── */}
      {/* The white surface only appears once files are present — the empty state
          sits directly on the modal background (per Figma). */}
      {step === 'upload' && (
        <div
          className={`rounded-lg overflow-hidden flex flex-col ${
            uploadedFiles.length > 0 || isEMakler ? 'bg-surface shadow-xs' : ''
          }`}
        >
          {(uploadedFiles.length > 0 || isEMakler) && (
            <div className="p-5 flex flex-col gap-5">
              {uploadedFiles.length > 0 && (
                <div className="flex flex-col gap-2">
                  {uploadedFiles.map((uf, i) => (
                    <FileRow key={i} file={uf} onRemove={() => removeFile(i)} />
                  ))}
                </div>
              )}

              {hasUnsupported && (
                <InlineAlert variant="negative">
                  {allUnsupported
                    ? 'None of the selected files are supported'
                    : 'Some files are not supported and will be ignored'}
                </InlineAlert>
              )}

              {isEMakler && (
                <InlineAlert variant="neutral">
                  Tip: add both the portfolio and order-history CSV files for the best result.
                </InlineAlert>
              )}
            </div>
          )}

          <div className="border-t border-borderLight p-5 flex items-center justify-between">
            <Button variant="secondary" type="button" onClick={handleClose} className="w-20">
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              onClick={handleContinueToAccount}
              disabled={!canContinueUpload}
              className="w-20"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Account ────────────────────────────── */}
      {step === 'account' && (
        <div className="bg-surface rounded-lg shadow-xs overflow-hidden flex flex-col">
          <div className="p-5 flex flex-col gap-5">
            {accounts.length > 0 ? (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-foregroundMuted tracking-[-0.35px]">
                  Target Account{' '}
                  {suggestedAccountTypes.length > 0 && (
                    <span className="font-normal text-accent">
                      (Suggested: {suggestedAccountTypes.map((t) => ACCOUNT_TYPE_LABELS[t]).join(', ')} account)
                    </span>
                  )}
                </label>
                <Dropdown
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  options={accountOptions}
                  portal
                />
              </div>
            ) : (
              <InlineAlert variant="warning">
                No accounts exist yet. Create an account first on the Accounts page.
              </InlineAlert>
            )}
          </div>

          <div className="border-t border-borderLight p-5 flex items-center justify-between">
            <Button variant="secondary" type="button" onClick={() => setStep('upload')} className="w-20">
              Back
            </Button>
            <Button
              variant="primary"
              type="button"
              onClick={() => void handleContinueToFlow()}
              disabled={!selectedAccountId}
              className="w-20"
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Delegated Flow ─────────────────────── */}
      {/* Every flow renders its own white card (and headerless gradient done card). */}
      {step === 'flow' && primaryFormat && selectedAccount && renderFlow()}
    </Modal>
  )

  // ─── Preview slots (card variant) ──────

  function uploadPreview() {
    return (
      <div className="flex flex-col items-center gap-4 px-6 pb-4">
        <FolderOpenedBold size={24} className="text-foreground" />
        <div className="flex flex-col items-center gap-1 text-center tracking-[-0.35px]">
          <p className="text-sm font-medium text-foreground leading-none">
            Drag & drop your import file(s) here
          </p>
          <p className="text-sm text-accent leading-normal">Supports CSV, XLS, XLSX, and PDF</p>
        </div>
        <Button variant="secondary" type="button" onClick={() => fileInputRef.current?.click()}>
          Choose Files
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    )
  }

  function accountPreview() {
    if (!primaryFormat) return null
    return (
      <div className="flex flex-col items-center gap-4 px-6 pb-4">
        {holdingMeta && <Badge variant={holdingMeta.variant}>{holdingMeta.label}</Badge>}
        <div className="flex flex-col items-center gap-1 text-center tracking-[-0.35px]">
          <p className="text-sm font-medium text-foreground leading-none [font-feature-settings:'lnum'_1,'tnum'_1]">
            {FORMAT_SPECS[primaryFormat.type].label}
          </p>
          <p className="text-sm text-accent leading-normal">
            {FORMAT_SPECS[primaryFormat.type].transactional ? 'Transaction import' : 'Holdings import'}
          </p>
        </div>
      </div>
    )
  }

  // ─── Flow delegation ──────────────────

  function renderFlow() {
    if (!primaryFormat || !selectedAccount) return null

    const { type } = primaryFormat

    // CSV holdings formats
    if (type === 'pko_ike' || type === 'xtb_holdings' || type === 'unknown_csv') {
      const knownFormat = type === 'unknown_csv' ? null : detectFormat(csvHeaders)
      return (
        <CSVImportFlow
          accountId={selectedAccount.id}
          accountName={selectedAccount.name}
          accountType={selectedAccount.type}
          headers={csvHeaders}
          rawRows={csvRows}
          detectedFormat={knownFormat}
          onComplete={handleFlowComplete}
          onBack={handleFlowBack}
          onDoneChange={setFlowDone}
        />
      )
    }

    // eMakler
    if (type === 'emakler_portfolio' || type === 'emakler_order_history') {
      const emaklerFiles = uploadedFiles
        .filter(
          (uf) =>
            uf.format.type === 'emakler_portfolio' || uf.format.type === 'emakler_order_history',
        )
        .map((uf) => ({
          file: uf.file,
          type: uf.format.type === 'emakler_portfolio' ? 'portfolio' as const : 'order_history' as const,
        }))

      return (
        <EMaklerImportFlow
          accountId={selectedAccount.id}
          accountName={selectedAccount.name}
          files={emaklerFiles}
          onComplete={handleFlowComplete}
          onBack={handleFlowBack}
          onDoneChange={setFlowDone}
        />
      )
    }

    // XTB transactions
    if (type === 'xtb_transactions') {
      const file = uploadedFiles.find((uf) => uf.format.type === 'xtb_transactions')?.file
      if (!file) return null
      return (
        <XTBTransactionFlow
          accountId={selectedAccount.id}
          file={file}
          onComplete={handleFlowComplete}
          onBack={handleFlowBack}
          onDoneChange={setFlowDone}
        />
      )
    }

    // XTB daily confirmations: several statements can be imported at once, so
    // every confirmation PDF in the upload goes to a single flow.
    if (type === 'xtb_confirmation') {
      const confirmationFiles = uploadedFiles
        .filter((uf) => uf.format.type === 'xtb_confirmation')
        .map((uf) => uf.file)
      if (confirmationFiles.length === 0) return null
      return (
        <XTBConfirmationFlow
          accountId={selectedAccount.id}
          files={confirmationFiles}
          onComplete={handleFlowComplete}
          onBack={handleFlowBack}
          onDoneChange={setFlowDone}
        />
      )
    }

    // Revolut BTC: triggered when any Transfer Confirmation PDFs are uploaded.
    // Collects both revolut_btc_transfer and revolut_crypto files — statement PDFs
    // (revolut_crypto) can be either ETH or BTC, so we pass them all to the BTC parser
    // which classifies them by content. The ETH branch below only fires when no BTC
    // transfer PDFs are present.
    if (type === 'revolut_btc_transfer') {
      const btcFiles = uploadedFiles
        .filter((uf) => uf.format.type === 'revolut_btc_transfer' || uf.format.type === 'revolut_crypto')
        .map((uf) => uf.file)
      if (btcFiles.length === 0) return null
      return (
        <RevolutBtcFlow
          accountId={selectedAccount.id}
          files={btcFiles}
          onComplete={handleFlowComplete}
          onBack={handleFlowBack}
          onDoneChange={setFlowDone}
        />
      )
    }

    // Revolut ETH: statement PDFs only (no Transfer Confirmation PDFs in the upload)
    if (type === 'revolut_crypto') {
      const revolutFiles = uploadedFiles
        .filter((uf) => uf.format.type === 'revolut_crypto')
        .map((uf) => uf.file)
      if (revolutFiles.length === 0) return null
      return (
        <RevolutCryptoFlow
          accountId={selectedAccount.id}
          files={revolutFiles}
          onComplete={handleFlowComplete}
          onBack={handleFlowBack}
          onDoneChange={setFlowDone}
        />
      )
    }

    return null
  }
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

/** A single uploaded-file row: icon, name, format tag, remove. Unsupported files
 *  get a subtle red gradient wash to flag them at a glance. */
function FileRow({ file: uf, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  const { type } = uf.format
  const unsupported = type === 'unsupported'
  const badgeVariant: BadgeVariant = unsupported ? 'negative' : type === 'unknown_csv' ? 'warning' : 'neutral'

  return (
    <div className="relative flex items-center gap-3 p-3 rounded-lg bg-muted border border-borderLight overflow-hidden">
      {unsupported && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-negativeForeground" />
      )}
      <Clipboard size={20} className="relative shrink-0 text-foregroundMuted" />
      <div className="relative flex flex-1 items-center gap-2 min-w-0">
        <span className="flex-1 min-w-0 truncate text-sm text-foreground tracking-[-0.35px]">
          {uf.file.name}
        </span>
        <Badge variant={badgeVariant}>{FORMAT_SPECS[type].fileBadge}</Badge>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${uf.file.name}`}
        className="relative shrink-0 text-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <Cross size={20} />
      </button>
    </div>
  )
}

