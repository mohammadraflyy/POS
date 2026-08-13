import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, productUnits, sales, saleItems, units, users } from './db/schema'
import { getDashboard } from './dashboard'
import { getRekap } from './rekap'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

const PCS_UNIT_ID = 1

function seedUser(db: ReturnType<typeof createDb>) {
  const now = new Date()
  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()
}

function insertProduct(
  db: ReturnType<typeof createDb>,
  input: { id: number; namaItem: string; stok: number; isActive: boolean },
) {
  const now = new Date()
  db.insert(products)
    .values({
      id: input.id,
      kodeItem: `P${input.id}`,
      barcode: null,
      namaItem: input.namaItem,
      categoryId: null,
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: input.stok,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  // the satuan label lives on the base product_units row now; the units row is
  // shared, so it is inserted once and reused by every product
  db.insert(units)
    .values({ id: PCS_UNIT_ID, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run()

  db.insert(productUnits)
    .values({
      productId: input.id,
      unitId: PCS_UNIT_ID,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual: 1500_00,
      isBaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function insertSale(
  db: ReturnType<typeof createDb>,
  input: {
    id: number
    status: 'selesai' | 'dibatalkan'
    metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
    total: number
    dibayar: number
    createdAt: Date
    items: { productId: number; qty: number }[]
  },
) {
  db.insert(sales)
    .values({
      id: input.id,
      userId: 1,
      namaPelanggan: null,
      metodePembayaran: input.metodePembayaran,
      status: input.status,
      total: input.total,
      dibayar: input.dibayar,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .run()

  db.insert(saleItems)
    .values(
      input.items.map((item, i) => ({
        id: input.id * 100 + i,
        saleId: input.id,
        productId: item.productId,
        productUnitId: null,
        qty: item.qty,
        konversi: 1,
        satuan: null,
        hargaJual: 1500_00,
        hargaPokok: 1000_00,
        subtotal: item.qty * 1500_00,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })),
    )
    .run()
}

describe('getDashboard', () => {
  it('stokMenipis includes stok<=5, excludes stok=6 and inactive products', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Rendah', stok: 5, isActive: true })
    insertProduct(db, { id: 2, namaItem: 'Aman', stok: 6, isActive: true })
    insertProduct(db, { id: 3, namaItem: 'NonaktifRendah', stok: 0, isActive: false })

    const result = getDashboard(db)
    const names = result.stokMenipis.map((p) => p.namaItem)
    expect(names).toContain('Rendah')
    expect(names).not.toContain('Aman')
    expect(names).not.toContain('NonaktifRendah')
  })

  it('stokMenipis is ordered ascending by stok and capped at 10', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    const stokValues = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] // 12 products, all <= 5
    stokValues.forEach((stok, i) => {
      insertProduct(db, { id: i + 1, namaItem: `Produk ${i}`, stok, isActive: true })
    })

    const result = getDashboard(db)
    expect(result.stokMenipis).toHaveLength(10)
    expect(result.stokMenipis.map((p) => p.stok)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('transaksiTerbaru returns the 5 most recent sales descending by createdAt', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })

    for (let i = 0; i < 6; i++) {
      insertSale(db, {
        id: i + 1,
        status: i === 0 ? 'dibatalkan' : 'selesai',
        metodePembayaran: 'tunai',
        total: 1500_00,
        dibayar: 1500_00,
        createdAt: new Date(2020, 0, i + 1, 10, 0),
        items: [{ productId: 1, qty: 1 }],
      })
    }

    const result = getDashboard(db)
    expect(result.transaksiTerbaru).toHaveLength(5)
    expect(result.transaksiTerbaru.map((t) => t.id)).toEqual([6, 5, 4, 3, 2])
  })

  it('includes a cancelled sale with no status filter, when it is among the most recent', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })

    insertSale(db, {
      id: 1,
      status: 'dibatalkan',
      metodePembayaran: 'tunai',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1 }],
    })

    const result = getDashboard(db)
    expect(result.transaksiTerbaru).toHaveLength(1)
    expect(result.transaksiTerbaru[0]).toMatchObject({ id: 1, status: 'dibatalkan' })
  })

  it('itemSummary joins multiple line items into a comma-separated string', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })
    insertProduct(db, { id: 2, namaItem: 'Gula', stok: 100, isActive: true })

    insertSale(db, {
      id: 1,
      status: 'selesai',
      metodePembayaran: 'tunai',
      total: 4500_00,
      dibayar: 4500_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [
        { productId: 1, qty: 2 },
        { productId: 2, qty: 1 },
      ],
    })

    const result = getDashboard(db)
    expect(result.transaksiTerbaru[0].itemSummary).toBe('Kopi x2, Gula x1')
  })

  it('summary and produkTerlarisHariIni match a direct getRekap call scoped to today', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedUser(db)
    insertProduct(db, { id: 1, namaItem: 'Kopi', stok: 100, isActive: true })

    const now = new Date()
    insertSale(db, {
      id: 1,
      status: 'selesai',
      metodePembayaran: 'tunai',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: now,
      items: [{ productId: 1, qty: 1 }],
    })

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const expected = getRekap(db, { from: today, to: today })

    const result = getDashboard(db)
    expect(result.summary).toEqual(expected.summary)
    expect(result.produkTerlarisHariIni).toEqual(expected.produkTerlaris)
  })
})
