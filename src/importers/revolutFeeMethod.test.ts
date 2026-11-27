import { describe, expect, it } from 'vitest'
import { coinsMoved, feeClue, solveFeeMethods, type FeeRow } from '@/importers/revolutFeeMethod'
import { parseRevolutStatement } from '@/importers/revolutStatement'
import { assignFeeMethods, feeMethodLines, feeReasons } from '@/importers/revolutStatementImport'
import { HEADER, TX_HEADER } from '@/importers/revolutStatement.fixture'

// Made-up rows. Buys of 0.01 coin at 10,000 PLN with a 1 PLN fee: 0.0099 coins with
// the fee taken out, 0.01 with it on top; the difference is 0.0001.
const buy = (quantity: number, value: number, fee: number): FeeRow => ({ quantity, value, fee })
const total = (type: 'buy' | 'sell', rows: FeeRow[], methods: ('out' | 'top')[]) =>
  rows.reduce((t, r, i) => t + coinsMoved(type, r, methods[i]), 0)

describe('coinsMoved', () => {
  it('takes the fee out of a buy, or adds it on top', () => {
    expect(coinsMoved('buy', buy(0.01, 100, 1), 'out')).toBe(0.0099)
    expect(coinsMoved('buy', buy(0.01, 100, 1), 'top')).toBe(0.01)
  })

  it('takes a sell’s fee in coins, or out of the PLN received', () => {
    expect(coinsMoved('sell', buy(30, 60, 2), 'out')).toBe(31)
    expect(coinsMoved('sell', buy(30, 60, 2), 'top')).toBe(30)
  })
})

describe('feeClue', () => {
  it('a whole-PLN Value suggests the fee was taken out; a round Quantity that it was on top', () => {
    expect(feeClue(buy(0.01234567, 40, 1))).toBe('out')
    expect(feeClue(buy(0.02, 213.47, 3.2))).toBe('top')
    expect(feeClue(buy(0.02, 200, 3))).toBeNull()
    expect(feeClue(buy(0.01234567, 213.47, 3.2))).toBeNull()
  })
})

describe('solveFeeMethods', () => {
  const rows = [buy(0.01, 100, 1), buy(0.02, 200, 3), buy(0.03, 300, 4)]

  it('finds all fees taken out', () => {
    const t = total('buy', rows, ['out', 'out', 'out'])
    expect(solveFeeMethods('buy', rows, 0, t)).toEqual({ methods: ['out', 'out', 'out'], matched: true })
  })

  it('finds all fees on top', () => {
    expect(solveFeeMethods('buy', rows, 0, 0.06)).toEqual({ methods: ['top', 'top', 'top'], matched: true })
  })

  it('finds a mix, counting what the receives brought in', () => {
    const t = total('buy', rows, ['out', 'top', 'out'])
    expect(solveFeeMethods('buy', rows, 0.5, t + 0.5)).toEqual({ methods: ['out', 'top', 'out'], matched: true })
  })

  it('picks how many of a group of rows with equal differences had the fee on top', () => {
    // Four identical buys; the total says two of them had it on top.
    const same = [buy(0.01, 100, 1), buy(0.01, 100, 1), buy(0.01, 100, 1), buy(0.01, 100, 1)]
    const solved = solveFeeMethods('buy', same, 0, 0.0099 * 2 + 0.01 * 2)
    expect(solved.matched).toBe(true)
    expect(solved.methods.filter((m) => m === 'top')).toHaveLength(2)
  })

  it('within such a group, gives "on top" to the rows whose round quantity suggests it', () => {
    // Same difference for both (Quantity × Fee ÷ Value = 0.0001); only the second has a round-quantity clue.
    const mixed = [buy(0.01, 100, 1), buy(0.01, 100.5, 1.005)]
    expect(feeClue(mixed[1])).toBe('top')
    const solved = solveFeeMethods('buy', mixed, 0, 0.0099 + 0.01)
    expect(solved).toEqual({ methods: ['out', 'top'], matched: true })
  })

  it('reads a mixed sell: one for a PLN amount, one "sell all"', () => {
    const sells = [buy(30, 60, 2), buy(12.5, 50.37, 1)]
    // 31 (30 sold for 60 PLN, fee in coins) + 12.5 (sold all, fee out of the PLN).
    expect(solveFeeMethods('sell', sells, 0, 31 + 12.5)).toEqual({ methods: ['out', 'top'], matched: true })
  })

  it('says so when no split adds up, and falls back to each row’s clue', () => {
    const solved = solveFeeMethods('buy', [buy(0.02, 213.47, 3.2), buy(0.01234567, 40, 1)], 0, 0.5)
    expect(solved).toEqual({ methods: ['top', 'out'], matched: false })
  })

  it('allows a grosz per row for the statement’s rounded fee', () => {
    // Revolut charged 1.01 PLN; the statement says 1.00.
    const charged = coinsMoved('buy', buy(0.01, 100, 1.01), 'out')
    expect(solveFeeMethods('buy', [buy(0.01, 100, 1)], 0, charged)).toEqual({ methods: ['out'], matched: true })
  })
})

