import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { products, productUnits, purchases, purchaseItems, suppliers, users } from './db/schema'
import { recordPurchase, listPurchases, searchProductsForPurchase, type PurchaseItemInput } from './purchase'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  db.insert(suppliers)
    .values({ id: 1, nama: 'CV Sumber Makmur', telepon: null, alamat: null, keterangan: null, createdAt: now, updatedAt: now })
    .run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'KOPI1',
        barcode: null,
        namaItem: 'Kopi Kapal Api',
        categoryId: null,
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
        categoryId: null,
        satuan: 'KG',
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 5,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  db.insert(productUnits)
    .values({
      id: 1,
      productId: 1,
      level: 2,
      satuan: 'Renteng',
      jumlahKemasan: 12,
      konversi: 12,
      hargaJual: 18000_00,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

function baseItem(overrides: Partial<PurchaseItemInput> = {}): PurchaseItemInput {
  return {
    productId: 1,
    productUnitId: null,
    qty: 10,
    hargaBeli: 1400_00,
    ...overrides,
  }
}

describe('recordPurchase', () => {
  it('records a base-unit purchase and increments stock by qty', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ qty: 10, hargaBeli: 1400_00 })],
      userId: 1,
    })

    expect(result.purchaseId).toBeGreaterThan(0)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(20) // 10 existing + 10 purchased

    const purchase = db.select().from(purchases).where(eq(purchases.id, result.purchaseId)).get()
    expect(purchase).toMatchObject({ supplierId: 1, tanggal: '2026-08-08', total: 14000_00 })

    const items = db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, result.purchaseId)).all()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      productId: 1,
      productUnitId: null,
      qty: 10,
      konversi: 1,
      satuan: null,
      hargaBeli: 1400_00,
      subtotal: 14000_00,
    })
  })

  it('records a unit-based purchase and increments stock by qty * konversi', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ productUnitId: 1, qty: 2, hargaBeli: 15000_00 })],
      userId: 1,
    })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(34) // 10 existing + (2 renteng * 12 konversi) = 10 + 24

    const items = db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, result.purchaseId)).all()
    expect(items[0]).toMatchObject({ productUnitId: 1, qty: 2, konversi: 12, satuan: 'Renteng', hargaBeli: 15000_00, subtotal: 30000_00 })
  })

  it('records multiple items in one purchase and sums the total', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ productId: 1, qty: 10, hargaBeli: 1400_00 }), baseItem({ productId: 2, qty: 5, hargaBeli: 11000_00 })],
      userId: 1,
    })

    const purchase = db.select().from(purchases).where(eq(purchases.id, result.purchaseId)).get()
    expect(purchase?.total).toBe(14000_00 + 55000_00)

    const productA = db.select().from(products).where(eq(products.id, 1)).get()
    const productB = db.select().from(products).where(eq(products.id, 2)).get()
    expect(productA?.stok).toBe(20)
    expect(productB?.stok).toBe(10)

    const list = listPurchases(db, { page: 1 })
    expect(list.data[0].itemSummary).toBe('Kopi Kapal Api x10, Gula Pasir x5')
  })

  it('allows a null supplierId', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: null,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem()],
      userId: 1,
    })

    const purchase = db.select().from(purchases).where(eq(purchases.id, result.purchaseId)).get()
    expect(purchase?.supplierId).toBeNull()
  })

  it('throws when tanggal is empty', () => {
    const db = seedDb()
    expect(() => recordPurchase(db, { supplierId: 1, tanggal: '', catatan: null, items: [baseItem()], userId: 1 })).toThrow(
      'Tanggal wajib diisi.',
    )
  })

  it('throws when items is empty', () => {
    const db = seedDb()
    expect(() => recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [], userId: 1 })).toThrow(
      'Item pembelian tidak boleh kosong.',
    )
  })

  it('throws when qty is not a positive integer', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ qty: 0 })], userId: 1 }),
    ).toThrow('Qty harus bilangan bulat minimal 1.')

    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ qty: 1.5 })], userId: 1 }),
    ).toThrow('Qty harus bilangan bulat minimal 1.')
  })

  it('throws when hargaBeli is not finite', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ hargaBeli: NaN })], userId: 1 }),
    ).toThrow('Harga beli wajib diisi.')
  })

  it('throws when hargaBeli is negative', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ hargaBeli: -1 })], userId: 1 }),
    ).toThrow('Harga beli tidak boleh negatif.')
  })

  it('throws when a productId does not exist', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ productId: 999 })], userId: 1 }),
    ).toThrow('Produk tidak ditemukan.')
  })

  it('throws when a productUnitId does not belong to the given product', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, {
        supplierId: 1,
        tanggal: '2026-08-08',
        catatan: null,
        items: [baseItem({ productId: 2, productUnitId: 1 })], // unit 1 belongs to product 1, not 2
        userId: 1,
      }),
    ).toThrow('Satuan tidak valid untuk Gula Pasir.')
  })

  it('writes nothing when validation fails partway through a multi-item batch', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, {
        supplierId: 1,
        tanggal: '2026-08-08',
        catatan: null,
        items: [baseItem({ productId: 1, qty: 10 }), baseItem({ productId: 2, qty: -1 })],
        userId: 1,
      }),
    ).toThrow()

    const allPurchases = db.select().from(purchases).all()
    expect(allPurchases).toHaveLength(0)

    const product1 = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product1?.stok).toBe(10) // untouched
  })
})

describe('listPurchases', () => {
  it('returns purchases with supplier name and item summary, newest first', () => {
    const db = seedDb()
    recordPurchase(db, { supplierId: 1, tanggal: '2026-08-01', catatan: null, items: [baseItem({ qty: 3 })], userId: 1 })
    recordPurchase(db, { supplierId: null, tanggal: '2026-08-05', catatan: null, items: [baseItem({ productId: 2, qty: 2 })], userId: 1 })

    const result = listPurchases(db, { page: 1 })
    expect(result.total).toBe(2)
    expect(result.data[0].tanggal).toBe('2026-08-05')
    expect(result.data[0].supplierName).toBeNull()
    expect(result.data[0].itemSummary).toBe('Gula Pasir x2')
    expect(result.data[1].supplierName).toBe('CV Sumber Makmur')
    expect(result.data[1].itemSummary).toBe('Kopi Kapal Api x3')
  })

  it('paginates with the given pageSize', () => {
    const db = seedDb()
    for (let i = 0; i < 12; i++) {
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ qty: 1 })], userId: 1 })
    }

    const page1 = listPurchases(db, { page: 1, pageSize: 10 })
    expect(page1.data).toHaveLength(10)
    expect(page1.lastPage).toBe(2)
    expect(page1.total).toBe(12)
  })

  it('defaults to pageSize 25 and falls back on an invalid pageSize', () => {
    const db = seedDb()
    recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem()], userId: 1 })

    const result = listPurchases(db, { page: 1, pageSize: 999 })
    expect(result.lastPage).toBe(1)
  })
})

describe('searchProductsForPurchase', () => {
  it('matches on kodeItem, namaItem, or barcode, capped at 20', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'kopi')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 1, kodeItem: 'KOPI1', namaItem: 'Kopi Kapal Api', satuan: 'PCS', hargaPokok: 1500_00 })
  })

  it('includes each product\'s available units', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'kopi')
    expect(results[0].units).toEqual([{ id: 1, level: 2, satuan: 'Renteng', konversi: 12 }])
  })

  it('returns an empty units array for a product with no satuan turunan', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'gula')
    expect(results[0].units).toEqual([])
  })
})
