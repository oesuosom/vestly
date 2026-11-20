import { describe, expect, it } from 'vitest'
import type { Account, Holding, Transaction } from '@/types'
import { accountsAfterSync, actionableSyncRows, planHoldingSync } from './holdingSync'

const NOW = '2026-01-01T00:00:00.000Z'

function holding(fields: Partial<Holding> & Pick<Holding, 'id' | 'quantity'>): Holding {
  return {
    accountId: 'acc', name: 'ACME', ticker: 'ACME', category: 'stock', purchasePrice: 100, currentPrice: 110,
    purchaseDate: '2026-01-10', createdAt: NOW, updatedAt: NOW, ...fields,
  }
}

function account(holdings: Holding[], type: Account['type'] = 'brokerage'): Account {
  return { id: 'acc', name: 'Acc', type, createdAt: NOW, lastUpdated: NOW, holdings }
}

let n = 0
function tx(fields: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amountPLN'>): Transaction {
  const id = `t${++n}`
  return { id, externalId: id, accountId: 'acc', ticker: 'ACME', source: 'xtb_import', createdAt: NOW, ...fields }
}

const firstBuy = tx({ type: 'buy', date: '2026-01-10', amountPLN: -1000, quantity: 10 })

describe('planHoldingSync — XTB', () => {
  const acme = holding({ id: 'acme', quantity: 10 })

  it('a later buy proposes the new quantity and average cost', () => {
    const buy = tx({ type: 'buy', date: '2026-03-05', amountPLN: -800, quantity: 5 })
    const rows = planHoldingSync(account([acme]), [firstBuy, buy], [buy])
    expect(rows).toEqual([{ kind: 'update', holding: acme, quantity: 15, averageCostPLN: 120 }])
  })

  it('a partial sale proposes the new quantity and keeps the per-unit cost', () => {
    const sale = tx({ type: 'sell', date: '2026-03-05', amountPLN: 900, quantity: 6, source: 'xtb_confirmation' })
    const rows = planHoldingSync(account([acme]), [firstBuy, sale], [sale])
    expect(rows).toEqual([{ kind: 'update', holding: acme, quantity: 4, averageCostPLN: 100 }])
  })

  it('a full sale proposes closing, on the sale’s day with its proceeds', () => {
    const s1 = tx({ type: 'sell', date: '2026-03-05', amountPLN: 600, quantity: 4, source: 'xtb_confirmation' })
    const s2 = tx({ type: 'sell', date: '2026-04-07', amountPLN: 1050, quantity: 6, source: 'xtb_confirmation' })
    const rows = planHoldingSync(account([acme]), [firstBuy, s1, s2], [s1, s2])
    expect(rows).toEqual([{ kind: 'close', holding: acme, date: '2026-04-07', proceedsPLN: 1650, sales: [s1, s2] }])
  })

  it('flags a holding whose transactions don’t explain its quantity, and proposes nothing for it', () => {
    const handEntered = holding({ id: 'acme', quantity: 12 })
    const buy = tx({ type: 'buy', date: '2026-03-05', amountPLN: -500, quantity: 5 })
    const rows = planHoldingSync(account([handEntered]), [firstBuy, buy], [buy])
    expect(rows).toEqual([{ kind: 'unexplained', holding: handEntered, reason: 'history', quantity: 15 }])
    expect(actionableSyncRows(rows)).toEqual([])
  })

  it('flags a sale of more than the log ever recorded', () => {
    const noHistory = holding({ id: 'acme', quantity: 10 })
    const sale = tx({ type: 'sell', date: '2026-03-05', amountPLN: 1500, quantity: 10, source: 'xtb_confirmation' })
    expect(planHoldingSync(account([noHistory]), [sale], [sale])).toEqual([
      { kind: 'unexplained', holding: noHistory, reason: 'history', quantity: 0 },
    ])
  })

  it('flags holdings that share a ticker: the trades can’t be pinned on one', () => {
    const twin = holding({ id: 'twin', name: 'ACME (2)', quantity: 3 })
    const buy = tx({ type: 'buy', date: '2026-03-05', amountPLN: -500, quantity: 5 })
    const rows = planHoldingSync(account([acme, twin]), [firstBuy, buy], [buy])
    expect(rows.map((r) => [r.kind, r.holding.id, r.kind === 'unexplained' && r.reason])).toEqual([
      ['unexplained', 'acme', 'shared'],
      ['unexplained', 'twin', 'shared'],
    ])
  })

  it('leaves out holdings the file didn’t trade, holdings that already match, and other accounts', () => {
    const other = holding({ id: 'other', name: 'Other', ticker: 'OTH', quantity: 7 })
    const elsewhere = tx({ type: 'buy', date: '2026-03-05', amountPLN: -500, quantity: 5, accountId: 'acc2' })
    // A holding the first import created from these same rows already matches.
    expect(planHoldingSync(account([acme, other]), [firstBuy], [firstBuy])).toEqual([])
    expect(planHoldingSync(account([acme, other]), [firstBuy, elsewhere], [elsewhere])).toEqual([])
  })

  it('ignores rows the import skipped as duplicates', () => {
    const skipped = tx({ type: 'buy', date: '2026-03-05', amountPLN: -500, quantity: 5 })
    expect(planHoldingSync(account([acme]), [firstBuy], [skipped])).toEqual([])
  })
})

