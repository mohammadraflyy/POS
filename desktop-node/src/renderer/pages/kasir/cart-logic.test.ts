import { describe, expect, it } from 'vitest'
import {
  addLine,
  applyHarga,
  applyQty,
  cartFromSale,
  changeUnit,
  expandUnitResults,
  lineKey,
  restoreCart,
  toStoredCart,
  unitKonversi,
  unitPrice,
  activeTier,
  type CartLine,
  type EditSaleItem,
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

  it('puts a new line at the top so the newest item is first', () => {
    const other: Product = { ...product, id: 2, kodeItem: 'MIE1', namaItem: 'Mie Instan', baseProductUnitId: 2 }
    const cart: CartLine[] = [{ key: lineKey(2, null), product: other, productUnitId: null, satuan: 'PCS', qty: 1 }]

    const result = addLine(cart, product)

    expect(result.map((line) => line.key)).toEqual([lineKey(1, null), lineKey(2, null)])
  })

  it('leaves a merged line where it is instead of moving it to the top', () => {
    const other: Product = { ...product, id: 2, kodeItem: 'MIE1', namaItem: 'Mie Instan', baseProductUnitId: 2 }
    const cart: CartLine[] = [
      { key: lineKey(2, null), product: other, productUnitId: null, satuan: 'PCS', qty: 1 },
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 },
    ]

    const result = addLine(cart, product)

    expect(result.map((line) => line.key)).toEqual([lineKey(2, null), lineKey(1, null)])
    expect(result[1].qty).toBe(2)
  })

  it('adds a line for a derived unit when given its productUnitId', () => {
    const result = addLine([], product, 1, 9)

    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 }])
  })

  it('merges into the existing line for that same derived unit', () => {
    const cart: CartLine[] = [{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2 }]

    const result = addLine(cart, product, 3, 9)

    expect(result).toEqual([{ key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 5 }])
  })

  it('keeps a derived-unit line separate from the base-unit line', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]

    const result = addLine(cart, product, 1, 9)

    expect(result.map((line) => line.key)).toEqual([lineKey(1, 9), lineKey(1, null)])
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

describe('expandUnitResults', () => {
  it('returns one row per unit, base unit first', () => {
    const results = expandUnitResults([product], 'beras', 50)

    expect(results).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', hargaJual: 65000 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', hargaJual: 700000 },
    ])
  })

  it('matches on barcode, which is how a scan into the search box arrives', () => {
    expect(expandUnitResults([product], '8991234500015', 50)).toHaveLength(2)
  })

  it('matches on kode item and is case-insensitive', () => {
    expect(expandUnitResults([product], 'brs5', 50)).toHaveLength(2)
  })

  it('returns nothing for a blank query', () => {
    expect(expandUnitResults([product], '   ', 50)).toEqual([])
  })

  it('returns nothing when the query matches no product', () => {
    expect(expandUnitResults([product], 'tidak ada', 50)).toEqual([])
  })

  it('honours the limit', () => {
    expect(expandUnitResults([product], 'beras', 1)).toHaveLength(1)
  })

  it('tolerates a product with no barcode', () => {
    const noBarcode: Product = { ...product, barcode: null }

    expect(expandUnitResults([noBarcode], 'beras', 50)).toHaveLength(2)
  })
})

describe('hargaOverride', () => {
  it('wins over the tier price', () => {
    const line: CartLine = {
      key: lineKey(1, null),
      product,
      productUnitId: null,
      satuan: 'PCS',
      qty: 5,
      hargaOverride: 50000,
    }

    expect(unitPrice(line)).toBe(50000)
  })

  it('wins over a derived unit price', () => {
    const line: CartLine = {
      key: lineKey(1, 9),
      product,
      productUnitId: 9,
      satuan: 'DUS',
      qty: 1,
      hargaOverride: 600000,
    }

    expect(unitPrice(line)).toBe(600000)
  })

  it('is ignored when null, falling back to normal pricing', () => {
    const line: CartLine = {
      key: lineKey(1, null),
      product,
      productUnitId: null,
      satuan: 'PCS',
      qty: 5,
      hargaOverride: null,
    }

    expect(unitPrice(line)).toBe(62000)
  })

  it('allows a deliberate zero, which is not the same as "no override"', () => {
    const line: CartLine = {
      key: lineKey(1, null),
      product,
      productUnitId: null,
      satuan: 'PCS',
      qty: 5,
      hargaOverride: 0,
    }

    expect(unitPrice(line)).toBe(0)
  })
})

describe('applyHarga', () => {
  it('sets the override on the matching line only', () => {
    const cart: CartLine[] = [
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 },
    ]

    const result = applyHarga(cart, lineKey(1, 9), 640000)

    expect(result[0].hargaOverride).toBeUndefined()
    expect(result[1].hargaOverride).toBe(640000)
  })

  it('rounds to whole rupiah and floors a negative at zero', () => {
    const cart: CartLine[] = [{ key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 1 }]

    expect(applyHarga(cart, lineKey(1, null), 1234.6)[0].hargaOverride).toBe(1235)
    expect(applyHarga(cart, lineKey(1, null), -5)[0].hargaOverride).toBe(0)
  })
})

describe('cartFromSale', () => {
  it('maps the stored base product_units id back to the cart null base unit', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2, hargaOverride: null },
    ])
  })

  it('keeps a derived unit as itself', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 9, qty: 1, hargaJual: 700000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1, hargaOverride: null },
    ])
  })

  it('turns a manually priced line back into an override', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 55000, priceSource: 'manual' },
    ]

    expect(cartFromSale(items, [product])[0].hargaOverride).toBe(55000)
  })

  it('leaves a tier-priced line to be recomputed rather than pinning it', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 5, hargaJual: 62000, priceSource: 'price_tier' },
    ]

    expect(cartFromSale(items, [product])[0].hargaOverride).toBeNull()
  })

  it('drops a line whose product is gone from the catalog', () => {
    const items: EditSaleItem[] = [
      { productId: 77, productUnitId: 1, qty: 1, hargaJual: 1000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([])
  })

  it('preserves the saved order of the lines', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 9, qty: 1, hargaJual: 700000, priceSource: 'normal' },
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product]).map((line) => line.key)).toEqual([lineKey(1, 9), lineKey(1, null)])
  })

  it('drops a line whose derived unit was deleted from the catalog', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 999, qty: 1, hargaJual: 700000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product])).toEqual([])
  })

  it('coalesces two sale_items rows for the same product and unit into one line', () => {
    // addItemsToSale plain-inserts rather than merging, so a bon topped up with a
    // product already on it can carry two rows for the same product+unit
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
      { productId: 1, productUnitId: 1, qty: 3, hargaJual: 65000, priceSource: 'normal' },
    ]

    const result = cartFromSale(items, [product])

    expect(result).toHaveLength(1)
    expect(result[0].qty).toBe(5)
  })

  it('keeps the last non-null manual override when coalescing duplicate rows', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 50000, priceSource: 'manual' },
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 55000, priceSource: 'manual' },
    ]

    const result = cartFromSale(items, [product])

    expect(result).toHaveLength(1)
    expect(result[0].hargaOverride).toBe(55000)
  })
})
