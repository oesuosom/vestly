// ─────────────────────────────────────────
// eMakler (mBank) CSV Parser
//
// Handles two file formats exported from mBank eMakler:
//   1. Portfolio snapshot  — eMAKLER_portfel.Csv
//   2. Order history       — eMAKLER_historia_zlecen.Csv
//
// Both files are CP1250-encoded and semicolon-separated.
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// Exchange normalisation
// ─────────────────────────────────────────

const EXCHANGE_MAP: Record<string, string> = {
  'WWA-GPW': 'PL',
  'GBR-LSE': 'UK',  // EODHD uses 'UK' for London Stock Exchange (e.g. ISAC.UK)
}

export function normalizeEMaklerExchange(raw: string): string {
  return EXCHANGE_MAP[raw.trim()] ?? raw.trim()
}

// ─────────────────────────────────────────
// Low-level helpers
// ─────────────────────────────────────────

/** Decode a CP1250 (Windows-1250) encoded binary file to a UTF string. */
export async function readCP1250(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  return new TextDecoder('windows-1250').decode(buffer)
}

function splitSemi(line: string): string[] {
  return line.split(';').map((s) => s.trim())
}

/** Normalise decimal separator: comma → period, then parse. */
function toFloat(raw: string): number {
  return parseFloat(raw.replace(',', '.').trim())
}

