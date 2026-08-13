import { dialog, ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
import * as schema from '../db/schema'
import { getRekap, buildRekapWorkbook } from '../rekap'
import { getMainWindow } from '../index'
import { requireAdmin } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

export function registerRekapIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('rekap:getRekap', (_event, input: { from: string; to: string }) => {
    requireAdmin()

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
      labaPerSatuan: result.labaPerSatuan.map((row) => ({
        satuan: row.satuan,
        qtyTerjual: row.qtyTerjual,
        omzet: toRupiah(row.omzet),
        laba: toRupiah(row.laba),
        // a percentage, not money - it must not go through toRupiah
        marginPersen: row.marginPersen,
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
      stockValue: {
        totalNilai: toRupiah(result.stockValue.totalNilai),
        produk: result.stockValue.produk.map((row) => ({
          namaItem: row.namaItem,
          kodeItem: row.kodeItem,
          satuan: row.satuan,
          stok: row.stok,
          hargaPokok: toRupiah(row.hargaPokok),
          nilai: toRupiah(row.nilai),
        })),
      },
      salesHistory: result.salesHistory.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        namaPelanggan: row.namaPelanggan,
        metodePembayaran: row.metodePembayaran,
        status: row.status,
        total: toRupiah(row.total),
        dibayar: toRupiah(row.dibayar),
      })),
    }
  })

  ipcMain.handle('rekap:exportExcel', async (_event, input: { from: string; to: string }) => {
    requireAdmin()

    const window = getMainWindow()
    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const result = await dialog.showSaveDialog(window, {
      defaultPath: `rekap-${input.from}-${input.to}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const rekap = getRekap(db, input)
    const workbook = buildRekapWorkbook(rekap)
    XLSX.writeFile(workbook, result.filePath)

    return result.filePath
  })
}
