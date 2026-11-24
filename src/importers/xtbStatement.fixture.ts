/**
 * A synthetic XTB account statement (.xlsx), built in code so the fixture is
 * reviewable. It reproduces the structure of XTB's original export — sheet
 * names, header blocks, header rows, columns and row layout — with made-up
 * instruments, amounts and ids. Nothing here comes from a real account.
 *
 * Test helper only: not imported by app code.
 */
import * as XLSX from 'xlsx'

/** A fake account number, so tests can check it never reaches a parse result. */
export const FAKE_ACCOUNT_NUMBER = '99990001'

/**
 * Excel serial for a UTC time as the CSV shows it, microseconds included:
 * "2026-01-05 14:37:04.277391". Worked out without the code under test.
 */
export function serial(time: string): number {
  const m = time.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/)
  if (!m) throw new Error(`fixture time: ${time}`)
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  const micros = m[7] ? Number(m[7].padEnd(6, '0')) : 0
  return (ms + micros / 1000) / 86_400_000 + 25_569
}

export const CASH_OPERATIONS_HEADER = [
  'Type', 'Instrument', 'Ticker', 'Category', 'Time', 'Amount', 'ID', 'Comment', 'Product', 'Position ID',
] as const

export type CashOpRow = [
  type: string, instrument: string, ticker: string, category: string, time: string,
  amount: number, id: string, comment: string, product: string, positionId: string,
]

const op = (
  type: string, instrument: string, ticker: string, category: string, time: string,
  amount: number, id: string, comment: string, positionId = '',
): CashOpRow => [type, instrument, ticker, category, time, amount, id, comment, 'My Trades', positionId]

/** Newest first, like the export. Every type XTB's current export shows. */
export const CASH_OPERATIONS: CashOpRow[] = [
  op('Free funds interest tax', '', '', '', '2026-03-01 00:05:00', -0.36, '90000013', 'Free-funds Interest Tax 2026-02'),
  op('Free funds interest', '', '', '', '2026-03-01 00:05:00', 1.89, '90000012', 'Free-funds Interest 2026-02'),
  op('Dividend', 'Przyklad SA', 'PRZK.PL', 'STOCK', '2026-02-25 06:00:00', 10, '90000011', 'PRZK.PL PLN 1.0000/ SHR'),
  op('Withholding tax', 'Acme Corp', 'ACME.US', 'STOCK', '2026-02-20 12:00:01.500000', -0.55, '90000010', 'ACME.US USD WHT 15%'),
  op('Dividend', 'Acme Corp', 'ACME.US', 'STOCK', '2026-02-20 12:00:01.500000', 3.66, '90000009', 'ACME.US USD 0.2400/ SHR', '70000002'),
  op('Stock purchase', 'Example Global ETF', 'EXGL.DE', 'ETF', '2026-02-10 09:15:30.123456', -412.5, '90000008', 'OPEN BUY 0.25 @ 400.00', '70000006'),
  op('Stock purchase', 'Sample Holdings', 'SMPL.UK', 'STOCK', '2026-02-09 23:59:59.999600', -51.2, '90000007', 'OPEN BUY SMPL.UK 4 @ 2.50', '70000005'),
  op('Stock purchase', 'Voorbeeld NV', 'VBLD.NL', 'STOCK', '2026-02-06 08:00:00', -86.4, '90000006', 'OPEN BUY 1 @ 20.00', '70000007'),
  op('Stock purchase', 'Przyklad SA', 'PRZK.PL', 'STOCK', '2026-02-05 10:00:00.250000', -105, '90000005', 'OPEN BUY PRZK.PL 10 @ 10.50', '70000004'),
  op('Stock purchase', 'Acme Corp', 'ACME.US', 'STOCK', '2026-01-15 15:30:12.000001', -120.4, '90000004', 'OPEN BUY 3/5 @ 10.00', '70000003'),
  op('Stock purchase', 'Acme Corp', 'ACME.US', 'STOCK', '2026-01-15 15:30:12.000001', -80.27, '90000003', 'OPEN BUY 2/5 @ 10.00', '70000003'),
  op('Stock purchase', 'Acme Corp', 'ACME.US', 'STOCK', '2026-01-05 14:37:04.277391', -80, '90000002', 'OPEN BUY 2 @ 10.00', '70000002'),
  op('Deposit', '', '', '', '2026-01-02 08:00:00', 1100, '90000001',
    'PAYU deposit, PAYU provider transaction id=FAKE-TXN-0001, PAYU, id=FAKE-0002'),
]

export const PERIOD = { from: '2006-01-01 00:00:00', to: '2026-11-20 12:00:00' }

