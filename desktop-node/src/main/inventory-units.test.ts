import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, productPriceHistories, users } from './db/schema'
import {
  getProductUnits,
  setProductUnit,
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

describe('getProductUnits', () => {
  it('returns null for both levels when none exist', () => {
    const db = seedProduct()
    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })
})

describe('setProductUnit', () => {
  const validInput = { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }

  it('creates a level 2 unit with konversi equal to jumlahKemasan', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)

    const { level2, level3 } = getProductUnits(db, 1)
    expect(level2).toMatchObject({ level: 2, satuan: 'Renteng', jumlahKemasan: 12, konversi: 12, hargaJual: 15000_00 })
    expect(level3).toBeNull()
  })

  it('creates a level 3 unit with konversi = jumlahKemasan * level 2 konversi', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })

    const { level3 } = getProductUnits(db, 1)
    expect(level3).toMatchObject({ level: 3, satuan: 'Dus', jumlahKemasan: 10, konversi: 120 })
  })

  it('throws when level 3 is set before level 2 exists', () => {
    const db = seedProduct()

    expect(() => setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })).toThrow(
      'Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3.',
    )
  })

  it('updates an existing level 2 unit (upsert)', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)
    setProductUnit(db, 1, 2, { satuan: 'Renteng Baru', jumlahKemasan: 20, hargaJual: 20000_00 })

    const { level2 } = getProductUnits(db, 1)
    expect(level2).toMatchObject({ satuan: 'Renteng Baru', jumlahKemasan: 20, konversi: 20, hargaJual: 20000_00 })
  })

  it('recomputes level 3 konversi when level 2 is updated, keeping level 3 jumlahKemasan unchanged', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput) // konversi 12
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // konversi 120
    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 24, hargaJual: 15000_00 }) // konversi 24

    const { level3 } = getProductUnits(db, 1)
    expect(level3?.konversi).toBe(240) // 10 * 24
    expect(level3?.jumlahKemasan).toBe(10) // unchanged relative quantity
  })

  it('throws when satuan is empty', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, satuan: 'a'.repeat(21) })).toThrow('Satuan maksimal 20 karakter.')
  })

  it('throws when jumlahKemasan is not finite', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: NaN })).toThrow('Jumlah kemasan wajib diisi.')
  })

  it('throws when jumlahKemasan is less than 1', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: 0 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when jumlahKemasan is not an integer', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: 1.5 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })
})

describe('deleteProductUnit', () => {
  it('deletes a level 2 unit with no level 3', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    deleteProductUnit(db, 1, 2)

    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })

  it('deletes a level 3 unit without affecting level 2', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    deleteProductUnit(db, 1, 3)

    const { level2, level3 } = getProductUnits(db, 1)
    expect(level2).not.toBeNull()
    expect(level3).toBeNull()
  })

  it('cascades: deleting level 2 also deletes level 3', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    deleteProductUnit(db, 1, 2)

    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })

  it('is a no-op when the level does not exist', () => {
    const db = seedProduct()
    expect(() => deleteProductUnit(db, 1, 2)).not.toThrow()
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

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const detail = getProductDetail(db, 1)
    expect(detail.units.level2).not.toBeNull()
    expect(detail.units.level3).toBeNull()
    expect(detail.priceTiers).toHaveLength(1)
    expect(detail.priceHistory).toEqual([])
  })
})
