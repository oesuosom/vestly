/**
 * How Revolut charged a crypto trade's fee. The statement's row doesn't say,
 * and in both cases its Quantity is Value ÷ Price:
 *
 * - **out** — the fee is taken out (a trade entered as a PLN amount: "buy for
 *   20 zł"). A buy pays Value and receives (Value − Fee) ÷ Value × Quantity
 *   coins; a sell receives Value and removes (Value + Fee) ÷ Value × Quantity.
 * - **top** — the fee is added on top (a trade entered as a coin amount: "buy
 *   0.02 ETH", "sell all"). A buy pays Value + Fee and receives exactly
 *   Quantity; a sell removes exactly Quantity and receives Value − Fee.
 *
 * Fees depend on Revolut's plan, volume and date, so no rate is assumed: each
 * row's own Fee is used. Which method each row used is worked out per coin
 * from the statement's own totals: Account summary's amount in (buys and
 * receives) and amount out (sells and sends). The split of a coin's buys (and,
 * separately, its sells) whose coins add up to that total is chosen; when
 * several do, the round-number clue decides (a whole-PLN Value suggests
 * "out", a Quantity with at most 4 decimals suggests "top"), and "out" when
 * nothing does. Pure, so it can be tested on synthetic rows.
 */

export type FeeMethod = 'out' | 'top'

/** One buy or sell, as the solver sees it. */
export type FeeRow = {
  quantity: number
  value: number
  fee: number
}

/** Coins a buy or sell moves under each method (positive). */
export function coinsMoved(type: 'buy' | 'sell', row: FeeRow, method: FeeMethod): number {
  if (method === 'top' || row.value <= 0) return row.quantity
  const factor = type === 'buy' ? (row.value - row.fee) / row.value : (row.value + row.fee) / row.value
  return Math.round(row.quantity * factor * 1e8) / 1e8
}

/** The round-number clue: which method a row's own numbers suggest, if any. */
export function feeClue(row: FeeRow): FeeMethod | null {
  const roundQuantity = Math.abs(row.quantity * 1e4 - Math.round(row.quantity * 1e4)) < 1e-6
  const roundValue = Math.abs(row.value - Math.round(row.value)) < 1e-9
  if (roundQuantity && !roundValue) return 'top'
  if (roundValue && !roundQuantity) return 'out'
  return null
}

/**
 * How far off a matching total may be: 1e-8 per row (coin amounts have 8
 * decimals), plus a grosz per row in coins: the statement's fee is a grosz
 * below the one Revolut charged, so an "out" row's coins are that much off.
 */
export function sideTolerance(rows: FeeRow[]): number {
  return 1e-8 * (rows.length + 1) + rows.reduce((t, r) => t + (r.value > 0 ? (0.01 * r.quantity) / r.value : 0), 0)
}

export type SideSolution = {
  methods: FeeMethod[]
  /** True when the methods make the rows add up to the statement's total. */
  matched: boolean
}

/** Each row by its own clue, "out" when it has none. */
export function byClue(rows: FeeRow[]): FeeMethod[] {
  return rows.map((r) => feeClue(r) ?? 'out')
}

const MAX_STEPS = 200_000
const MAX_SOLUTIONS = 500

/**
 * The methods for one coin's buys (or sells) that make their coins, plus
 * `fixed` (receives or sends), add up to `total` (Account summary's amount in
 * or out). Rows whose two candidates differ by the same amount are
 * interchangeable, so they are grouped and only how many of each group are
 * "top" is searched. `matched` is false when no split fits (the rows then
 * follow their clues).
 */
export function solveFeeMethods(type: 'buy' | 'sell', rows: FeeRow[], fixed: number, total: number): SideSolution {
  if (rows.length === 0) return { methods: [], matched: Math.abs(fixed - total) <= sideTolerance([]) }
  const out = rows.map((r) => coinsMoved(type, r, 'out'))
  const diff = rows.map((r, i) => Math.abs(coinsMoved(type, r, 'top') - out[i]))
  // "top" moves more coins on a buy and fewer on a sell.
  const sign = type === 'buy' ? 1 : -1
  const need = sign * (total - fixed - out.reduce((a, b) => a + b, 0))
  const tolerance = sideTolerance(rows)

  // Groups of rows with the same difference, largest first.
  const groups = new Map<number, number[]>()
  rows.forEach((_, i) => {
    const key = Math.round(diff[i] * 1e9)
    groups.set(key, [...(groups.get(key) ?? []), i])
  })
  const list = [...groups.values()].map((idx) => ({ idx, d: diff[idx[0]] })).sort((a, b) => b.d - a.d)
  const remaining = list.map((_, g) => list.slice(g).reduce((t, x) => t + x.d * x.idx.length, 0))

  const solutions: number[][] = []
  const counts = new Array<number>(list.length).fill(0)
  let steps = 0
  const search = (g: number, sum: number) => {
    if (++steps > MAX_STEPS || solutions.length >= MAX_SOLUTIONS) return
    if (sum - need > tolerance) return
    if (g === list.length) {
      if (Math.abs(sum - need) <= tolerance) solutions.push([...counts])
      return
    }
    if (sum + remaining[g] < need - tolerance) return
    for (let k = 0; k <= list[g].idx.length; k++) {
      counts[g] = k
      search(g + 1, sum + k * list[g].d)
    }
    counts[g] = 0
  }
  search(0, 0)
  if (solutions.length === 0) return { methods: byClue(rows), matched: false }

  // Within a group, "top" goes to the rows whose clue says so first.
  const rank = (i: number) => (feeClue(rows[i]) === 'top' ? 0 : feeClue(rows[i]) === null ? 1 : 2)
  const assign = (c: number[]): FeeMethod[] => {
    const methods = new Array<FeeMethod>(rows.length).fill('out')
    list.forEach((grp, g) => {
      const order = [...grp.idx].sort((a, b) => rank(a) - rank(b) || a - b)
      for (const i of order.slice(0, c[g])) methods[i] = 'top'
    })
    return methods
  }
  const score = (m: FeeMethod[]) => m.reduce((s, method, i) => s + (feeClue(rows[i]) === method ? 1 : 0), 0)
  const tops = (m: FeeMethod[]) => m.filter((x) => x === 'top').length
  const residual = (m: FeeMethod[]) => Math.abs(m.reduce((s, x, i) => s + (x === 'top' ? diff[i] : 0), 0) - need)

  const best = solutions
    .map(assign)
    .sort((a, b) => score(b) - score(a) || tops(a) - tops(b) || residual(a) - residual(b))[0]
  return { methods: best, matched: true }
}
