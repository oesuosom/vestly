import { DEFAULT_SETTINGS, type Holding, type InstrumentAlias, type PortfolioStore, type Transaction } from '@/types'
import { LEGACY_EXCHANGE_CODES } from '@/domain/exchanges'
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

/**
 * An eMakler order's deduplication key (`name|exchange|date|quantity|price`,
 * also stored as its transaction's `externalId`) with a legacy exchange code
 * rewritten, so the same order file still dedupes after the parser started
 * writing XETRA for "DEU-XETRA". The exchange is read from the end, so a name
 * containing "|" can't shift it. Returns the key itself when nothing changes.
 */
export function migrateEMaklerOrderKey(key: string): string {
  const parts = key.split('|')
  if (parts.length < 5) return key
  const at = parts.length - 4
  const code = LEGACY_EXCHANGE_CODES[parts[at]]
  if (!code) return key
  parts[at] = code
  return parts.join('|')
}

/**
 * Exchange codes earlier versions stored that mean one of ours
 * (`LEGACY_EXCHANGE_CODES`): XTB imports kept XTB's "DE" and eMakler imports
 * kept "DEU-XETRA" for XETRA, so those holdings' prices were looked up on the
 * wrong market and converted at the USD rate. Rewrites them on open and closed
 * holdings, transactions (and eMakler orders' `externalId`, which embeds the
 * exchange) and instrument aliases.
 *
 * Not tied to a schema version: it is idempotent and cheap, and runs on every
 * start (`initializeStore`), so a backup restored from before the change is
 * fixed too, whatever version it carries — or none.
 *
 * @returns The store (the same object when nothing changed) and the ids of the
 *          holdings whose exchange changed, whose cached price history was
 *          fetched for the wrong market.
 */
export function migrateLegacyExchangeCodes(store: PortfolioStore): { store: PortfolioStore; changedHoldingIds: string[] } {
  const changedHoldingIds: string[] = []
  const fixHolding = (h: Holding): Holding => {
    const code = h.exchange ? LEGACY_EXCHANGE_CODES[h.exchange] : undefined
    if (!code) return h
    changedHoldingIds.push(h.id)
    return { ...h, exchange: code }
  }

  let accountsChanged = false
  const accounts = store.accounts.map((a) => {
    const holdings = a.holdings.map(fixHolding)
    const closedHoldings = a.closedHoldings?.map(fixHolding)
    const touched = holdings.some((h, i) => h !== a.holdings[i]) ||
      (closedHoldings?.some((h, i) => h !== a.closedHoldings![i]) ?? false)
    if (!touched) return a
    accountsChanged = true
    return { ...a, holdings, ...(closedHoldings && { closedHoldings }) }
  })

  let transactionsChanged = false
  const transactions = store.transactions.map((t) => {
    const code = t.exchange ? LEGACY_EXCHANGE_CODES[t.exchange] : undefined
    const externalId = t.source === 'emakler_import' ? migrateEMaklerOrderKey(t.externalId) : t.externalId
    if (!code && externalId === t.externalId) return t
    transactionsChanged = true
    return { ...t, ...(code && { exchange: code }), externalId }
  })

  let aliasesChanged = false
  const aliases: Record<string, InstrumentAlias> = {}
  for (const [name, alias] of Object.entries(store.settings?.instrumentAliases ?? {})) {
    const code = alias?.exchange ? LEGACY_EXCHANGE_CODES[alias.exchange] : undefined
    if (code) aliasesChanged = true
    aliases[name] = code ? { ...alias, exchange: code } : alias
  }

  if (!accountsChanged && !transactionsChanged && !aliasesChanged) return { store, changedHoldingIds }
  return {
    store: {
      ...store,
      accounts: accountsChanged ? accounts : store.accounts,
      transactions: transactionsChanged ? transactions : store.transactions,
      settings: aliasesChanged ? { ...store.settings, instrumentAliases: aliases } : store.settings,
    },
    changedHoldingIds,
  }
}

export type { Transaction }
