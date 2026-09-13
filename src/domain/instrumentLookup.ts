import type { AssetCategory } from '@/types'

export type StaticInstrumentInfo = {
  ticker: string
  exchange: string
  category: AssetCategory
  /** Canonical display name. When set, the importer uses this instead of the raw CSV instrument name. */
  canonicalName?: string
}

/**
 * Static map of XTB instrument names (lowercase) → ticker/exchange/category.
 * Keys are matched case-insensitively against the "Instrument" column in XTB CSV exports.
 *
 * XTB's Cash Operations CSV uses abbreviated instrument names (e.g. "Core S&P 500"
 * instead of "iShares Core S&P 500 UCITS ETF USD (Acc)"). Both full names and the
 * short XTB forms are registered so staticLookupInstrument can find them via exact
 * or substring matching.
 *
 * Users can supplement this with their own mappings via Settings → Instrument Aliases.
 */
const STATIC_INSTRUMENT_LOOKUP: Record<string, StaticInstrumentInfo> = {
  // ── iShares — full names ──────────────────────────────────────────────────
  'ishares core msci world ucits etf usd (acc)':               { ticker: 'IWDA',  exchange: 'UK',    category: 'etf' },
  'ishares core msci world ucits etf':                          { ticker: 'IWDA',  exchange: 'UK',    category: 'etf' },
  'ishares msci world ucits etf':                               { ticker: 'SWDA',  exchange: 'UK',    category: 'etf' },
  'ishares core s&p 500 ucits etf usd (acc)':                  { ticker: 'CSPX',  exchange: 'UK',    category: 'etf' },
  'ishares core s&p 500 ucits etf':                             { ticker: 'CSPX',  exchange: 'UK',    category: 'etf' },
  'ishares nasdaq 100 ucits etf':                               { ticker: 'CNDX',  exchange: 'UK',    category: 'etf' },
  'ishares core msci emerging markets imi ucits etf':           { ticker: 'EIMI',  exchange: 'UK',    category: 'etf' },
  'ishares msci world quality factor ucits etf':                { ticker: 'IWQU',  exchange: 'UK',    category: 'etf' },
  'ishares core msci europe ucits etf eur (dist)':              { ticker: 'IMEA',  exchange: 'UK',    category: 'etf' },
  'ishares s&p 500 information technology sector ucits etf':    { ticker: 'QDVE',  exchange: 'XETRA', category: 'etf' },
  'ishares automation & robotics ucits etf':                    { ticker: 'RBOT',  exchange: 'UK',    category: 'etf' },
  'ishares msci world esg screened ucits etf':                  { ticker: 'WSRI',  exchange: 'UK',    category: 'etf' },
  'ishares edge msci world minimum volatility ucits etf':       { ticker: 'MVOL',  exchange: 'UK',    category: 'etf' },
  'ishares core euro stoxx 50 ucits etf eur (dist)':            { ticker: 'CS51',  exchange: 'XETRA', category: 'etf' },

  // ── iShares — XTB short forms (no "iShares" prefix, no "UCITS ETF" suffix) ─
  // XTB Cash Operations CSVs use abbreviated names in the Instrument column.
  'core s&p 500':                                               { ticker: 'CSPX',  exchange: 'UK',    category: 'etf' },
  'ishares core s&p 500':                                       { ticker: 'CSPX',  exchange: 'UK',    category: 'etf' },
  'core msci world':                                            { ticker: 'IWDA',  exchange: 'UK',    category: 'etf' },
  'ishares core msci world':                                    { ticker: 'IWDA',  exchange: 'UK',    category: 'etf' },
  'core msci em imi':                                           { ticker: 'EIMI',  exchange: 'UK',    category: 'etf' },
  'ishares core msci em imi':                                   { ticker: 'EIMI',  exchange: 'UK',    category: 'etf' },
  'core msci emerging markets imi':                             { ticker: 'EIMI',  exchange: 'UK',    category: 'etf' },
  'ishares core msci emerging markets imi':                     { ticker: 'EIMI',  exchange: 'UK',    category: 'etf' },
  'core euro stoxx 50':                                         { ticker: 'CS51',  exchange: 'XETRA', category: 'etf' },
  'ishares core euro stoxx 50':                                 { ticker: 'CS51',  exchange: 'XETRA', category: 'etf' },
  'msci world quality factor':                                  { ticker: 'IWQU',  exchange: 'UK',    category: 'etf' },
  'msci world esg screened':                                    { ticker: 'WSRI',  exchange: 'UK',    category: 'etf' },
  'edge msci world minimum volatility':                         { ticker: 'MVOL',  exchange: 'UK',    category: 'etf' },
  'automation & robotics':                                      { ticker: 'RBOT',  exchange: 'UK',    category: 'etf' },
  'nasdaq 100':                                                 { ticker: 'CNDX',  exchange: 'UK',    category: 'etf' },

  // ── Vanguard — full names ─────────────────────────────────────────────────
  'vanguard ftse all-world ucits etf usd accumulating':         { ticker: 'VWRA',  exchange: 'UK',    category: 'etf' },
  'vanguard ftse all-world ucits etf usd distributing':         { ticker: 'VWRL',  exchange: 'UK',    category: 'etf' },
  'vanguard ftse all-world ucits etf':                          { ticker: 'VWRL',  exchange: 'UK',    category: 'etf' },
  'vanguard s&p 500 ucits etf usd accumulating':                { ticker: 'VUAA',  exchange: 'UK',    category: 'etf' },
  'vanguard s&p 500 ucits etf usd distributing':                { ticker: 'VUSA',  exchange: 'UK',    category: 'etf' },
  'vanguard s&p 500 ucits etf':                                 { ticker: 'VUSA',  exchange: 'UK',    category: 'etf' },
  'vanguard ftse developed world ucits etf':                    { ticker: 'VEVE',  exchange: 'UK',    category: 'etf' },
  'vanguard ftse emerging markets ucits etf':                   { ticker: 'VFEM',  exchange: 'UK',    category: 'etf' },
  'vanguard ftse developed europe ucits etf':                   { ticker: 'VEUR',  exchange: 'UK',    category: 'etf' },
  'vanguard ftse north america ucits etf':                      { ticker: 'VNAM',  exchange: 'UK',    category: 'etf' },

  // ── Vanguard — XTB short forms ────────────────────────────────────────────
  'ftse all-world':                                             { ticker: 'VWRL',  exchange: 'UK',    category: 'etf' },
  'ftse developed world':                                       { ticker: 'VEVE',  exchange: 'UK',    category: 'etf' },
  'ftse emerging markets':                                      { ticker: 'VFEM',  exchange: 'UK',    category: 'etf' },
  'ftse developed europe':                                      { ticker: 'VEUR',  exchange: 'UK',    category: 'etf' },
  'ftse north america':                                         { ticker: 'VNAM',  exchange: 'UK',    category: 'etf' },

  // ── Amundi — full names ───────────────────────────────────────────────────
  'amundi prime usa ucits etf dr':                              { ticker: 'PUSA',  exchange: 'XETRA', category: 'etf' },
  'amundi prime usa ucits etf':                                 { ticker: 'PUSA',  exchange: 'XETRA', category: 'etf' },
  'amundi prime global ucits etf dr':                           { ticker: 'PRGLO', exchange: 'XETRA', category: 'etf' },
  'amundi prime global ucits etf':                              { ticker: 'PRGLO', exchange: 'XETRA', category: 'etf' },
  'amundi prime europe ucits etf dr':                           { ticker: 'PREUR', exchange: 'XETRA', category: 'etf' },
  'amundi msci world ii ucits etf acc':                         { ticker: 'MWRD',  exchange: 'UK',    category: 'etf' },
  'amundi msci world ucits etf acc':                            { ticker: 'LCUW',  exchange: 'XETRA', category: 'etf' },

  // ── Amundi — XTB short forms ──────────────────────────────────────────────
  'prime usa':                                                  { ticker: 'PUSA',  exchange: 'XETRA', category: 'etf' },
  'prime global':                                               { ticker: 'PRGLO', exchange: 'XETRA', category: 'etf' },
  'prime europe':                                               { ticker: 'PREUR', exchange: 'XETRA', category: 'etf' },
  'msci world ii':                                              { ticker: 'MWRD',  exchange: 'UK',    category: 'etf' },

  // ── Xtrackers / DWS ──────────────────────────────────────────────────────
  'xtrackers msci world swap ucits etf':                        { ticker: 'XDWD',  exchange: 'UK',    category: 'etf' },
  'xtrackers s&p 500 swap ucits etf':                           { ticker: 'XDPS',  exchange: 'UK',    category: 'etf' },
  'xtrackers msci world momentum factor ucits etf':             { ticker: 'XDWM',  exchange: 'UK',    category: 'etf' },

  // ── SPDR ─────────────────────────────────────────────────────────────────
  'spdr s&p 500 etf trust':                                     { ticker: 'SPY',   exchange: 'US',    category: 'etf' },
  'spdr msci world ucits etf':                                  { ticker: 'SWLD',  exchange: 'UK',    category: 'etf' },
  'spdr s&p us dividend aristocrats ucits etf':                 { ticker: 'UDVD',  exchange: 'UK',    category: 'etf' },

  // ── HSBC ─────────────────────────────────────────────────────────────────
  'hsbc msci world ucits etf':                                  { ticker: 'HMWD',  exchange: 'UK',    category: 'etf' },
  'hsbc s&p 500 ucits etf':                                     { ticker: 'HSPX',  exchange: 'UK',    category: 'etf' },

  // ── iShares MSCI ACWI ────────────────────────────────────────────────────
  'ishares msci acwi ucits etf':                                { ticker: 'ISAC',  exchange: 'UK',    category: 'etf' },
  'msci acwi':                                                  { ticker: 'ISAC',  exchange: 'UK',    category: 'etf' },
  'isac etf ln':                                                { ticker: 'ISAC',  exchange: 'UK',    category: 'etf' },

  // ── VanEck ───────────────────────────────────────────────────────────────
  'vaneck uranium and nuclear technologies ucits etf':          { ticker: 'NUCZ',  exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Uranium and Nuclear Technologies UCITS ETF' },
  'vaneck uranium and nuclear technologies ucits etf (xetra)':  { ticker: 'NUKL',  exchange: 'XETRA', category: 'etf', canonicalName: 'VanEck Uranium and Nuclear Technologies UCITS ETF' },
  'uranium and nuclear technologies':                           { ticker: 'NUCZ',  exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Uranium and Nuclear Technologies UCITS ETF' },
  'uranium and nuclear technlgs u':                             { ticker: 'NUKL',  exchange: 'XETRA', category: 'etf', canonicalName: 'VanEck Uranium and Nuclear Technologies UCITS ETF' },
  'vaneck uranium and nuclear technologies':                    { ticker: 'NUCZ',  exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Uranium and Nuclear Technologies UCITS ETF' },
  'vaneck semiconductor ucits etf':                             { ticker: 'SMH',   exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Semiconductor UCITS ETF' },
  'vaneck defense ucits etf':                                   { ticker: 'DFND',  exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Defense UCITS ETF' },
  'vaneck gold miners ucits etf':                               { ticker: 'GDX',   exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Gold Miners UCITS ETF' },
  'vaneck junior gold miners ucits etf':                        { ticker: 'GDXJ',  exchange: 'UK',    category: 'etf', canonicalName: 'VanEck Junior Gold Miners UCITS ETF' },

  // ── Sprott ───────────────────────────────────────────────────────────────
  'sprott uranium miners ucits etf':                            { ticker: 'URNM',  exchange: 'UK',    category: 'etf' },
  'uranium miners':                                             { ticker: 'URNM',  exchange: 'UK',    category: 'etf' },

  // ── Global X ─────────────────────────────────────────────────────────────
  'global x uranium ucits etf':                                 { ticker: 'URNU',  exchange: 'UK',    category: 'etf' },

  // ── WisdomTree ───────────────────────────────────────────────────────────
  'wisdomtree physical gold':                                   { ticker: 'PHAU',  exchange: 'UK',    category: 'etf' },
  'wisdomtree physical silver':                                 { ticker: 'PHAG',  exchange: 'UK',    category: 'etf' },
}

/**
 * Look up an instrument by name (case-insensitive).
 *
 * Resolution order:
 *   1. Exact match against the lookup map.
 *   2. Substring match: find lookup keys that are contained within the instrument
 *      name (e.g. "Core S&P 500" contains the key "core s&p 500"). Requires the
 *      matching fragment to be ≥ 8 characters to avoid false positives. When
 *      multiple keys match, the longest one wins (most specific).
 *
 * Returns undefined if no match is found.
 */
export function staticLookupInstrument(name: string): StaticInstrumentInfo | undefined {
  const normalized = name.toLowerCase().trim()

  // 1. Exact match (O(1))
  const exact = STATIC_INSTRUMENT_LOOKUP[normalized]
  if (exact) return exact

  // 2. Substring match: any registered key that is contained within the name.
  //    Use ≥ 8 chars minimum and prefer the longest matching key.
  if (normalized.length >= 8) {
    let bestMatch: StaticInstrumentInfo | undefined
    let bestKeyLen = 0
    for (const [key, info] of Object.entries(STATIC_INSTRUMENT_LOOKUP)) {
      if (key.length >= 8 && normalized.includes(key) && key.length > bestKeyLen) {
        bestMatch = info
        bestKeyLen = key.length
      }
    }
    if (bestMatch) return bestMatch
  }

  return undefined
}
