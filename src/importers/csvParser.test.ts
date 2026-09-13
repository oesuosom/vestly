import { describe, expect, it } from 'vitest'
import { parseCSVRaw } from './csvParser'

describe('parseCSVRaw', () => {
  it('parses comma-separated rows', () => {
    const { headers, rows } = parseCSVRaw('a,b,c\n1,2,3')
    expect(headers).toEqual(['a', 'b', 'c'])
    expect(rows).toEqual([{ a: '1', b: '2', c: '3' }])
  })

  it('detects semicolon separator from the header line', () => {
    const { headers, rows } = parseCSVRaw('a;b\n1;2')
    expect(headers).toEqual(['a', 'b'])
    expect(rows).toEqual([{ a: '1', b: '2' }])
  })

  it('keeps separators inside quoted fields', () => {
    const { rows } = parseCSVRaw('name,qty\n"Obligacje, seria X",5')
    expect(rows).toEqual([{ name: 'Obligacje, seria X', qty: '5' }])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    const { rows } = parseCSVRaw('name,qty\n"say ""hi""",1')
    expect(rows).toEqual([{ name: 'say "hi"', qty: '1' }])
  })

  it('parses quoted headers', () => {
    const { headers } = parseCSVRaw('"a,x";"b"\n1;2')
    // header line contains a ';' so separator is ';'
    expect(headers).toEqual(['a,x', 'b'])
  })

  it('handles CRLF line endings', () => {
    const { rows } = parseCSVRaw('a,b\r\n1,2\r\n3,4')
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('skips blank lines and fills missing trailing columns', () => {
    const { rows } = parseCSVRaw('a,b,c\n1,2\n\n4,5,6')
    expect(rows).toEqual([
      { a: '1', b: '2', c: '' },
      { a: '4', b: '5', c: '6' },
    ])
  })
})
