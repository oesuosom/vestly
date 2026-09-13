import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import type { Account, Holding, ImportUndoData, Snapshot, Transaction } from '@/types'
import { upsertTodaySnapshot } from '@/domain/snapshots'
import {
  KEYS,
  initializeStore,
  saveAccounts,
  saveSnapshots,
  saveTransactions,
  StorageQuotaError,
} from '@/storage/portfolioStore'
import { buildBondBuyTransaction, resolveDividendLinks, upsertBondBuyTransaction } from '@/domain/transactions'
import { upsertSyntheticCashHolding } from '@/domain/holdings'
import { staticLookupInstrument } from '@/domain/instrumentLookup'

// ─────────────────────────────────────────
// Import action types (used by importHoldings)
// ─────────────────────────────────────────

export type ImportAction =
  | { type: 'update'; existingId: string; quantity: number; currentPrice: number; purchasePrice?: number }
  | { type: 'add'; holding: Omit<Holding, 'id' | 'accountId' | 'createdAt' | 'updatedAt'> }
  | { type: 'remove'; holdingId: string }

// ─────────────────────────────────────────
// Context types
// ─────────────────────────────────────────

type PortfolioState = {
  accounts: Account[]
  snapshots: Snapshot[]
  transactions: Transaction[]
  isLoading: boolean
  error: string | null
  lastImportUndo: ImportUndoData | null
}

type PortfolioActions = {
  addAccount: (account: Omit<Account, 'id' | 'createdAt' | 'lastUpdated' | 'holdings'>) => void
  updateAccount: (id: string, data: Partial<Pick<Account, 'name' | 'type' | 'notes'>>) => void
  deleteAccount: (id: string) => void
  addHolding: (accountId: string, holding: Omit<Holding, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>) => void
  updateHolding: (holdingId: string, data: Partial<Omit<Holding, 'id' | 'accountId' | 'createdAt'>>) => void
  deleteHolding: (holdingId: string) => void
  importSnapshot: (snapshot: Snapshot) => void
  importHoldings: (accountId: string, actions: ImportAction[]) => { updated: number; added: number; removed: number }
  undoLastImport: () => void
  clearImportUndo: () => void
  /** Delete a single transaction by id. */
  deleteTransaction: (id: string) => void
  /** Replace the full transactions array (used after a CSV import). */
  setTransactions: (transactions: Transaction[]) => void
  /**
   * Merge new transactions (from a CSV parse) into the store for a given account,
   * then run post-processing: resolveDividendLinks + upsertSyntheticCashHolding.
   * Returns the merged transaction list, updated accounts, and count added so the
   * caller can compute cost-basis diffs without reading stale context state.
   */
  importTransactions: (newTransactions: Transaction[], accountId: string) => {
    added: number
    mergedTransactions: Transaction[]
    nextAccounts: Account[]
  }
  /**
   * Replace the full accounts array. Used after recalculateCostBases to commit
   * updated purchase prices from the cost-basis recalculation modal.
   */
  replaceAccounts: (accounts: Account[]) => void
  /**
   * Re-run resolveDividendLinks against current accounts and transactions,
   * then persist the result. Call this after any holding is created or edited
   * so that dividend transactions link to the new holding immediately.
   */
  relinkDividends: () => void
}

type PortfolioContextValue = PortfolioState & PortfolioActions

