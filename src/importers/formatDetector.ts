import { fileToCSVText, isSupportedImportFile, isWorkbookFile, readWorkbook } from './xlsReader'
import { cashOperationsHeaderIndex, detectSeparator, findCashOperationsSheet, splitCSVLine } from './xtbStatement'
import { detectFormat, parseCSVRaw } from './csvParser'
import { detectEMaklerFileType } from './eMaklerParser'
import { extractPDFLayout } from './pdfText'
import { isRevolutStatementText } from './revolutStatement'

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

export type DetectedFormat =
  | { type: 'pko_ike' }
  | { type: 'xtb_transactions' }
  | { type: 'xtb_confirmation' }
  | { type: 'emakler_portfolio' }
  | { type: 'emakler_order_history' }
  | { type: 'revolut_statement' }
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
 * 2. PDFs, by content: Revolut's Crypto Account Statement by its title and
 *    Transactions header, XTB confirmations by their table headers
 * 3. eMakler (CP1250-encoded CSV with characteristic Polish strings)
 * 4. XTB's .xlsx statement: a sheet with the Cash Operations header row, wherever it is
 * 5. Decode to CSV text (handles CSV, and the first sheet of other XLS/XLSX files)
 *    and look for a Cash Operations CSV: its header row, found by names
 * 6. Known holdings formats via csvParser (PKO IKE)
 * 7. Fallback: unknown CSV with extracted headers
 */
export async function detectFileFormat(file: File): Promise<DetectedFormat> {
  // 1. Reject anything we can't read at all
  if (!isSupportedImportFile(file)) {
    return { type: 'unsupported', reason: `Unsupported file type: ${file.name}` }
  }

  // 2. PDFs, recognised by their content. File names are only ids (Revolut's
  //    statement) or too generic to trust (XTB's 00000000_20260908_DailyStatement.pdf).
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const lines = await pdfLines(file)
    if (isRevolutStatementText(lines)) return { type: 'revolut_statement' }
    // XTB daily order confirmation. The document's *title* is rasterised, so
    // we key off the table's column headers, which are real text.
    const text = lines.join(' ')
    if (XTB_CONFIRMATION_MARKERS.every((re) => re.test(text))) return { type: 'xtb_confirmation' }
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

  // 4. XTB's account statement: one workbook with Closed Positions, Cash
  //    Operations and Open Positions sheets. Its Cash Operations sheet is found
  //    by name and header row, not by position.
  if (isWorkbookFile(file)) {
    const workbook = await readWorkbook(file).catch(() => null)
    if (workbook && findCashOperationsSheet(workbook)) return { type: 'xtb_transactions' }
  }

  // 5. Read as CSV text (a CSV, or the first sheet of any other workbook), then
  //    look for a Cash Operations CSV: XTB's, or the sheet saved by hand with
  //    either separator. Its header row names Type, Instrument, Amount and Comment.
  const text = await fileToCSVText(file)
  const lines = text.split(/\r?\n/).slice(0, 20)
  const separator = detectSeparator(lines)
  if (cashOperationsHeaderIndex(lines.map((l) => splitCSVLine(l, separator)), true) >= 0) {
    return { type: 'xtb_transactions' }
  }

  // 6. Try known holdings formats (PKO IKE)
  const { headers } = parseCSVRaw(text)
  const knownFormat = detectFormat(headers)

  if (knownFormat?.id === 'pko_ike') return { type: 'pko_ike' }

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
 * The PDF's text, one string per line, in reading order; empty when it can't
 * be read.
 *
 * Uses the layout extractor because that is what the parsers read next —
 * `extractPDFLayout` memoises per File, so detecting and then importing
 * decodes the PDF once, not twice.
 */
async function pdfLines(file: File): Promise<string[]> {
  try {
    const pages = await extractPDFLayout(file)
    return pages.flatMap((page) => page.lines.map((line) => line.cells.map((c) => c.text).join(' ')))
  } catch {
    return []
  }
}

/**
 * Detect formats for multiple files (supports eMakler's two-file workflow).
 * Returns one DetectedFormat per file, in the same order as input.
 */
export async function detectFileFormats(files: File[]): Promise<DetectedFormat[]> {
  return Promise.all(files.map(detectFileFormat))
}
