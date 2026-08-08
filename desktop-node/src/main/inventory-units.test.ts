import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, productPriceHistories, users } from './db/schema'
import {
  listProductUnits,
  addProductUnit,
  updateProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  listPriceTiers,
  listPriceHistory,
  getProductDetail,
} from './inventory-units'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedProduct() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(products)
    .values({
      id: 1,
      kodeItem: 'RKK1',
      barcode: null,
      namaItem: 'Rokok A',
      categoryId: null,
      satuan: 'Pcs',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

describe('listProductUnits', () => {
  it('returns an empty array when no derived units exist', () => {
    const db = seedProduct()
    expect(listProductUnits(db, 1)).toEqual([])
  })
})

describe('addProductUnit', () => {
  const validInput = { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }

  it('appends the first unit with konversi equal to jumlahKemasan', () => {
    const db = seedProduct()

    addProductUnit(db, 1, validInput)

    const units = listProductUnits(db, 1)
    expect(units).toEqual([
      { id: expect.any(Number), satuan: 'Renteng', jumlahKemasan: 12, konversi: 12, hargaJual: 15000_00 },
    ])
  })

  it('supports a chain longer than 2 derived units, each konversi cumulative from the one below it', () => {
    const db = seedProduct()

    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }) // 12
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // 10 * 12 = 120
    addProductUnit(db, 1, { satuan: 'Pak', jumlahKemasan: 5, hargaJual: 650000_00 }) // 5 * 120 = 600

    const units = listProductUnits(db, 1)
    expect(units.map((u) => ({ satuan: u.satuan, konversi: u.konversi }))).toEqual([
      { satuan: 'Renteng', konversi: 12 },
      { satuan: 'Dus', konversi: 120 },
      { satuan: 'Pak', konversi: 600 },
    ])
  })

  it('throws when satuan already exists for the product', () => {
    const db = seedProduct()
    addProductUnit(db, 1, validInput)

    expect(() => addProductUnit(db, 1, { ...validInput, hargaJual: 16000_00 })).toThrow('Satuan "Renteng" sudah ada.')
  })

  it('throws when satuan is empty', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, satuan: 'a'.repeat(21) })).toThrow('Satuan maksimal 20 karakter.')
  })

  it('throws when jumlahKemasan is not finite', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, jumlahKemasan: NaN })).toThrow('Jumlah kemasan wajib diisi.')
  })

  it('throws when jumlahKemasan is less than 1', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, jumlahKemasan: 0 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when jumlahKemasan is not an integer', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, jumlahKemasan: 1.5 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })
})

describe('updateProductUnit', () => {
  it('recomputes konversi for the edited unit and every unit above it, leaving units below untouched', () => {
    const db = seedProduct()

    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }) // 12
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // 120
    addProductUnit(db, 1, { satuan: 'Pak', jumlahKemasan: 5, hargaJual: 650000_00 }) // 600

    const [renteng, dus] = listProductUnits(db, 1)
    updateProductUnit(db, 1, renteng.id, { satuan: 'Renteng', jumlahKemasan: 24, hargaJual: 15000_00 })

    const units = listProductUnits(db, 1)
    expect(units.map((u) => u.konversi)).toEqual([24, 240, 1200])
    expect(units[1].id).toBe(dus.id)
    expect(units[1].jumlahKemasan).toBe(10) // unchanged relative quantity
  })

  it('throws when the unit does not belong to the product', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })

    expect(() => updateProductUnit(db, 1, 999, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan tidak ditemukan.',
    )
  })

  it('throws when renaming to a satuan already used by another unit of the same product', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })

    const [renteng] = listProductUnits(db, 1)
    expect(() => updateProductUnit(db, 1, renteng.id, { satuan: 'Dus', jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan "Dus" sudah ada.',
    )
  })

  it('allows re-saving a unit with its own unchanged satuan', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, 1)
    expect(() => updateProductUnit(db, 1, renteng.id, { satuan: 'Renteng', jumlahKemasan: 20, hargaJual: 16000_00 })).not.toThrow()
    expect(listProductUnits(db, 1)[0]).toMatchObject({ jumlahKemasan: 20, konversi: 20, hargaJual: 16000_00 })
  })
})

