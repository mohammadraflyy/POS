import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, stockAdjustments, users } from './db/schema'
import { getProductsByIds, saveProductRows, validateBulkRows, bulkSaveProducts, type BulkSaveRow } from './inventory-bulk'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  // Create test users
  db.insert(users)
    .values([
      { id: 3, username: 'testuser3', passwordHash: 'hash', name: 'Test User 3', createdAt: now, updatedAt: now },
      { id: 5, username: 'testuser5', passwordHash: 'hash', name: 'Test User 5', createdAt: now, updatedAt: now },
      { id: 7, username: 'testuser7', passwordHash: 'hash', name: 'Test User 7', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(categories).values({ id: 1, nama: 'Sembako', createdAt: now, updatedAt: now }).run()

  db.insert(products)
    .values({
      id: 1,
      kodeItem: 'BRS5',
      barcode: '1234567890',
      namaItem: 'Beras 5kg',
      categoryId: 1,
      satuan: 'PCS',
      hargaPokok: 60000_00,
      hargaJual: 65000_00,
      stok: 10,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

function baseRow(overrides: Partial<BulkSaveRow> = {}): BulkSaveRow {
  return {
    key: 'row-1',
    id: null,
    kodeItem: 'NEW1',
    barcode: null,
    namaItem: 'Produk Baru',
    kategori: null,
    satuan: 'PCS',
    hargaPokok: 1000_00,
    hargaJual: 1500_00,
    stok: 5,
    ...overrides,
  }
}

describe('getProductsByIds', () => {
  it('returns matching products ordered by namaItem, with zero unit/tier counts by default', () => {
    const db = seedDb()
    const result = getProductsByIds(db, [1])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 1,
      kodeItem: 'BRS5',
      namaItem: 'Beras 5kg',
      categoryName: 'Sembako',
      unitsCount: 0,
      priceTiersCount: 0,
    })
  })

  it('returns an empty array for an empty id list', () => {
    const db = seedDb()
    expect(getProductsByIds(db, [])).toEqual([])
  })
})

describe('validateBulkRows', () => {
  it('returns no errors for valid rows', () => {
    const db = seedDb()
    expect(validateBulkRows(db, [baseRow()])).toEqual({})
  })

  it('flags missing required fields', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ kodeItem: '', namaItem: '', satuan: '' })])
    expect(errors['row-1']).toMatchObject({
      kodeItem: 'Kode item wajib diisi.',
      namaItem: 'Nama item wajib diisi.',
      satuan: 'Satuan wajib diisi.',
    })
  })

  it('flags non-finite and negative prices', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ hargaPokok: NaN, hargaJual: -1 })])
    expect(errors['row-1']).toMatchObject({
      hargaPokok: 'Harga pokok wajib diisi.',
      hargaJual: 'Harga jual tidak boleh negatif.',
    })
  })

  it('flags every row sharing a duplicate kodeItem within the batch', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [
      baseRow({ key: 'a', kodeItem: 'DUPE' }),
      baseRow({ key: 'b', kodeItem: 'DUPE' }),
    ])
    expect(errors.a.kodeItem).toBe('Kode item duplikat pada baris ini.')
    expect(errors.b.kodeItem).toBe('Kode item duplikat pada baris ini.')
  })

  it('flags every row sharing a duplicate barcode within the batch', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [
      baseRow({ key: 'a', kodeItem: 'A1', barcode: '999' }),
      baseRow({ key: 'b', kodeItem: 'B1', barcode: '999' }),
    ])
    expect(errors.a.barcode).toBe('Barcode duplikat pada baris ini.')
    expect(errors.b.barcode).toBe('Barcode duplikat pada baris ini.')
  })

  it('flags a kodeItem already used by a different product in the database', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ kodeItem: 'BRS5' })])
    expect(errors['row-1'].kodeItem).toBe('Kode item sudah digunakan.')
  })

  it('does not flag a row editing its own existing kodeItem', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg' })])
    expect(errors['row-1']).toBeUndefined()
  })
})

describe('saveProductRows', () => {
  it('creates a new product', () => {
    const db = seedDb()
    const result = saveProductRows(db, [baseRow()], { updateStok: false, userId: null })
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0 })
    const created = db.select().from(products).where(eq(products.kodeItem, 'NEW1')).get()
    expect(created).toMatchObject({ namaItem: 'Produk Baru', stok: 5, isActive: true })
  })

  it('updates an existing product and logs price history when prices change', () => {
    const db = seedDb()
    const result = saveProductRows(
      db,
      [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg', hargaPokok: 61000_00, hargaJual: 66000_00 })],
      { updateStok: false, userId: 7 },
    )
    expect(result).toEqual({ created: 0, updated: 1, unchanged: 0 })
    const history = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ hargaPokokLama: 60000_00, hargaPokokBaru: 61000_00, userId: 7 })
  })

  it('counts a row as unchanged when nothing actually differs', () => {
    const db = seedDb()
    const result = saveProductRows(
      db,
      [
        baseRow({
          id: 1,
          kodeItem: 'BRS5',
          barcode: '1234567890',
          namaItem: 'Beras 5kg',
          kategori: 'Sembako',
          satuan: 'PCS',
          hargaPokok: 60000_00,
          hargaJual: 65000_00,
          stok: 999,
        }),
      ],
      { updateStok: false, userId: null },
    )
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 1 })
  })

  it('does not touch stock on update when updateStok is false, even if the row specifies a different value', () => {
    const db = seedDb()
    saveProductRows(db, [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg Baru', stok: 999 })], {
      updateStok: false,
      userId: null,
    })
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(10)
  })

  it('updates stock and logs a stock adjustment when updateStok is true and stock changed', () => {
    const db = seedDb()
    saveProductRows(db, [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg', stok: 25 })], {
      updateStok: true,
      userId: 3,
    })
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(25)
    const adjustments = db.select().from(stockAdjustments).where(eq(stockAdjustments.productId, 1)).all()
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({ stokSebelum: 10, stokSesudah: 25, selisih: 15, alasan: 'Import Excel', userId: 3 })
  })

  it('resolves kategori via find-or-create', () => {
    const db = seedDb()
    saveProductRows(db, [baseRow({ kategori: 'Baru' })], { updateStok: false, userId: null })
    const category = db.select().from(categories).where(eq(categories.nama, 'Baru')).get()
    expect(category).toBeDefined()
    const product = db.select().from(products).where(eq(products.kodeItem, 'NEW1')).get()
    expect(product?.categoryId).toBe(category?.id)
  })

  it('skips a row referencing a non-existent id rather than throwing', () => {
    const db = seedDb()
    const result = saveProductRows(db, [baseRow({ id: 999, kodeItem: 'GHOST' })], { updateStok: false, userId: null })
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 0 })
  })
})

describe('bulkSaveProducts', () => {
  it('saves all valid rows atomically and returns counts', () => {
    const db = seedDb()
    const result = bulkSaveProducts(db, [baseRow({ key: 'a', kodeItem: 'A1' }), baseRow({ key: 'b', kodeItem: 'B1' })], 5)
    expect(result).toEqual({ success: true, created: 2, updated: 0, unchanged: 0 })
  })

  it('writes nothing when any row is invalid (all-or-nothing)', () => {
    const db = seedDb()
    const result = bulkSaveProducts(db, [baseRow({ key: 'a', kodeItem: 'A1' }), baseRow({ key: 'b', kodeItem: '' })], null)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.rowErrors.b.kodeItem).toBe('Kode item wajib diisi.')
    }
    const created = db.select().from(products).where(eq(products.kodeItem, 'A1')).get()
    expect(created).toBeUndefined()
  })
})
