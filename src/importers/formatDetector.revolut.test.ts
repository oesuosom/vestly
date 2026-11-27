import { describe, expect, it, vi } from 'vitest'
import { detectFileFormat } from '@/importers/formatDetector'
import { STATEMENT_PAGES } from '@/importers/revolutStatement.fixture'
import type { LayoutPage } from '@/importers/pdfText'

// The PDF reader is replaced by the lines each test file "contains".
const contents = new Map<string, string[][]>()
vi.mock('@/importers/pdfText', () => ({
  extractPDFLayout: async (file: File): Promise<LayoutPage[]> =>
    (contents.get(file.name) ?? []).map((lines) => ({ images: [], lines: lines.map((text, i) => ({ cross: i, cells: [{ text, pos: 0 }] })) })),
}))

const pdf = (name: string, pages: string[][]) => {
  contents.set(name, pages)
  return new File(['%PDF'], name, { type: 'application/pdf' })
}

describe('detecting Revolut’s Crypto Account Statement', () => {
  it('by its content, whatever the file is called', async () => {
    expect(await detectFileFormat(pdf('account-statement_2025-01-01_2025-12-31_en_abc123.pdf', STATEMENT_PAGES))).toEqual({ type: 'revolut_statement' })
    expect(await detectFileFormat(pdf('anything.pdf', STATEMENT_PAGES))).toEqual({ type: 'revolut_statement' })
  })

  it('no longer by the old per-transaction file names', async () => {
    const result = await detectFileFormat(pdf('transaction-statement_00000000-0000-4000-8000-000000000000_en_9d4969.pdf', [['Some other PDF']]))
    expect(result.type).toBe('unsupported')
    expect((await detectFileFormat(pdf('p2p-transaction-confirmation-report_en_3ddaf1.pdf', [['Transfer']]))).type).toBe('unsupported')
  })

  it('still recognises an XTB confirmation', async () => {
    const xtb = pdf('00000000_20260908_DailyStatement.pdf', [['Numer zlecenia Instrument', 'Łączne koszty', 'Wolne środki']])
    expect(await detectFileFormat(xtb)).toEqual({ type: 'xtb_confirmation' })
  })
})
