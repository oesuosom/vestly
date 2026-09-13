import { DEFAULT_SETTINGS, type PortfolioStore, type Transaction } from '@/types'
// Renames are resolved at read time (see @/utils/iconIds); these two migrations
// remain so stores already stamped 3.0.0 or 4.0.0 still advance.
import { ICON_ID_RENAMES } from '@/utils/iconIds'


function migrate_1_0_0_to_2_0_0(store: PortfolioStore): PortfolioStore {
  return {
    ...store,
    version: {
      ...store.version,
      version: '2.0.0',
      updatedAt: new Date().toISOString(),
    },
    transactions: [],  // starts empty; user imports CSV to populate
  }
}

function migrate_2_0_0_to_3_0_0(store: PortfolioStore): PortfolioStore {
  return {
    ...store,
    version: {
      ...store.version,
      version: '3.0.0',
      updatedAt: new Date().toISOString(),
    },
    settings: {
      ...store.settings,
      priceProvider: store.settings.priceProvider ?? DEFAULT_SETTINGS.priceProvider,
      exchangeRateProvider: store.settings.exchangeRateProvider ?? DEFAULT_SETTINGS.exchangeRateProvider,
    },
  }
}

function migrate_3_0_0_to_4_0_0(store: PortfolioStore): PortfolioStore {
  return {
    ...store,
    version: {
      ...store.version,
      version: '4.0.0',
      updatedAt: new Date().toISOString(),
    },
    accounts: store.accounts.map(a =>
      a.iconId && ICON_ID_RENAMES[a.iconId]
        ? { ...a, iconId: ICON_ID_RENAMES[a.iconId] }
        : a,
    ),
  }
}

// Same remap as 3→4, re-run for the icon renames added in the second batch.
function migrate_4_0_0_to_5_0_0(store: PortfolioStore): PortfolioStore {
  return {
    ...store,
    version: {
      ...store.version,
      version: '5.0.0',
      updatedAt: new Date().toISOString(),
    },
    accounts: store.accounts.map(a =>
      a.iconId && ICON_ID_RENAMES[a.iconId]
        ? { ...a, iconId: ICON_ID_RENAMES[a.iconId] }
        : a,
    ),
  }
}

export function migrateIfNeeded(store: PortfolioStore): PortfolioStore {
  let s = store
  const v = s.version.version
  if (v === '1.0.0') s = migrate_1_0_0_to_2_0_0(s)
  if (s.version.version === '2.0.0') s = migrate_2_0_0_to_3_0_0(s)
  if (s.version.version === '3.0.0') s = migrate_3_0_0_to_4_0_0(s)
  if (s.version.version === '4.0.0') s = migrate_4_0_0_to_5_0_0(s)
  return s
}

export type { Transaction }