export const CLOSED_POSITIONS_HEADER = [
  'Instrument', 'Ticker', 'Category', 'Type', 'Volume', 'Open Price', 'Open Time (UTC)', 'Close Price',
  'Close Time (UTC)', 'Product', 'Profit/Loss', 'Gross Profit', 'Purchase Value', 'Sale Value', 'Stop Loss',
  'Take Profit', 'Commission', 'Margin', 'Swap', 'Rollover', 'Open Conversion Rate', 'Close Conversion Rate',
  'Close Origin', 'Position ID', 'Comment',
]

export const OPEN_POSITIONS_HEADER = [
  'Product', 'Instrument/Position', 'Ticker', 'Category', 'Type', 'Volume', 'Value', 'Current price',
  'Open price', 'Open time (UTC)', 'Stop Loss', 'Take Profit', 'Net Profit %', 'Net Profit', 'Gross Profit',
  'Margin', 'Open Commission', 'Swap', 'Rollover',
]

type Cell = string | number
type Sheet = { name: string; rows: Cell[][] }

function headerBlock(name: string, third: [string, number], fourth?: [string, number]): Cell[][] {
  return [['Account number', FAKE_ACCOUNT_NUMBER], [name, ''], third, ...(fourth ? [fourth] : [])]
}

/**
 * The Cash Operations sheet saved as CSV by hand. `locale: 'pl'` is what a
 * spreadsheet app set to Polish writes: `;` between fields, decimal commas and
 * non-breaking spaces between thousands.
 */
export function cashOperationsCSV(rows: CashOpRow[] = CASH_OPERATIONS, opts: { locale?: 'en' | 'pl' } = {}): string {
  const pl = opts.locale === 'pl'
  const sep = pl ? ';' : ','
  const num = (n: number) => {
    if (!pl) return String(n)
    const [int, frac] = Math.abs(n).toFixed(2).split('.')
    return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')},${frac}`
  }
  const field = (v: string | number) => {
    const text = typeof v === 'number' ? num(v) : v
    return text.includes(sep) || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text
  }
  const line = (cells: (string | number)[]) => cells.map(field).join(sep)
  return [
    line(['Account number', FAKE_ACCOUNT_NUMBER]),
    line(['Cash Operations', '']),
    line(['Date from (UTC)', PERIOD.from]),
    line(['Date to (UTC)', PERIOD.to]),
    line([...CASH_OPERATIONS_HEADER]),
    ...rows.map(line),
    line(['Total', '', '', '', '', sumOf(rows)]),
  ].join('\r\n')
}

export function closedPositionsSheet(): Sheet {
  const summary: Cell[] = CLOSED_POSITIONS_HEADER.map((h, i) => (i === 0 ? 'Profit/loss' : h === 'Profit/Loss' ? 0 : ''))
  return {
    name: 'Closed Positions',
    rows: [
      ...headerBlock('Closed Positions', ['Date from (UTC)', serial(PERIOD.from)], ['Date to (UTC)', serial(PERIOD.to)]),
      CLOSED_POSITIONS_HEADER,
      summary,
    ],
  }
}

const sumOf = (rows: CashOpRow[]) => Math.round(rows.reduce((s, r) => s + r[5], 0) * 100) / 100

export function cashOperationsSheet(rows: CashOpRow[] = CASH_OPERATIONS, total?: number): Sheet {
  const sum = total ?? sumOf(rows)
  return {
    name: 'Cash Operations',
    rows: [
      ...headerBlock('Cash Operations', ['Date from (UTC)', serial(PERIOD.from)], ['Date to (UTC)', serial(PERIOD.to)]),
      [...CASH_OPERATIONS_HEADER],
      ...rows.map((r): Cell[] => [...r.slice(0, 4), serial(r[4]), ...r.slice(5)]),
      ['Total', '', '', '', '', sum],
    ],
  }
}

/**
 * One instrument in Open Positions: its summary row's name and category, and
 * its lots. Rates are what the made-up instrument's currency was worth in PLN
 * when the report was generated: a lot's Value is Volume × Current price × rate.
 */
export type OpenPosition = {
  instrument: string
  /** As XTB writes it: "ACME.US". */
  ticker: string
  category: 'STOCK' | 'ETF'
  currentPrice: number
  /** PLN per unit of the instrument's currency at report time. */
  rate: number
  lots: { id: string; volume: number; openPrice: number; openTime: string }[]
}

/**
 * What XTB holds for {@link CASH_OPERATIONS}: every purchase still open, so
 * everything matches. ACME's two purchases were merged by XTB into one position
 * at their weighted-average open price, as it does; per ticker it still adds up.
 */
