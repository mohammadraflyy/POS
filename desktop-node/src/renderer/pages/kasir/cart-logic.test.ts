import { describe, expect, it } from 'vitest'
import {
  addLine,
  applyDiskon,
  applyHarga,
  applyQty,
  cartFromSale,
  cartModal,
  changeUnit,
  expandUnitResults,
  lineGross,
  lineKey,
  lineSubtotal,
  matchingProducts,
  parseDiskon,
  restoreCart,
  toStoredCart,
  unitKonversi,
  unitPrice,
  unitHargaPokok,
  isBelowHargaPokok,
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
  hargaPokok: 60000,
  stok: 100,
  baseProductUnitId: 1,
  productUnits: [{ id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000, hargaPokok: 720000 }],
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
  it('round-trips a cart through the stored shape, discounts included', () => {
    const cart: CartLine[] = [
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 0.25, diskon: 0 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 2, diskon: 50000 },
    ]

    expect(restoreCart(toStoredCart(cart), [product])).toEqual(cart)
  })

  it('rebuilds satuan and product from the catalog rather than the stored line', () => {
    const renamed: Product = {
      ...product,
      namaItem: 'Beras 5kg Premium',
      hargaJual: 70000,
      productUnits: [{ id: 9, satuan: 'KARTON', konversi: 12, hargaJual: 750000, hargaPokok: 720000 }],
    }

    const result = restoreCart([{ productId: 1, productUnitId: 9, qty: 2 }], [renamed])

    expect(result).toEqual([
      { key: lineKey(1, 9), product: renamed, productUnitId: 9, satuan: 'KARTON', qty: 2, diskon: 0 },
    ])
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
      { key: lineKey(1, null), product: withoutUnits, productUnitId: null, satuan: 'PCS', qty: 3, diskon: 0 },
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
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', hargaJual: 65000, stok: 100 },
      // 100 PCS at 12 to the DUS reads as 8.33 DUS, not as the product's raw base stock
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', hargaJual: 700000, stok: 8.333 },
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

  // The row cap used to cut the catalog in plain order, so a cashier searching a
  // short string only ever saw products near the front of the alphabet.
  it('spends its row budget on the best matches, not on whatever comes first', () => {
    const filler: Product[] = Array.from({ length: 40 }, (_, i) => ({
      ...product,
      id: 100 + i,
      kodeItem: `AAA${i}`,
      barcode: null,
      namaItem: `Aneka Beras Campur ${i}`,
      productUnits: [],
    }))
    const wanted: Product = { ...product, id: 7, namaItem: 'Beras', barcode: null, productUnits: [] }

    const results = expandUnitResults([...filler, wanted], 'beras', 10)

    expect(results[0].product.id).toBe(7)
  })
})

describe('matchingProducts', () => {
  const exact: Product = { ...product, id: 2, namaItem: 'Zeta', kodeItem: 'ZET', barcode: null }
  const prefix: Product = { ...product, id: 3, namaItem: 'Zeta Manis', kodeItem: 'ZTM', barcode: null }
  const contains: Product = { ...product, id: 4, namaItem: 'Apel Zeta', kodeItem: 'APZ', barcode: null }

  it('ranks an exact field above a prefix, and a prefix above a substring', () => {
    expect(matchingProducts([contains, prefix, exact], 'zeta').map((p) => p.id)).toEqual([2, 3, 4])
  })

  it('breaks ties on name so equal matches keep a stable order', () => {
    const b: Product = { ...contains, id: 5, namaItem: 'Bakwan Zeta' }

    expect(matchingProducts([b, contains], 'zeta').map((p) => p.id)).toEqual([4, 5])
  })

  it('returns nothing for a blank query', () => {
    expect(matchingProducts([product], '  ')).toEqual([])
  })
})

