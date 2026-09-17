import { describe, expect, it } from 'vitest'
import { diBawahMarginMinimal, diBawahModal, hargaJualRekomendasi, marginDariHargaJual } from './harga'

describe('hargaJualRekomendasi', () => {
  it('leaves the asked-for margin of the selling price', () => {
    // a DUS costing 144.000 at a 10% margin has to be sold at 160.000
    expect(hargaJualRekomendasi(144_000, 10)).toBe(160_000)
    expect(marginDariHargaJual(160_000, 144_000)).toBeCloseTo(10, 6)
  })

  it('rounds up to the next hundred, never down into a thinner margin', () => {
    // 185.100 / 0.9 = 205.666,67
    expect(hargaJualRekomendasi(185_100, 10)).toBe(205_700)
    expect(marginDariHargaJual(205_700, 185_100)!).toBeGreaterThan(10)
  })

  it('returns the cost itself at a zero margin', () => {
    expect(hargaJualRekomendasi(50_000, 0)).toBe(50_000)
  })

  it('has nothing to recommend without a cost', () => {
    expect(hargaJualRekomendasi(0, 10)).toBe(0)
    expect(hargaJualRekomendasi(-5, 10)).toBe(0)
  })

  it('clamps an out-of-range margin instead of dividing by zero', () => {
    expect(Number.isFinite(hargaJualRekomendasi(10_000, 100))).toBe(true)
    expect(hargaJualRekomendasi(10_000, 100)).toBe(hargaJualRekomendasi(10_000, 90))
    expect(hargaJualRekomendasi(10_000, -20)).toBe(10_000)
  })
})

describe('marginDariHargaJual', () => {
  it('is negative when the price sits under the cost', () => {
    expect(marginDariHargaJual(143_000, 144_000)!).toBeLessThan(0)
  })

  it('is null when there is no price to divide by', () => {
    expect(marginDariHargaJual(0, 144_000)).toBeNull()
  })
})

describe('diBawahMarginMinimal / diBawahModal', () => {
  it('flags a price that clears the cost but misses the minimum margin', () => {
    // 150.000 on a 144.000 cost is 4% - profitable, but under a 10% floor
    expect(diBawahModal(150_000, 144_000)).toBe(false)
    expect(diBawahMarginMinimal(150_000, 144_000, 10)).toBe(true)
  })

  it('accepts a price exactly on the recommendation', () => {
    expect(diBawahMarginMinimal(160_000, 144_000, 10)).toBe(false)
  })

  it('never flags an item with no cost recorded', () => {
    expect(diBawahMarginMinimal(5_000, 0, 10)).toBe(false)
    expect(diBawahModal(5_000, 0)).toBe(false)
  })
})
