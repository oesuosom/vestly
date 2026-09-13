import { v4 as uuidv4 } from 'uuid'
import type { Account, InstrumentAlias, Transaction, TransactionType } from '@/types'
import { fileToCSVText } from './xlsReader'
import { staticLookupInstrument } from '@/domain/instrumentLookup'
import { findDuplicateTrades } from './tradeDedup'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type ParseWarning = {
  row: number
  message: string
  rawData: string
}

export type ParseResult = {
  transactions: Transaction[]
  skipped: number           // duplicate externalIds already in store
  /**
   * Trades dropped because they match one already imported from a daily
   * confirmation PDF. Those carry XTB's *order* number, which is a different ID
   * space from this export's `ID` column, so `skipped` can't catch them —
   * see tradeDedup.ts.
   */
  crossFormatSkipped: number
  warnings: ParseWarning[]
}

// ─────────────────────────────────────────
// XTB type mapping
// ─────────────────────────────────────────

const XTB_TYPE_MAP: Record<string, TransactionType> = {
  'Stock purchase':          'buy',
  'Deposit':                 'deposit',
  'Withdrawal':              'withdrawal',
  'Dividend':                'dividend',
  'Withholding tax':         'withholding_tax',
  'Free funds interest':     'interest',
  'Free funds interest tax': 'interest_tax',
}

// ─────────────────────────────────────────
// Comment parsers
// ─────────────────────────────────────────

/**
 * Parse quantity and original price from a buy comment.
 * Example: "OPEN BUY 0.1724 @ 79.98" → { quantity: 0.1724, pricePerUnitOriginal: 79.98 }
 */
export function parseBuyComment(comment: string): {
  quantity: number
  pricePerUnitOriginal: number
} | null {
  const match = comment.match(/OPEN BUY ([\d.]+) @ ([\d.]+)/)
  if (!match) return null
  return {
    quantity: parseFloat(match[1]),
    pricePerUnitOriginal: parseFloat(match[2]),
  }
}

/**
 * Parse ticker and exchange from a comment that starts with a ticker symbol.
 * Examples:
 *   "AGNC.US USD 0.1200/ SHR"  → { ticker: "AGNC", exchange: "US" }
 *   "AGNC.US USD WHT 15%"      → { ticker: "AGNC", exchange: "US" }
 *   "KRU.PL ..."               → { ticker: "KRU",  exchange: "PL" }
 */
export function parseTickerFromComment(comment: string): {
  ticker: string
  exchange: string
} | null {
  const match = comment.match(/^([A-Z0-9]+)\.([A-Z]{2})\s/)
  if (!match) return null
  return { ticker: match[1], exchange: match[2] }
}

// ─────────────────────────────────────────
// CSV structure helpers
// ─────────────────────────────────────────


/**
 * XTB Cash Operations CSV structure:
 *   Rows 1–4:  metadata headers (Account number, Cash Operations, Date from, Date to)
 *   Row 5:     column headers: Type, Instrument, Time, Amount, ID, Comment, Product
 *   Row 6–N:   transaction data
 *   Last row:  "Total,,,,57.67,," — strip this running balance row
 *
 * Separator: comma. Rows may be quoted.
 */
function parseXTBCSVRaw(text: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const lines = text.trim().split('\n')

  // Row 5 (index 4) is the column header row
  const HEADER_ROW_INDEX = 4

  if (lines.length <= HEADER_ROW_INDEX) {
    return { headers: [], rows: [] }
  }

  const separator = ','

  const splitLine = (line: string): string[] => {
    // Simple CSV split that handles quoted fields
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuotes = !inQuotes
      } else if (ch === separator && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = splitLine(lines[HEADER_ROW_INDEX])
  const rows: Record<string, string>[] = []

  for (let i = HEADER_ROW_INDEX + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Skip the "Total" summary row at the end
    if (line.startsWith('Total')) continue

    const values = splitLine(line)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? ''
    }
    rows.push(row)
  }

  return { headers, rows }
}

// ─────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────

