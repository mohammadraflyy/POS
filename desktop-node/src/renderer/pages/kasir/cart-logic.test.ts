import { describe, expect, it } from 'vitest'
import { lineKey, pickUnitForBaseQty, resolveLineQty, unitKonversi, unitPrice, type CartLine, type Product } from './cart-logic'

const product: Product = {
  id: 1,
  kodeItem: 'BRS5',
  barcode: '8991234500015',
  namaItem: 'Beras 5kg',
  satuan: 'PCS',
  hargaJual: 65000,
  stok: 100,
  productUnits: [{ id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000 }],
  priceTiers: [{ minQty: 5, hargaJual: 62000 }],
}

describe('unitPrice', () => {
  it('uses tier pricing for the base unit when qty meets a tier', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 5 }
    expect(unitPrice(line)).toBe(62000)
  })

  it('falls back to the base price below any tier threshold', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 }
    expect(unitPrice(line)).toBe(65000)
  })

  it('uses the fixed unit price when a productUnitId is set, ignoring tiers', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitPrice(line)).toBe(700000)
  })
})

describe('unitKonversi', () => {
  it('is 1 for the base unit', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }
    expect(unitKonversi(line)).toBe(1)
  })

  it('is the unit konversi for a derived unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitKonversi(line)).toBe(12)
  })
})

describe('pickUnitForBaseQty', () => {
  it('picks the base unit when the qty does not divide evenly into any derived unit', () => {
    expect(pickUnitForBaseQty(product, 5)).toEqual({ productUnitId: null, qty: 5, satuan: 'PCS' })
  })

  it('picks the derived unit with the largest konversi that divides evenly', () => {
    expect(pickUnitForBaseQty(product, 24)).toEqual({ productUnitId: 9, qty: 2, satuan: 'DUS' })
  })

  it('rounds up to at least 1 when the base qty is below any unit', () => {
    expect(pickUnitForBaseQty(product, 0.3)).toEqual({ productUnitId: null, qty: 1, satuan: 'PCS' })
  })
})

describe('resolveLineQty', () => {
  it('converts a typed qty in the current unit to base units, then picks the cleanest unit', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }
    expect(resolveLineQty(line, 24)).toEqual({ productUnitId: 9, qty: 2, satuan: 'DUS' })
  })

  it('resolves a typed qty while already on a derived unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(resolveLineQty(line, 0.5)).toEqual({ productUnitId: null, qty: 6, satuan: 'PCS' })
  })
})
