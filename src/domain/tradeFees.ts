import type { Transaction } from '@/types'

/**
 * The fee charged on each trade, in PLN (positive), keyed by the trade's
 * transaction `id`. Trades without a separately recorded fee are absent.
 */
export type TradeFees = ReadonlyMap<string, number>

/**
 * How each Revolut trade's `externalId` maps to the `externalId` of its fee row.
 *
 * Revolut imports store a trade's fee as a separate `fee` transaction, so the
 * ids — built in `importers/revolutStatementImport.ts` from the Crypto Account
 * Statement — are what ties the two together:
 *
 * | Trade       | Trade id                                              | Fee id            |
 * |-------------|-------------------------------------------------------|-------------------|
 * | buy, sell   | `revolut-stmt-{coin}-{type}-{utcISO}-{qty}-{n}`       | trade id + `-fee` |
 *
 * `{n}` is which of the statement's identical rows it is, so each trade has
 * its own fee id. Rows from the retired per-transaction PDF import
 * (`revolut-btc-…`, `revolut-eth-…`) are no longer paired: their fees stay in
 * the log and in Cash, but are not added to the trade's cost.
 */
const FEE_ID_RULES: {
  type: 'buy' | 'sell'
  tradeId: RegExp
  feeId: (match: RegExpMatchArray) => string
}[] = [
  {
    type: 'buy',
    tradeId: /^(revolut-stmt-[^-]+-buy-.+)$/,
    feeId: (m) => `${m[1]}-fee`,
  },
  {
    type: 'sell',
    tradeId: /^(revolut-stmt-[^-]+-sell-.+)$/,
    feeId: (m) => `${m[1]}-fee`,
  },
]

/** The `externalId` the fee row of this trade would have, if it is a Revolut trade. */
function expectedFeeId(trade: Transaction): string | undefined {
  for (const rule of FEE_ID_RULES) {
    if (trade.type !== rule.type) continue
    const match = trade.externalId.match(rule.tradeId)
    if (match) return rule.feeId(match)
  }
  return undefined
}

/**
 * Pair every separately stored trade fee with the trade it was charged on.
 *
 * Only Revolut crypto imports store fees this way (see {@link FEE_ID_RULES});
 * every other source either has no trade fees or already includes them in the
 * trade's amount (XTB confirmations), so its trades get no entry here.
 *
 * Pairing never crosses accounts. Should several trades ever point at the same
 * fee id, the fees recorded under it are split evenly between them. However
 * the rows pair up, the fees handed out add up to exactly the fee rows that
 * were matched: no fee is counted twice.
 *
 * A fee row with no matching trade (the trade was deleted, or the fee has
 * nothing to do with a trade) is left out.
 */
export function pairTradeFees(transactions: Transaction[]): TradeFees {
  const key = (accountId: string, feeId: string) => `${accountId}\n${feeId}`

  const tradeIdsByFee = new Map<string, string[]>()
  for (const t of transactions) {
    const feeId = expectedFeeId(t)
    if (!feeId) continue
    const k = key(t.accountId, feeId)
    const tradeIds = tradeIdsByFee.get(k)
    if (tradeIds) tradeIds.push(t.id)
    else tradeIdsByFee.set(k, [t.id])
  }

  const fees = new Map<string, number>()
  if (tradeIdsByFee.size === 0) return fees

  const feeTotals = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'fee') continue
    const k = key(t.accountId, t.externalId)
    if (tradeIdsByFee.has(k)) feeTotals.set(k, (feeTotals.get(k) ?? 0) + Math.abs(t.amountPLN))
  }

  for (const [k, total] of feeTotals) {
    const tradeIds = tradeIdsByFee.get(k)!
    for (const id of tradeIds) fees.set(id, total / tradeIds.length)
  }
  return fees
}
