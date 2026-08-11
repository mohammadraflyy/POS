import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import {
  categories,
  products,
  productPriceHistories,
  saleItems,
  sales,
  purchaseItems,
  purchases,
  users,
  productUnits,
  productPriceTiers,
  units,
} from './db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from './inventory'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

const PCS_UNIT_ID = 1
const KG_UNIT_ID = 2
const RENTENG_UNIT_ID = 3

function seedProducts() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
    .run()

  db.insert(categories).values({ id: 1, nama: 'Sembako', createdAt: now, updatedAt: now }).run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'BRS5',
        barcode: '1234567890',
        namaItem: 'Beras 5kg',
        categoryId: 1,
        hargaPokok: 60000_00,
        hargaJual: 65000_00,
        stok: 10,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        kodeItem: 'MIE1',
        barcode: null,
        namaItem: 'Mie Instan',
        categoryId: null,
        hargaPokok: 2500_00,
        hargaJual: 3000_00,
        stok: 100,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 3,
        kodeItem: 'GLA1',
        barcode: null,
        namaItem: 'Gula Pasir',
        categoryId: 1,
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 0,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  db.insert(units)
    .values([
      { id: PCS_UNIT_ID, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now },
      { id: KG_UNIT_ID, code: 'KG', name: 'Kilogram', symbol: 'kg', createdAt: now, updatedAt: now },
      { id: RENTENG_UNIT_ID, code: 'RENTENG', name: 'Renteng', symbol: 'rtg', createdAt: now, updatedAt: now },
    ])
    .run()

  // the satuan label lives on each product's base row now; unitsCount still
  // counts only the derived rows, so these do not affect it
  db.insert(productUnits)
    .values(
      [
        { id: 101, productId: 1, unitId: PCS_UNIT_ID, hargaJual: 65000_00 },
        { id: 102, productId: 2, unitId: PCS_UNIT_ID, hargaJual: 3000_00 },
        { id: 103, productId: 3, unitId: KG_UNIT_ID, hargaJual: 14000_00 },
      ].map((row) => ({
        ...row,
        jumlahKemasan: 1,
        conversionFactor: 1,
        isBaseUnit: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run()

  return db
}

describe('listProducts', () => {
  it('returns all products ordered by namaItem, with category names joined', () => {
    const db = seedProducts()

    const result = listProducts(db, { page: 1 })

    expect(result.total).toBe(3)
    expect(result.data.map((p) => p.namaItem)).toEqual(['Beras 5kg', 'Gula Pasir', 'Mie Instan'])
    expect(result.data.find((p) => p.id === 1)?.categoryName).toBe('Sembako')
    expect(result.data.find((p) => p.id === 2)?.categoryName).toBeNull()
  })

  it('filters by search across kodeItem, namaItem, barcode', () => {
    const db = seedProducts()

    expect(listProducts(db, { search: 'beras', page: 1 }).data.map((p) => p.id)).toEqual([1])
    expect(listProducts(db, { search: 'MIE1', page: 1 }).data.map((p) => p.id)).toEqual([2])
    expect(listProducts(db, { search: '1234567890', page: 1 }).data.map((p) => p.id)).toEqual([1])
    expect(listProducts(db, { search: 'tidak-ada', page: 1 }).data).toHaveLength(0)
  })

  it('paginates with the given pageSize, computing lastPage and total', () => {
    const db = seedProducts()
    const now = new Date()
    const extra = Array.from({ length: 9 }, (_, i) => ({
      kodeItem: `EX${i}`,
      barcode: null,
      namaItem: `Extra Produk ${i}`,
      categoryId: null,
      hargaPokok: 1000_00,
      hargaJual: 1200_00,
      stok: 5,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(extra).run()
    // total = 3 seeded + 9 extra = 12

    const page1 = listProducts(db, { page: 1, pageSize: 10 })
    expect(page1.data).toHaveLength(10)
    expect(page1.currentPage).toBe(1)
    expect(page1.lastPage).toBe(2)
    expect(page1.total).toBe(12)

    const page2 = listProducts(db, { page: 2, pageSize: 10 })
    expect(page2.data).toHaveLength(2)
  })

  it('falls back to pageSize 25 when given an invalid pageSize', () => {
    const db = seedProducts()
    const now = new Date()
    const extra = Array.from({ length: 27 }, (_, i) => ({
      kodeItem: `IX${i}`,
      barcode: null,
      namaItem: `Invalid Pagesize Produk ${i}`,
      categoryId: null,
      hargaPokok: 1000_00,
      hargaJual: 1200_00,
      stok: 5,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(extra).run()
    // total = 3 seeded + 27 extra = 30

    const result = listProducts(db, { page: 1, pageSize: 999 })
    expect(result.data).toHaveLength(25)
    expect(result.lastPage).toBe(2)
  })

  it('defaults to pageSize 25 when none is given', () => {
    const db = seedProducts()
    const result = listProducts(db, { page: 1 })
    expect(result.lastPage).toBe(1)
  })

  it('returns money fields in cents, unconverted', () => {
    const db = seedProducts()
    const result = listProducts(db, { page: 1 })
    const beras = result.data.find((p) => p.id === 1)
    expect(beras?.hargaPokok).toBe(60000_00)
    expect(beras?.hargaJual).toBe(65000_00)
  })
})

describe('updateProduct', () => {
  const validInput = {
    kodeItem: 'BRS5',
    barcode: '1234567890',
    namaItem: 'Beras 5kg Baru',
    kategori: 'Sembako',
    satuan: 'PCS',
    hargaPokok: 61000_00,
    hargaJual: 66000_00,
    isActive: true,
  }

  it('updates the product fields', () => {
    const db = seedProducts()

    updateProduct(db, 1, validInput)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.namaItem).toBe('Beras 5kg Baru')
    expect(product?.hargaPokok).toBe(61000_00)
    expect(product?.hargaJual).toBe(66000_00)
  })

  it('resolves kategori to an existing category by exact name match', () => {
    const db = seedProducts()

    updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', kategori: 'Sembako', barcode: null })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.categoryId).toBe(1)
  })

  it('creates a new category when kategori does not match an existing one', () => {
    const db = seedProducts()

    updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', kategori: 'Makanan Instan', barcode: null })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    const newCategory = db.select().from(categories).where(eq(categories.nama, 'Makanan Instan')).get()
    expect(product?.categoryId).toBe(newCategory?.id)
  })

  it('sets categoryId to null when kategori is null or empty', () => {
    const db = seedProducts()

    updateProduct(db, 1, { ...validInput, kategori: null })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.categoryId).toBeNull()
  })

  it('throws when kodeItem is empty', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: '' })).toThrow('Kode item wajib diisi.')
  })

  it('throws when kodeItem exceeds 50 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: 'a'.repeat(51) })).toThrow(
      'Kode item maksimal 50 karakter.',
    )
  })

  it('throws when kodeItem collides with another product', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: 'MIE1' })).toThrow('Kode item sudah digunakan.')
  })

  it('allows keeping the same kodeItem on self (no false collision)', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: 'BRS5' })).not.toThrow()
  })

  it('throws when barcode exceeds 100 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, barcode: '1'.repeat(101) })).toThrow(
      'Barcode maksimal 100 karakter.',
    )
  })

  it('throws when barcode collides with another product', () => {
    const db = seedProducts()
    updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', barcode: '999' })
    expect(() => updateProduct(db, 1, { ...validInput, barcode: '999' })).toThrow('Barcode sudah digunakan.')
  })

  it('allows null barcode without a uniqueness check', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, barcode: null })).not.toThrow()
    expect(() => updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', barcode: null })).not.toThrow()
  })

  it('throws when namaItem is empty', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, namaItem: '' })).toThrow('Nama item wajib diisi.')
  })

  it('throws when namaItem exceeds 255 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, namaItem: 'a'.repeat(256) })).toThrow(
      'Nama item maksimal 255 karakter.',
    )
  })

  it('throws when satuan is empty', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, satuan: 'a'.repeat(21) })).toThrow(
      'Satuan maksimal 20 karakter.',
    )
  })

  it('throws when hargaPokok is negative', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, hargaPokok: -1 })).toThrow('Harga pokok tidak boleh negatif.')
  })

  it('throws when hargaPokok is not a finite number', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, hargaPokok: NaN })).toThrow('Harga pokok wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })

  it('throws when hargaJual is not a finite number', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when kategori exceeds 255 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kategori: 'a'.repeat(256) })).toThrow(
      'Kategori maksimal 255 karakter.',
    )
  })

  it('records a price history row when hargaPokok or hargaJual changes', () => {
    const db = seedProducts()

    updateProduct(db, 1, validInput)

    const history = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      hargaPokokLama: 60000_00,
      hargaPokokBaru: 61000_00,
      hargaJualLama: 65000_00,
      hargaJualBaru: 66000_00,
    })
  })

  it('does not record a price history row when prices are unchanged', () => {
    const db = seedProducts()

    updateProduct(db, 1, { ...validInput, hargaPokok: 60000_00, hargaJual: 65000_00 })

    const history = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(history).toHaveLength(0)
  })

  it('toggles isActive', () => {
    const db = seedProducts()

    updateProduct(db, 3, { ...validInput, kodeItem: 'GLA1', isActive: true, barcode: null })

    const product = db.select().from(products).where(eq(products.id, 3)).get()
    expect(product?.isActive).toBe(true)
  })
})

