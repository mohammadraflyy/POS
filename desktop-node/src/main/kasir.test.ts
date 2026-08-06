import { describe, expect, it } from 'vitest'
import { priceForQty, resolveCartItem, type ProductRow, type ProductUnitRow } from './kasir'

describe('priceForQty', () => {
  it('falls back to the base price when there are no tiers', () => {
    expect(priceForQty([], 10000, 5)).toBe(10000)
  })

  it('applies a tier when qty meets its threshold', () => {
    expect(priceForQty([{ minQty: 10, hargaJual: 9000 }], 10000, 12)).toBe(9000)
  })

  it('picks the highest satisfied tier threshold', () => {
    const tiers = [
      { minQty: 10, hargaJual: 9500 },
      { minQty: 50, hargaJual: 9000 },
    ]
    expect(priceForQty(tiers, 10000, 60)).toBe(9000)
    expect(priceForQty(tiers, 10000, 20)).toBe(9500)
    expect(priceForQty(tiers, 10000, 5)).toBe(10000)
  })
})

describe('resolveCartItem', () => {
  const product: ProductRow = {
    id: 1,
    namaItem: 'Beras 5kg',
    satuan: 'PCS',
    hargaJual: 65000_00,
    hargaPokok: 60000_00,
    stok: 30,
  }

  it('resolves the base unit with tier pricing when no product unit is given', () => {
    const result = resolveCartItem(product, null, [{ minQty: 5, hargaJual: 62000_00 }], 5)
    expect(result).toEqual({
      productId: 1,
      productUnitId: null,
      satuan: 'PCS',
      konversi: 1,
      hargaJual: 62000_00,
      hargaPokok: 60000_00,
      qty: 5,
      qtyDasar: 5,
    })
  })

  it('resolves a product unit, overriding satuan/konversi/hargaJual', () => {
    const unit: ProductUnitRow = { id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000_00 }
    const result = resolveCartItem(product, unit, [], 2)
    expect(result).toEqual({
      productId: 1,
      productUnitId: 9,
      satuan: 'DUS',
      konversi: 12,
      hargaJual: 700000_00,
      hargaPokok: 60000_00,
      qty: 2,
      qtyDasar: 24,
    })
  })

  it('throws when base-unit stock is insufficient', () => {
    expect(() => resolveCartItem(product, null, [], 50)).toThrow('Stok Beras 5kg tidak cukup.')
  })

  it('throws when a product-unit purchase would exceed base-unit stock', () => {
    const unit: ProductUnitRow = { id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000_00 }
    expect(() => resolveCartItem(product, unit, [], 3)).toThrow('Stok Beras 5kg tidak cukup.')
  })
})
