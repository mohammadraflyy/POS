import { describe, expect, it } from 'vitest'
import { cn, formatRupiah } from './utils'

describe('cn', () => {
  it('merges class names and resolves Tailwind conflicts (last one wins)', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b')
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
