import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { users, products, productUnits, units } from './db/schema'
import { checkout } from './kasir'
import { recordPurchase } from './purchase'
import { recordStockAdjustment } from './stock-opname'
import { listStockMovements } from './stock-movements'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
    .run()

  db.insert(products)
    .values([
      { id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg', hargaJual: 65000_00, hargaPokok: 60000_00, stok: 10, createdAt: now, updatedAt: now },
      { id: 2, kodeItem: 'GULA1', namaItem: 'Gula Pasir', hargaJual: 14000_00, hargaPokok: 12000_00, stok: 5, createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(units).values({ id: 1, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now }).run()

  db.insert(productUnits)
    .values([
      {
        id: 101,
        productId: 1,
        unitId: 1,
        jumlahKemasan: 1,
        conversionFactor: 1,
        hargaJual: 65000_00,
        hargaPokok: 60000_00,
        isBaseUnit: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 102,
        productId: 2,
        unitId: 1,
        jumlahKemasan: 1,
        conversionFactor: 1,
        hargaJual: 14000_00,
        hargaPokok: 12000_00,
        isBaseUnit: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  return db
}

describe('listStockMovements', () => {
  it('combines sale, purchase, and opname rows into one ledger, newest first', () => {
    const db = seedDb()

    recordPurchase(db, { supplierId: null, tanggal: '2026-08-01', catatan: null, items: [{ productId: 1, productUnitId: null, qty: 5, hargaBeli: 60000_00 }], userId: 1 })
    checkout(db, { metodePembayaran: 'tunai', namaPelanggan: null, dibayar: 65000_00, userId: 1, items: [{ productId: 1, productUnitId: null, qty: 1 }] })
    recordStockAdjustment(db, { productId: 2, stokSesudah: 4, alasan: 'susut', userId: 1 })

    const result = listStockMovements(db, { page: 1 })

    expect(result.total).toBe(3)
    expect(result.data.map((row) => row.movementType)).toEqual(['stock_adjustment', 'sale', 'purchase'])
  })

  it('signs quantity negative for stock leaving, positive for stock arriving', () => {
    const db = seedDb()

    recordPurchase(db, { supplierId: null, tanggal: '2026-08-01', catatan: null, items: [{ productId: 1, productUnitId: null, qty: 5, hargaBeli: 60000_00 }], userId: 1 })
    checkout(db, { metodePembayaran: 'tunai', namaPelanggan: null, dibayar: 130000_00, userId: 1, items: [{ productId: 1, productUnitId: null, qty: 2 }] })

    const result = listStockMovements(db, { page: 1 })
    const sale = result.data.find((row) => row.movementType === 'sale')
    const purchase = result.data.find((row) => row.movementType === 'purchase')

    expect(sale?.quantity).toBe(-2)
    expect(purchase?.quantity).toBe(5)
  })

  it('filters by product name or code', () => {
    const db = seedDb()

    recordStockAdjustment(db, { productId: 1, stokSesudah: 8, alasan: null, userId: 1 })
    recordStockAdjustment(db, { productId: 2, stokSesudah: 3, alasan: null, userId: 1 })

    const result = listStockMovements(db, { page: 1, q: 'beras' })

    expect(result.total).toBe(1)
    expect(result.data[0].namaItem).toBe('Beras 5kg')
  })

  it('filters by movement type', () => {
    const db = seedDb()

    recordPurchase(db, { supplierId: null, tanggal: '2026-08-01', catatan: null, items: [{ productId: 1, productUnitId: null, qty: 5, hargaBeli: 60000_00 }], userId: 1 })
    recordStockAdjustment(db, { productId: 2, stokSesudah: 3, alasan: null, userId: 1 })

    const result = listStockMovements(db, { page: 1, movementType: 'purchase' })

    expect(result.total).toBe(1)
    expect(result.data[0].movementType).toBe('purchase')
  })

  it('filters by date range', () => {
    const db = seedDb()

    recordPurchase(db, { supplierId: null, tanggal: '2026-08-01', catatan: null, items: [{ productId: 1, productUnitId: null, qty: 5, hargaBeli: 60000_00 }], userId: 1 })

    expect(listStockMovements(db, { page: 1, dari: '2099-01-01' }).total).toBe(0)
    expect(listStockMovements(db, { page: 1, sampai: '2099-01-01' }).total).toBe(1)
  })

  it('paginates', () => {
    const db = seedDb()

    for (let i = 0; i < 12; i++) {
      recordStockAdjustment(db, { productId: 1, stokSesudah: i, alasan: null, userId: 1 })
    }

    const result = listStockMovements(db, { page: 1, pageSize: 10 })

    expect(result.data).toHaveLength(10)
    expect(result.total).toBe(12)
    expect(result.lastPage).toBe(2)
  })
})