export const MATCHING_POSITIONS: OpenPosition[] = [
  { instrument: 'Acme Corp', ticker: 'ACME.US', category: 'STOCK', currentPrice: 12, rate: 4,
    lots: [{ id: '70000002', volume: 7, openPrice: 10, openTime: '2026-01-05 14:37:04.277391' }] },
  { instrument: 'Example Global ETF', ticker: 'EXGL.DE', category: 'ETF', currentPrice: 410, rate: 4.25,
    lots: [{ id: '70000006', volume: 0.25, openPrice: 400, openTime: '2026-02-10 09:15:30.123456' }] },
  { instrument: 'Przyklad SA', ticker: 'PRZK.PL', category: 'STOCK', currentPrice: 11, rate: 1,
    lots: [{ id: '70000004', volume: 10, openPrice: 10.5, openTime: '2026-02-05 10:00:00.250000' }] },
  // A ".UK" ticker priced in USD: its currency shows only in Value ÷ (Volume × Current price).
  { instrument: 'Sample Holdings', ticker: 'SMPL.UK', category: 'STOCK', currentPrice: 2.6, rate: 4,
    lots: [{ id: '70000005', volume: 4, openPrice: 2.5, openTime: '2026-02-09 23:59:59.999600' }] },
  { instrument: 'Voorbeeld NV', ticker: 'VBLD.NL', category: 'STOCK', currentPrice: 21, rate: 4.25,
    lots: [{ id: '70000007', volume: 1, openPrice: 20, openTime: '2026-02-06 08:00:00' }] },
]

/** Purchases of two more instruments, for the statement whose holdings differ. */
export const DIFFERENCES_CASH_OPERATIONS: CashOpRow[] = [
  op('Stock purchase', 'Foo Industries', 'FOOI.US', 'STOCK', '2026-02-12 14:00:00', -200, '90000015', 'OPEN BUY 5 @ 10.00', '70000011'),
  op('Stock purchase', 'Muster AG', 'MUST.DE', 'STOCK', '2026-02-11 09:30:00', -255, '90000014', 'OPEN BUY 5 @ 12.00', '70000010'),
  ...CASH_OPERATIONS,
]

/**
 * What XTB holds for {@link DIFFERENCES_CASH_OPERATIONS}. Four instruments
 * match (ACME merged); four don't:
 *   - SPIN.US: free shares from a spin-off, open price 0, no Cash Operations row.
 *   - SMPL.UK: XTB holds 2 more, from a lot bought before the file's purchases.
 *   - MUST.DE: XTB holds 2 fewer (a sale the file doesn't have).
 *   - FOOI.US: bought in the file, gone at XTB.
 */
export const DIFFERENCES_POSITIONS: OpenPosition[] = [
  ...MATCHING_POSITIONS.filter((p) => p.ticker !== 'SMPL.UK'),
  { instrument: 'Sample Holdings', ticker: 'SMPL.UK', category: 'STOCK', currentPrice: 2.6, rate: 4,
    lots: [
      { id: '70000005', volume: 4, openPrice: 2.5, openTime: '2026-02-09 23:59:59.999600' },
      { id: '70000009', volume: 2, openPrice: 2.4, openTime: '2026-01-20 13:00:00' },
    ] },
  { instrument: 'Spinco Example', ticker: 'SPIN.US', category: 'STOCK', currentPrice: 5, rate: 4,
    lots: [{ id: '70000012', volume: 3, openPrice: 0, openTime: '2026-02-16 05:00:00' }] },
  { instrument: 'Muster AG', ticker: 'MUST.DE', category: 'STOCK', currentPrice: 13, rate: 4.25,
    lots: [{ id: '70000010', volume: 3, openPrice: 12, openTime: '2026-02-11 09:30:00' }] },
]

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The Open Positions sheet as XTB's export lays it out: the header block, a
 * small summary table in the account currency, a note, then the header row
 * and one summary row per instrument followed by its lots. A summary row has
 * the instrument's name, its category and the total volume, with an empty
 * Type and Current price; a lot has its position id, Type "BUY", no category,
 * and typed numbers.
 */
export function openPositionsSheet(currency = 'PLN', positions: OpenPosition[] = MATCHING_POSITIONS): Sheet {
  const rows: Cell[][] = []
  for (const p of positions) {
    const lots = p.lots.map((l) => {
      const value = round2(l.volume * p.currentPrice * p.rate)
      const gross = round2((p.currentPrice - l.openPrice) * l.volume * p.rate)
      return { ...l, value, gross }
    })
    const sum = (f: (l: (typeof lots)[number]) => number) => round2(lots.reduce((s, l) => s + f(l), 0))
    const volume = Math.round(lots.reduce((s, l) => s + l.volume, 0) * 1e8) / 1e8
    rows.push(['My Trades', p.instrument, p.ticker, p.category, '', volume, sum((l) => l.value), '', '', '', '', '', '',
      sum((l) => l.gross), sum((l) => l.gross), 0, 0, 0, 0])
    for (const l of lots) {
      const cost = l.volume * l.openPrice * p.rate
      rows.push(['My Trades', l.id, p.ticker, '', 'BUY', l.volume, l.value, p.currentPrice, l.openPrice, serial(l.openTime),
        '', '', cost > 0 ? round2((l.gross / cost) * 100) : 0, l.gross, l.gross, 0, 0, 0, 0])
    }
  }
  const total = round2(rows.filter((r) => r[4] === 'BUY').reduce((s, r) => s + (r[6] as number), 0))
  return {
    name: 'Open Positions',
    rows: [
      ['Account number', FAKE_ACCOUNT_NUMBER],
      ['Open Positions', ''],
      ['Data as of report generated', serial(PERIOD.to)],
      ['Product', 'Metric', 'Amount', 'Currency'],
      ['My Trades', 'Open position value', total, currency],
      ['My Trades', 'Open position profit', 12.34, currency],
      [],
      ['Note', 'Summary values and open positions are shown as of the report generation time'],
      OPEN_POSITIONS_HEADER,
      ...rows,
    ],
  }
}

