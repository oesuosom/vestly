/**
 * Parser for Revolut individual crypto transaction statement PDFs.
 *
 * Each PDF is a single-transaction statement ("Exchanged to ETH") with:
 *   - Transaction date
 *   - ETH quantity received (net of fees)
 *   - Fiat amount in PLN (net, excluding fee) — used as cost basis
 *   - Fee in PLN — stored as a separate 'fee' transaction
 *
 * Per PDF this produces two Transaction records:
 *   1. type: 'buy'  — amountPLN = -(netFiatPLN)
 *   2. type: 'fee'  — amountPLN = -(feePLN)
 */
import { extractPDFText } from './pdfText'
import { v4 as uuidv4 } from 'uuid'
import type { Transaction } from '@/types'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type ParseWarning = {
  fileName: string
  message: string
}

export type ParseResult = {
  transactions: Transaction[]
  /** Count of buy+fee pairs skipped because their externalIds already exist in the store. */
  skipped: number
  warnings: ParseWarning[]
  /**
   * Total ETH quantity across all successfully parsed PDFs (including already-imported ones).
   * Used for checksum validation in the preview step.
   */
  totalEthFromPDFs: number
}

interface RevolutTransaction {
  date: string      // ISO datetime e.g. "2021-01-28T00:00:00.000Z"
  ethQty: number
  netFiatPLN: number
  feePLN: number
}

// ─────────────────────────────────────────
// Date parsing helpers
// ─────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4,  Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

// ─────────────────────────────────────────
// Transaction parsing
// ─────────────────────────────────────────

/**
 * Parse a Revolut transaction statement text into structured data.
 * Returns null if any required field is missing.
 */
function parseRevolutText(text: string): RevolutTransaction | null {
  // 1. Date: find the date on the same line as "Exchanged to ETH" (the transaction row).
  //    This avoids picking up the statement generation date that appears in the header.
  //    The transaction row looks like: "Jan 28, 2021  Exchanged to ETH  0.003... ETH  0.003... ETH"
  const txLineMatch = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})[^\n]*Exchanged\s+to\s+ETH/,
  )
  // Fallback: if the date and description landed on separate lines (pdfjs column splitting),
  // find the date in the 200 characters immediately preceding "Exchanged to ETH".
  const fallbackMatch = !txLineMatch
    ? text.match(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b(?=[\s\S]{0,200}Exchanged\s+to\s+ETH)/,
      )
    : null
  const dateMatch = txLineMatch ?? fallbackMatch
  if (!dateMatch) return null
  const month = MONTH_MAP[dateMatch[1]]
  const day = parseInt(dateMatch[2], 10)
  const year = parseInt(dateMatch[3], 10)
  const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`

  // 2. ETH quantity: Revolut renders ETH amounts with the Ξ symbol (U+039E).
  //    The transaction row is: "Jan 28, 2021 Exchanged to ETH Ξ0.00387433 Ξ0.00387433"
  //    First Ξ value = buy quantity, second = running balance. We want the first.
  const ethMatch = text.match(/Ξ([\d.]+)/)
  if (!ethMatch) return null
  const ethQty = parseFloat(ethMatch[1])
  if (isNaN(ethQty) || ethQty <= 0) return null

  // 3. Net fiat: "fiat amount 19.49 PLN" — PLN follows the number (not precedes it).
  //    This line precedes the Fee line. Split on "Fee:" to avoid capturing gross amount.
  const beforeFee = text.split(/\bFee:/)[0]
  const netMatch = beforeFee.match(/fiat\s+amount\s+([\d,.]+)\s+PLN/)
  if (!netMatch) return null
  const netFiatPLN = parseFloat(netMatch[1].replace(/,/g, ''))
  if (isNaN(netFiatPLN) || netFiatPLN <= 0) return null

  // 4. Fee: "Fee: 0.49 PLN"
  const feeMatch = text.match(/\bFee:\s*([\d,.]+)\s*PLN/)
  if (!feeMatch) return null
  const feePLN = parseFloat(feeMatch[1].replace(/,/g, ''))
  if (isNaN(feePLN) || feePLN < 0) return null

  return { date: isoDate, ethQty, netFiatPLN, feePLN }
}

// ─────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────

/**
 * Parse multiple Revolut crypto transaction statement PDFs into Transaction objects.
 *
 * Per successfully parsed PDF, produces up to two transactions:
 *   - type: 'buy'  — amountPLN = -(netFiatPLN), cost basis excludes fee
 *   - type: 'fee'  — amountPLN = -(feePLN)
 *
 * @param files                 Array of PDF File objects (one per Revolut statement)
 * @param accountId             Target account for the imported transactions
 * @param existingExternalIds   externalIds already in the store (for deduplication)
 */
export async function parseRevolutCryptoPDFs(
  files: File[],
  accountId: string,
  existingExternalIds: Set<string>,
): Promise<ParseResult> {
  const transactions: Transaction[] = []
  const warnings: ParseWarning[] = []
  let skipped = 0
  let totalEthFromPDFs = 0
  const now = new Date().toISOString()

  for (const file of files) {
    // Extract text from PDF
    let text: string
    try {
      text = await extractPDFText(file)
    } catch (err) {
      warnings.push({
        fileName: file.name,
        message: `Failed to extract PDF text: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    // Parse transaction fields from extracted text
    const parsed = parseRevolutText(text)
    if (!parsed) {
      warnings.push({
        fileName: file.name,
        message:
          'Could not parse transaction data. Verify this is a Revolut crypto transaction statement.',
      })
      continue
    }

    const { date, ethQty, netFiatPLN, feePLN } = parsed

    // Always count ETH quantity for the checksum total, even if already imported
    totalEthFromPDFs += ethQty

    const buyExternalId = `revolut-eth-${date.slice(0, 10)}-${ethQty}-${netFiatPLN}-${feePLN}`
    const feeExternalId = `revolut-eth-fee-${date.slice(0, 10)}-${ethQty}-${feePLN}`

    const buyAlreadyExists = existingExternalIds.has(buyExternalId)
    const feeAlreadyExists = existingExternalIds.has(feeExternalId)

    if (buyAlreadyExists && feeAlreadyExists) {
      skipped++
      continue
    }

    if (!buyAlreadyExists) {
      transactions.push({
        id: uuidv4(),
        accountId,
        type: 'buy',
        date,
        amountPLN: -netFiatPLN,
        instrument: 'Ethereum',
        ticker: 'ETH',
        quantity: ethQty,
        pricePerUnitPLN: netFiatPLN / ethQty,
        externalId: buyExternalId,
        source: 'revolut_crypto',
        createdAt: now,
      })
    }

    if (!feeAlreadyExists && feePLN > 0) {
      transactions.push({
        id: uuidv4(),
        accountId,
        type: 'fee',
        date,
        amountPLN: -feePLN,
        externalId: feeExternalId,
        source: 'revolut_crypto',
        createdAt: now,
      })
    }
  }

  return { transactions, skipped, warnings, totalEthFromPDFs }
}
