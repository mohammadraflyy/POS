import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, productUnits, units, users } from './db/schema'
import { checkout } from './kasir'
import { listProducts } from './inventory'
import { recordStockAdjustment, searchProductsForOpname } from './stock-opname'

describe('stock after a sale', () => {
  it.each(['tunai', 'bon', 'qris', 'transfer'] as const)(
    '%s reduces catalog and opname stock and rejects a count made before the sale',
    (metodePembayaran) => {
      const db = createDb(':memory:', path.resolve(__dirname, '../../drizzle'))
      const now = new Date()
      db.insert(users).values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now }).run()
      db.insert(products).values({
        id: 1, kodeItem: 'TEST', namaItem: 'Produk Tes', stok: 10,
        hargaPokok: 100_00, hargaJual: 200_00, isActive: true,
        createdAt: now, updatedAt: now,
      }).run()
      db.insert(units).values({ id: 1, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now }).run()
      db.insert(productUnits).values({
        productId: 1, unitId: 1, jumlahKemasan: 1, conversionFactor: 1,
        isBaseUnit: true, hargaJual: 200_00, createdAt: now, updatedAt: now,
      }).run()
      const before = searchProductsForOpname(db, { q: 'TEST', categoryIds: [] })[0]

      checkout(db, {
        metodePembayaran, namaPelanggan: 'Pelanggan', dibayar: 400_00, userId: 1,
        items: [{ productId: 1, productUnitId: null, qty: 2 }],
      })

      expect(listProducts(db, { search: 'TEST', page: 1 }).data[0].stok).toBe(8)
      const after = searchProductsForOpname(db, { q: 'TEST', categoryIds: [] })[0]
      expect(after.stok).toBe(8)
      expect(after.stockRevision).toBeGreaterThan(before.stockRevision)
      expect(() => recordStockAdjustment(db, {
        productId: 1, stokSesudah: 10, alasan: null, userId: 1,
        expectedStock: before.stok, expectedRevision: before.stockRevision,
      })).toThrow('Stok berubah')
      expect(searchProductsForOpname(db, { q: 'TEST', categoryIds: [] })[0].stok).toBe(8)
    },
  )
})
