/**
 * Account `iconId` values are the kebab-case form of the icon component name,
 * so renaming an icon renames its key — and any id already written to
 * localStorage would no longer resolve.
 *
 * Rather than a schema migration per rename batch, stored ids are resolved
 * through this map at read time: an account saved under an old id keeps
 * rendering the right glyph forever, and the entry can be dropped once no
 * stored data can plausibly still use it.
 *
 * Add an entry for every icon rename that changes a registry key.
 */
export const ICON_ID_RENAMES: Record<string, string> = {
  'chart-3':        'chart',
  'wallet-5':       'wallet-3',
  'bank':           'credit-card',
  'diamond':        'palette',
  'dossier':        'folder-opened',
  'earth':          'globe',
  'safe-simple':    'vault',
  'shopping-bag-1': 'wind-rose',
  'sparkle-2':      'sparkle',
  'crypto-coin':    'currency-crypto',
  'rocking-horse':  'person-arms',
}

/** Map a possibly-stale stored iconId onto its current registry key. */
export function resolveIconId(iconId: string): string {
  return ICON_ID_RENAMES[iconId] ?? iconId
}
