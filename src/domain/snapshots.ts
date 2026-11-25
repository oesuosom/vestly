import { v4 as uuidv4 } from 'uuid'
import type { Account, Snapshot } from '@/types'
import { getAccountValues, getCurrentAllocation, getTotalValue } from './calculations'
import { todayISO } from '@/utils/today'

/**
 * Build a snapshot object from the current account data.
 * Returns everything except the `id` — the caller decides
 * whether to reuse an existing id or generate a new one.
 */
function buildSnapshot(accounts: Account[]): Omit<Snapshot, 'id'> {
  return {
    date: todayISO(),
    totalValue: getTotalValue(accounts),
    allocation: getCurrentAllocation(accounts),
    accountValues: getAccountValues(accounts),
    createdAt: new Date().toISOString(),
  }
}

/**
 * Upsert today's snapshot.
 *
 * - If a snapshot for today already exists → replace its calculated values
 *   but keep the same `id`.
 * - If no snapshot exists for today → create a new one.
 * - Past-day snapshots are never touched.
 */
export function upsertTodaySnapshot(
  snapshots: Snapshot[],
  accounts: Account[]
): Snapshot[] {
  const today = todayISO()
  const fresh = buildSnapshot(accounts)

  const existingIndex = snapshots.findIndex((s) => s.date === today)

  if (existingIndex !== -1) {
    // Replace in-place, keep original id
    const updated = [...snapshots]
    updated[existingIndex] = { ...fresh, id: snapshots[existingIndex].id }
    return updated
  }

  // Append new snapshot
  return [...snapshots, { ...fresh, id: uuidv4() }]
}
