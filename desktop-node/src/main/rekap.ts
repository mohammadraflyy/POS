import { and, eq, gte, lte, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, purchases, saleItems, sales, suppliers } from './db/schema'

export interface RekapSummary {
  omzetTunai: number
  piutangBeredar: number
  jumlahTransaksi: number
  labaKotor: number
}

export interface LabaPerKategoriRow {
  categoryName: string
  omzet: number
  laba: number
}

export interface LabaPerHariRow {
  tanggal: string
  omzet: number
  laba: number
}

export interface ProdukTerlarisRow {
  namaItem: string
  qtyTerjual: number
  totalPenjualan: number
}

export interface PembelianPerSupplierRow {
  supplierName: string
  totalPembelian: number
}

export interface RekapResult {
  summary: RekapSummary
  labaPerKategori: LabaPerKategoriRow[]
  labaPerHari: LabaPerHariRow[]
  produkTerlaris: ProdukTerlarisRow[]
  pembelianPerSupplier: PembelianPerSupplierRow[]
}

export function getRekap(db: BetterSQLite3Database<typeof schema>, input: { from: string; to: string }): RekapResult {
  const rangeStart = new Date(`${input.from}T00:00:00`)
  const rangeEnd = new Date(`${input.to}T23:59:59`)

  const omzetTunaiRow = db
    .select({ total: sql<number>`coalesce(sum(${sales.total}), 0)` })
    .from(sales)
    .where(
      and(
        eq(sales.status, 'selesai'),
        eq(sales.metodePembayaran, 'tunai'),
        gte(sales.createdAt, rangeStart),
        lte(sales.createdAt, rangeEnd),
      ),
    )
    .get()

  const jumlahTransaksiRow = db
    .select({ count: sql<number>`count(*)` })
    .from(sales)
    .where(and(eq(sales.status, 'selesai'), gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)))
    .get()

  const piutangRow = db
    .select({ piutang: sql<number>`coalesce(sum(${sales.total} - ${sales.dibayar}), 0)` })
    .from(sales)
    .where(and(eq(sales.status, 'selesai'), eq(sales.metodePembayaran, 'bon')))
    .get()

  const saleItemRows = db
    .select({
      createdAt: sales.createdAt,
      categoryName: categories.nama,
      productId: products.id,
      namaItem: products.namaItem,
      subtotal: saleItems.subtotal,
      qty: saleItems.qty,
      konversi: saleItems.konversi,
      hargaPokok: saleItems.hargaPokok,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(sales.status, 'selesai'), gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)))
    .all()

  let labaKotor = 0
  const labaPerKategoriMap = new Map<string, { omzet: number; laba: number }>()
  const labaPerHariMap = new Map<string, { omzet: number; laba: number }>()
  const produkTerlarisMap = new Map<number, { namaItem: string; qtyTerjual: number; totalPenjualan: number }>()

  for (const row of saleItemRows) {
    const laba = row.subtotal - row.qty * row.konversi * row.hargaPokok
    labaKotor += laba

    const categoryName = row.categoryName ?? 'Tanpa Kategori'
    const kategoriEntry = labaPerKategoriMap.get(categoryName) ?? { omzet: 0, laba: 0 }
    kategoriEntry.omzet += row.subtotal
    kategoriEntry.laba += laba
    labaPerKategoriMap.set(categoryName, kategoriEntry)

    const createdAt = row.createdAt
    const tanggal = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(createdAt.getDate()).padStart(2, '0')}`
    const hariEntry = labaPerHariMap.get(tanggal) ?? { omzet: 0, laba: 0 }
    hariEntry.omzet += row.subtotal
    hariEntry.laba += laba
    labaPerHariMap.set(tanggal, hariEntry)

    const produkEntry = produkTerlarisMap.get(row.productId) ?? { namaItem: row.namaItem, qtyTerjual: 0, totalPenjualan: 0 }
    produkEntry.qtyTerjual += row.qty
    produkEntry.totalPenjualan += row.subtotal
    produkTerlarisMap.set(row.productId, produkEntry)
  }

  const labaPerKategori: LabaPerKategoriRow[] = Array.from(labaPerKategoriMap.entries())
    .map(([categoryName, v]) => ({ categoryName, ...v }))
    .sort((a, b) => b.laba - a.laba)

  const labaPerHari: LabaPerHariRow[] = Array.from(labaPerHariMap.entries())
    .map(([tanggal, v]) => ({ tanggal, ...v }))
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0))

  const produkTerlaris: ProdukTerlarisRow[] = Array.from(produkTerlarisMap.values())
    .sort((a, b) => b.qtyTerjual - a.qtyTerjual)
    .slice(0, 5)

  const pembelianPerSupplier: PembelianPerSupplierRow[] = db
    .select({
      supplierName: suppliers.nama,
      totalPembelian: sql<number>`coalesce(sum(${purchases.total}), 0)`,
    })
    .from(purchases)
    .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(and(gte(purchases.tanggal, input.from), lte(purchases.tanggal, input.to)))
    .groupBy(suppliers.id, suppliers.nama)
    .all()
    .sort((a, b) => b.totalPembelian - a.totalPembelian)

  return {
    summary: {
      omzetTunai: omzetTunaiRow?.total ?? 0,
      piutangBeredar: piutangRow?.piutang ?? 0,
      jumlahTransaksi: jumlahTransaksiRow?.count ?? 0,
      labaKotor,
    },
    labaPerKategori,
    labaPerHari,
    produkTerlaris,
    pembelianPerSupplier,
  }
}
