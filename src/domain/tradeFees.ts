import type { Transaction } from '@/types'

/**
 * The fee charged on each trade, in PLN (positive), keyed by the trade's
 * transaction `id`. Trades without a separately recorded fee are absent.
 */
export type TradeFees = ReadonlyMap<string, number>

/**
 * How each Revolut trade's `externalId` maps to the `externalId` of its fee row.
 *
 * Revolut imports store a trade's fee as a separate `fee` transaction with no
 * ticker and no link to the trade, so the ids — built in `revolutBtcParser.ts`
 * and `revolutCryptoParser.ts` — are the only thing that ties the two together.
 * They do not all carry the same fields:
 *
 * | Trade    | Trade id                                   | Fee id                                 |
 * |----------|--------------------------------------------|----------------------------------------|
 * | BTC buy  | `revolut-btc-{date}-{qty}-{net}`           | `revolut-btc-fee-{date}-{qty}`         |
 * | BTC sell | `revolut-btc-sell-{date}-{qty}-{gross}`    | `revolut-btc-sell-fee-{date}-{qty}`    |
 * | ETH buy  | `revolut-eth-{date}-{qty}-{net}-{fee}`     | `revolut-eth-fee-{date}-{qty}-{fee}`   |
 *
 * `{date}` is `YYYY-MM-DD`; the numbers are written as JavaScript prints them.
 * Each pattern captures `{date}-{qty}` (and, for ETH, `{fee}`) and drops the
 * trade amount, which the fee id does not have. The date right after the
 * prefix is what keeps the BTC buy pattern from matching the `sell-`, `fee-`,
 * `send-` and `receive-` ids that share its prefix.
 */
const FEE_ID_RULES: {
  type: 'buy' | 'sell'
  tradeId: RegExp
  feeId: (match: RegExpMatchArray) => string
}[] = [
  {
    type: 'buy',
    tradeId: /^revolut-btc-(\d{4}-\d{2}-\d{2}-.+)-[^-]+$/,
    feeId: (m) => `revolut-btc-fee-${m[1]}`,
  },
  {
    type: 'sell',
    tradeId: /^revolut-btc-sell-(\d{4}-\d{2}-\d{2}-.+)-[^-]+$/,
    feeId: (m) => `revolut-btc-sell-fee-${m[1]}`,
  },
  {
    type: 'buy',
    tradeId: /^revolut-eth-(\d{4}-\d{2}-\d{2}-.+)-[^-]+-([^-]+)$/,
    feeId: (m) => `revolut-eth-fee-${m[1]}-${m[2]}`,
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
 * Pairing never crosses accounts. A fee id carries less than its trade's id, so
 * several trades can point at the same fee id — two BTC buys of the same
 * quantity on the same day, for instance. The fees recorded under that id are
 * then split evenly between those trades (they have the same quantity, so that
 * is also pro rata). However the rows pair up, the fees handed out add up to
 * exactly the fee rows that were matched: no fee is counted twice.
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