describe('planHoldingSync — Revolut BTC', () => {
  const btc = (quantity: number) =>
    holding({ id: 'btc', name: 'Bitcoin', ticker: 'BTC', category: 'crypto', quantity, purchasePrice: 100000 })
  const rev = (fields: Partial<Transaction> & Pick<Transaction, 'type' | 'date' | 'amountPLN'>) =>
    tx({ ticker: 'BTC', source: 'revolut_crypto', ...fields })
  const buy = rev({ type: 'buy', date: '2026-01-10T00:00:00.000Z', amountPLN: -200000, quantity: 2 })

  it('a partial sale keeps the cost per BTC (2 bought for 200,000, 1 sold → 100,000, not 200,000)', () => {
    const sale = rev({ type: 'sell', date: '2026-03-01T00:00:00.000Z', amountPLN: 150000, quantity: 1 })
    const rows = planHoldingSync(account([btc(2)], 'crypto'), [buy, sale], [sale])
    expect(rows).toEqual([{ kind: 'update', holding: btc(2), quantity: 1, averageCostPLN: 100000 }])
  })

  it('selling everything closes the holding with the proceeds after the fee', () => {
    // Ids as the BTC parser builds them, which is how the fee is paired with its sale.
    const sale = rev({ type: 'sell', date: '2026-03-01T00:00:00.000Z', amountPLN: 300000, quantity: 2, externalId: 'revolut-btc-sell-2026-03-01-2-300000' })
    const fee = rev({ type: 'fee', date: '2026-03-01T00:00:00.000Z', amountPLN: -600, ticker: undefined, externalId: 'revolut-btc-sell-fee-2026-03-01-2' })
    const rows = planHoldingSync(account([btc(2)], 'crypto'), [buy, sale, fee], [sale, fee])
    expect(rows).toMatchObject([{ kind: 'close', date: '2026-03-01', proceedsPLN: 299400 }])
  })

  it('sending everything away closes it too, with no proceeds', () => {
    const send = rev({ type: 'send', date: '2026-03-02T00:00:00.000Z', amountPLN: 0, quantity: 2 })
    expect(planHoldingSync(account([btc(2)], 'crypto'), [buy, send], [send])).toMatchObject([
      { kind: 'close', date: '2026-03-02', proceedsPLN: 0 },
    ])
  })

  it('stores the quantity without floating-point noise', () => {
    const small = btc(0.3)
    const b1 = rev({ type: 'buy', date: '2026-01-10T00:00:00.000Z', amountPLN: -10000, quantity: 0.1 })
    const b2 = rev({ type: 'buy', date: '2026-01-11T00:00:00.000Z', amountPLN: -20000, quantity: 0.2 })
    const send = rev({ type: 'send', date: '2026-03-02T00:00:00.000Z', amountPLN: 0, quantity: 0.2 })
    const [row] = planHoldingSync(account([small], 'crypto'), [b1, b2, send], [send])
    expect(row).toMatchObject({ kind: 'update', quantity: 0.1 })
  })
})

describe('accountsAfterSync', () => {
  it('applies updates and moves closed holdings to Closed positions', () => {
    const a = holding({ id: 'a', quantity: 10 })
    const b = holding({ id: 'b', name: 'B', ticker: 'B', quantity: 3 })
    const [acc] = accountsAfterSync([account([a, b])], [
      { kind: 'update', holding: a, quantity: 15, averageCostPLN: 120 },
      { kind: 'close', holding: b, date: '2026-04-07', proceedsPLN: 400, sales: [] },
      { kind: 'unexplained', holding: a, reason: 'history', quantity: 1 },
    ], NOW)
    expect(acc.holdings).toMatchObject([{ id: 'a', quantity: 15, purchasePrice: 120 }])
    expect(acc.closedHoldings).toMatchObject([{ id: 'b', closedAt: '2026-04-07' }])
  })
})
