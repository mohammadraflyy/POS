import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import {
  products,
  productPriceHistories,
  productUnits,
  purchases,
  purchaseItems,
  stockMovements,
  suppliers,
  units,
  users,
} from './db/schema'
import {
  recordPurchase,
  listPurchases,
  searchProductsForPurchase,
  hitungHargaPokokRataRata,
  hitungHargaPokokSatuan,
  type PurchaseItemInput,
} from './purchase'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

const PCS_UNIT_ID = 1
const KG_UNIT_ID = 2
const RENTENG_UNIT_ID = 3

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
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 5,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  db.insert(units)
    .values([
      { id: PCS_UNIT_ID, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now },
      { id: KG_UNIT_ID, code: 'KG', name: 'Kilogram', symbol: 'kg', createdAt: now, updatedAt: now },
      { id: RENTENG_UNIT_ID, code: 'Renteng', name: 'Renteng', symbol: 'rtg', createdAt: now, updatedAt: now },
    ])
    .run()

  // every product needs exactly one base product_units row now - base is no
  // longer implied by a null productUnitId at the storage level
  db.insert(productUnits)
    .values([
      {
        id: 101,
        productId: 1,
        unitId: PCS_UNIT_ID,
        jumlahKemasan: 1,
        conversionFactor: 1,
        hargaJual: 2000_00,
        isBaseUnit: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 102,
        productId: 2,
        unitId: KG_UNIT_ID,
        jumlahKemasan: 1,
        conversionFactor: 1,
        hargaJual: 14000_00,
        isBaseUnit: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 1,
        productId: 1,
        unitId: RENTENG_UNIT_ID,
        jumlahKemasan: 12,
        conversionFactor: 12,
        hargaJual: 18000_00,
        isBaseUnit: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
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
      satuan: 'PCS',
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

  it('records a purchase stock movement against the resolved unit row, even for a null (base) input unit', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ productUnitId: null, qty: 10 }), baseItem({ productUnitId: 1, qty: 2, hargaBeli: 15000_00 })],
      userId: 1,
    })

    const movements = db.select().from(stockMovements).where(eq(stockMovements.referenceId, result.purchaseId)).all()
    expect(movements).toHaveLength(2)
    expect(movements.every((movement) => movement.movementType === 'purchase')).toBe(true)
    // the base line resolves to product 1's base row (101) rather than staying null
    expect(movements[0]).toMatchObject({ productUnitId: 101, quantity: 10, conversionFactor: 1, baseQuantity: 10 })
    expect(movements[1]).toMatchObject({ productUnitId: 1, quantity: 2, conversionFactor: 12, baseQuantity: 24 })
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

describe('hitungHargaPokokRataRata', () => {
  it('averages the old inventory value against the money just spent', () => {
    // 10 pcs worth 150.000 each, plus 10 pcs bought for 1.400.000 total
    expect(hitungHargaPokokRataRata(10, 1500_00, 10, 14000_00)).toBe(1450_00)
  })

  it('takes the pure purchase cost when there is no stock left to average against', () => {
    expect(hitungHargaPokokRataRata(0, 1500_00, 10, 11000_00)).toBe(1100_00)
  })

  it('ignores negative stock rather than letting it subtract inventory value', () => {
    expect(hitungHargaPokokRataRata(-5, 1000_00, 10, 5000_00)).toBe(500_00)
  })

  it('keeps the old cost when nothing is received and nothing is in stock', () => {
    expect(hitungHargaPokokRataRata(0, 1500_00, 0, 0)).toBe(1500_00)
  })

  it('rounds to whole rupiah', () => {
    expect(hitungHargaPokokRataRata(1, 100, 1, 101)).toBe(101) // 201 / 2 = 100,5
  })
})

