import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
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

export interface StockValueRow {
  namaItem: string
  kodeItem: string
  satuan: string
  stok: number
  hargaPokok: number
  nilai: number
}

export interface StockValueSummary {
  totalNilai: number
  produk: StockValueRow[]
}

export interface SalesHistoryRow {
  id: number
  createdAt: string
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
}

export interface RekapResult {
  summary: RekapSummary
  labaPerKategori: LabaPerKategoriRow[]
  labaPerHari: LabaPerHariRow[]
  produkTerlaris: ProdukTerlarisRow[]
  pembelianPerSupplier: PembelianPerSupplierRow[]
  stockValue: StockValueSummary
  salesHistory: SalesHistoryRow[]
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
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(and(gte(purchases.tanggal, input.from), lte(purchases.tanggal, input.to)))
    .groupBy(purchases.supplierId)
    .all()
    .map((row) => ({ supplierName: row.supplierName ?? 'Tanpa Supplier', totalPembelian: row.totalPembelian }))
    .sort((a, b) => b.totalPembelian - a.totalPembelian)

  const stockValue = getStockValue(db)
  const salesHistory = getSalesHistory(db, input)

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
    stockValue,
    salesHistory,
  }
}

export function getStockValue(db: BetterSQLite3Database<typeof schema>): StockValueSummary {
  const rows = db
    .select({
      namaItem: products.namaItem,
      kodeItem: products.kodeItem,
      satuan: products.satuan,
      stok: products.stok,
      hargaPokok: products.hargaPokok,
    })
    .from(products)
    .where(and(eq(products.isActive, true), gt(products.stok, 0)))
    .all()

  const produk: StockValueRow[] = rows
    .map((row) => ({ ...row, nilai: row.stok * row.hargaPokok }))
    .sort((a, b) => b.nilai - a.nilai)

  const totalNilai = produk.reduce((sum, row) => sum + row.nilai, 0)

  return { totalNilai, produk }
}

export function getSalesHistory(
  db: BetterSQLite3Database<typeof schema>,
  input: { from: string; to: string },
): SalesHistoryRow[] {
  const rangeStart = new Date(`${input.from}T00:00:00`)
  const rangeEnd = new Date(`${input.to}T23:59:59`)

  return db
    .select({
      id: sales.id,
      createdAt: sales.createdAt,
      namaPelanggan: sales.namaPelanggan,
      metodePembayaran: sales.metodePembayaran,
      status: sales.status,
      total: sales.total,
      dibayar: sales.dibayar,
    })
    .from(sales)
    .where(and(gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)))
    .orderBy(desc(sales.createdAt))
    .all()
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

function toRupiahExport(cents: number): number {
  return cents / 100
}

function computeColWidths(headers: string[], rows: Record<string, unknown>[]): { wch: number }[] {
  return headers.map((header) => {
    const maxRowLen = rows.reduce((max, row) => Math.max(max, String(row[header] ?? '').length), 0)
    return { wch: Math.min(Math.max(header.length, maxRowLen) + 2, 40) }
  })
}

export function buildRekapWorkbook(rekap: RekapResult): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  const sheets: { name: string; headers: string[]; rows: Record<string, unknown>[] }[] = [
    {
      name: 'Riwayat Transaksi',
      headers: ['Tanggal', 'Pelanggan', 'Metode', 'Status', 'Total', 'Dibayar'],
      rows: rekap.salesHistory.map((row) => ({
        Tanggal: new Date(row.createdAt).toLocaleString('id-ID'),
        Pelanggan: row.namaPelanggan ?? '-',
        Metode: row.metodePembayaran,
        Status: row.status,
        Total: toRupiahExport(row.total),
        Dibayar: toRupiahExport(row.dibayar),
      })),
    },
    {
      name: 'Laba per Kategori',
      headers: ['Kategori', 'Omzet', 'Laba'],
      rows: rekap.labaPerKategori.map((row) => ({
        Kategori: row.categoryName,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
      })),
    },
    {
      name: 'Laba per Hari',
      headers: ['Tanggal', 'Omzet', 'Laba'],
      rows: rekap.labaPerHari.map((row) => ({
        Tanggal: row.tanggal,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
      })),
    },
    {
      name: 'Produk Terlaris',
      headers: ['Produk', 'Qty Terjual', 'Total Penjualan'],
      rows: rekap.produkTerlaris.map((row) => ({
        Produk: row.namaItem,
        'Qty Terjual': row.qtyTerjual,
        'Total Penjualan': toRupiahExport(row.totalPenjualan),
      })),
    },
    {
      name: 'Pembelian per Supplier',
      headers: ['Supplier', 'Total Pembelian'],
      rows: rekap.pembelianPerSupplier.map((row) => ({
        Supplier: row.supplierName,
        'Total Pembelian': toRupiahExport(row.totalPembelian),
      })),
    },
    {
      name: 'Nilai Stock',
      headers: ['Kode Item', 'Produk', 'Stok', 'Satuan', 'Harga Pokok', 'Nilai'],
      rows: rekap.stockValue.produk.map((row) => ({
        'Kode Item': row.kodeItem,
        Produk: row.namaItem,
        Stok: row.stok,
        Satuan: row.satuan,
        'Harga Pokok': toRupiahExport(row.hargaPokok),
        Nilai: toRupiahExport(row.nilai),
      })),
    },
  ]

  for (const sheet of sheets) {
    const worksheet: XLSX.WorkSheet = {}
    XLSX.utils.sheet_add_json(worksheet, sheet.rows, { header: sheet.headers, origin: 'A2' })
    XLSX.utils.sheet_add_aoa(worksheet, [[sheet.name]], { origin: 'A1' })
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(sheet.headers.length - 1, 0) } }]
    worksheet['!cols'] = computeColWidths(sheet.headers, sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
  }

  return workbook
}
