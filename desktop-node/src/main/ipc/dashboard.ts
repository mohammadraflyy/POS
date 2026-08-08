import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { getDashboard } from '../dashboard'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

export function registerDashboardIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('dashboard:getDashboard', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const result = getDashboard(db)

    return {
      summary: {
        omzetTunai: toRupiah(result.summary.omzetTunai),
        piutangBeredar: toRupiah(result.summary.piutangBeredar),
        jumlahTransaksi: result.summary.jumlahTransaksi,
        labaKotor: toRupiah(result.summary.labaKotor),
      },
      stokMenipis: result.stokMenipis,
      produkTerlarisHariIni: result.produkTerlarisHariIni.map((row) => ({
        namaItem: row.namaItem,
        qtyTerjual: row.qtyTerjual,
        totalPenjualan: toRupiah(row.totalPenjualan),
      })),
      transaksiTerbaru: result.transaksiTerbaru.map((row) => ({
        id: row.id,
        namaPelanggan: row.namaPelanggan,
        metodePembayaran: row.metodePembayaran,
        status: row.status,
        total: toRupiah(row.total),
        dibayar: toRupiah(row.dibayar),
        createdAt: row.createdAt.toISOString(),
        itemSummary: row.itemSummary,
      })),
    }
  })
}