describe('isBelowHargaPokok', () => {
  function line(productUnitId: number | null, hargaOverride: number | null, qty = 1): CartLine {
    return {
      key: lineKey(1, productUnitId),
      product,
      productUnitId,
      satuan: productUnitId === null ? 'PCS' : 'DUS',
      qty,
      hargaOverride,
    }
  }

  it('reads the cost of the unit the line sells', () => {
    expect(unitHargaPokok(line(null, null))).toBe(60000)
    expect(unitHargaPokok(line(9, null))).toBe(720000)
  })

  it('flags a manual price under the base unit cost', () => {
    expect(isBelowHargaPokok(line(null, 59999))).toBe(true)
  })

  it('accepts a manual price exactly at cost', () => {
    expect(isBelowHargaPokok(line(null, 60000))).toBe(false)
  })

  it('checks a derived unit against its own cost, not the base unit cost', () => {
    // 700.000 clears the base unit's 60.000 but sits under the DUS cost of 720.000
    expect(isBelowHargaPokok(line(9, 700000))).toBe(true)
  })

  it('leaves a tier price alone even when it prices under cost', () => {
    // qty 5 hits the 62.000 tier; no override, so this is the owner's own pricing
    expect(isBelowHargaPokok(line(null, null, 5))).toBe(false)
  })

  it('ignores the line discount, matching the main-process guard', () => {
    const diskonLine: CartLine = { ...line(null, 60000, 1), diskon: 30000 }
    expect(isBelowHargaPokok(diskonLine)).toBe(false)
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

describe('parseDiskon', () => {
  it('reads a plain number as whole rupiah', () => {
    expect(parseDiskon('5000', 65000)).toBe(5000)
  })

  it('resolves a percentage against the base it is given', () => {
    expect(parseDiskon('10%', 65000)).toBe(6500)
    expect(parseDiskon('12.5%', 80000)).toBe(10000)
  })

  it('never gives away more than the line is worth', () => {
    expect(parseDiskon('999999', 65000)).toBe(65000)
    expect(parseDiskon('150%', 65000)).toBe(65000)
  })

  it('reads an empty box, junk and negatives as no discount', () => {
    expect(parseDiskon('', 65000)).toBe(0)
    expect(parseDiskon('   ', 65000)).toBe(0)
    expect(parseDiskon('abc', 65000)).toBe(0)
    expect(parseDiskon('-500', 65000)).toBe(500)
  })

  it('cannot manufacture a discount on an empty line', () => {
    expect(parseDiskon('10%', 0)).toBe(0)
    expect(parseDiskon('5000', 0)).toBe(0)
  })
})

describe('lineSubtotal', () => {
  const line: CartLine = { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 }

  it('is the gross when nothing was discounted', () => {
    expect(lineGross(line)).toBe(130000)
    expect(lineSubtotal(line)).toBe(130000)
  })

  it('takes the discount off the gross', () => {
    expect(lineSubtotal({ ...line, diskon: 30000 })).toBe(100000)
  })

  it('floors at zero rather than paying the customer', () => {
    expect(lineSubtotal({ ...line, diskon: 999999 })).toBe(0)
  })

  it('discounts the tier price, not the master price, when a tier applies', () => {
    // 6 x 62000 tier price = 372000, less 2000
    const tiered: CartLine = { ...line, qty: 6 }
    expect(lineGross(tiered)).toBe(372000)
    expect(lineSubtotal({ ...tiered, diskon: 2000 })).toBe(370000)
  })
})

describe('cartModal', () => {
  it('costs each line at its own satuan cost, not at the base cost', () => {
    const cart: CartLine[] = [
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 },
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 },
    ]

    // 2 x 60000 base cost + 1 x 720000 DUS cost - never 12 x 60000 for the DUS line
    expect(cartModal(cart)).toBe(840000)
  })

  it('is what a discounted bill has to clear: below it the sale loses money', () => {
    const cart: CartLine[] = [
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2, diskon: 20000 },
    ]

    // 130000 gross, 20000 off, against 120000 of cost
    expect(lineSubtotal(cart[0])).toBe(110000)
    expect(cartModal(cart)).toBe(120000)
  })

  it('is zero for an empty cart', () => {
    expect(cartModal([])).toBe(0)
  })
})

describe('applyDiskon', () => {
  const cart: CartLine[] = [
    { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2 },
    { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1 },
  ]

  it('sets a percentage against the line it lands on, not the whole cart', () => {
    const result = applyDiskon(cart, lineKey(1, null), '10%')

    expect(result[0].diskon).toBe(13000)
    expect(result[1].diskon).toBeUndefined()
  })

  it('clamps to the line it lands on', () => {
    expect(applyDiskon(cart, lineKey(1, null), '999999')[0].diskon).toBe(130000)
  })
})

describe('cartFromSale', () => {
  it.each(['normal', 'price_tier', 'manual'] as const)('keeps a 10000 bon price after catalog drops to 9000 (%s)', (priceSource) => {
    const catalog = { ...product, hargaJual: 9000, hargaPokok: 11000, priceTiers: [] }
    const { cart } = cartFromSale([{ productId: 1, productUnitId: 1, qty: 2, hargaJual: 10000, priceSource }], [catalog])
    expect(unitPrice(cart[0])).toBe(10000)
    expect(lineSubtotal(cart[0])).toBe(20000)
    expect(isBelowHargaPokok(cart[0])).toBe(false)
  })

  it('maps the stored base product_units id back to the cart null base unit', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product]).cart).toEqual([
      { key: lineKey(1, null), product, productUnitId: null, satuan: 'PCS', qty: 2, hargaOverride: 65000, hargaSnapshot: 65000, diskon: 0 },
    ])
    expect(cartFromSale(items, [product]).dropped).toBe(0)
  })

  it('keeps a derived unit as itself', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 9, qty: 1, hargaJual: 700000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product]).cart).toEqual([
      { key: lineKey(1, 9), product, productUnitId: 9, satuan: 'DUS', qty: 1, hargaOverride: 700000, hargaSnapshot: 700000, diskon: 0 },
    ])
  })

  it('turns a manually priced line back into an override', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 55000, priceSource: 'manual' },
    ]

    expect(cartFromSale(items, [product]).cart[0].hargaOverride).toBe(55000)
  })

  it('preserves the saved tier price', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 5, hargaJual: 62000, priceSource: 'price_tier' },
    ]

    expect(cartFromSale(items, [product]).cart[0].hargaOverride).toBe(62000)
  })

  it('drops a line whose product is gone from the catalog, and reports it as dropped', () => {
    const items: EditSaleItem[] = [
      { productId: 77, productUnitId: 1, qty: 1, hargaJual: 1000, priceSource: 'normal' },
    ]

    const result = cartFromSale(items, [product])

    expect(result.cart).toEqual([])
    expect(result.dropped).toBe(1)
  })

  it('preserves the saved order of the lines', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 9, qty: 1, hargaJual: 700000, priceSource: 'normal' },
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
    ]

    expect(cartFromSale(items, [product]).cart.map((line) => line.key)).toEqual([lineKey(1, 9), lineKey(1, null)])
  })

  it('drops a line whose derived unit was deleted from the catalog, and reports it as dropped', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 999, qty: 1, hargaJual: 700000, priceSource: 'normal' },
    ]

    const result = cartFromSale(items, [product])

    expect(result.cart).toEqual([])
    expect(result.dropped).toBe(1)
  })

  it('keeps separate saved rows for the same product and unit', () => {
    // addItemsToSale plain-inserts rather than merging, so a bon topped up with a
    // product already on it can carry two rows for the same product+unit
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 2, hargaJual: 65000, priceSource: 'normal' },
      { productId: 1, productUnitId: 1, qty: 3, hargaJual: 65000, priceSource: 'normal' },
    ]

    const result = cartFromSale(items, [product])

    expect(result.cart).toHaveLength(2)
    expect(result.cart.map(line => line.qty)).toEqual([2, 3])
    expect(new Set(result.cart.map(line => line.key)).size).toBe(2)
    expect(result.dropped).toBe(0)
  })

  it('preserves different prices on duplicate product rows', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 50000, priceSource: 'manual' },
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 55000, priceSource: 'manual' },
    ]

    const result = cartFromSale(items, [product])

    expect(result.cart).toHaveLength(2)
    expect(result.cart.map(line => line.hargaOverride)).toEqual([50000, 55000])
  })

  it('counts a dropped-product line and a dropped-unit line separately in a mixed batch', () => {
    const items: EditSaleItem[] = [
      { productId: 1, productUnitId: 1, qty: 1, hargaJual: 65000, priceSource: 'normal' },
      { productId: 77, productUnitId: 1, qty: 1, hargaJual: 1000, priceSource: 'normal' },
      { productId: 1, productUnitId: 999, qty: 1, hargaJual: 700000, priceSource: 'normal' },
    ]

    const result = cartFromSale(items, [product])

    expect(result.cart).toHaveLength(1)
    expect(result.dropped).toBe(2)
  })
})
