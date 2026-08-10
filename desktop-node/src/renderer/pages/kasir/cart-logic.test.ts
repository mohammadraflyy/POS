import { describe, expect, it } from 'vitest'
import {
  addLine,
  applyQty,
  changeUnit,
  lineKey,
  restoreCart,
  toStoredCart,
  unitKonversi,
  unitPrice,
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

  it('adds the given qty (decimals included) for a product not yet in the cart', () => {
    const result = addLine([], product, 2.5)
    expect(result).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2.5 }])
  })

  it('adds the given qty onto the existing base-unit line', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 }]
    const result = addLine(cart, product, 3)
    expect(result).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 5 }])
  })

  it('falls back to 1 for a zero or negative qty', () => {
    expect(addLine([], product, 0)).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }])
    expect(addLine([], product, -3)).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }])
  })
})

describe('toStoredCart / restoreCart', () => {
  it('round-trips a cart through the stored shape', () => {
    const cart: CartLine[] = [
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 0.25 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2 },
    ]

    expect(restoreCart(toStoredCart(cart), [product])).toEqual(cart)
  })

  it('rebuilds satuan and product from the catalog rather than the stored line', () => {
    const renamed: Product = {
      ...product,
      namaItem: 'Beras 5kg Premium',
      hargaJual: 70000,
      productUnits: [{ id: 9, satuan: 'KARTON', konversi: 12, hargaJual: 750000 }],
    }

    const result = restoreCart([{ productId: 1, productUnitId: 9, qty: 2 }], [renamed])

    expect(result).toEqual([{ key: lineKey(1, 9), product: renamed, productUnitId: 9, satuan: 'KARTON', qty: 2 }])
  })

  it('drops lines whose product, satuan or qty is no longer valid', () => {
    const withoutUnits: Product = { ...product, productUnits: [] }

    const result = restoreCart(
      [
        { productId: 2, productUnitId: null, qty: 1 },
        { productId: 1, productUnitId: 9, qty: 1 },
        { productId: 1, productUnitId: null, qty: 0 },
        { productId: 1, productUnitId: null, qty: 3 },
      ],
      [withoutUnits],
    )

    expect(result).toEqual([
      { key: lineKey(1, null), product: withoutUnits, productUnitId: null, satuan: 'PCS', qty: 3 },
    ])
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
  it('sets the qty literally in the line current satuan, decimals included', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]
    const result = applyQty(cart, lineKey(1, null), 0.25)
    expect(result).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 0.25 }])
  })

  it('does not change the satuan even when the qty is a whole multiple of a derived unit', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]
    const result = applyQty(cart, lineKey(1, null), 24)
    expect(result).toEqual([{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 24 }])
  })

  it('falls back to 1 for a zero or negative qty', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 5 }]
    expect(applyQty(cart, lineKey(1, null), 0)).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 },
    ])
    expect(applyQty(cart, lineKey(1, null), -3)).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 },
    ])
  })
})
