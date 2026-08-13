import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { products, productPriceHistories, users, units, productUnits } from './db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from './db/schema'
import {
  listProductUnits,
  getBaseProductUnit,
  addProductUnit,
  updateProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  listPriceTiers,
  listPriceHistory,
  getProductDetail,
  syncUnitCostsFromBase,
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
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  seedBaseUnit(db, 1, 1500_00)

  return db
}

/**
 * Gives a product the base `product_units` row every product must have - price
 * tiers and cart resolution both look it up by `isBaseUnit`.
 */
function seedBaseUnit(db: ReturnType<typeof createDb>, productId: number, hargaJual: number) {
  const now = new Date()
  const unitId = seedUnit(db, { code: `BASE${productId}`, name: `Base ${productId}`, symbol: `b${productId}` })

  db.insert(productUnits)
    .values({
      productId,
      unitId,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual,
      isBaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

let unitSeq = 0

/** Seeds a `units` row with a unique code/name/symbol and returns its id. */
function seedUnit(db: BetterSQLite3Database<typeof schema>, overrides: Partial<{ code: string; name: string; symbol: string }> = {}) {
  unitSeq += 1
  const now = new Date()
  const unit = db
    .insert(units)
    .values({
      code: overrides.code ?? `UNIT${unitSeq}`,
      name: overrides.name ?? `Unit ${unitSeq}`,
      symbol: overrides.symbol ?? `u${unitSeq}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()
  return unit.id
}

/**
 * Seeds a product with a base-unit product_units row (isBaseUnit=true, conversionFactor=1),
 * mirroring what the post-migration schema guarantees for every real product.
 */
function seedProductWithUnits(db: BetterSQLite3Database<typeof schema>) {
  const now = new Date()
  const baseUnitId = seedUnit(db, { code: 'PCS', name: 'Pcs', symbol: 'pcs' })

  const product = db
    .insert(products)
    .values({
      kodeItem: 'RKK1',
      barcode: null,
      namaItem: 'Rokok A',
      categoryId: null,
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  const baseRow = db
    .insert(productUnits)
    .values({
      productId: product.id,
      unitId: baseUnitId,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual: 1500_00,
      isBaseUnit: true,
      isDefaultSalesUnit: true,
      isDefaultPurchaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  const baseUnit = listProductUnits(db, product.id)[0]

  return { productId: product.id, baseUnitRowId: baseRow.id, baseUnit }
}

describe('getBaseProductUnit', () => {
  it('returns the row with isBaseUnit = true', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const base = getBaseProductUnit(db, productId)
    expect(base.id).toBe(baseUnitRowId)
    expect(base.conversionFactor).toBe(1)
  })

  it('throws when the product has no base unit row', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => getBaseProductUnit(db, 999)).toThrow('tidak memiliki satuan dasar')
  })
})

describe('listProductUnits', () => {
  it('includes the base unit row when no derived units exist', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const rows = listProductUnits(db, productId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(baseUnitRowId)
    expect(rows[0].isBaseUnit).toBe(true)
  })
})

describe('addProductUnit', () => {
  it('appends the first derived unit with conversionFactor equal to jumlahKemasan', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })

    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })

    const derived = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(derived).toEqual([
      expect.objectContaining({ unitId: rentengId, jumlahKemasan: 12, conversionFactor: 12, hargaJual: 15000_00, isBaseUnit: false }),
    ])
  })

  it('supports a chain longer than 2 derived units, each conversionFactor cumulative from the one below it', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const dusId = seedUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    const pakId = seedUnit(db, { code: 'PAK', name: 'Pak', symbol: 'pak' })

    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 }) // 12
    addProductUnit(db, productId, { unitId: dusId, jumlahKemasan: 10, hargaJual: 140000_00 }) // 10 * 12 = 120
    addProductUnit(db, productId, { unitId: pakId, jumlahKemasan: 5, hargaJual: 650000_00 }) // 5 * 120 = 600

    const derived = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(derived.map((u) => ({ unitId: u.unitId, conversionFactor: u.conversionFactor }))).toEqual([
      { unitId: rentengId, conversionFactor: 12 },
      { unitId: dusId, conversionFactor: 120 },
      { unitId: pakId, conversionFactor: 600 },
    ])
  })

  it('breaks conversionFactor ties deterministically by insertion order (id) when jumlahKemasan is 1', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const altId = seedUnit(db, { code: 'ALT', name: 'Alt', symbol: 'alt' })

    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 }) // conversionFactor 12
    addProductUnit(db, productId, { unitId: altId, jumlahKemasan: 1, hargaJual: 15000_00 }) // conversionFactor 12, ties with Renteng

    const derived = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(derived.map((u) => u.unitId)).toEqual([rentengId, altId])
  })

  it('throws when the unit is already used for the product', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })

    expect(() => addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 6, hargaJual: 16000_00 })).toThrow(
      'Satuan ini sudah dipakai untuk produk ini.',
    )
  })

  it('throws when the unit does not exist', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    expect(() => addProductUnit(db, productId, { unitId: 999, jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan tidak ditemukan atau tidak aktif.',
    )
  })

  it('throws when the unit is inactive', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const now = new Date()
    const inactiveUnit = db
      .insert(units)
      .values({ code: 'OLD', name: 'Old', symbol: 'old', isActive: false, createdAt: now, updatedAt: now })
      .returning()
      .get()

    expect(() => addProductUnit(db, productId, { unitId: inactiveUnit.id, jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan tidak ditemukan atau tidak aktif.',
    )
  })

  it('throws when jumlahKemasan is not finite', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    expect(() => addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: NaN, hargaJual: 15000_00 })).toThrow(
      'Jumlah kemasan minimal 1.',
    )
  })

  it('throws when jumlahKemasan is less than 1', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    expect(() => addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 0, hargaJual: 15000_00 })).toThrow(
      'Jumlah kemasan minimal 1.',
    )
  })

  it('throws when jumlahKemasan is not an integer', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    expect(() => addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 1.5, hargaJual: 15000_00 })).toThrow(
      'Jumlah kemasan minimal 1.',
    )
  })

  it('throws when hargaJual is not finite', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    expect(() => addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: NaN })).toThrow(
      'Harga jual wajib diisi dan tidak boleh negatif.',
    )
  })

  it('throws when hargaJual is negative', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    expect(() => addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: -1 })).toThrow(
      'Harga jual wajib diisi dan tidak boleh negatif.',
    )
  })
})

describe('updateProductUnit', () => {
  it('recomputes conversionFactor for the edited unit and every unit above it, leaving units below untouched', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const dusId = seedUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    const pakId = seedUnit(db, { code: 'PAK', name: 'Pak', symbol: 'pak' })

    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 }) // 12
    addProductUnit(db, productId, { unitId: dusId, jumlahKemasan: 10, hargaJual: 140000_00 }) // 120
    addProductUnit(db, productId, { unitId: pakId, jumlahKemasan: 5, hargaJual: 650000_00 }) // 600

    const [renteng, dus] = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    updateProductUnit(db, productId, renteng.id, { unitId: rentengId, jumlahKemasan: 24, hargaJual: 15000_00 })

    const derived = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(derived.map((u) => u.conversionFactor)).toEqual([24, 240, 1200])
    expect(derived[1].id).toBe(dus.id)
    expect(derived[1].jumlahKemasan).toBe(10) // unchanged relative quantity
  })

  it('throws when the unit does not belong to the product', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })

    expect(() =>
      updateProductUnit(db, productId, 999, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 }),
    ).toThrow('Satuan tidak ditemukan.')
  })

  it('throws when changing to a unit already used by another derived row of the same product', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const dusId = seedUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })
    addProductUnit(db, productId, { unitId: dusId, jumlahKemasan: 10, hargaJual: 140000_00 })

    const [renteng] = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(() => updateProductUnit(db, productId, renteng.id, { unitId: dusId, jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan ini sudah dipakai untuk produk ini.',
    )
  })

  it('throws a friendly error (not a raw SQLite constraint error) when changing a derived unit to match the base unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnit } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(() =>
      updateProductUnit(db, productId, renteng.id, { unitId: baseUnit.unitId, jumlahKemasan: 12, hargaJual: 15000_00 }),
    ).toThrow('Satuan ini sudah dipakai untuk produk ini.')
  })

  it('allows re-saving a derived unit with its own unchanged unitId', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(() =>
      updateProductUnit(db, productId, renteng.id, { unitId: rentengId, jumlahKemasan: 20, hargaJual: 16000_00 }),
    ).not.toThrow()
    const derived = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(derived[0]).toMatchObject({ jumlahKemasan: 20, conversionFactor: 20, hargaJual: 16000_00 })
  })

  it('updates only hargaJual on the base unit row and syncs products.hargaJual', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId, baseUnit } = seedProductWithUnits(db)

    updateProductUnit(db, productId, baseUnitRowId, { unitId: baseUnit.unitId, jumlahKemasan: 1, hargaJual: 99900 })

    const base = getBaseProductUnit(db, productId)
    expect(base.hargaJual).toBe(99900)
    expect(base.jumlahKemasan).toBe(1)
    expect(base.conversionFactor).toBe(1)
    expect(base.unitId).toBe(baseUnit.unitId)
  })

  it('syncs products.hargaJual when the base unit price changes', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId, baseUnit } = seedProductWithUnits(db)
    updateProductUnit(db, productId, baseUnitRowId, { unitId: baseUnit.unitId, jumlahKemasan: 1, hargaJual: 99900 })
    const product = db.select().from(products).where(eq(products.id, productId)).get()
    expect(product?.hargaJual).toBe(99900)
  })

  it('throws when updating the base unit with a negative hargaJual', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId, baseUnit } = seedProductWithUnits(db)
    expect(() =>
      updateProductUnit(db, productId, baseUnitRowId, { unitId: baseUnit.unitId, jumlahKemasan: 1, hargaJual: -1 }),
    ).toThrow('Harga jual wajib diisi dan tidak boleh negatif.')
  })
})

describe('deleteProductUnit', () => {
  it('deletes a derived unit with nothing above it', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    deleteProductUnit(db, productId, renteng.id)

    expect(listProductUnits(db, productId).filter((u) => !u.isBaseUnit)).toEqual([])
  })

  it('cascades: deleting a middle unit also deletes every unit above it, leaving units below untouched', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const dusId = seedUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    const pakId = seedUnit(db, { code: 'PAK', name: 'Pak', symbol: 'pak' })
    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })
    addProductUnit(db, productId, { unitId: dusId, jumlahKemasan: 10, hargaJual: 140000_00 })
    addProductUnit(db, productId, { unitId: pakId, jumlahKemasan: 5, hargaJual: 650000_00 })

    const [renteng, dus] = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    deleteProductUnit(db, productId, dus.id)

    const remaining = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(renteng.id)
  })

  it('is a no-op when the unit does not exist', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId } = seedProductWithUnits(db)
    expect(() => deleteProductUnit(db, productId, 999)).not.toThrow()
  })

  it('throws when deleting the base unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => deleteProductUnit(db, productId, baseUnitRowId)).toThrow('Satuan dasar tidak bisa dihapus.')
  })
})

describe('addPriceTier', () => {
  it('adds a price tier scoped to a unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: null, hargaJual: 1400_00 })

    expect(listPriceTiers(db, productId)).toEqual([
      { id: expect.any(Number), productUnitId: baseUnitRowId, minQty: 6, maxQty: null, hargaJual: 1400_00 },
    ])
  })

  it('throws when minQty is not finite', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: NaN, maxQty: null, hargaJual: 1400_00 })).toThrow(
      'Qty minimal wajib diisi.',
    )
  })

  it('throws when minQty is not greater than 0', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 0, maxQty: null, hargaJual: 5000 })).toThrow(
      'Qty minimal harus lebih dari 0.',
    )
  })

  it('throws when minQty is not an integer', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 2.5, maxQty: null, hargaJual: 5000 })).toThrow(
      'Qty minimal harus lebih dari 0.',
    )
  })

  it('throws when maxQty is less than minQty', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: 5, hargaJual: 5000 })).toThrow(
      'Qty maksimal harus lebih besar atau sama dengan qty minimal.',
    )
  })

  it('allows a single-qty range where maxQty equals minQty', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: 10, hargaJual: 5000 })

    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(1)
  })

  it('throws when hargaJual is not finite', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: null, hargaJual: NaN })).toThrow(
      'Harga jual wajib diisi.',
    )
  })

  it('throws when hargaJual is negative', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: null, hargaJual: -1 })).toThrow(
      'Harga jual tidak boleh negatif.',
    )
  })

  it('throws when the new range overlaps an existing tier', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 10, hargaJual: 5000 })

    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 8, maxQty: 20, hargaJual: 4500 })).toThrow(
      'Rentang qty tumpang tindih dengan tier yang sudah ada.',
    )
  })

  it('allows adjacent non-overlapping ranges', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 9, hargaJual: 5000 })
    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: 49, hargaJual: 4500 })

    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(2)
  })

  it('allows a second, unbounded tier after a bounded one', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 9, hargaJual: 5000 })
    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: null, hargaJual: 4500 })

    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(2)
  })

  it('rejects a bounded tier that would start inside an existing unbounded tier', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: null, hargaJual: 4000 })

    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 15, maxQty: 20, hargaJual: 3900 })).toThrow(
      'Rentang qty tumpang tindih dengan tier yang sudah ada.',
    )
  })

  it('scopes overlap checks per product_unit - the same range is fine on a different unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const boxUnitId = seedUnit(db, { code: 'BOX', name: 'Box', symbol: 'box' })
    addProductUnit(db, productId, { unitId: boxUnitId, jumlahKemasan: 10, hargaJual: 14000_00 })
    const derivedRowId = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)[0].id

    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 10, hargaJual: 1400_00 })
    addPriceTier(db, productId, derivedRowId, { minQty: 1, maxQty: 10, hargaJual: 13000_00 })

    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(1)
    expect(listPriceTiers(db, productId, derivedRowId)).toHaveLength(1)
    expect(listPriceTiers(db, productId)).toHaveLength(2)
  })
})

describe('deletePriceTier', () => {
  it('deletes a tier belonging to the product', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: null, hargaJual: 1400_00 })
    const [tier] = listPriceTiers(db, productId)
    deletePriceTier(db, productId, tier.id)

    expect(listPriceTiers(db, productId)).toEqual([])
  })

  it('throws when the tier does not belong to the product', () => {
    const db = createDb(':memory:', migrationsFolder)
    const first = seedProductWithUnits(db)
    const now = new Date()

    const second = db
      .insert(products)
      .values({
        kodeItem: 'RKK2',
        barcode: null,
        namaItem: 'Rokok B',
        categoryId: null,
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 50,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    seedBaseUnit(db, second.id, 1500_00)
    const secondBaseRowId = listProductUnits(db, second.id)[0].id

    addPriceTier(db, second.id, secondBaseRowId, { minQty: 6, maxQty: null, hargaJual: 1400_00 })
    const [tier] = listPriceTiers(db, second.id)

    expect(() => deletePriceTier(db, first.productId, tier.id)).toThrow('Harga bertingkat tidak ditemukan.')
  })

  // Acceptance criterion: a tier prices a sale at checkout time and is snapshotted
  // onto sale_items there, so removing one must never reach back into history.
  // deletePriceTier's own query is what is pinned here - it names only
  // product_price_tiers.
  it('deleting a price tier does not touch any existing sale_items row', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: null, hargaJual: 4200 })
    const tier = listPriceTiers(db, productId, baseUnitRowId)[0]
    deletePriceTier(db, productId, tier.id)

    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(0)
  })
})

describe('listPriceTiers', () => {
  it('returns tiers sorted by unit then minQty ascending', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)

    addPriceTier(db, productId, baseUnitRowId, { minQty: 12, maxQty: null, hargaJual: 1300_00 })
    addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: 11, hargaJual: 1400_00 })

    expect(listPriceTiers(db, productId).map((t) => t.minQty)).toEqual([6, 12])
  })

  it('returns every unit tier for the product when no unit is given', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const boxUnitId = seedUnit(db, { code: 'BOX', name: 'Box', symbol: 'box' })
    addProductUnit(db, productId, { unitId: boxUnitId, jumlahKemasan: 10, hargaJual: 14000_00 })
    const derivedRowId = listProductUnits(db, productId).filter((u) => !u.isBaseUnit)[0].id

    addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: null, hargaJual: 1400_00 })
    addPriceTier(db, productId, derivedRowId, { minQty: 2, maxQty: null, hargaJual: 13000_00 })

    const unitIds = listPriceTiers(db, productId).map((t) => t.productUnitId)
    expect([...unitIds].sort()).toEqual([baseUnitRowId, derivedRowId].sort())
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
  it('bundles units (including the base row), price tiers, and price history', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const rentengId = seedUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })

    addProductUnit(db, productId, { unitId: rentengId, jumlahKemasan: 12, hargaJual: 15000_00 })
    addPriceTier(db, productId, baseUnitRowId, { minQty: 6, maxQty: null, hargaJual: 1400_00 })

    const detail = getProductDetail(db, productId)
    expect(detail.units).toHaveLength(2)
    expect(detail.units.some((u) => u.isBaseUnit)).toBe(true)
    expect(detail.units.find((u) => !u.isBaseUnit)).toMatchObject({ unitId: rentengId, conversionFactor: 12 })
    expect(detail.priceTiers).toHaveLength(1)
    expect(detail.priceHistory).toEqual([])
  })
})

describe('per-unit cost outside purchases', () => {
  it('seeds a newly added unit from the base cost times its conversion', () => {
    const db = seedProduct() // products.hargaPokok is 1.000
    const pakUnitId = seedUnit(db, { code: 'PAK', name: 'Pak', symbol: 'pak' })

    addProductUnit(db, 1, { unitId: pakUnitId, jumlahKemasan: 10, hargaJual: 14000_00 })

    const pak = listProductUnits(db, 1).find((unit) => unit.unitCode === 'PAK')
    expect(pak?.hargaPokok).toBe(10000_00)
  })

  it('re-derives cost for every unit whose conversion is recomputed', () => {
    const db = seedProduct()
    const pakUnitId = seedUnit(db, { code: 'PAK', name: 'Pak', symbol: 'pak' })
    const dusUnitId = seedUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    addProductUnit(db, 1, { unitId: pakUnitId, jumlahKemasan: 10, hargaJual: 14000_00 })
    addProductUnit(db, 1, { unitId: dusUnitId, jumlahKemasan: 10, hargaJual: 140000_00 })

    const pak = listProductUnits(db, 1).find((unit) => unit.unitCode === 'PAK')!
    // PAK grows from 10 to 20 base units, so DUS grows from 100 to 200 - both costs follow
    updateProductUnit(db, 1, pak.id, { unitId: pakUnitId, jumlahKemasan: 20, hargaJual: 14000_00 })

    const after = listProductUnits(db, 1)
    expect(after.find((unit) => unit.unitCode === 'PAK')?.hargaPokok).toBe(20000_00)
    expect(after.find((unit) => unit.unitCode === 'DUS')?.hargaPokok).toBe(200000_00)
  })

  it('resets every unit cost when the product cost is stated by hand', () => {
    const db = seedProduct()
    const pakUnitId = seedUnit(db, { code: 'PAK', name: 'Pak', symbol: 'pak' })
    addProductUnit(db, 1, { unitId: pakUnitId, jumlahKemasan: 10, hargaJual: 14000_00 })

    syncUnitCostsFromBase(db, 1, 1200_00)

    const after = listProductUnits(db, 1)
    expect(after.find((unit) => unit.isBaseUnit)?.hargaPokok).toBe(1200_00)
    expect(after.find((unit) => unit.unitCode === 'PAK')?.hargaPokok).toBe(12000_00)
  })
})
