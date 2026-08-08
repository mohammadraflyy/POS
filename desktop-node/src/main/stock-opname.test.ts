import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, stockAdjustments, users } from './db/schema'
import {
  listCategories,
  searchProductsForOpname,
  recordStockAdjustment,
} from './stock-opname'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  db.insert(categories)
    .values([
      { id: 1, nama: 'Sembako', createdAt: now, updatedAt: now },
      { id: 2, nama: 'Minuman', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'KOPI1',
        barcode: '8991234567890',
        namaItem: 'Kopi Kapal Api',
        categoryId: 1,
        satuan: 'PCS',
        hargaPokok: 1500_00,
        hargaJual: 2000_00,
        stok: 10,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        kodeItem: 'GULA1',
        barcode: null,
        namaItem: 'Gula Pasir',
        categoryId: 1,
        satuan: 'KG',
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 50,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 3,
        kodeItem: 'TEHBOTOL1',
        barcode: null,
        namaItem: 'Teh Botol',
        categoryId: 2,
        satuan: 'PCS',
        hargaPokok: 3000_00,
        hargaJual: 4000_00,
        stok: 20,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 4,
        kodeItem: 'NONAKTIF1',
        barcode: null,
        namaItem: 'Produk Nonaktif',
        categoryId: 1,
        satuan: 'PCS',
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 5,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  return db
}

describe('listCategories', () => {
  it('returns categories ordered by nama', () => {
    const db = seedDb()
    const result = listCategories(db)
    expect(result).toEqual([
      { id: 2, nama: 'Minuman' },
      { id: 1, nama: 'Sembako' },
    ])
  })
})

describe('searchProductsForOpname', () => {
  it('matches on kodeItem, namaItem, or barcode', () => {
    const db = seedDb()
    expect(searchProductsForOpname(db, { q: 'kopi', categoryIds: [] })).toHaveLength(1)
    expect(searchProductsForOpname(db, { q: 'GULA1', categoryIds: [] })).toHaveLength(1)
    expect(searchProductsForOpname(db, { q: '8991234567890', categoryIds: [] })).toHaveLength(1)
  })

  it('matches on the product category name', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: 'minuman', categoryIds: [] })
    expect(result.map((r) => r.namaItem)).toEqual(['Teh Botol'])
  })

  it('filters by categoryIds', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [2] })
    expect(result.map((r) => r.namaItem)).toEqual(['Teh Botol'])
  })

  it('combines keyword and category filters', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: 'kopi', categoryIds: [2] })
    expect(result).toHaveLength(0)
  })

  it('excludes inactive products', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [1] })
    expect(result.map((r) => r.namaItem)).not.toContain('Produk Nonaktif')
  })

  it('caps keyword search at 20 results', () => {
    const db = seedDb()
    const now = new Date()
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      kodeItem: `BANYAK${i}`,
      barcode: null,
      namaItem: `Produk Banyak ${i}`,
      categoryId: 1,
      satuan: 'PCS',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(many).run()

    const result = searchProductsForOpname(db, { q: 'Produk Banyak', categoryIds: [] })
    expect(result).toHaveLength(20)
  })

  it('does not cap results when browsing by category with no keyword', () => {
    const db = seedDb()
    const now = new Date()
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      kodeItem: `BANYAK${i}`,
      barcode: null,
      namaItem: `Produk Banyak ${i}`,
      categoryId: 1,
      satuan: 'PCS',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(many).run()

    const result = searchProductsForOpname(db, { q: '', categoryIds: [1] })
    expect(result.length).toBeGreaterThan(20)
    expect(result).toHaveLength(27) // 25 new + Kopi Kapal Api + Gula Pasir, both category 1
  })

  it('returns a capped, non-throwing result when q and categoryIds are both empty', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [] })
    expect(result.length).toBeLessThanOrEqual(20)
  })

  it('orders results by namaItem', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [1] })
    const names = result.map((r) => r.namaItem)
    expect(names).toEqual([...names].sort())
  })
})

describe('recordStockAdjustment', () => {
  it('records a count-up and increments products.stok', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 15, alasan: 'Hitung fisik bulanan', userId: 1 })

    expect(result.id).toBeGreaterThan(0)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(15)

    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment).toMatchObject({
      productId: 1,
      userId: 1,
      stokSebelum: 10,
      stokSesudah: 15,
      selisih: 5,
      alasan: 'Hitung fisik bulanan',
    })
  })

  it('records a count-down with a negative selisih', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 2, stokSesudah: 45, alasan: null, userId: 1 })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.stok).toBe(45)

    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.selisih).toBe(-5)
  })

  it('records a zero-change adjustment', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 10, alasan: null, userId: 1 })

    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment).toMatchObject({ stokSebelum: 10, stokSesudah: 10, selisih: 0 })
  })

  it('stores a missing alasan as null', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 12, alasan: null, userId: 1 })
    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.alasan).toBeNull()
  })

  it('trims alasan and stores whitespace-only as null', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 12, alasan: '   ', userId: 1 })
    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.alasan).toBeNull()
  })

  it('allows a null userId', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 12, alasan: null, userId: null })
    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.userId).toBeNull()
  })

  it('throws when stokSesudah is negative', () => {
    const db = seedDb()
    expect(() => recordStockAdjustment(db, { productId: 1, stokSesudah: -1, alasan: null, userId: 1 })).toThrow(
      'Stok fisik harus bilangan bulat, minimal 0.',
    )
  })

  it('throws when stokSesudah is not an integer', () => {
    const db = seedDb()
    expect(() => recordStockAdjustment(db, { productId: 1, stokSesudah: 1.5, alasan: null, userId: 1 })).toThrow(
      'Stok fisik harus bilangan bulat, minimal 0.',
    )
  })

  it('throws when the product does not exist', () => {
    const db = seedDb()
    expect(() => recordStockAdjustment(db, { productId: 999, stokSesudah: 5, alasan: null, userId: 1 })).toThrow(
      'Produk tidak ditemukan.',
    )
  })
})
