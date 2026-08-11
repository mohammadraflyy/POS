import { describe, expect, it } from 'vitest'
import {
  addLine,
  applyQty,
  changeUnit,
  lineKey,
  pickUnitForBaseQty,
  resolveLineQty,
  unitKonversi,
  unitPrice,
  activeTier,
  type CartLine,
  type Product,
} from './cart-logic'

const product: Product = {
  id: 1,
  kodeItem: 'BRS5',
  barcode: '8991234500015',
  namaItem: 'Beras 5kg',
  satuan: 'PCS',
  hargaJual: 65000,
  stok: 100,
  baseProductUnitId: 1,
  productUnits: [{ id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000 }],
  priceTiers: [{ productUnitId: 1, minQty: 5, maxQty: null, hargaJual: 62000 }],
}

/** carries a tier on the DUS unit as well as on the base unit */
const productWithUnitTiers: Product = {
  ...product,
  priceTiers: [
    { productUnitId: 1, minQty: 5, maxQty: 9, hargaJual: 62000 },
    { productUnitId: 9, minQty: 2, maxQty: null, hargaJual: 650000 },
  ],
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

  it('uses the fixed unit price when a derived unit carries no tier of its own', () => {
    const line: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitPrice(line)).toBe(700000)
  })

  it('falls back to the normal price above a closed range with nothing above it', () => {
    const line: CartLine = { key: lineKey(1, null), product: productWithUnitTiers, productUnitId: null, satuan: 'PCS', qty: 50 }
    expect(unitPrice(line)).toBe(65000)
  })
})

describe('unitPrice with per-unit tiers', () => {
  it('applies a tier scoped to the currently selected derived unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithUnitTiers, productUnitId: 9, satuan: 'DUS', qty: 3 }
    expect(unitPrice(line)).toBe(650000)
  })

  it('does not apply a tier scoped to a different unit', () => {
    // qty 1 misses the DUS tier's minQty 2, so it takes DUS's own price -
    // never the base unit's tier, which is priced per PCS
    const line: CartLine = { key: lineKey(1, 9), product: productWithUnitTiers, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitPrice(line)).toBe(700000)
  })

  it('applies the base unit tier to a base-unit line, resolving null through baseProductUnitId', () => {
    const line: CartLine = { key: lineKey(1, null), product: productWithUnitTiers, productUnitId: null, satuan: 'PCS', qty: 6 }
    expect(unitPrice(line)).toBe(62000)
  })
})

describe('activeTier', () => {
  it('returns the matched tier', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithUnitTiers, productUnitId: 9, satuan: 'DUS', qty: 3 }
    expect(activeTier(line)).toEqual({ productUnitId: 9, minQty: 2, maxQty: null, hargaJual: 650000 })
  })

  it('returns null when no tier matches', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithUnitTiers, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(activeTier(line)).toBeNull()
  })

  it('returns null when qty sits above a closed range', () => {
    const line: CartLine = { key: lineKey(1, null), product: productWithUnitTiers, productUnitId: null, satuan: 'PCS', qty: 20 }
    expect(activeTier(line)).toBeNull()
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

describe('addLine', () => {
  it('adds a new base-unit line for a product not yet in the cart', () => {
    const result = addLine([], product)
    expect(result).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }])
  })

  it('increments qty when the product is already in the cart at the base unit', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 }]
    const result = addLine(cart, product)
    expect(result).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 3 }])
  })
})

describe('changeUnit', () => {
  it('moves a line onto a unit not yet in the cart', () => {
    const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 }
    const result = changeUnit([line], line, 9)
    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2 }])
  })

  it('merges into an existing line at the target unit, combining qty', () => {
    const baseLine: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 3 }
    const dusLine: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2 }
    const result = changeUnit([baseLine, dusLine], baseLine, 9)
    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 5 }])
  })
})

describe('applyQty', () => {
  it('moves a line onto the resolved unit when no existing line occupies it', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]
    const result = applyQty(cart, lineKey(1, null), 24)
    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2 }])
  })

  it('merges into an existing line at the resolved unit, combining qty', () => {
    const baseLine: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }
    const dusLine: CartLine = { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }
    const result = applyQty([baseLine, dusLine], baseLine.key, 24)
    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 3 }])
  })
})