/**
 * Parse an XTB Cash Operations CSV file into Transaction objects.
 *
 * @param file                  The File object from the file picker
 * @param accountId             The account this import belongs to
 * @param existingExternalIds   Set of externalIds already in the store (for deduplication)
 * @param accounts              Optional existing accounts — used as a final fallback to
 *                              resolve tickers for buy-only instruments (e.g. Fortinet)
 *                              that never appear in dividend rows. Matched by
 *                              case-insensitive holding name against the CSV Instrument column.
 */
export async function parseXTBCashOperations(
  file: File,
  accountId: string,
  existingExternalIds: Set<string>,
  accounts?: Account[],
  instrumentAliases?: Record<string, InstrumentAlias>,
  existingTransactions?: Transaction[]
): Promise<ParseResult> {
  const text = await fileToCSVText(file)
  const { rows } = parseXTBCSVRaw(text)

  // Pass 1: build instrument name → ticker map from dividend/withholding_tax rows.
  // Buy comments ("OPEN BUY 0.1724 @ 79.98") contain no ticker, but the
  // corresponding dividend comments ("AGNC.US USD 0.1200/ SHR") do.
  // e.g. "AGNC Investment" → "AGNC", "US"
  const instrumentTickerMap = new Map<string, { ticker: string; exchange: string }>()
  for (const row of rows) {
    const rawType = row['Type'] ?? ''
    const type = XTB_TYPE_MAP[rawType]
    if (type !== 'dividend' && type !== 'withholding_tax') continue
    const instrument = (row['Instrument'] ?? '').trim()
    const comment = row['Comment'] ?? ''
    if (!instrument) continue
    if (instrumentTickerMap.has(instrument)) continue
    const tickerInfo = parseTickerFromComment(comment)
    if (tickerInfo) instrumentTickerMap.set(instrument, tickerInfo)
  }

  // Fallback map: lowercase holding name → ticker, built from existing accounts.
  // Used for buy-only instruments that never appear in dividend rows and therefore
  // can't be resolved via instrumentTickerMap. The user must have set the ticker
  // on the holding manually for this to help.
  const holdingNameMap = new Map<string, string>()
  if (accounts) {
    for (const acc of accounts) {
      for (const h of acc.holdings) {
        if (h.ticker) holdingNameMap.set(h.name.toLowerCase(), h.ticker)
      }
    }
  }

  // Pass 2: parse all rows into transactions
  const transactions: Transaction[] = []
  const warnings: ParseWarning[] = []
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    // Row numbers shown to the user are 1-based and offset by 5 header rows
    const rowNum = i + 6

    const rawType = row['Type'] ?? ''
    const rawInstrument = row['Instrument'] ?? ''
    const rawTime = row['Time'] ?? ''
    const rawAmount = row['Amount'] ?? ''
    const rawId = row['ID'] ?? ''
    const rawComment = row['Comment'] ?? ''

    // 1. Deduplication: skip if externalId already exists
    if (existingExternalIds.has(rawId)) {
      skipped++
      continue
    }

    // 2. Map type
    const type = XTB_TYPE_MAP[rawType]
    if (!type) {
      warnings.push({
        row: rowNum,
        message: `Unknown transaction type: "${rawType}"`,
        rawData: JSON.stringify(row),
      })
      continue
    }

    // 3. Parse amount
    const amountPLN = parseFloat(rawAmount)
    if (isNaN(amountPLN)) {
      warnings.push({
        row: rowNum,
        message: `Invalid amount: "${rawAmount}"`,
        rawData: JSON.stringify(row),
      })
      continue
    }

    // 4. Parse date
    const date = parseXTBDateTime(rawTime)
    if (!date) {
      warnings.push({
        row: rowNum,
        message: `Invalid date: "${rawTime}"`,
        rawData: JSON.stringify(row),
      })
      continue
    }

    // 5. Build transaction with type-specific fields
    const base = {
      id: uuidv4(),
      accountId,
      type,
      date,
      amountPLN,
      externalId: rawId,
      comment: rawComment || undefined,
      source: 'xtb_import' as const,
      createdAt: new Date().toISOString(),
    }

    if (type === 'buy') {
      const parsed = parseBuyComment(rawComment)
      if (!parsed) {
        warnings.push({
          row: rowNum,
          message: `Could not parse buy comment: "${rawComment}"`,
          rawData: JSON.stringify(row),
        })
        continue
      }

      // Ticker resolution priority for buy rows:
      //   1. Comment (not present in real XTB buy rows, but handled for robustness)
      //   2. instrumentTickerMap — built from dividend/withholding_tax rows in Pass 1
      //   3. instrumentAliases  — user-defined name→ticker map from Settings
      //   4. staticLookupInstrument — built-in map for common ETFs
      //   5. holdingNameMap — case-insensitive name match against existing holdings
      //      (covers buy-only instruments like Fortinet that never appear in dividend rows)
      const instrumentKey = rawInstrument.trim()
      const tickerFromComment = parseTickerFromComment(rawComment)
      const tickerFromMap = instrumentKey ? instrumentTickerMap.get(instrumentKey) : undefined
      const aliasKey = instrumentKey.toLowerCase()
      const tickerFromAlias = (!tickerFromComment && !tickerFromMap && instrumentKey && instrumentAliases)
        ? (instrumentAliases[instrumentKey] ?? instrumentAliases[aliasKey])
        : undefined
      const tickerFromStatic = (!tickerFromComment && !tickerFromMap && !tickerFromAlias && instrumentKey)
        ? staticLookupInstrument(instrumentKey)
        : undefined
      const tickerFromHolding = (!tickerFromComment && !tickerFromMap && !tickerFromAlias && !tickerFromStatic && instrumentKey)
        ? holdingNameMap.get(instrumentKey.toLowerCase())
        : undefined
      const tickerInfo = tickerFromComment ?? tickerFromMap ?? tickerFromAlias ?? tickerFromStatic
      const ticker = tickerInfo?.ticker ?? tickerFromHolding
      const exchange = tickerInfo?.exchange  // not available from holding name match
      const originalCurrency = exchange === 'PL' ? 'PLN' : exchange === 'US' ? 'USD' : undefined

      transactions.push({
        ...base,
        instrument: rawInstrument || undefined,
        ticker,
        exchange,
        quantity: parsed.quantity,
        pricePerUnitPLN: Math.abs(amountPLN) / parsed.quantity,
        originalCurrency,
        pricePerUnitOriginal: parsed.pricePerUnitOriginal,
      })
    } else if (type === 'dividend' || type === 'withholding_tax') {
      // relatedInstrument from Instrument column, relatedTicker from Comment
      const tickerInfo = parseTickerFromComment(rawComment)

      transactions.push({
        ...base,
        relatedInstrument: rawInstrument || undefined,
        relatedTicker: tickerInfo?.ticker,
        exchange: tickerInfo?.exchange,
      })
    } else {
      // deposit, withdrawal, interest, interest_tax, fee, sell
      // no instrument fields
      transactions.push(base)
    }
  }

  // Pass 3: drop trades that already arrived via a daily confirmation PDF.
  // Matching is by economic identity, not id — the two documents share none.
  const dupes = findDuplicateTrades(transactions, existingTransactions ?? [])

  return {
    transactions: dupes.size > 0 ? transactions.filter((t) => !dupes.has(t.id)) : transactions,
    skipped,
    crossFormatSkipped: dupes.size,
    warnings,
  }
}

// ─────────────────────────────────────────
// Date parsing
// ─────────────────────────────────────────

/**
 * Parse XTB datetime string to ISO 8601.
 *
 * Handles two formats observed in XTB exports:
 *   "2026-02-10 10:59:02.277000"  — YYYY-MM-DD HH:MM:SS.microseconds (actual)
 *   "10.02.2026 10:59:02"         — DD.MM.YYYY HH:MM:SS (documented)
 *
 * Returns null if unparseable.
 */
function parseXTBDateTime(raw: string): string | null {
  // Format 1: "2026-02-10 10:59:02.277000" (YYYY-MM-DD with optional fractional seconds)
  const isoSpaceMatch = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/)
  if (isoSpaceMatch) {
    // Store date only — XTB timestamps are Warsaw time but we can't safely convert
    // to UTC without a timezone library. The date portion is all that's needed for
    // tax-year attribution, sorting, and deduplication.
    return isoSpaceMatch[1]
  }

  // Format 2: "10.02.2026 10:59:02" (DD.MM.YYYY)
  const dotMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (dotMatch) {
    const [, day, month, year] = dotMatch
    return `${year}-${month}-${day}`
  }

  return null
}
