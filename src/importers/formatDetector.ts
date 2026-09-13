import { fileToCSVText, isSupportedImportFile } from './xlsReader'
import { detectFormat, parseCSVRaw } from './csvParser'
import { detectEMaklerFileType } from './eMaklerParser'
import { extractPDFLayout } from './pdfText'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type DetectedFormat =
  | { type: 'pko_ike' }
  | { type: 'xtb_holdings' }
  | { type: 'xtb_transactions' }
  | { type: 'xtb_confirmation' }
  | { type: 'emakler_portfolio' }
  | { type: 'emakler_order_history' }
  | { type: 'revolut_crypto' }
  | { type: 'revolut_btc_transfer' }
  | { type: 'unknown_csv'; headers: string[] }
  | { type: 'unsupported'; reason: string }

export type DetectedFormatType = DetectedFormat['type']

// ─────────────────────────────────────────
// Detection
// ─────────────────────────────────────────

/**
 * Detect the format of an import file by inspecting its contents.
 *
 * Detection order:
 * 1. Reject unsupported extensions outright
 * 2. PDFs — Revolut by filename, XTB confirmations by table headers
 * 3. eMakler (CP1250-encoded CSV with characteristic Polish strings)
 * 4. Decode to CSV text (handles CSV, XLS, XLSX)
 * 5. XTB Cash Operations (metadata rows 1-4, header at row 5)
 * 6. Known holdings formats via csvParser (PKO IKE, XTB holdings)
 * 7. Fallback: unknown CSV with extracted headers
 */
export async function detectFileFormat(file: File): Promise<DetectedFormat> {
  // 1. Reject anything we can't read at all
  if (!isSupportedImportFile(file)) {
    return { type: 'unsupported', reason: `Unsupported file type: ${file.name}` }
  }

  // 2. PDFs — Revolut by filename pattern, XTB confirmations by content
  if (file.name.toLowerCase().endsWith('.pdf')) {
    // BTC send/receive: "Transfer Confirmation" PDFs
    // e.g. p2p-transaction-confirmation-report_en_3ddaf1.pdf
    if (/^p2p-transaction-confirmation-report_/i.test(file.name)) {
      return { type: 'revolut_btc_transfer' }
    }
    // ETH/BTC buy/sell: individual transaction statement PDFs
    // e.g. transaction-statement_00000000-0000-4000-8000-000000000000_en_9d4969.pdf
    if (/^transaction-statement_/i.test(file.name)) {
      return { type: 'revolut_crypto' }
    }
    // XTB daily order confirmation — sniffed by content rather than filename.
    // The filename (50797751_20260908_DailyStatement.pdf) is too generic to
    // trust, and the document's *title* is rasterised, so we key off the table's
    // column headers, which are real text.
    if (await isXTBConfirmation(file)) {
      return { type: 'xtb_confirmation' }
    }
    return { type: 'unsupported', reason: `Unrecognised PDF: ${file.name}` }
  }

  // 3. Try eMakler detection (CP1250-encoded CSVs)
  //    Only check CSV files — eMakler never exports XLS/XLSX
  if (file.name.toLowerCase().endsWith('.csv')) {
    const slice = file.slice(0, 4096)
    const buf = await slice.arrayBuffer()
    const cp1250Text = new TextDecoder('windows-1250').decode(buf)
    const emaklerType = detectEMaklerFileType(cp1250Text)
    if (emaklerType === 'portfolio') return { type: 'emakler_portfolio' }
    if (emaklerType === 'order_history') return { type: 'emakler_order_history' }
  }

  // 4. Read as UTF-8 CSV text (handles CSV, XLS, XLSX)
  const text = await fileToCSVText(file)
  const lines = text.trim().split('\n')

  // 5. Try XTB Cash Operations: header row at line index 4
  //    Expected columns: Type, Instrument, Time, Amount, ID, Comment, Product
  if (lines.length >= 5) {
    const headerLine = lines[4].replace(/"/g, '').trim()
    if (
      headerLine.includes('Type') &&
      headerLine.includes('Instrument') &&
      headerLine.includes('Amount') &&
      headerLine.includes('Comment')
    ) {
      return { type: 'xtb_transactions' }
    }
  }

  // 6. Try known holdings formats (PKO IKE, XTB holdings)
  const { headers } = parseCSVRaw(text)
  const knownFormat = detectFormat(headers)

  if (knownFormat?.id === 'pko_ike') return { type: 'pko_ike' }
  if (knownFormat?.id === 'xtb') return { type: 'xtb_holdings' }

  // 7. Unknown CSV — user will map columns manually
  return { type: 'unknown_csv', headers }
}

/**
 * Markers unique to an XTB order-confirmation table. All three are drawn as
 * real text (unlike the document title and the Kupno/Sprzedaż badge, which are
 * images), so their presence is a reliable signal.
 */
const XTB_CONFIRMATION_MARKERS = [/Numer zlecenia/i, /Łączne koszty/i, /Wolne środki/i]

/**
 * True when the PDF's text layer carries XTB's confirmation table headers.
 *
 * Uses the layout extractor rather than the plain-text one because that is what
 * the parser needs next — `extractPDFLayout` memoises per File, so detecting and
 * then importing decodes the PDF once, not twice.
 */
async function isXTBConfirmation(file: File): Promise<boolean> {
  try {
    const pages = await extractPDFLayout(file)
    const text = pages
      .flatMap((page) => page.lines.flatMap((line) => line.cells.map((c) => c.text)))
      .join(' ')
    return XTB_CONFIRMATION_MARKERS.every((re) => re.test(text))
  } catch {
    return false
  }
}

/**
 * Detect formats for multiple files (supports eMakler's two-file workflow).
 * Returns one DetectedFormat per file, in the same order as input.
 */
export async function detectFileFormats(files: File[]): Promise<DetectedFormat[]> {
  return Promise.all(files.map(detectFileFormat))
}