/** The statement whose holdings differ from XTB's: see {@link DIFFERENCES_POSITIONS}. */
export function differencesStatementSheets(): Sheet[] {
  return [closedPositionsSheet(), cashOperationsSheet(DIFFERENCES_CASH_OPERATIONS), openPositionsSheet('PLN', DIFFERENCES_POSITIONS)]
}

export type StatementOptions = {
  /** Sheets in file order. Default: XTB's order. */
  sheets?: Sheet[]
  /** Write the zip with data descriptors, as XTB's export is. Default true. */
  dataDescriptors?: boolean
}

/** The statement as .xlsx bytes. */
export function xtbStatementXLSX(opts: StatementOptions = {}): Uint8Array<ArrayBuffer> {
  const sheets = opts.sheets ?? [closedPositionsSheet(), cashOperationsSheet(), openPositionsSheet()]
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    // Give date cells a date format, as the export does. SheetJS still reads them back as plain
    // serial numbers with no format exposed, which is what the importer has to handle.
    for (const [addr, cell] of Object.entries(ws)) {
      if (addr.startsWith('!') || typeof cell.v !== 'number') continue
      if (cell.v > 30_000 && cell.v < 80_000 && !Number.isInteger(cell.v * 100)) cell.z = 'yyyy-mm-dd hh:mm:ss'
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer)
  return opts.dataDescriptors === false ? bytes : withDataDescriptors(bytes)
}

export function xtbStatementFile(name = 'PLN_statement.xlsx', opts: StatementOptions = {}): File {
  return new File([xtbStatementXLSX(opts)], name)
}

/**
 * Rewrite a zip so every entry uses a data descriptor: sizes and CRC zeroed in
 * the local header (flag bit 3) and written after the data instead, with 8-byte
 * sizes. That matches what SheetJS reports reading XTB's export ("Bad
 * uncompressed size: N != 0", logged with console.error; the data still reads).
 */
export function withDataDescriptors(zip: Uint8Array): Uint8Array<ArrayBuffer> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let eocd = zip.length - 22
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--
  const count = view.getUint16(eocd + 10, true)
  const cdOffset = view.getUint32(eocd + 16, true)

  const out: number[] = []
  const push = (bytes: Uint8Array) => { for (const b of bytes) out.push(b) }
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]

  const central: Uint8Array[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const entryLen = 46 + nameLen + extraLen + commentLen
    const entry = zip.slice(p, p + entryLen)
    const crc = view.getUint32(p + 16, true)
    const csz = view.getUint32(p + 20, true)
    const usz = view.getUint32(p + 24, true)
    const local = view.getUint32(p + 42, true)
    const localNameLen = view.getUint16(local + 26, true)
    const localExtraLen = view.getUint16(local + 28, true)
    const header = zip.slice(local, local + 30 + localNameLen + localExtraLen)
    const hv = new DataView(header.buffer)
    hv.setUint16(6, hv.getUint16(6, true) | 8, true)
    hv.setUint32(14, 0, true)
    hv.setUint32(18, 0, true)
    hv.setUint32(22, 0, true)
    const ev = new DataView(entry.buffer)
    ev.setUint16(8, ev.getUint16(8, true) | 8, true)
    ev.setUint32(42, out.length, true)
    push(header)
    const dataStart = local + header.length
    push(zip.subarray(dataStart, dataStart + csz))
    // ZIP64-sized descriptor (8-byte sizes). SheetJS reads 4-byte ones, so it takes the
    // high half of the compressed size as the uncompressed size: "Bad uncompressed size: N != 0".
    out.push(...u32(0x08074b50), ...u32(crc), ...u32(csz), ...u32(0), ...u32(usz), ...u32(0))
    central.push(entry)
    p += entryLen
  }
  const newCd = out.length
  for (const e of central) push(e)
  const cdSize = out.length - newCd
  out.push(...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(cdSize), ...u32(newCd), ...u16(0))
  return new Uint8Array(out)
}