describe('hitungHargaPokokSatuan', () => {
  it('reproduces hitungHargaPokokRataRata exactly when konversi is 1', () => {
    expect(hitungHargaPokokSatuan(100, 5000, 1, 200, 1000000)).toBe(hitungHargaPokokRataRata(100, 5000, 200, 1000000))
  })

  it('scales the average by konversi so a DUS costs 100x what a PCS costs on the same purchase', () => {
    // empty stock, receiving 200 base units for 1.000.000
    expect(hitungHargaPokokSatuan(0, 0, 1, 200, 1000000)).toBe(5000)
    expect(hitungHargaPokokSatuan(0, 0, 10, 200, 1000000)).toBe(50000)
    expect(hitungHargaPokokSatuan(0, 0, 100, 200, 1000000)).toBe(500000)
  })

  it('weights the existing stock at the unit-scaled old cost', () => {
    // 200 base units already on hand at 5.000/pcs, receiving 20 more for 120.000
    expect(hitungHargaPokokSatuan(200, 5000, 1, 20, 120000)).toBe(5091)
  })

  it('keeps the old cost when there is nothing to average against', () => {
    expect(hitungHargaPokokSatuan(0, 7000, 10, 0, 0)).toBe(7000)
  })

  it('ignores negative stock as an averaging basis', () => {
    // a manual adjustment can drive stock negative; that carries no inventory value
    expect(hitungHargaPokokSatuan(-50, 9000, 1, 100, 400000)).toBe(4000)
  })
})

describe('recordPurchase harga pokok', () => {
  it('averages harga pokok on a base-unit purchase', () => {
    const db = seedDb()
    recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-13',
      catatan: null,
      items: [baseItem({ qty: 10, hargaBeli: 1400_00 })],
      userId: 1,
    })

    // (10 * 1.500 + 10 * 1.400) / 20
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.hargaPokok).toBe(1450_00)
  })

  it('averages per base unit on a derived-unit purchase, not per package', () => {
    const db = seedDb()
    recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-13',
      catatan: null,
      items: [baseItem({ productUnitId: 1, qty: 2, hargaBeli: 9500_00 })],
      userId: 1,
    })

    // 2 renteng = 24 pcs for 1.900.000, on top of 10 pcs worth 1.500.000 => 3.400.000 / 34
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.hargaPokok).toBe(1000_00)
    expect(product?.stok).toBe(34)
  })

  it('compounds several lines for the same product instead of averaging each against the opening stock', () => {
    const db = seedDb()
    recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-13',
      catatan: null,
      items: [
        baseItem({ qty: 10, hargaBeli: 1400_00 }), // -> 20 pcs worth 2.900.000
        baseItem({ productUnitId: 1, qty: 1, hargaBeli: 13000_00 }), // + 12 pcs for 1.300.000
      ],
      userId: 1,
    })

    // 4.200.000 / 32 pcs
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.hargaPokok).toBe(1312_50)
    expect(product?.stok).toBe(32)
  })

  it('takes the purchase cost outright when the product had no stock', () => {
    const db = seedDb()
    db.update(products).set({ stok: 0 }).where(eq(products.id, 2)).run()

    recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-13',
      catatan: null,
      items: [baseItem({ productId: 2, qty: 10, hargaBeli: 11000_00 })],
      userId: 1,
    })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.hargaPokok).toBe(11000_00)
  })

  it('logs a price history row carrying the buyer and the untouched selling price', () => {
    const db = seedDb()
    recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-13',
      catatan: null,
      items: [baseItem({ qty: 10, hargaBeli: 1400_00 })],
      userId: 1,
    })

    const histories = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(histories).toHaveLength(1)
    expect(histories[0]).toMatchObject({
      userId: 1,
      hargaPokokLama: 1500_00,
      hargaPokokBaru: 1450_00,
      hargaJualLama: 2000_00,
      hargaJualBaru: 2000_00,
    })
  })

  it('logs no price history when the purchase leaves harga pokok unchanged', () => {
    const db = seedDb()
    recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-13',
      catatan: null,
      items: [baseItem({ qty: 10, hargaBeli: 1500_00 })],
      userId: 1,
    })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.hargaPokok).toBe(1500_00)
    expect(db.select().from(productPriceHistories).all()).toHaveLength(0)
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
    expect(results[0].units).toEqual([{ id: 1, satuan: 'Renteng', konversi: 12 }])
  })

  it('returns an empty units array for a product with no satuan turunan', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'gula')
    expect(results[0].units).toEqual([])
  })
})