const PortfolioContext = createContext<PortfolioContextValue | null>(null)

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [transactions, setTransactionsState] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastImportUndo, setLastImportUndo] = useState<ImportUndoData | null>(null)

  // Track whether a batch import is in progress to avoid clearing undo
  const importInProgressRef = useRef(false)

  // Ref mirror of lastImportUndo so undoLastImport can read it outside of a state updater
  const lastImportUndoRef = useRef<ImportUndoData | null>(null)

  // Ref mirrors of accounts and transactions so importTransactions can read
  // current state synchronously without closures going stale.
  const accountsRef = useRef<Account[]>([])
  const transactionsRef = useRef<Transaction[]>([])

  // When mount initialization throws (e.g. corrupted JSON in localStorage),
  // state is still the empty defaults. The persist effects must NOT run then —
  // they would overwrite the raw stored data with empty arrays, turning a
  // recoverable parse error into permanent data loss.
  const initFailedRef = useRef(false)

  // Initialize on mount
  useEffect(() => {
    try {
      initializeStore()
      const rawAccounts = localStorage.getItem(KEYS.ACCOUNTS)
      const rawSnapshots = localStorage.getItem(KEYS.SNAPSHOTS)
      const rawTransactions = localStorage.getItem(KEYS.TRANSACTIONS)
      const loadedAccounts: Account[] = rawAccounts ? JSON.parse(rawAccounts) : []
      const loadedSnapshots: Snapshot[] = rawSnapshots ? JSON.parse(rawSnapshots) : []
      const loadedTransactions: Transaction[] = rawTransactions ? JSON.parse(rawTransactions) : []

      // Migrate old "yyyy-MM" snapshot dates to "yyyy-MM-01"
      const migratedSnapshots = loadedSnapshots.map((s) =>
        s.date.length === 7 ? { ...s, date: `${s.date}-01` } : s
      )

      // Migrate: receive transactions were historically stored with negative amountPLN
      // (cost basis as money-out). Correct sign to positive (incoming asset value).
      const migratedTransactions = loadedTransactions.map((t) =>
        t.type === 'receive' && t.amountPLN < 0 ? { ...t, amountPLN: -t.amountPLN } : t
      )

      // Re-resolve dividend links on startup so any previously imported transactions
      // that weren't linked (e.g. dividends imported before the holding existed) get
      // linked immediately without requiring any user action.
      const relinkedOnInit = resolveDividendLinks(migratedTransactions, loadedAccounts)

      // Backfill bond buy transactions for any bond holdings that don't yet have one.
      // Idempotent: externalId guard means this is a no-op after the first run.
      const existingExternalIds = new Set(relinkedOnInit.map(t => t.externalId))
      const bondBuys = loadedAccounts.flatMap(acc =>
        acc.holdings
          .filter(h => h.category === 'bond' && !h.isSynthetic && !existingExternalIds.has(`bond-buy-${h.id}`))
          .map(h => buildBondBuyTransaction(h))
      )
      const allTransactions = bondBuys.length > 0 ? [...relinkedOnInit, ...bondBuys] : relinkedOnInit

      // Persist immediately — the reactive useEffect may not fire before the tab closes
      saveTransactions(allTransactions)

      // Re-run synthetic cash upsert for every account on startup so the purchaseDate
      // is always derived from transaction history rather than a stale stored value.
      const accountsWithCash = loadedAccounts.reduce(
        (acc, account) => upsertSyntheticCashHolding(acc, allTransactions, account.id),
        loadedAccounts,
      )

      // Upsert today's snapshot from the fully refreshed accounts — computing
      // it from raw loadedAccounts would bake stale synthetic-cash values into
      // the persisted snapshot.
      const updatedSnapshots = upsertTodaySnapshot(migratedSnapshots, accountsWithCash)
      saveSnapshots(updatedSnapshots)

      setAccounts(accountsWithCash)
      setSnapshots(updatedSnapshots)
      setTransactionsState(allTransactions)
    } catch (e) {
      initFailedRef.current = true
      setError(e instanceof Error ? e.message : 'Failed to load portfolio data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // A full quota is the one write failure `writeKey` rethrows. Surfacing it as
  // context error state keeps the app mounted and tells the user what to do;
  // letting it escape a persist effect would unmount the whole tree into the
  // ErrorBoundary, which is the opposite of what a failed background save
  // deserves.
  const persist = useCallback((write: () => void) => {
    try {
      write()
    } catch (err) {
      if (err instanceof StorageQuotaError) setError(err.message)
      else throw err
    }
  }, [])

  // Persist accounts to localStorage on change
  useEffect(() => {
    if (!isLoading && !initFailedRef.current) {
      persist(() => saveAccounts(accounts))
    }
  }, [accounts, isLoading, persist])

  // Persist snapshots to localStorage on change
  useEffect(() => {
    if (!isLoading && !initFailedRef.current) {
      persist(() => saveSnapshots(snapshots))
    }
  }, [snapshots, isLoading, persist])

  // Persist transactions to localStorage on change
  useEffect(() => {
    if (!isLoading && !initFailedRef.current) {
      persist(() => saveTransactions(transactions))
    }
  }, [transactions, isLoading, persist])

  // Keep refs in sync with state
  useEffect(() => {
    lastImportUndoRef.current = lastImportUndo
  }, [lastImportUndo])

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  useEffect(() => {
    transactionsRef.current = transactions
  }, [transactions])

  // Multi-tab sync: adopt writes made by other tabs. The `storage` event only
  // fires in tabs that did NOT perform the write, so this cannot loop — and
  // without it two open tabs silently overwrite each other (last write wins).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.newValue === null || initFailedRef.current) return
      try {
        if (e.key === KEYS.ACCOUNTS) setAccounts(JSON.parse(e.newValue))
        else if (e.key === KEYS.SNAPSHOTS) setSnapshots(JSON.parse(e.newValue))
        else if (e.key === KEYS.TRANSACTIONS) setTransactionsState(JSON.parse(e.newValue))
      } catch {
        // Malformed payload from another tab — keep current state
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** Helper: upsert current-month snapshot with given accounts and persist. */
  const refreshSnapshot = useCallback(
    (nextAccounts: Account[]) => {
      setSnapshots((prev) => upsertTodaySnapshot(prev, nextAccounts))
    },
    []
  )

  /** Clear import undo if a manual holding change happens outside of a batch import. */
  const invalidateUndo = useCallback(() => {
    if (!importInProgressRef.current) {
      setLastImportUndo(null)
    }
  }, [])

  const clearImportUndo = useCallback(() => {
    setLastImportUndo(null)
  }, [])

  const addAccount = useCallback(
    (data: Omit<Account, 'id' | 'createdAt' | 'lastUpdated' | 'holdings'>) => {
      const now = new Date().toISOString()
      const newAccount: Account = {
        ...data,
        id: uuidv4(),
        createdAt: now,
        lastUpdated: now,
        holdings: [],
      }
      setAccounts((prev) => {
        const next = [...prev, newAccount]
        refreshSnapshot(next)
        return next
      })
    },
    [refreshSnapshot]
  )

  const updateAccount = useCallback(
    (id: string, data: Partial<Pick<Account, 'name' | 'type' | 'notes'>>) => {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, ...data, lastUpdated: new Date().toISOString() }
            : a
        )
      )
      // No snapshot update — name/type/notes don't affect values
    },
    []
  )

  const deleteAccount = useCallback(
    (id: string) => {
      // Cascade to the transaction log. Without this the account's dividends,
      // interest and trades keep a dangling accountId: Activity renders the
      // full log unfiltered, so they stay visible and keep feeding the income
      // summaries under an account that no longer exists — and the account
      // filter can't select them, so there's no way to clear them by hand.
      // Mirrors deleteHolding, which already cascades.
      setTransactionsState((prev) => {
        const next = prev.filter((t) => t.accountId !== id)
        // Returning the same reference lets React bail out: deleting an account
        // with no transactions then costs no re-render and no redundant write
        // of the (largest) transaction log.
        return next.length === prev.length ? prev : next
      })
      setAccounts((prev) => {
        const next = prev.filter((a) => a.id !== id)
        refreshSnapshot(next)
        return next
      })
    },
    [refreshSnapshot]
  )

  const addHolding = useCallback(
    (accountId: string, data: Omit<Holding, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>) => {
      invalidateUndo()
      const now = new Date().toISOString()
      const newHolding: Holding = {
        ...data,
        id: uuidv4(),
        accountId,
        createdAt: now,
        updatedAt: now,
      }
      // Capture next accounts in a ref so we can relink after the updater runs.
      // flushSync guarantees the updater executes before we read the ref —
      // without it React defers the updater when another update is pending
      // (e.g. invalidateUndo right after an import), skipping the relink.
      const nextAccountsRef = { current: null as Account[] | null }
      flushSync(() => setAccounts((prev) => {
        const next = prev.map((a) =>
          a.id === accountId
            ? {
                ...a,
                holdings: [...a.holdings, newHolding],
                lastUpdated: now,
              }
            : a
        )
        nextAccountsRef.current = next
        refreshSnapshot(next)
        return next
      }))
      // Re-resolve dividend links now that a new holding exists.
      if (nextAccountsRef.current) {
        const relinked = resolveDividendLinks(transactionsRef.current, nextAccountsRef.current)
        setTransactionsState(
          data.category === 'bond'
            ? upsertBondBuyTransaction(relinked, newHolding)
            : relinked
        )
      }
    },
    [refreshSnapshot, invalidateUndo]
  )

  const updateHolding = useCallback(
    (holdingId: string, data: Partial<Omit<Holding, 'id' | 'accountId' | 'createdAt'>>) => {
      invalidateUndo()
      const now = new Date().toISOString()
      // flushSync: see addHolding — guarantees nextAccountsRef is populated below.
      const nextAccountsRef = { current: null as Account[] | null }
      flushSync(() => setAccounts((prev) => {
        const next = prev.map((a) => ({
          ...a,
          holdings: a.holdings.map((h) =>
            h.id === holdingId ? { ...h, ...data, updatedAt: now } : h
          ),
          lastUpdated: a.holdings.some((h) => h.id === holdingId) ? now : a.lastUpdated,
        }))
        nextAccountsRef.current = next
        refreshSnapshot(next)
        return next
      }))
      // Re-resolve dividend links in case the ticker changed and matches unlinked transactions.
      if (nextAccountsRef.current) {
        const relinked = resolveDividendLinks(transactionsRef.current, nextAccountsRef.current)
        const updatedHolding = nextAccountsRef.current.flatMap(a => a.holdings).find(h => h.id === holdingId)
        setTransactionsState(
          updatedHolding?.category === 'bond'
            ? upsertBondBuyTransaction(relinked, updatedHolding)
            : relinked
        )
      }
    },
    [refreshSnapshot, invalidateUndo]
  )

  const deleteHolding = useCallback(
    (holdingId: string) => {
      invalidateUndo()
      const now = new Date().toISOString()

      const holding = accountsRef.current.flatMap(a => a.holdings).find(h => h.id === holdingId)
      if (holding && !holding.isSynthetic) {
        const holdingTicker = holding.ticker?.toUpperCase()
        const holdingName = holding.name.toLowerCase()
        setTransactionsState(prev => prev.filter(t => {
          if (t.relatedHoldingId === holdingId) return false
          if (t.accountId !== holding.accountId) return true
          const tTicker = (
            t.ticker ?? (t.instrument ? staticLookupInstrument(t.instrument)?.ticker : undefined)
          )?.toUpperCase()
          const tRelatedTicker = (
            t.relatedTicker ?? (t.relatedInstrument ? staticLookupInstrument(t.relatedInstrument)?.ticker : undefined)
          )?.toUpperCase()
          if (holdingTicker && (tTicker === holdingTicker || tRelatedTicker === holdingTicker)) return false
          if (t.instrument?.toLowerCase() === holdingName || t.relatedInstrument?.toLowerCase() === holdingName) return false
          return true
        }))
      }

      setAccounts((prev) => {
        const next = prev.map((a) => ({
          ...a,
          holdings: a.holdings.filter((h) => h.id !== holdingId),
          lastUpdated: a.holdings.some((h) => h.id === holdingId) ? now : a.lastUpdated,
        }))
        refreshSnapshot(next)
        return next
      })
    },
    [refreshSnapshot, invalidateUndo]
  )

  const importHoldings = useCallback(
    (accountId: string, actions: ImportAction[]): { updated: number; added: number; removed: number } => {
      importInProgressRef.current = true

      const now = new Date().toISOString()

      // Pre-generate stable UUIDs for add actions OUTSIDE the updater
      // so StrictMode double-invocation uses the same IDs both times
      const addIds = actions
        .filter((a): a is Extract<ImportAction, { type: 'add' }> => a.type === 'add')
        .map(() => uuidv4())

      // Use a ref to capture undo data from the updater without closure mutation issues.
      // The updater is pure: it rebuilds these each time, so StrictMode re-runs are safe.
      const resultRef = {
        undoUpdates: [] as ImportUndoData['updates'],
        undoAdds: [] as string[],
        undoRemoves: [] as Holding[],
        updated: 0,
        added: 0,
        removed: 0,
      }

      flushSync(() => setAccounts((prev) => {
        // Reset — makes updater safe for StrictMode double-invocation
        const undoUpdates: ImportUndoData['updates'] = []
        const undoAdds: string[] = []
        const undoRemoves: Holding[] = []
        let updated = 0
        let added = 0
        let removed = 0

        const next = [...prev]

        // Find the target account
        const accountIndex = next.findIndex((a) => a.id === accountId)
        if (accountIndex === -1) return prev

        const account = { ...next[accountIndex] }
        let holdings = [...account.holdings]

        // 1. Process removes first
        for (const action of actions) {
          if (action.type !== 'remove') continue
          const existing = holdings.find((h) => h.id === action.holdingId)
          if (existing) {
            undoRemoves.push({ ...existing })
            holdings = holdings.filter((h) => h.id !== action.holdingId)
            removed++
          }
        }

        // 2. Then updates
        for (const action of actions) {
          if (action.type !== 'update') continue
          const existing = holdings.find((h) => h.id === action.existingId)
          if (existing) {
            undoUpdates.push({
              holdingId: existing.id,
              oldQuantity: existing.quantity,
              oldCurrentPrice: existing.currentPrice,
            })
            holdings = holdings.map((h) =>
              h.id === action.existingId
                ? {
                    ...h,
                    quantity: action.quantity,
                    currentPrice: action.currentPrice,
                    ...(action.purchasePrice !== undefined && { purchasePrice: action.purchasePrice }),
                    updatedAt: now,
                  }
                : h
            )
            updated++
          }
        }

        // 3. Then adds (using pre-generated stable IDs)
        let addIndex = 0
        for (const action of actions) {
          if (action.type !== 'add') continue
          const newHolding: Holding = {
            ...action.holding,
            id: addIds[addIndex++],
            accountId,
            createdAt: now,
            updatedAt: now,
          }
          holdings = [...holdings, newHolding]
          undoAdds.push(newHolding.id)
          added++
        }

        account.holdings = holdings
        account.lastUpdated = now
        next[accountIndex] = account

        // Write results to ref (last invocation wins, which is what React uses)
        resultRef.undoUpdates = undoUpdates
        resultRef.undoAdds = undoAdds
        resultRef.undoRemoves = undoRemoves
        resultRef.updated = updated
        resultRef.added = added
        resultRef.removed = removed

        refreshSnapshot(next)
        return next
      }))

      // Sync bond buy transactions for any bond-related import actions
      {
        const removedExternalIds = new Set<string>()
        let nextTxs = transactionsRef.current
        let addIdx = 0

        for (const action of actions) {
          if (action.type === 'add') {
            if (action.holding.category === 'bond' && !action.holding.isSynthetic) {
              const newHolding: Holding = {
                ...action.holding,
                id: addIds[addIdx],
                accountId,
                createdAt: now,
                updatedAt: now,
              }
              nextTxs = upsertBondBuyTransaction(nextTxs, newHolding)
            }
            addIdx++
          } else if (action.type === 'update') {
            const original = accountsRef.current.flatMap(a => a.holdings).find(h => h.id === action.existingId)
            if (original?.category === 'bond' && !original.isSynthetic) {
              const updatedHolding: Holding = {
                ...original,
                quantity: action.quantity,
                currentPrice: action.currentPrice,
                ...(action.purchasePrice !== undefined && { purchasePrice: action.purchasePrice }),
                updatedAt: now,
              }
              nextTxs = upsertBondBuyTransaction(nextTxs, updatedHolding)
            }
          } else if (action.type === 'remove') {
            removedExternalIds.add(`bond-buy-${action.holdingId}`)
          }
        }

        if (removedExternalIds.size > 0) {
          nextTxs = nextTxs.filter(t => !removedExternalIds.has(t.externalId ?? ''))
        }

        if (nextTxs !== transactionsRef.current) {
          setTransactionsState(nextTxs)
        }
      }

      // flushSync above ensures the updater ran synchronously, so resultRef is populated
      setLastImportUndo({
        updates: resultRef.undoUpdates,
        adds: resultRef.undoAdds,
        removes: resultRef.undoRemoves,
        accountId,
      })

      importInProgressRef.current = false

      return { updated: resultRef.updated, added: resultRef.added, removed: resultRef.removed }
    },
    [refreshSnapshot]
  )

  const undoLastImport = useCallback(() => {
    // Read undo data from ref (avoids nesting setAccounts inside another updater)
    const undoData = lastImportUndoRef.current
    if (!undoData) return

    // Clear undo data first (prevents double-invocation issues)
    setLastImportUndo(null)

    const now = new Date().toISOString()

    setAccounts((prev) => {
      const next = [...prev]
      const accountIndex = next.findIndex((a) => a.id === undoData.accountId)
      if (accountIndex === -1) return prev

      const account = { ...next[accountIndex] }
      let holdings = [...account.holdings]

      // 1. Undo updates — restore old values
      for (const update of undoData.updates) {
        holdings = holdings.map((h) =>
          h.id === update.holdingId
            ? { ...h, quantity: update.oldQuantity, currentPrice: update.oldCurrentPrice, updatedAt: now }
            : h
        )
      }

      // 2. Undo adds — delete them
      const addIds = new Set(undoData.adds)
      holdings = holdings.filter((h) => !addIds.has(h.id))

      // 3. Undo removes — re-add them
      for (const removed of undoData.removes) {
        holdings = [...holdings, { ...removed, updatedAt: now }]
      }

      account.holdings = holdings
      account.lastUpdated = now
      next[accountIndex] = account

      refreshSnapshot(next)
      return next
    })
  }, [refreshSnapshot])

  const deleteTransaction = useCallback((id: string) => {
    setTransactionsState((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const setTransactions = useCallback((next: Transaction[]) => {
    setTransactionsState(next)
  }, [])

  const importTransactions = useCallback(
    (newTransactions: Transaction[], accountId: string) => {
      // Dedup against current state (belt-and-suspenders — parser already deduped).
      // Transactions without an externalId can't be identified as duplicates — keep them.
      const existingIds = new Set(transactionsRef.current.map((t) => t.externalId))
      const toAdd = newTransactions.filter((t) => t.externalId == null || !existingIds.has(t.externalId))
      const added = toAdd.length

      // Compute merged transaction list
      const merged = toAdd.length > 0
        ? [...transactionsRef.current, ...toAdd]
        : transactionsRef.current

      // 1. Resolve dividend links using current accounts
      const linked = resolveDividendLinks(merged, accountsRef.current)

      // 2. Upsert synthetic cash holding
      const nextAccounts = upsertSyntheticCashHolding(accountsRef.current, linked, accountId)

      // Commit both atomically — React batches updates inside one handler.
      setTransactionsState(linked)
      setAccounts(() => {
        refreshSnapshot(nextAccounts)
        return nextAccounts
      })

      return { added, mergedTransactions: linked, nextAccounts }
    },
    [refreshSnapshot]
  )

  const replaceAccounts = useCallback(
    (next: Account[]) => {
      setAccounts(() => {
        refreshSnapshot(next)
        return next
      })
    },
    [refreshSnapshot]
  )

  const relinkDividends = useCallback(() => {
    const linked = resolveDividendLinks(transactionsRef.current, accountsRef.current)
    setTransactionsState(linked)
  }, [])

  const importSnapshot = useCallback((snapshot: Snapshot) => {
    setSnapshots((prev) => {
      const exists = prev.some((s) => s.date === snapshot.date)
      if (exists) {
        return prev.map((s) => (s.date === snapshot.date ? snapshot : s))
      }
      return [...prev, snapshot]
    })
  }, [])

  return (
    <PortfolioContext.Provider
      value={{
        accounts,
        snapshots,
        transactions,
        isLoading,
        error,
        lastImportUndo,
        addAccount,
        updateAccount,
        deleteAccount,
        addHolding,
        updateHolding,
        deleteHolding,
        importSnapshot,
        importHoldings,
        undoLastImport,
        clearImportUndo,
        deleteTransaction,
        setTransactions,
        importTransactions,
        replaceAccounts,
        relinkDividends,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  )
}

export function usePortfolio(): PortfolioContextValue {
  const context = useContext(PortfolioContext)
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider')
  }
  return context
}
