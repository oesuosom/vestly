import type { Settings } from '@/types'

// ─────────────────────────────────────────
// Provider switches
//
// One place that decides whether a provider may be contacted. Every service
// that talks to a provider takes the settings and checks here first, so a
// provider that's switched off is never called, whether a key is saved or not.
// ─────────────────────────────────────────

export type ProviderId = 'anthropic' | 'eodhd' | 'yahoo' | 'nbp' | 'coingecko'

/** The settings fields the switches live in. */
export type ProviderSettings = Pick<
  Settings,
  | 'anthropicEnabled'
  | 'claudeApiKey'
  | 'priceProvider'
  | 'exchangeRateProvider'
  | 'nbpEnabled'
  | 'coinGeckoEnabled'
  | 'coinGeckoApiKey'
>

/** Names as Settings shows them. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  eodhd: 'EODHD',
  yahoo: 'Yahoo Finance',
  nbp: 'Narodowy Bank Polski',
  coingecko: 'CoinGecko',
}

/** The switch alone, ignoring keys. */
export function isProviderSwitchedOn(settings: ProviderSettings, id: ProviderId): boolean {
  switch (id) {
    case 'anthropic':
      return settings.anthropicEnabled === true
    case 'eodhd':
      return settings.priceProvider?.id === 'eodhd' && settings.priceProvider.enabled === true
    case 'yahoo':
      return settings.exchangeRateProvider?.id === 'yahoo' && settings.exchangeRateProvider.enabled === true
    case 'nbp':
      return settings.nbpEnabled === true
    case 'coingecko':
      return settings.coinGeckoEnabled === true
  }
}

/**
 * Whether the provider may be contacted: switched on and, for providers that
 * need a key (Anthropic, EODHD), a key saved. CoinGecko's key is optional.
 */
export function isProviderOn(settings: ProviderSettings, id: ProviderId): boolean {
  if (!isProviderSwitchedOn(settings, id)) return false
  if (id === 'anthropic') return !!settings.claudeApiKey
  if (id === 'eodhd') return !!settings.priceProvider.apiKey
  return true
}

export class ProviderOffError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId) {
    super(`${PROVIDER_NAMES[provider]} is off`)
    this.name = 'ProviderOffError'
    this.provider = provider
  }
}

/** Throws ProviderOffError unless the provider may be contacted. */
export function assertProviderOn(settings: ProviderSettings, id: ProviderId): void {
  if (!isProviderOn(settings, id)) throw new ProviderOffError(id)
}

/**
 * "Yahoo Finance is off", "Yahoo Finance and EODHD are off",
 * "Yahoo Finance, EODHD and CoinGecko are off".
 */
export function describeOff(ids: ProviderId[]): string {
  const names = ids.map((id) => PROVIDER_NAMES[id])
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is off`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are off`
}
