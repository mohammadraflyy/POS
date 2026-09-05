import { describe, expect, it } from 'vitest'
import { cn, formatQty, formatRupiah, parseQty } from './utils'

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts (last one wins)', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
  })
})

describe('parseQty', () => {
  it('reads a plain number', () => {
    expect(parseQty(' 12 ')).toBe(12)
  })

  it('reads both decimal separators', () => {
    expect(parseQty('5,5')).toBe(5.5)
    expect(parseQty('5.5')).toBe(5.5)
  })

  it('reads a dot every three digits as thousands, not a decimal point', () => {
    expect(parseQty('2.133')).toBe(2133)
    expect(parseQty('1.250.000')).toBe(1250000)
  })

  it('treats dots as grouping once a comma marks the decimal', () => {
    expect(parseQty('1.500,25')).toBe(1500.25)
  })

  it('returns NaN for something unparseable', () => {
    expect(parseQty('abc')).toBeNaN()
  })

  it('round-trips whatever formatQty wrote, which is how the grid seeds its fields', () => {
    for (const value of [0, 5.5, 12, 2133, 1250000, 2133.5]) {
      expect(parseQty(formatQty(value))).toBe(value)
    }
  })
})

describe('parseQty', () => {
  it('reads a plain number', () => {
    expect(parseQty(' 12 ')).toBe(12)
  })

  it('reads both decimal separators', () => {
    expect(parseQty('5,5')).toBe(5.5)
    expect(parseQty('5.5')).toBe(5.5)
  })

  it('reads a dot every three digits as thousands, not a decimal point', () => {
    expect(parseQty('2.133')).toBe(2133)
    expect(parseQty('1.250.000')).toBe(1250000)
  })

  it('treats dots as grouping once a comma marks the decimal', () => {
    expect(parseQty('1.500,25')).toBe(1500.25)
  })

  it('returns NaN for something unparseable', () => {
    expect(parseQty('abc')).toBeNaN()
  })

  it('round-trips whatever formatQty wrote, which is how the grid seeds its fields', () => {
    for (const value of [0, 5.5, 12, 2133, 1250000, 2133.5]) {
      expect(parseQty(formatQty(value))).toBe(value)
    }
  })
})

describe('formatRupiah', () => {
  it('formats a whole Rupiah amount with thousand separators', () => {
    expect(formatRupiah(15000)).toBe('Rp 15.000')
  })

  it('formats zero', () => {
    expect(formatRupiah(0)).toBe('Rp 0')
  })

  it('formats a large amount', () => {
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000')
  })
})
