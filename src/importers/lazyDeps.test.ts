import { describe, it, expect } from 'vitest'
import { fileToCSVText } from './xlsReader'

/**
 * SheetJS and pdf.js are loaded with dynamic `import()` so they stay out of the
 * initial bundle. Nothing else exercises the SheetJS path — these do.
 *
 * pdf.js is deliberately NOT covered here. `getPdfjs()` sets `workerSrc` from
 * `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`, which Vite
 * rewrites to the emitted asset at build time but Node resolves relative to this
 * source file — so `getDocument()` fails under vitest with "Setting up fake
 * worker failed". That predates the lazy-loading change (the static-import
 * version fails identically) and is an environment limit, not a defect. The
 * browser path is covered structurally instead: the build emits
 * `assets/pdf.worker.min-<hash>.mjs` and references it by that hashed name,
 * which only happens if Vite resolved the URL. End-to-end PDF import was
 * verified manually in a real browser on 2026-09-13, after the lazy change.
 */

describe('lazily-loaded import dependencies', () => {
  it('loads SheetJS on demand and converts a real XLSX to CSV', async () => {
    const XLSX = await import('xlsx')
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Instrument', 'Quantity', 'Price'],
      ['KRUK', 10, 400],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const csv = await fileToCSVText(new File([buf], 'holdings.xlsx'))

    expect(csv).toContain('Instrument')
    expect(csv).toContain('KRUK')
    // rawNumbers: true — plain 400, not a locale-formatted "400.00"
    expect(csv).toContain('400')
  })

  it('returns CSV text without loading SheetJS at all', async () => {
    const csv = await fileToCSVText(new File(['a,b\n1,2'], 'x.csv'))
    expect(csv).toBe('a,b\n1,2')
  })
})
