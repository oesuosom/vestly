/** File extensions accepted by all import flows. */
export const IMPORT_FILE_ACCEPT = '.csv,.xls,.xlsx,.pdf,application/pdf'

/** Returns true when the file has a supported import extension. */
export function isSupportedImportFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.csv') ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.pdf')
  )
}

/**
 * Read a File (CSV, XLS, or XLSX) and return its first sheet as CSV text.
 *
 * - CSV files are returned as plain text unchanged.
 * - XLS / XLSX files have their first sheet serialised to CSV via SheetJS,
 *   preserving row order and blank rows so that row-index-sensitive parsers
 *   (e.g. the XTB parser that expects headers at row 5) keep working.
 */
export async function fileToCSVText(file: File): Promise<string> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    return file.text()
  }

  // XLS / XLSX path. SheetJS is ~1MB and only ever needed here, so it is loaded
  // on demand rather than shipped in the initial bundle — `IMPORT_FILE_ACCEPT`
  // and `isSupportedImportFile` are imported by UI that must stay cheap.
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // rawNumbers: true outputs raw numeric values (e.g. 5200) instead of locale-formatted
  // display strings (e.g. "5,200.00"), avoiding RFC 4180 quoted fields that confuse the
  // naive comma-split in parseCSVRaw. blankrows defaults to true — keeps row indices stable.
  return XLSX.utils.sheet_to_csv(sheet, { rawNumbers: true })
}
