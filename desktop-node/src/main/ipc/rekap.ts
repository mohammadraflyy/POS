import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { getRekap } from '../rekap'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

export function registerRekapIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('rekap:getRekap', (_event, input: { from: string; to: string }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const result = getRekap(db, input)

    return {
      summary: {
        omzetTunai: toRupiah(result.summary.omzetTunai),
        piutangBeredar: toRupiah(result.summary.piutangBeredar),
        jumlahTransaksi: result.summary.jumlahTransaksi,
        labaKotor: toRupiah(result.summary.labaKotor),
      },
      labaPerKategori: result.labaPerKategori.map((row) => ({
        categoryName: row.categoryName,
        omzet: toRupiah(row.omzet),
        laba: toRupiah(row.laba),
      })),
      labaPerHari: result.labaPerHari.map((row) => ({
        tanggal: row.tanggal,
        omzet: toRupiah(row.omzet),
        laba: toRupiah(row.laba),
      })),
      produkTerlaris: result.produkTerlaris.map((row) => ({
        namaItem: row.namaItem,
        qtyTerjual: row.qtyTerjual,
        totalPenjualan: toRupiah(row.totalPenjualan),
      })),
      pembelianPerSupplier: result.pembelianPerSupplier.map((row) => ({
        supplierName: row.supplierName,
        totalPembelian: toRupiah(row.totalPembelian),
      })),
    }
  })
}
