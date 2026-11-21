import { describe, it, expect } from 'vitest'
import { findClosedByHandSales, findDuplicateTrade, findDuplicateTradeGroups, findDuplicateTrades } from './tradeDedup'
import type { Transaction } from '@/types'

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'id-1',
    accountId: 'acc-1',
    type: 'buy',
    date: '2026-09-08T09:02:54.000Z',
    amountPLN: -99.125,
    ticker: 'KRU',
    quantity: 0.25,
    externalId: 'xtb-order:1000000001',
    source: 'xtb_confirmation',
    createdAt: '2026-09-08T10:00:00.000Z',
    ...overrides,
  }
}

describe('findDuplicateTrade', () => {
  it('matches the same trade arriving from the other document type', () => {
    // Same purchase, but from the Cash Operations export: different ID space,
    // settlement timestamp a few hours later, sub-grosz rounding.
    const fromCashOps = tx({
      id: 'id-2',
      externalId: '512334455',
      source: 'xtb_import',
      date: '2026-09-08T17:30:00.000Z',
      amountPLN: -99.13,
    })
    expect(findDuplicateTrade(tx(), [fromCashOps])).toBe(fromCashOps)
  })

  it('tolerates a settlement date one day later', () => {
    const next = tx({ id: 'id-2', externalId: 'x', date: '2026-09-09T08:00:00.000Z' })
    expect(findDuplicateTrade(tx(), [next])).toBe(next)
  })

  it('does not match across a two-day gap', () => {
    const later = tx({ id: 'id-2', externalId: 'x', date: '2026-09-10T09:02:54.000Z' })
    expect(findDuplicateTrade(tx(), [later])).toBeNull()
  })

  it('does not match a different quantity, ticker, account or direction', () => {
    expect(findDuplicateTrade(tx(), [tx({ id: '2', externalId: 'x', quantity: 0.5 })])).toBeNull()
    expect(findDuplicateTrade(tx(), [tx({ id: '2', externalId: 'x', ticker: 'CDR' })])).toBeNull()
    expect(findDuplicateTrade(tx(), [tx({ id: '2', externalId: 'x', accountId: 'acc-2' })])).toBeNull()
    expect(
      findDuplicateTrade(tx(), [tx({ id: '2', externalId: 'x', type: 'sell', amountPLN: 99.125 })]),
    ).toBeNull()
  })

  it('does not match a materially different amount', () => {
    expect(findDuplicateTrade(tx(), [tx({ id: '2', externalId: 'x', amountPLN: -105 })])).toBeNull()
  })

  it('ignores rows sharing the candidate externalId — those are exact-ID dupes', () => {
    expect(findDuplicateTrade(tx(), [tx({ id: 'id-2' })])).toBeNull()
  })

  it('ignores non-trade types and trades with no ticker', () => {
    expect(findDuplicateTrade(tx({ type: 'dividend' }), [tx()])).toBeNull()
    expect(findDuplicateTrade(tx({ ticker: undefined }), [tx()])).toBeNull()
  })
})

describe('findDuplicateTrades', () => {
  it('never matches two candidates onto the same existing transaction', () => {
    // A partially-filled order: two identical executions on the same day, but
    // only one of them is already in the store.
    const a = tx({ id: 'a', externalId: 'xtb-order:1' })
    const b = tx({ id: 'b', externalId: 'xtb-order:2' })
    const existing = tx({ id: 'e1', externalId: '999', source: 'xtb_import' })

    const matches = findDuplicateTrades([a, b], [existing])
    expect(matches.size).toBe(1)
    expect(matches.get('a')).toBe(existing)
  })
})

describe('sales', () => {
  const pdfSale = tx({ id: 'pdf', type: 'sell', amountPLN: 600, quantity: 5, ticker: 'ACME', date: '2026-09-08T14:00:00.000Z' })

  it('a sale from a daily confirmation matches the same sale in Cash Operations', () => {
    const cashOps = tx({ id: 'co', type: 'sell', amountPLN: 600, quantity: 5, ticker: 'ACME', externalId: '7', source: 'xtb_import', date: '2026-09-08T14:00:01.000Z' })
    expect(findDuplicateTrades([cashOps], [pdfSale])).toEqual(new Map([['co', pdfSale]]))
  })

  it('a sale never matches a buy', () => {
    const buy = tx({ id: 'co', type: 'buy', amountPLN: 600, quantity: 5, ticker: 'ACME', externalId: '7' })
    expect(findDuplicateTrade(buy, [pdfSale])).toBeNull()
  })
})