/** Parse 'DD.MM.YYYY HH:mm:ss' → ISO 8601, or null if invalid. */
function parseDDMMYYYY(raw: string): string | null {
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}.000Z`
  return isNaN(Date.parse(iso)) ? null : iso
}

// ─────────────────────────────────────────
// Public types
// ─────────────────────────────────────────

export type EMaklerPortfolioRow = {
  name: string
  exchange: string        // normalised (PL, GB, …)
  quantity: number
  currentPrice: number   // in priceCurrency
  priceCurrency: string  // 'USD' | 'GBP' | 'PLN' | …
  totalValuePLN: number  // total position value in PLN
}

export type EMaklerOrderRow = {
  name: string
  exchange: string        // normalised
  side: 'buy' | 'sell'
  quantityOrdered: number
  quantityExecuted: number
  price: number           // in currency, comma→period normalised
  currency: string
  date: string            // ISO datetime
  deduplicationKey: string // `${name}|${exchange}|${date}|${quantityExecuted}|${price}`
}

export type EMaklerFileType = 'portfolio' | 'order_history' | 'unknown'

// ─────────────────────────────────────────
// File-type detection
// ─────────────────────────────────────────

/**
 * Detect whether a CP1250-decoded string is a portfolio or order-history file.
 * Works by looking for distinctive column-header strings.
 */
export function detectEMaklerFileType(text: string): EMaklerFileType {
  // Portfolio: unique column "Liczba dostępna (Blokady)"
  if (text.includes('Liczba dost') && text.includes('Kurs')) return 'portfolio'
  // Also catch un-decoded or partial strings (fallback)
  if (text.includes('Papier') && text.includes('Waluta') && !text.includes('Stan')) return 'portfolio'

  // Order history: unique column "Liczba zrealizowana"
  if (text.includes('Liczba zrealizowana') || text.includes('Historia zlece')) return 'order_history'
  if (text.includes('Stan') && text.includes('Papier') && text.includes('K/S')) return 'order_history'

  return 'unknown'
}

// ─────────────────────────────────────────
// Portfolio parser
// ─────────────────────────────────────────

/**
 * Parse an eMakler portfolio snapshot CSV (CP1250-encoded, semicolon-separated).
 *
 * Expected column-header row (after metadata block):
 *   Papier;Giełda;Liczba dostępna (Blokady);Kurs;Waluta;Wartość;Waluta
 *
 * Stops before the "Łączna wycena papierów" total line.
 */
export async function parseEMaklerPortfolio(file: File): Promise<EMaklerPortfolioRow[]> {
  const text = await readCP1250(file)
  const lines = text.split('\n')

  // Find the header row: starts with "Papier" and contains "Kurs"
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.startsWith('Papier') && t.includes('Kurs')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    throw new Error('Portfolio file: cannot find column header row (expected "Papier;Giełda;…")')
  }

  const headers = splitSemi(lines[headerIdx])

  // Locate column indices by header content
  const iName  = headers.findIndex((h) => h === 'Papier')
  const iXchg  = headers.findIndex((h) => h.startsWith('Gie'))  // Giełda
  const iQty   = headers.findIndex((h) => h.startsWith('Liczba'))
  const iPrice = headers.findIndex((h) => h === 'Kurs')
  const iVal   = headers.findIndex((h) => h.startsWith('Warto'))  // Wartość

  // There are TWO "Waluta" columns: index[0] = price currency, index[1] = value currency (PLN)
  const walutaIdxs = headers.reduce<number[]>((acc, h, i) => {
    if (h === 'Waluta') acc.push(i)
    return acc
  }, [])
  const iWaluta = walutaIdxs[0] ?? -1

  const rows: EMaklerPortfolioRow[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Stop at the totals line
    if (
      line.startsWith('\u0141\u0105czna') || // Łączna (after decode)
      line.startsWith('Razem') ||
      line.startsWith('Suma')
    ) break

    const cells = splitSemi(line)
    if (cells.length < 5) continue

    const name       = (iName  >= 0 ? cells[iName]  : cells[0]).trim()
    const rawXchg    = (iXchg  >= 0 ? cells[iXchg]  : cells[1]).trim()
    const rawQty     = iQty    >= 0 ? cells[iQty]    : cells[2]
    const rawPrice   = iPrice  >= 0 ? cells[iPrice]  : cells[3]
    const waluta     = (iWaluta >= 0 ? cells[iWaluta] : cells[4]).trim()
    const rawVal     = iVal    >= 0 ? cells[iVal]     : cells[5]

    if (!name) continue

    const quantity     = toFloat(rawQty)
    const currentPrice = toFloat(rawPrice)
    const totalValuePLN = toFloat(rawVal)

    if (isNaN(quantity) || isNaN(currentPrice)) continue

    rows.push({
      name,
      exchange: normalizeEMaklerExchange(rawXchg),
      quantity,
      currentPrice,
      priceCurrency: waluta || 'PLN',
      totalValuePLN: isNaN(totalValuePLN) ? 0 : totalValuePLN,
    })
  }

  return rows
}

// ─────────────────────────────────────────
// Order history parser
// ─────────────────────────────────────────

/**
 * Parse an eMakler order-history CSV (CP1250-encoded, semicolon-separated).
 *
 * Expected column-header row (after metadata block):
 *   Stan;Papier;Giełda;K/S;Liczba zlecona;Liczba zrealizowana;Limit ceny;Waluta;Limit aktywacji;Data zlecenia
 *
 * Only rows where Stan === 'Zrealizowane' (executed) are returned.
 * K = buy, S = sell.
 * Decimal separator in "Limit ceny" is comma — normalised to period.
 */
export async function parseEMaklerOrderHistory(file: File): Promise<EMaklerOrderRow[]> {
  const text = await readCP1250(file)
  const lines = text.split('\n')

  // Find header row: starts with "Stan" and contains "Papier"
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.startsWith('Stan') && t.includes('Papier')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    throw new Error('Order history file: cannot find column header row (expected "Stan;Papier;…")')
  }

  const headers = splitSemi(lines[headerIdx])

  function hIdx(fragment: string): number {
    return headers.findIndex((h) => h.includes(fragment))
  }

  const iStan    = hIdx('Stan')     // e.g. 'Zrealizowane'
  const iPapier  = hIdx('Papier')
  const iGielda  = hIdx('gie')      // Giełda — might decode differently
  const iKS      = hIdx('K/S')
  const iZlec    = hIdx('zlecona')
  const iZreal   = hIdx('zrealizowana')
  const iLimit   = hIdx('Limit ceny')
  const iWaluta  = hIdx('Waluta')
  const iData    = hIdx('Data')

  const rows: EMaklerOrderRow[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cells = splitSemi(line)
    if (cells.length < 8) continue

    const stan = (iStan >= 0 ? cells[iStan] : cells[0]).trim()
    if (stan !== 'Zrealizowane') continue

    const name            = (iPapier >= 0 ? cells[iPapier]  : cells[1]).trim()
    const rawXchg         = (iGielda >= 0 ? cells[iGielda]  : cells[2]).trim()
    const ks              = (iKS     >= 0 ? cells[iKS]      : cells[3]).trim()
    const rawQtyOrdered   = iZlec  >= 0 ? cells[iZlec]  : cells[4]
    const rawQtyExec      = iZreal >= 0 ? cells[iZreal] : cells[5]
    const rawPrice        = iLimit >= 0 ? cells[iLimit] : cells[6]
    const currency        = (iWaluta >= 0 ? cells[iWaluta] : cells[7]).trim()
    const rawDate         = (iData  >= 0 ? cells[iData]  : cells[9]).trim()

    if (!name) continue

    const side: 'buy' | 'sell' = ks === 'K' ? 'buy' : 'sell'
    const quantityOrdered   = toFloat(rawQtyOrdered)
    const quantityExecuted  = toFloat(rawQtyExec)
    const price             = toFloat(rawPrice)
    const date              = parseDDMMYYYY(rawDate)

    if (isNaN(quantityExecuted) || isNaN(price) || !date) continue

    const exchange = normalizeEMaklerExchange(rawXchg)
    const deduplicationKey = `${name}|${exchange}|${date}|${quantityExecuted}|${price}`

    rows.push({
      name,
      exchange,
      side,
      quantityOrdered: isNaN(quantityOrdered) ? quantityExecuted : quantityOrdered,
      quantityExecuted,
      price,
      currency: currency || 'PLN',
      date,
      deduplicationKey,
    })
  }

  return rows
}
