import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ScrollRestoration } from '@/components/layout/ScrollRestoration'
import { PortfolioProvider } from '@/context/PortfolioContext'
import { SettingsProvider } from '@/context/SettingsContext'
import { Overview } from '@/pages/Overview'
import { Portfolio } from '@/pages/Portfolio'
import { Activity } from '@/pages/Activity'
import { AccountDetail } from '@/pages/AccountDetail'
import { DevShowcase } from '@/dev/DevShowcase'
import { SettingsDialog } from '@/features/settings/SettingsDialog'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <BrowserRouter>
      <ScrollRestoration />
      <PortfolioProvider>
        <SettingsProvider>
          <Layout onOpenSettings={() => setSettingsOpen(true)}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/accounts/:accountSlug" element={<AccountDetail />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/activity" element={<Activity />} />
              {import.meta.env.DEV && (
                <Route path="/dev" element={<DevShowcase />} />
              )}
            </Routes>
          </Layout>
          <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </SettingsProvider>
      </PortfolioProvider>
    </BrowserRouter>
  )
}
