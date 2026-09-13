import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { UnifiedImportModal } from '@/features/import/UnifiedImportModal'
import { Toast } from '@/components/ui/Toast'

type LayoutProps = {
  children: ReactNode
  onOpenSettings: () => void
}

export function Layout({ children, onOpenSettings }: LayoutProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  })

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar onImportClick={() => setImportOpen(true)} onOpenSettings={onOpenSettings} />
      <main className="flex-1 ml-24 pr-24 py-8">
        {children}
      </main>

      <UnifiedImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImportDone={(msg) => setToast({ open: true, message: msg })}
      />

      <Toast
        isOpen={toast.open}
        message={toast.message}
        onClose={() => setToast({ open: false, message: '' })}
      />
    </div>
  )
}