describe('assignFeeMethods', () => {
  const statement = (summary: string[], rows: string[]) =>
    parseRevolutStatement([[...HEADER, 'Account summary', ...summary, TX_HEADER, ...rows]])

  it('reads each coin’s buys and sells against Account summary’s amount in and out', () => {
    const s = statement(
      ['0.02000000 ETH', 'ETH Ether 0.01000000 ETH 0.03000000 ETH'],
      [
        'ETH Buy 0.02000000 10,000.00 PLN 200.00 PLN 3.00 PLN Jan 5, 2025, 3:04:12PM',
        'ETH Buy 0.01000000 10,000.00 PLN 100.00 PLN 1.00 PLN Jan 6, 2025, 3:04:12PM',
        'ETH Sell 0.01000000 10,000.00 PLN 100.00 PLN 1.00 PLN Jan 7, 2025, 3:04:12PM',
      ],
    )
    const { byRow, coins } = assignFeeMethods(s)
    expect(byRow).toEqual(['top', 'top', 'top'])
    expect(coins.ETH).toEqual({
      buys: { rows: 2, top: 2, status: 'matched' },
      sells: { rows: 1, top: 1, status: 'matched' },
    })
    expect(feeMethodLines(s)).toEqual(['ETH: fee added on top for 2 buys and 1 sell'])
    expect(feeReasons(coins.ETH)).toEqual([])
  })

  it('uses each row’s clue for a coin with no amount in or out, and says it couldn’t tell', () => {
    const s = statement([], [
      'ETH Buy 0.02000000 10,673.50 PLN 213.47 PLN 3.20 PLN Jan 5, 2025, 3:04:12PM',
      'ETH Buy 0.01234567 3,240.00 PLN 40.00 PLN 1.00 PLN Jan 6, 2025, 3:04:12PM',
    ])
    const { byRow, coins } = assignFeeMethods(s)
    expect(byRow).toEqual(['top', 'out'])
    expect(coins.ETH.buys).toEqual({ rows: 2, top: 1, status: 'guessed' })
    expect(feeReasons(coins.ETH)).toEqual(['Couldn’t tell how fees were charged on 2 buys'])
  })

  it('tries the amount in without staking rewards when Revolut counts them in', () => {
    const s = statement(
      ['0.02100000 ETH', 'ETH Ether 0 ETH 0.02100000 ETH'],
      [
        'ETH Buy 0.02000000 10,000.00 PLN 200.00 PLN 3.00 PLN Jan 5, 2025, 3:04:12PM',
        'ETH Staking reward 0.00100000 10,000.00 PLN 10.00 PLN 0.00 PLN Jan 9, 2025, 3:04:12PM',
      ],
    )
    expect(assignFeeMethods(s).coins.ETH.buys).toEqual({ rows: 1, top: 1, status: 'matched' })
  })
})
