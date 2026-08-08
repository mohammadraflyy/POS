import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { categories, products, productUnits, purchases, sales, saleItems, suppliers, users } from './db/schema'
import { getRekap } from './rekap'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedBase(db: ReturnType<typeof createDb>) {
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  db.insert(categories)
    .values([{ id: 1, nama: 'Sembako', createdAt: now, updatedAt: now }])
    .run()

  db.insert(suppliers)
    .values([{ id: 1, nama: 'CV Sumber Makmur', telepon: null, alamat: null, keterangan: null, createdAt: now, updatedAt: now }])
    .run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'KOPI1',
        barcode: null,
        namaItem: 'Kopi Kapal Api',
        categoryId: 1,
        satuan: 'PCS',
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 100,
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
        stok: 100,
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
      satuan: 'DUS',
      jumlahKemasan: 10,
      konversi: 10,
      hargaJual: 14000_00,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function insertSale(
  db: ReturnType<typeof createDb>,
  input: {
    id: number
    metodePembayaran: 'tunai' | 'bon'
    status: 'selesai' | 'dibatalkan'
    total: number
    dibayar: number
    createdAt: Date
    items: { productId: number; qty: number; konversi: number; hargaJual: number; hargaPokok: number; subtotal: number }[]
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
        konversi: item.konversi,
        satuan: null,
        hargaJual: item.hargaJual,
        hargaPokok: item.hargaPokok,
        subtotal: item.subtotal,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })),
    )
    .run()
}

