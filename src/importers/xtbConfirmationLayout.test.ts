/**
 * Layout-level regression tests for the XTB confirmation parser.
 *
 * The real statements can't be committed (they carry a name and account
 * number), so these rebuild the layout `extractPDFLayout` produces for one —
 * cell text and relative positions taken from a real KRU fractional-rights
 * confirmation, with the account holder anonymised.
 *
 * This is the only coverage for column assignment, continuation merging and
 * Typ-badge classification, so keep it in step with the real document.
 */
import { describe, it, expect, vi } from 'vitest'
import type { LayoutPage } from './pdfText'

vi.mock('./pdfText', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pdfText')>()),
  extractPDFLayout: vi.fn(),
}))

const { extractPDFLayout } = await import('./pdfText')
const { parseXTBConfirmations } = await import('./xtbConfirmationParser')

/** Columns are evenly spaced; only their order and relative position matter. */
const COL = (i: number) => i * 100

const TABLE_HEADERS = [
  'Nr', 'Numer zlecenia', 'Symbol, którego', 'Nazwa', 'System', 'Typ', 'Wolumen',
  'Data i czas', 'Zlecenie', 'Cena', 'Cena całkowita', 'Klasa aktywów', 'Waluta',
  'Kurs', 'Koszty', 'Prowizja', 'Łączne koszty',
]

const STATEMENT_LABELS = [
  'Imię i nazwisko', 'Konto', 'Waluta rachunku', 'Saldo', 'Wartość konta',
  'Wartość OMI i Praw ułamkowych', 'Depozyt zabezpieczający', 'Wolne środki',
]
const STATEMENT_VALUES = [
  'Anonymous', '50797751', 'PLN', '51,41', '7 399,89', '7 348,48', '0,00', '51,41',
]

const cells = (texts: (string | null)[]) =>
  texts.flatMap((text, i) => (text == null ? [] : [{ text, pos: COL(i) }]))

/** Ink colours sampled from real badges: XTB draws Kupno green. */
const GREEN: [number, number, number] = [0, 168, 80]
const RED: [number, number, number] = [220, 40, 40]

function statementPage(badge: [number, number, number] | null): LayoutPage {
  return {
    lines: [
      { cross: 0, cells: cells(STATEMENT_LABELS) },
      { cross: 10, cells: cells(STATEMENT_VALUES) },
      { cross: 100, cells: cells(TABLE_HEADERS) },
      // Data row — note the Typ cell (index 5) is absent: it is a raster badge.
      {
        cross: 200,
        cells: cells([
          '1', '2802219889', 'KRU.PL', 'KRUK SA', 'XTB', null, '0,2500',
          '08.09.2026', 'rynkowe', '396,50000', '99,12500', 'Prawa ułamkowe',
          'PLN', '1.0000', '0,00', '0,00', '0,00',
        ]),
      },
      // Continuation: the time wraps under the date, "dot. akcji" under the class.
      {
        cross: 208,
        cells: [
          { text: '09:02:54', pos: COL(7) },
          { text: 'dot. akcji', pos: COL(11) },
        ],
      },
    ],
    images: badge ? [{ pos: COL(5), cross: 200, inkRGB: badge }] : [],
  }
}

const file = (name = 'statement.pdf') => new File([''], name, { type: 'application/pdf' })

function mockPages(...pages: LayoutPage[][]) {
  const fn = vi.mocked(extractPDFLayout)
  fn.mockReset()
  for (const p of pages) fn.mockResolvedValueOnce(p)
}

describe('parseXTBConfirmations, layout level', () => {
  it('reads every column of a fractional-rights purchase', async () => {
    mockPages([statementPage(GREEN)])
    const { trades, warnings, statement } = await parseXTBConfirmations([file()])

    expect(warnings).toEqual([])
    expect(statement.freeCash).toBe(51.41)
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      direction: 'buy',
      orderNo: '2802219889',
      ticker: 'KRU',
      exchange: 'PL',
      instrument: 'KRUK SA',
      quantity: 0.25,
      unitPriceOriginal: 396.5,
      currency: 'PLN',
      fxRate: 1,
      totalCosts: 0,
      grossPLN: 99.125,
      // Merged from the continuation line.
      date: '2026-09-08T09:02:54.000Z',
    })
  })

  it('classifies a red Typ badge as a sale', async () => {
    mockPages([statementPage(RED)])
    const { trades } = await parseXTBConfirmations([file()])
    expect(trades[0].direction).toBe('sell')
  })

  it('leaves direction unset when there is no readable badge', async () => {
    mockPages([statementPage(null)])
    const { trades } = await parseXTBConfirmations([file()])
    expect(trades[0].direction).toBeNull()
  })

  it('leaves direction unset when the badge is a colour it cannot read', async () => {
    mockPages([statementPage([128, 128, 128])])
    const { trades } = await parseXTBConfirmations([file()])
    expect(trades[0].direction).toBeNull()
  })

  it('deduplicates the same order across re-dropped files', async () => {
    mockPages([statementPage(GREEN)], [statementPage(GREEN)])
    const { trades, warnings } = await parseXTBConfirmations([file('a.pdf'), file('b.pdf')])

    expect(trades).toHaveLength(1)
    // The second file contributed no new rows, and says so.
    expect(warnings).toEqual([
      { fileName: 'b.pdf', message: 'No executed orders found in this statement.' },
    ])
  })

  it('warns instead of throwing when a file has no table', async () => {
    mockPages([{ lines: [{ cross: 0, cells: cells(['Nothing here']) }], images: [] }])
    const { trades, warnings } = await parseXTBConfirmations([file('empty.pdf')])

    expect(trades).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toMatch(/No executed orders/)
  })
})
