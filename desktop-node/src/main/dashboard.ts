import { and, desc, eq, inArray, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, saleItems, sales } from './db/schema'
import { getRekap, type ProdukTerlarisRow, type RekapSummary } from './rekap'

export interface StokMenipisRow {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  stok: number
}

export interface TransaksiTerbaruRow {
  id: number
  namaPelanggan: string | null
  metodePembayaran: 'tunai' | 'bon'
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  createdAt: Date
  itemSummary: string
}

export interface DashboardResult {
  summary: RekapSummary
  stokMenipis: StokMenipisRow[]
  produkTerlarisHariIni: ProdukTerlarisRow[]
  transaksiTerbaru: TransaksiTerbaruRow[]
}

const LOW_STOCK_THRESHOLD = 5

export function getDashboard(db: BetterSQLite3Database<typeof schema>): DashboardResult {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  const rekap = getRekap(db, { from: today, to: today })

  const stokMenipis: StokMenipisRow[] = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      namaItem: products.namaItem,
      satuan: products.satuan,
      stok: products.stok,
    })
    .from(products)
    .where(and(eq(products.isActive, true), lte(products.stok, LOW_STOCK_THRESHOLD)))
    .orderBy(products.stok)
    .limit(10)
    .all()

  const saleRows = db
    .select({
      id: sales.id,
      namaPelanggan: sales.namaPelanggan,
      metodePembayaran: sales.metodePembayaran,
      status: sales.status,
      total: sales.total,
      dibayar: sales.dibayar,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .orderBy(desc(sales.createdAt))
    .limit(5)
    .all()

  const saleIds = saleRows.map((s) => s.id)

  const itemRows =
    saleIds.length > 0
      ? db
          .select({
            saleId: saleItems.saleId,
            qty: saleItems.qty,
            namaItem: products.namaItem,
          })
          .from(saleItems)
          .innerJoin(products, eq(saleItems.productId, products.id))
          .where(inArray(saleItems.saleId, saleIds))
          .all()
      : []

  const transaksiTerbaru: TransaksiTerbaruRow[] = saleRows.map((sale) => {
    const items = itemRows.filter((item) => item.saleId === sale.id)
    const itemSummary = items.map((item) => `${item.namaItem} x${item.qty}`).join(', ')

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      total: sale.total,
      dibayar: sale.dibayar,
      createdAt: sale.createdAt,
      itemSummary,
    }
  })

  return {
    summary: rekap.summary,
    stokMenipis,
    produkTerlarisHariIni: rekap.produkTerlaris,
    transaksiTerbaru,
  }
}
