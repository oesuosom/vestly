/**
 * Parser for Revolut BTC transaction PDFs.
 *
 * Handles four PDF types:
 *   1. Statement "Exchanged to BTC"  → type: 'buy'  + type: 'fee'
 *   2. Statement "Exchanged to PLN"  → type: 'sell' + type: 'fee'
 *   3. Transfer Confirmation (Recipient present) → type: 'send'
 *   4. Transfer Confirmation (Sender present)    → type: 'receive'
 *
 * For sells: fiat amount = gross proceeds (before fee); fiat amount (inc. fees) = net received.
 * For receives: amountPLN is left as 0 by the parser; the wizard will patch it after
 * prompting the user for a cost basis.
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

export type BtcParseResult = {
  transactions: Transaction[]
  skipped: number
  warnings: ParseWarning[]
  /** Quantity breakdown for checksum display in preview step. */
  buyQty: number
  sellQty: number
  sendQty: number
  receiveQty: number
}

// ─────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4,  Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}

function parseMDY(month: string, day: string, year: string): string {
  const m = MONTH_MAP[month]
  const d = parseInt(day, 10)
  const y = parseInt(year, 10)
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00.000Z`
}

// ─────────────────────────────────────────
// PDF classification
// ─────────────────────────────────────────

type PdfKind = 'buy' | 'sell' | 'send' | 'receive'

function classifyPdfText(text: string): PdfKind | null {
  if (/Transfer\s+Confirmation/i.test(text)) {
    // "NameRecipient..." / "NameSender..." — no space before keyword, so no \b
    if (/Recipient/i.test(text)) return 'send'
    if (/Sender/i.test(text))    return 'receive'
    return null
  }
  if (/Exchanged\s+to\s+BTC/i.test(text))  return 'buy'
  if (/Exchanged\s+to\s+PLN/i.test(text))  return 'sell'
  return null
}

// ─────────────────────────────────────────
// Per-type parsers
// ─────────────────────────────────────────

interface BuyFields {
  date: string
  btcQty: number
  netFiatPLN: number
  feePLN: number
}

function parseBuy(text: string): BuyFields | null {
  // Date on the same line as "Exchanged to BTC", or within 200 chars before it
  const txLineMatch = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})[^\n]*Exchanged\s+to\s+BTC/,
  )
  const fallbackMatch = !txLineMatch
    ? text.match(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b(?=[\s\S]{0,200}Exchanged\s+to\s+BTC)/,
      )
    : null
  const dateMatch = txLineMatch ?? fallbackMatch
  if (!dateMatch) return null
  const date = parseMDY(dateMatch[1], dateMatch[2], dateMatch[3])

  // BTC quantity: Money out column — always 8 decimal places in Revolut statements.
  // The balance number follows immediately (no separator), so cap at 8 decimal places
  // to avoid merging the two numbers e.g. "0.001583450.00158345" → "0.00158345".
  const qtyMatch = text.match(/Exchanged\s+to\s+BTC\s*(\d+\.\d{8})/)
  if (!qtyMatch) return null
  const btcQty = parseFloat(qtyMatch[1])
  if (isNaN(btcQty) || btcQty <= 0) return null

  // Net fiat PLN (before fee line). Use \s* — no space between "amount" and the number
  // in BTC PDFs (unlike ETH PDFs which have a space).
  const beforeFee = text.split(/\bFee:/)[0]
  const netMatch = beforeFee.match(/fiat\s+amount\s*([\d,.]+)\s*PLN/)
  if (!netMatch) return null
  const netFiatPLN = parseFloat(netMatch[1].replace(/,/g, ''))
  if (isNaN(netFiatPLN) || netFiatPLN <= 0) return null

  // Fee
  const feeMatch = text.match(/\bFee:\s*([\d,.]+)\s*PLN/)
  if (!feeMatch) return null
  const feePLN = parseFloat(feeMatch[1].replace(/,/g, ''))
  if (isNaN(feePLN) || feePLN < 0) return null

  return { date, btcQty, netFiatPLN, feePLN }
}

interface SellFields {
  date: string
  btcQty: number
  grossProceedsPLN: number
  feePLN: number
}

function parseSell(text: string): SellFields | null {
  // Date on the same line as "Exchanged to PLN", or within 200 chars before it
  const txLineMatch = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})[^\n]*Exchanged\s+to\s+PLN/,
  )
  const fallbackMatch = !txLineMatch
    ? text.match(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b(?=[\s\S]{0,200}Exchanged\s+to\s+PLN)/,
      )
    : null
  const dateMatch = txLineMatch ?? fallbackMatch
  if (!dateMatch) return null
  const date = parseMDY(dateMatch[1], dateMatch[2], dateMatch[3])

  // BTC quantity: Money out column — cap at 8 decimal places (same reason as parseBuy).
  const qtyMatch = text.match(/Exchanged\s+to\s+PLN\s*(\d+\.\d{8})/)
  if (!qtyMatch) return null
  const btcQty = parseFloat(qtyMatch[1])
  if (isNaN(btcQty) || btcQty <= 0) return null

  // Gross proceeds: "fiat amount NNN PLN" (before "Fee:"). Use \s* (no space in BTC PDFs).
  const beforeFee = text.split(/\bFee:/)[0]
  const grossMatch = beforeFee.match(/fiat\s+amount\s*([\d,.]+)\s*PLN/)
  if (!grossMatch) return null
  const grossProceedsPLN = parseFloat(grossMatch[1].replace(/,/g, ''))
  if (isNaN(grossProceedsPLN) || grossProceedsPLN <= 0) return null

  // Fee
  const feeMatch = text.match(/\bFee:\s*([\d,.]+)\s*PLN/)
  if (!feeMatch) return null
  const feePLN = parseFloat(feeMatch[1].replace(/,/g, ''))
  if (isNaN(feePLN) || feePLN < 0) return null

  return { date, btcQty, grossProceedsPLN, feePLN }
}

interface TransferFields {
  date: string
  btcQty: number
}

function parseTransfer(text: string): TransferFields | null {
  // Log extracted text in dev so regex issues are easy to spot in the console.
  if (import.meta.env.DEV) {
    console.debug('[BTC Transfer] pdfjs extracted text:\n', text)
  }

  // ── Date ──────────────────────────────────────────────────────────────────
  // The document generation date uses "Mar 14, 2026" (non-ISO), so the only
  // YYYY-MM-DD date in the document is the Value Date we want.
  //
  // The two-column PDF layout may put the label on one line and the value on
  // the next, so we first try "Value Date" with optional whitespace/newline,
  // then fall back to any YYYY-MM-DD anywhere in the document.
  let dateStr: string | undefined
  const valueDateMatch = text.match(/Value\s*Date[\s\S]{0,10}?(\d{4}-\d{2}-\d{2})/)
  if (valueDateMatch) {
    dateStr = valueDateMatch[1]
  } else {
    dateStr = text.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  }
  if (!dateStr) return null
  const date = `${dateStr}T00:00:00.000Z`

  // ── BTC amount ────────────────────────────────────────────────────────────
  // Three-tier fallback because the layout varies:
  //   1. "Transfer details" immediately followed by the number (same line)
  //   2. "Amount" immediately followed by the number (same line)
  //   3. Any 0.XXXXXXXX decimal in the document — BTC amounts are always
  //      between 0.000001 and 1, and the only such numbers in these PDFs
  //      are the transfer quantity itself.
  let btcQty = NaN

  const tdMatch = text.match(/Transfer\s+details[\s\S]{0,20}?(0\.\d+)/)
  if (tdMatch) btcQty = parseFloat(tdMatch[1])

  if (!(btcQty > 0)) {
    const amtMatch = text.match(/Amount[\s\S]{0,20}?(0\.\d+)/)
    if (amtMatch) btcQty = parseFloat(amtMatch[1])
  }

  if (!(btcQty > 0)) {
    // Last resort: first small decimal that looks like a BTC quantity
    const allMatches = [...text.matchAll(/(0\.\d{5,10})/g)].map(m => parseFloat(m[1]))
    btcQty = allMatches.find(n => n > 0 && n < 1) ?? NaN
  }

  if (!(btcQty > 0)) return null

  return { date, btcQty }
}

// ─────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────

/**
 * Parse multiple Revolut BTC PDFs (both statement and transfer confirmation formats).
 *
 * Per buy PDF:     type:'buy' + type:'fee'
 * Per sell PDF:    type:'sell' + type:'fee'
 * Per send PDF:    type:'send'  (amountPLN: 0)
 * Per receive PDF: type:'receive' (amountPLN: 0 — wizard will prompt for cost basis)
 *
 * @param files                 PDF File objects
 * @param accountId             Target account
 * @param existingExternalIds   externalIds already in the store (for deduplication)
 */
export async function parseRevolutBtcPDFs(
  files: File[],
  accountId: string,
  existingExternalIds: Set<string>,
): Promise<BtcParseResult> {
  const transactions: Transaction[] = []
  const warnings: ParseWarning[] = []
  let skipped = 0
  let buyQty = 0
  let sellQty = 0
  let sendQty = 0
  let receiveQty = 0
  const now = new Date().toISOString()

  for (const file of files) {
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

    const kind = classifyPdfText(text)
    if (!kind) {
      warnings.push({
        fileName: file.name,
        message: 'Could not classify PDF. Expected a BTC statement or Transfer Confirmation.',
      })
      continue
    }

    // ── BUY ──────────────────────────────
    if (kind === 'buy') {
      const parsed = parseBuy(text)
      if (!parsed) {
        warnings.push({ fileName: file.name, message: 'Could not parse BTC buy transaction fields.' })
        continue
      }
      const { date, btcQty, netFiatPLN, feePLN } = parsed
      buyQty += btcQty

      const date10 = date.slice(0, 10)
      const buyId  = `revolut-btc-${date10}-${btcQty}-${netFiatPLN}`
      const feeId  = `revolut-btc-fee-${date10}-${btcQty}`

      if (existingExternalIds.has(buyId) && existingExternalIds.has(feeId)) {
        skipped++
        continue
      }

      if (!existingExternalIds.has(buyId)) {
        transactions.push({
          id: uuidv4(),
          accountId,
          type: 'buy',
          date,
          amountPLN: -netFiatPLN,
          instrument: 'Bitcoin',
          ticker: 'BTC',
          quantity: btcQty,
          pricePerUnitPLN: netFiatPLN / btcQty,
          externalId: buyId,
          source: 'revolut_crypto',
          createdAt: now,
        })
      }
      if (!existingExternalIds.has(feeId) && feePLN > 0) {
        transactions.push({
          id: uuidv4(),
          accountId,
          type: 'fee',
          date,
          amountPLN: -feePLN,
          externalId: feeId,
          source: 'revolut_crypto',
          createdAt: now,
        })
      }
      continue
    }

    // ── SELL ─────────────────────────────
    if (kind === 'sell') {
      const parsed = parseSell(text)
      if (!parsed) {
        warnings.push({ fileName: file.name, message: 'Could not parse BTC sell transaction fields.' })
        continue
      }
      const { date, btcQty, grossProceedsPLN, feePLN } = parsed
      sellQty += btcQty

      const date10 = date.slice(0, 10)
      const sellId = `revolut-btc-sell-${date10}-${btcQty}-${grossProceedsPLN}`
      const feeId  = `revolut-btc-sell-fee-${date10}-${btcQty}`

      if (existingExternalIds.has(sellId) && existingExternalIds.has(feeId)) {
        skipped++
        continue
      }

      if (!existingExternalIds.has(sellId)) {
        transactions.push({
          id: uuidv4(),
          accountId,
          type: 'sell',
          date,
          amountPLN: grossProceedsPLN,   // positive = cash inflow (gross, fee recorded separately)
          instrument: 'Bitcoin',
          ticker: 'BTC',
          quantity: btcQty,
          pricePerUnitPLN: grossProceedsPLN / btcQty,
          externalId: sellId,
          source: 'revolut_crypto',
          createdAt: now,
        })
      }
      if (!existingExternalIds.has(feeId) && feePLN > 0) {
        transactions.push({
          id: uuidv4(),
          accountId,
          type: 'fee',
          date,
          amountPLN: -feePLN,
          externalId: feeId,
          source: 'revolut_crypto',
          createdAt: now,
        })
      }
      continue
    }

    // ── SEND ─────────────────────────────
    if (kind === 'send') {
      const parsed = parseTransfer(text)
      if (!parsed) {
        warnings.push({ fileName: file.name, message: 'Could not parse BTC send transfer fields.' })
        continue
      }
      const { date, btcQty } = parsed
      sendQty += btcQty

      const sendId = `revolut-btc-send-${date.slice(0, 10)}-${btcQty}`
      if (existingExternalIds.has(sendId)) {
        skipped++
        continue
      }
      transactions.push({
        id: uuidv4(),
        accountId,
        type: 'send',
        date,
        amountPLN: 0,
        instrument: 'Bitcoin',
        ticker: 'BTC',
        quantity: btcQty,
        externalId: sendId,
        source: 'revolut_crypto',
        createdAt: now,
      })
      continue
    }

    // ── RECEIVE ──────────────────────────
    if (kind === 'receive') {
      const parsed = parseTransfer(text)
      if (!parsed) {
        warnings.push({ fileName: file.name, message: 'Could not parse BTC receive transfer fields.' })
        continue
      }
      const { date, btcQty } = parsed
      receiveQty += btcQty

      const receiveId = `revolut-btc-receive-${date.slice(0, 10)}-${btcQty}`
      if (existingExternalIds.has(receiveId)) {
        skipped++
        continue
      }
      transactions.push({
        id: uuidv4(),
        accountId,
        type: 'receive',
        date,
        amountPLN: 0,  // patched by wizard after user enters cost basis
        instrument: 'Bitcoin',
        ticker: 'BTC',
        quantity: btcQty,
        externalId: receiveId,
        source: 'revolut_crypto',
        createdAt: now,
      })
    }
  }

  return { transactions, skipped, warnings, buyQty, sellQty, sendQty, receiveQty }
}
