import { v4 as uuidv4 } from 'uuid'
import { format, parseISO, subMonths, subYears } from 'date-fns'
import type { AssetCategory, Holding } from '@/types'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type ColumnMapping = {
  ticker: string
  quantity: string
  purchasePrice: string
  currentPrice: string
  purchaseDate?: string
}

export type KnownFormat = {
  id: string
  name: string
  detectHeaders: string[]
  mapping: ColumnMapping
  transform?: Record<string, (val: string, row: Record<string, string>) => string | number>
}

export type CSVParseResult = {
  format: KnownFormat | null
  headers: string[]
  holdings: Holding[]
  errors: { row: number; reason: string }[]
  rawRows: Record<string, string>[]
}

// ─────────────────────────────────────────
// Polish government bond duration lookup
// ─────────────────────────────────────────

/**
 * Duration (in years) for each Polish government bond type.
 * OTS is a special case: 3 months instead of years.
 * To add a new bond type, just add one line here.
 */
const POLISH_BOND_DURATIONS: Record<string, number> = {
  OTS: 3,  // 3 months (special case)
  ROR: 1,  // 1 year
  DOR: 2,  // 2 years
  TOS: 3,  // 3 years
  COI: 4,  // 4 years
  ROS: 6,  // 6 years
  EDO: 10, // 10 years
  ROD: 12, // 12 years
}

/**
 * Calculate the purchase date of a Polish government bond by subtracting
 * its duration from the maturity date (DATA WYKUPU).
 *
 * @param ticker  e.g. "EDO0235" — letters-only prefix is the bond type
 * @param maturityDate  YYYY-MM-DD maturity date from the CSV
 */
function calculateBondPurchaseDate(ticker: string, maturityDate: string): string {
  const prefix = ticker.replace(/[^A-Za-z]/g, '').toUpperCase()
  const duration = POLISH_BOND_DURATIONS[prefix]

  if (duration === undefined) {
    console.warn(`[CSV] Unrecognised Polish bond type "${prefix}" from ticker "${ticker}". Falling back to today's date. Add it to POLISH_BOND_DURATIONS.`)
    return new Date().toISOString().split('T')[0]
  }

  const maturity = parseISO(maturityDate)

  if (prefix === 'OTS') {
    return format(subMonths(maturity, duration), 'yyyy-MM-dd')
  }

  return format(subYears(maturity, duration), 'yyyy-MM-dd')
}

// ─────────────────────────────────────────
// Known broker formats
// ─────────────────────────────────────────

export const KNOWN_FORMATS: KnownFormat[] = [
  {
    id: 'pko_ike',
    name: 'PKO IKE (Obligacje Skarbowe)',
    detectHeaders: ['EMISJA', 'DOSTĘPNA LICZBA OBLIGACJI', 'WARTOŚĆ AKTUALNA'],
    mapping: {
      ticker: 'EMISJA',
      quantity: 'DOSTĘPNA LICZBA OBLIGACJI',
      purchasePrice: 'WARTOŚĆ NOMINALNA',
      currentPrice: 'WARTOŚĆ AKTUALNA',
      purchaseDate: 'DATA WYKUPU',
    },
    transform: {
      // Strip spaces before parseInt — Polish formatting uses a space as the
      // thousands separator and parseInt("1 000") would stop at the space.
      purchasePrice: (val: string, row: Record<string, string>) =>
        parseFloat(val.replace(/\s/g, '').replace(',', '.')) /
        parseInt(row['DOSTĘPNA LICZBA OBLIGACJI'].replace(/\s/g, ''), 10),
      currentPrice: (val: string, row: Record<string, string>) =>
        parseFloat(val.replace(/\s/g, '').replace(',', '.')) /
        parseInt(row['DOSTĘPNA LICZBA OBLIGACJI'].replace(/\s/g, ''), 10),
      quantity: (val: string) => parseInt(val.replace(/\s/g, ''), 10),
      purchaseDate: (val: string, row: Record<string, string>) =>
        calculateBondPurchaseDate(row['EMISJA'], val),
    },
  },
  {
    id: 'xtb',
    name: 'XTB',
    detectHeaders: ['Symbol', 'Quantity', 'Open Price'],
    mapping: {
      ticker: 'Symbol',
      quantity: 'Quantity',
      purchasePrice: 'Open Price',
      currentPrice: 'Current Price',
      purchaseDate: 'Open Date',
    },
    transform: {
      quantity: (val: string) => parseFloat(val),
      purchasePrice: (val: string) => parseFloat(val),
      currentPrice: (val: string) => parseFloat(val),
    },
  },
]