describe('getRekap', () => {
  it('omzetTunai sums only tunai selesai sales in range, excluding bon and cancelled', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 50000_00,
      dibayar: 50000_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 50000_00, hargaPokok: 1000_00, subtotal: 50000_00 }],
    })
    insertSale(db, {
      id: 2,
      metodePembayaran: 'bon',
      status: 'selesai',
      total: 30000_00,
      dibayar: 0,
      createdAt: new Date(2026, 0, 15, 11, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 30000_00, hargaPokok: 1000_00, subtotal: 30000_00 }],
    })
    insertSale(db, {
      id: 3,
      metodePembayaran: 'tunai',
      status: 'dibatalkan',
      total: 20000_00,
      dibayar: 20000_00,
      createdAt: new Date(2026, 0, 15, 12, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 20000_00, hargaPokok: 1000_00, subtotal: 20000_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.summary.omzetTunai).toBe(50000_00)
  })

  it('jumlahTransaksi counts tunai and bon selesai sales, excludes cancelled', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 50000_00,
      dibayar: 50000_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 50000_00, hargaPokok: 1000_00, subtotal: 50000_00 }],
    })
    insertSale(db, {
      id: 2,
      metodePembayaran: 'bon',
      status: 'selesai',
      total: 30000_00,
      dibayar: 0,
      createdAt: new Date(2026, 0, 15, 11, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 30000_00, hargaPokok: 1000_00, subtotal: 30000_00 }],
    })
    insertSale(db, {
      id: 3,
      metodePembayaran: 'tunai',
      status: 'dibatalkan',
      total: 20000_00,
      dibayar: 20000_00,
      createdAt: new Date(2026, 0, 15, 12, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 20000_00, hargaPokok: 1000_00, subtotal: 20000_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.summary.jumlahTransaksi).toBe(2)
  })

  it('piutangBeredar is all-time, unaffected by the date range', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'bon',
      status: 'selesai',
      total: 40000_00,
      dibayar: 25000_00,
      createdAt: new Date(2025, 5, 1, 10, 0), // June 2025, well outside the queried range
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 40000_00, hargaPokok: 1000_00, subtotal: 40000_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.summary.piutangBeredar).toBe(15000_00) // 40000 - 25000, despite being outside the range
  })

  it('labaKotor uses qty * konversi * hargaPokok, correctly costing a derived-unit sale', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    // Sells 1 DUS (konversi 10) of Kopi Kapal Api (hargaPokok 1000/pcs) for 14000
    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 14000_00,
      dibayar: 14000_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 10, hargaJual: 14000_00, hargaPokok: 1000_00, subtotal: 14000_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    // 14000 - (1 * 10 * 1000) = 4000, NOT 14000 - (1 * 1000) = 13000
    expect(result.summary.labaKotor).toBe(4000_00)
  })

  it('labaPerKategori falls back to Tanpa Kategori for uncategorized products', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 14000_00,
      dibayar: 14000_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 2, qty: 1, konversi: 1, hargaJual: 14000_00, hargaPokok: 12000_00, subtotal: 14000_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.labaPerKategori).toEqual([{ categoryName: 'Tanpa Kategori', omzet: 14000_00, laba: 2000_00 }])
  })

  it('labaPerHari groups sales into separate local-calendar-day buckets', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: new Date(2026, 0, 15, 23, 30),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 1500_00, hargaPokok: 1000_00, subtotal: 1500_00 }],
    })
    insertSale(db, {
      id: 2,
      metodePembayaran: 'tunai',
      status: 'selesai',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: new Date(2026, 0, 16, 0, 30),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 1500_00, hargaPokok: 1000_00, subtotal: 1500_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.labaPerHari).toEqual([
      { tanggal: '2026-01-15', omzet: 1500_00, laba: 500_00 },
      { tanggal: '2026-01-16', omzet: 1500_00, laba: 500_00 },
    ])
  })

  it('produkTerlaris returns at most 5 products, ordered by qty descending', () => {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()
    db.insert(users)
      .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
      .run()

    const productRows = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      kodeItem: `P${i + 1}`,
      barcode: null,
      namaItem: `Produk ${i + 1}`,
      categoryId: null,
      satuan: 'PCS',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 100,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(productRows).run()

    // Product i+1 sells (6-i) units, so product 1 sells 6 (most), product 6 sells 1 (least)
    for (let i = 0; i < 6; i++) {
      const qty = 6 - i
      insertSale(db, {
        id: i + 1,
        metodePembayaran: 'tunai',
        status: 'selesai',
        total: 1500_00 * qty,
        dibayar: 1500_00 * qty,
        createdAt: new Date(2026, 0, 15, 10, 0),
        items: [{ productId: i + 1, qty, konversi: 1, hargaJual: 1500_00, hargaPokok: 1000_00, subtotal: 1500_00 * qty }],
      })
    }

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.produkTerlaris).toHaveLength(5)
    expect(result.produkTerlaris.map((p) => p.namaItem)).toEqual([
      'Produk 1',
      'Produk 2',
      'Produk 3',
      'Produk 4',
      'Produk 5',
    ])
    expect(result.produkTerlaris[0]).toMatchObject({ qtyTerjual: 6, totalPenjualan: 9000_00 })
  })

  it('pembelianPerSupplier respects the date range on purchases.tanggal', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    db.insert(purchases)
      .values([
        { id: 1, supplierId: 1, userId: 1, tanggal: '2026-01-10', total: 100000_00, catatan: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 2, supplierId: 1, userId: 1, tanggal: '2025-06-01', total: 999999_00, catatan: null, createdAt: new Date(), updatedAt: new Date() },
      ])
      .run()

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.pembelianPerSupplier).toEqual([{ supplierName: 'CV Sumber Makmur', totalPembelian: 100000_00 }])
  })

  it('pembelianPerSupplier buckets purchases with no supplier under Tanpa Supplier', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    db.insert(purchases)
      .values([
        { id: 1, supplierId: null, userId: 1, tanggal: '2026-01-10', total: 75000_00, catatan: null, createdAt: new Date(), updatedAt: new Date() },
      ])
      .run()

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.pembelianPerSupplier).toEqual([{ supplierName: 'Tanpa Supplier', totalPembelian: 75000_00 }])
  })

  it('excludes cancelled sales from labaKotor, labaPerKategori, labaPerHari, and produkTerlaris', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    insertSale(db, {
      id: 1,
      metodePembayaran: 'tunai',
      status: 'dibatalkan',
      total: 1500_00,
      dibayar: 1500_00,
      createdAt: new Date(2026, 0, 15, 10, 0),
      items: [{ productId: 1, qty: 1, konversi: 1, hargaJual: 1500_00, hargaPokok: 1000_00, subtotal: 1500_00 }],
    })

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.summary.labaKotor).toBe(0)
    expect(result.labaPerKategori).toEqual([])
    expect(result.labaPerHari).toEqual([])
    expect(result.produkTerlaris).toEqual([])
  })

  it('returns zeroed summary and empty breakdowns for a range with no data', () => {
    const db = createDb(':memory:', migrationsFolder)
    seedBase(db)

    const result = getRekap(db, { from: '2026-01-01', to: '2026-01-31' })
    expect(result.summary).toEqual({ omzetTunai: 0, piutangBeredar: 0, jumlahTransaksi: 0, labaKotor: 0 })
    expect(result.labaPerKategori).toEqual([])
    expect(result.labaPerHari).toEqual([])
    expect(result.produkTerlaris).toEqual([])
    expect(result.pembelianPerSupplier).toEqual([])
  })
})
