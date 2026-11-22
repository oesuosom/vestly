import { createContext, useContext } from 'react'
import type { SettingsPage } from './SettingsSidebar'

/** Opens the Settings dialog, optionally on a given page. */
export type OpenSettings = (page?: SettingsPage) => void

export const OpenSettingsContext = createContext<OpenSettings>(() => {})

export function useOpenSettings(): OpenSettings {
  return useContext(OpenSettingsContext)
}