describe('deleteProductUnit', () => {
  it('deletes a unit with nothing above it', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, 1)
    deleteProductUnit(db, 1, renteng.id)

    expect(listProductUnits(db, 1)).toEqual([])
  })

  it('cascades: deleting a middle unit also deletes every unit above it, leaving units below untouched', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    addProductUnit(db, 1, { satuan: 'Pak', jumlahKemasan: 5, hargaJual: 650000_00 })

    const [renteng, dus] = listProductUnits(db, 1)
    deleteProductUnit(db, 1, dus.id)

    const remaining = listProductUnits(db, 1)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(renteng.id)
  })

  it('is a no-op when the unit does not exist', () => {
    const db = seedProduct()
    expect(() => deleteProductUnit(db, 1, 999)).not.toThrow()
  })
})

describe('addPriceTier', () => {
  it('adds a price tier', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const tiers = listPriceTiers(db, 1)
    expect(tiers).toEqual([{ id: expect.any(Number), minQty: 6, hargaJual: 1400_00 }])
  })

  it('throws when minQty is not finite', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: NaN, hargaJual: 1400_00 })).toThrow('Qty minimal wajib diisi.')
  })

  it('throws when minQty is less than 2', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 1, hargaJual: 1400_00 })).toThrow('Qty minimal harus 2 atau lebih.')
  })

  it('throws when minQty is not an integer', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 2.5, hargaJual: 1400_00 })).toThrow('Qty minimal harus 2 atau lebih.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 6, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 6, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })

  it('throws a friendly message when minQty already exists for the product', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    expect(() => addPriceTier(db, 1, { minQty: 6, hargaJual: 1300_00 })).toThrow('Harga bertingkat untuk qty 6 sudah ada.')
  })
})

describe('deletePriceTier', () => {
  it('deletes a tier belonging to the product', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })
    const [tier] = listPriceTiers(db, 1)
    deletePriceTier(db, 1, tier.id)

    expect(listPriceTiers(db, 1)).toEqual([])
  })

  it('throws when the tier does not belong to the product', () => {
    const db = seedProduct()
    const now = new Date()

    db.insert(products)
      .values({
        id: 2,
        kodeItem: 'RKK2',
        barcode: null,
        namaItem: 'Rokok B',
        categoryId: null,
        satuan: 'Pcs',
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 50,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    addPriceTier(db, 2, { minQty: 6, hargaJual: 1400_00 })
    const [tier] = listPriceTiers(db, 2)

    expect(() => deletePriceTier(db, 1, tier.id)).toThrow('Harga bertingkat tidak ditemukan.')
  })
})

describe('listPriceTiers', () => {
  it('returns tiers sorted by minQty ascending', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 12, hargaJual: 1300_00 })
    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const tiers = listPriceTiers(db, 1)
    expect(tiers.map((t) => t.minQty)).toEqual([6, 12])
  })
})

describe('listPriceHistory', () => {
  it('returns price history rows with the editor name, newest first', () => {
    const db = seedProduct()
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'admin', passwordHash: 'x', name: 'Admin', createdAt: now, updatedAt: now })
      .run()

    db.insert(productPriceHistories)
      .values([
        {
          productId: 1,
          userId: 1,
          hargaPokokLama: 1000_00,
          hargaPokokBaru: 1100_00,
          hargaJualLama: 1500_00,
          hargaJualBaru: 1600_00,
          createdAt: new Date(now.getTime() - 1000),
          updatedAt: now,
        },
        {
          productId: 1,
          userId: null,
          hargaPokokLama: 1100_00,
          hargaPokokBaru: 1200_00,
          hargaJualLama: 1600_00,
          hargaJualBaru: 1700_00,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run()

    const history = listPriceHistory(db, 1)
    expect(history).toHaveLength(2)
    expect(history[0].userName).toBeNull()
    expect(history[1].userName).toBe('Admin')
  })
})

describe('getProductDetail', () => {
  it('bundles units, price tiers, and price history', () => {
    const db = seedProduct()

    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const detail = getProductDetail(db, 1)
    expect(detail.units).toHaveLength(1)
    expect(detail.units[0]).toMatchObject({ satuan: 'Renteng', konversi: 12 })
    expect(detail.priceTiers).toHaveLength(1)
    expect(detail.priceHistory).toEqual([])
  })
})