// ─────────────────────────────────────────
// Raw CSV parsing
// ─────────────────────────────────────────

/**
 * Split one CSV line on `separator`, honouring double quotes.
 * A quoted field may contain the separator; `""` inside quotes is an
 * escaped quote. Naive `split(separator)` would shift every column after
 * a value like `"Obligacje, seria X"`.
 */
function splitCSVLine(line: string, separator: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"' && current.trim() === '') {
      inQuotes = true
      current = ''
    } else if (char === separator) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  values.push(current.trim())
  return values
}

/**
 * Parse raw CSV text into headers and rows (array of key→value objects).
 * Handles both comma and semicolon separators, quoted fields, and CRLF.
 */
export function parseCSVRaw(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length === 0) return { headers: [], rows: [] }

  // Detect separator from header line
  const separator = lines[0].includes(';') ? ';' : ','

  const headers = splitCSVLine(lines[0], separator)
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = splitCSVLine(line, separator)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? ''
    }
    rows.push(row)
  }

  return { headers, rows }
}

// ─────────────────────────────────────────
// Format detection
// ─────────────────────────────────────────

/**
 * Detect which known broker format matches the given CSV headers.
 * Returns the first matching KnownFormat, or null if unrecognised.
 */
export function detectFormat(headers: string[]): KnownFormat | null {
  const headerSet = new Set(headers)
  for (const fmt of KNOWN_FORMATS) {
    if (fmt.detectHeaders.every((h) => headerSet.has(h))) {
      return fmt
    }
  }
  return null
}

// ─────────────────────────────────────────
// Mapping + transformation
// ─────────────────────────────────────────

/** Normalise date strings to YYYY-MM-DD. Handles DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD. Returns null if unparseable. */
function normalizeDate(dateStr: string): string | null {
  if (!dateStr) return null

  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10)

  // DD.MM.YYYY or DD/MM/YYYY
  const match = dateStr.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  }

  return null
}

/**
 * Apply a column mapping (and optional transforms) to raw CSV rows,
 * producing Holding objects ready for import.
 */
export function applyMapping(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  transforms: Record<string, (val: string, row: Record<string, string>) => string | number> | undefined,
  category: AssetCategory,
  accountId: string
): { holdings: Holding[]; errors: { row: number; reason: string }[] } {
  const holdings: Holding[] = []
  const errors: { row: number; reason: string }[] = []
  const now = new Date().toISOString()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2 // +1 for header, +1 for 1-based

    try {
      // Extract raw values from the mapped columns
      const rawTicker = row[mapping.ticker] ?? ''
      const rawQuantity = row[mapping.quantity] ?? ''
      const rawPurchasePrice = row[mapping.purchasePrice] ?? ''
      const rawCurrentPrice = row[mapping.currentPrice] ?? ''
      const rawDate = mapping.purchaseDate ? (row[mapping.purchaseDate] ?? '') : ''

      if (!rawTicker) {
        errors.push({ row: rowNum, reason: 'Missing ticker/name' })
        continue
      }

      // Apply transforms or default numeric parsing
      const quantity = transforms?.quantity
        ? Number(transforms.quantity(rawQuantity, row))
        : parseNumeric(rawQuantity)

      const purchasePrice = transforms?.purchasePrice
        ? Number(transforms.purchasePrice(rawPurchasePrice, row))
        : parseNumeric(rawPurchasePrice)

      const currentPrice = transforms?.currentPrice
        ? Number(transforms.currentPrice(rawCurrentPrice, row))
        : parseNumeric(rawCurrentPrice)

      if (isNaN(quantity) || quantity <= 0) {
        errors.push({ row: rowNum, reason: `Invalid quantity: "${rawQuantity}"` })
        continue
      }
      if (!isFinite(purchasePrice) || purchasePrice < 0) {
        errors.push({ row: rowNum, reason: `Invalid purchase price: "${rawPurchasePrice}"` })
        continue
      }
      if (!isFinite(currentPrice) || currentPrice < 0) {
        errors.push({ row: rowNum, reason: `Invalid current price: "${rawCurrentPrice}"` })
        continue
      }

      // Apply purchaseDate transform or fall back to normalizeDate
      const purchaseDate = transforms?.purchaseDate
        ? String(transforms.purchaseDate(rawDate, row))
        : normalizeDate(rawDate)

      if (purchaseDate === null) {
        errors.push({ row: rowNum, reason: `Unrecognised date format: "${rawDate}"` })
        continue
      }

      holdings.push({
        id: uuidv4(),
        accountId,
        name: rawTicker,
        ticker: rawTicker,
        category,
        quantity,
        purchasePrice,
        currentPrice,
        purchaseDate,
        createdAt: now,
        updatedAt: now,
      })
    } catch {
      errors.push({ row: rowNum, reason: 'Failed to parse row' })
    }
  }

  return { holdings, errors }
}