describe('deleteProduct', () => {
  it('deletes a product with no transaction history', () => {
    const db = seedProducts()

    deleteProduct(db, 3)

    expect(db.select().from(products).where(eq(products.id, 3)).get()).toBeUndefined()
  })

  it('throws a friendly message when the product has sale history', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(sales)
      .values({ id: 1, userId: 1, metodePembayaran: 'tunai', status: 'selesai', total: 65000_00, dibayar: 65000_00, createdAt: now, updatedAt: now })
      .run()
    db.insert(saleItems)
      .values({ id: 1, saleId: 1, productId: 1, qty: 1, konversi: 1, satuan: 'PCS', hargaJual: 65000_00, hargaPokok: 60000_00, subtotal: 65000_00, createdAt: now, updatedAt: now })
      .run()

    expect(() => deleteProduct(db, 1)).toThrow('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.')
    expect(db.select().from(products).where(eq(products.id, 1)).get()).toBeDefined()
  })

  it('throws a friendly message when the product has purchase history', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(purchases).values({ id: 1, userId: 1, tanggal: '2026-01-01', total: 60000_00, createdAt: now, updatedAt: now }).run()
    db.insert(purchaseItems)
      .values({ id: 1, purchaseId: 1, productId: 2, qty: 1, hargaBeli: 2500_00, subtotal: 2500_00, createdAt: now, updatedAt: now })
      .run()

    expect(() => deleteProduct(db, 2)).toThrow('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.')
  })

  it('throws when the product does not exist', () => {
    const db = seedProducts()
    expect(() => deleteProduct(db, 999)).not.toThrow()
    // SQLite DELETE on a non-matching id is a no-op, not an error - matches
    // Laravel's route-model-binding 404 being handled at the IPC layer instead.
  })
})