describe('findClosedByHandSales', () => {
  const hand = tx({
    id: 'hand', type: 'sell', date: '2026-09-09', amountPLN: 590, quantity: 5, ticker: 'ACME',
    externalId: 'close-sell-h1', source: 'manual',
  })
  const imported = tx({ id: 'imp', type: 'sell', date: '2026-09-08T21:30:00.000Z', amountPLN: 600, quantity: 5, ticker: 'ACME', externalId: '7', source: 'xtb_import' })

  it('matches on ticker, quantity and a day at most one apart, whatever the amount', () => {
    expect(findClosedByHandSales([imported], [hand])).toEqual(new Map([['imp', hand]]))
  })

  it('ignores sales an import brought: only Close position’s own sale counts', () => {
    expect(findClosedByHandSales([imported], [{ ...hand, externalId: '99' }]).size).toBe(0)
  })

  it('uses each hand-recorded sale once', () => {
    const second = { ...imported, id: 'imp2', externalId: '8' }
    expect([...findClosedByHandSales([imported, second], [hand]).keys()]).toEqual(['imp'])
  })

  it('matches by the instrument when the imported sale has no ticker', () => {
    const noTicker = { ...imported, ticker: undefined, instrument: 'ACME' }
    expect(findClosedByHandSales([noTicker], [hand]).get('imp')).toBe(hand)
  })
})

describe('orders: fills and commission, both directions', () => {
  const fill = (id: string, quantity: number, amountPLN: number, date = '2026-09-08T14:00:00.000Z') => tx({
    id, externalId: id, source: 'xtb_import', ticker: 'ACME', instrument: 'Acme Corp', quantity, amountPLN, date,
    comment: `OPEN BUY ACME.US ${quantity}/2.5 @ 20.00`,
  })
  const fee = (id: string, amountPLN: number, date = '2026-09-08T14:00:00.000Z'): Transaction => ({
    id, accountId: 'acc-1', type: 'fee', date, amountPLN, relatedInstrument: 'Acme Corp', relatedTicker: 'ACME',
    externalId: id, source: 'xtb_import', createdAt: '',
  })
  const pdf = (amountPLN: number, quantity = 2.5) => tx({ id: 'pdf', ticker: 'ACME', quantity, amountPLN, externalId: 'xtb-order:1' })

  it('a confirmation imported after the export matches the fills already in the log', () => {
    const groups = findDuplicateTradeGroups([pdf(-200)], [fill('f1', 0.5, -40), fill('f2', 2, -160, '2026-09-08T14:00:01.000Z')])
    expect(groups).toHaveLength(1)
    expect(groups[0].existing.map((t) => t.id)).toEqual(['f1', 'f2'])
    expect(findDuplicateTrades([pdf(-200)], [fill('f1', 0.5, -40), fill('f2', 2, -160)]).get('pdf')?.id).toBe('f1')
  })

  it('…and the commission already in the log counts towards the confirmation’s amount', () => {
    const groups = findDuplicateTradeGroups([pdf(-201)], [fill('f1', 0.5, -40), fill('f2', 2, -160), fee('c1', -1)])
    expect(groups).toHaveLength(1)
    expect(groups[0].candidateFees).toEqual([]) // nothing on the PDF side to skip
  })

  it('the export after a confirmation: its fills and commission are the duplicate', () => {
    const groups = findDuplicateTradeGroups([fill('f1', 0.5, -40), fill('f2', 2, -160), fee('c1', -1)], [pdf(-201)])
    expect(groups).toHaveLength(1)
    expect(groups[0].candidates.map((t) => t.id)).toEqual(['f1', 'f2'])
    expect(groups[0].candidateFees.map((t) => t.id)).toEqual(['c1'])
  })

  it('fills that do not add up to the order are not matched as one', () => {
    expect(findDuplicateTradeGroups([fill('f1', 0.5, -40), fill('f2', 1.5, -120)], [pdf(-160, 2)])).toEqual([])
  })

  it('a commission at another time, or on another instrument, is not counted', () => {
    expect(findDuplicateTradeGroups([fill('f1', 0.5, -40), fill('f2', 2, -160), fee('c1', -1, '2026-09-08T15:00:00.000Z')], [pdf(-201)])).toEqual([])
    const other = { ...fee('c1', -1), relatedTicker: 'OTHER', relatedInstrument: 'Other Co' }
    expect(findDuplicateTradeGroups([fill('f1', 0.5, -40), fill('f2', 2, -160), other], [pdf(-201)])).toEqual([])
  })
})