/**
 * Parse a numeric string, stripping Polish number formatting
 * (spaces as thousands, comma as decimal separator).
 */
function parseNumeric(val: string): number {
  return parseFloat(val.replace(/\s/g, '').replace(',', '.'))
}

// ─────────────────────────────────────────
// Smart update: match existing vs parsed
// ─────────────────────────────────────────

export type MatchResult = {
  toUpdate: { existing: Holding; parsed: Holding }[]
  toAdd: Holding[]
  toRemove: Holding[]
}

/**
 * Match parsed CSV holdings against existing holdings in an account.
 * Match criteria: ticker === ticker AND purchaseDate === purchaseDate.
 *
 * - toUpdate: existing holding has a match in parsed (paired together)
 * - toAdd: parsed holding with no match in existing
 * - toRemove: existing holding with no match in parsed
 */
export function matchHoldings(
  existingHoldings: Holding[],
  parsedHoldings: Holding[]
): MatchResult {
  const toUpdate: { existing: Holding; parsed: Holding }[] = []
  const toAdd: Holding[] = []

  const unmatchedExisting = new Set(existingHoldings.map((h) => h.id))

  for (const parsed of parsedHoldings) {
    const match = existingHoldings.find(
      (ex) =>
        unmatchedExisting.has(ex.id) &&
        ex.ticker === parsed.ticker &&
        ex.purchaseDate === parsed.purchaseDate
    )

    if (match) {
      toUpdate.push({ existing: match, parsed })
      unmatchedExisting.delete(match.id)
    } else {
      toAdd.push(parsed)
    }
  }

  const toRemove = existingHoldings.filter((h) => unmatchedExisting.has(h.id))

  return { toUpdate, toAdd, toRemove }
}

// ─────────────────────────────────────────
// Main parse entry point
// ─────────────────────────────────────────

/**
 * Full CSV parse pipeline:
 * 1. Split text into headers + rows
 * 2. Detect known format (or use userMapping)
 * 3. Apply mapping + transforms
 * 4. Return holdings + errors
 */
export function parseCSV(
  text: string,
  accountId: string,
  category: AssetCategory,
  userMapping?: ColumnMapping
): CSVParseResult {
  const { headers, rows } = parseCSVRaw(text)

  if (headers.length === 0 || rows.length === 0) {
    return { format: null, headers, holdings: [], errors: [{ row: 0, reason: 'File is empty or has no data rows' }], rawRows: rows }
  }

  const format = detectFormat(headers)

  const mapping = userMapping ?? format?.mapping
  if (!mapping) {
    return { format, headers, holdings: [], errors: [], rawRows: rows }
  }

  const transforms = userMapping ? undefined : format?.transform
  const { holdings, errors } = applyMapping(rows, mapping, transforms, category, accountId)

  return { format, headers, holdings, errors, rawRows: rows }
}