describe('bulkDeleteProducts', () => {
  it('deletes all given ids when none are restricted', () => {
    const db = seedProducts()

    const result = bulkDeleteProducts(db, [2, 3])

    expect(result).toEqual({ deleted: 2, blocked: [] })
    expect(db.select().from(products).all()).toHaveLength(1)
  })

  it('deletes unrestricted products and reports restricted ones by name, without failing the whole batch', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(sales)
      .values({ id: 1, userId: 1, metodePembayaran: 'tunai', status: 'selesai', total: 65000_00, dibayar: 65000_00, createdAt: now, updatedAt: now })
      .run()
    db.insert(saleItems)
      .values({ id: 1, saleId: 1, productId: 1, qty: 1, konversi: 1, satuan: 'PCS', hargaJual: 65000_00, hargaPokok: 60000_00, subtotal: 65000_00, createdAt: now, updatedAt: now })
      .run()

    const result = bulkDeleteProducts(db, [1, 2, 3])

    expect(result.deleted).toBe(2)
    expect(result.blocked).toEqual(['Beras 5kg'])
    expect(db.select().from(products).where(eq(products.id, 1)).get()).toBeDefined()
    expect(db.select().from(products).where(eq(products.id, 2)).get()).toBeUndefined()
    expect(db.select().from(products).where(eq(products.id, 3)).get()).toBeUndefined()
  })
})

describe('searchProductsQuick', () => {
  it('matches across kodeItem, namaItem, barcode, capped at 20 results', () => {
    const db = seedProducts()

    expect(searchProductsQuick(db, 'beras').map((p) => p.id)).toEqual([1])
    expect(searchProductsQuick(db, '').length).toBeGreaterThan(0)
  })

  it('includes inactive products (matches the web app quick-search, which does not filter by isActive)', () => {
    const db = seedProducts()
    const results = searchProductsQuick(db, 'gula')
    expect(results.map((p) => p.id)).toEqual([3])
    expect(results[0].isActive).toBe(false)
  })
})

describe('listProducts unit/tier counts', () => {
  it('returns unitsCount and priceTiersCount for each product', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(productUnits)
      .values({
        productId: 1,
        unitId: RENTENG_UNIT_ID,
        jumlahKemasan: 12,
        conversionFactor: 12,
        hargaJual: 15000_00,
        isBaseUnit: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(productPriceTiers)
      .values([
        { productId: 1, productUnitId: 101, minQty: 6, maxQty: null, hargaJual: 63000_00, createdAt: now, updatedAt: now },
        { productId: 1, productUnitId: 101, minQty: 12, maxQty: null, hargaJual: 60000_00, createdAt: now, updatedAt: now },
      ])
      .run()

    const result = listProducts(db, { page: 1 })
    const beras = result.data.find((p) => p.id === 1)
    const mie = result.data.find((p) => p.id === 2)

    expect(beras?.unitsCount).toBe(1)
    expect(beras?.priceTiersCount).toBe(2)
    expect(mie?.unitsCount).toBe(0)
    expect(mie?.priceTiersCount).toBe(0)
  })
})

describe('searchProductsQuick unit/tier counts', () => {
  it('returns unitsCount and priceTiersCount', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(productUnits)
      .values({
        productId: 1,
        unitId: RENTENG_UNIT_ID,
        jumlahKemasan: 12,
        conversionFactor: 12,
        hargaJual: 15000_00,
        isBaseUnit: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const results = searchProductsQuick(db, 'beras')
    expect(results[0].unitsCount).toBe(1)
    expect(results[0].priceTiersCount).toBe(0)
  })
})
