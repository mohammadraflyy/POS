import { dialog, ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
import * as schema from '../db/schema'
import { getRekap, buildRekapWorkbook } from '../rekap'
import { getMainWindow } from '../index'
import { requireAdmin } from './auth'
import { applyCostCorrection, listCostCorrections, previewCostCorrection } from '../cost-correction'
import type { CostCorrectionApply, CostCorrectionRequest } from '../../shared/cost-correction'

function toRupiah(cents: number): number {
  return cents / 100
}

export function registerRekapIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('rekap:previewCostCorrection', (_event, input: CostCorrectionRequest) =>
    previewCostCorrection(db, requireAdmin(), input))
  ipcMain.handle('rekap:applyCostCorrection', (_event, input: CostCorrectionApply) =>
    applyCostCorrection(db, requireAdmin(), input))
  ipcMain.handle('rekap:listCostCorrections', () => listCostCorrections(db, requireAdmin()))
  ipcMain.handle('rekap:getRekap', (_event, input: { from: string; to: string }) => {
    requireAdmin()

    const result = getRekap(db, input)

    return {
      summary: {
        omzetTunai: toRupiah(result.summary.omzetTunai),
        omzetNonTunai: toRupiah(result.summary.omzetNonTunai),
        piutangBeredar: toRupiah(result.summary.piutangBeredar),
        jumlahTransaksi: result.summary.jumlahTransaksi,
        labaKotor: toRupiah(result.summary.labaKotor),
      },
      penjelasanLaba: {
        penjualanKotor: toRupiah(result.penjelasanLaba.penjualanKotor),
        diskonItem: toRupiah(result.penjelasanLaba.diskonItem),
        diskonNota: toRupiah(result.penjelasanLaba.diskonNota),
        omzet: toRupiah(result.penjelasanLaba.omzet),
        modal: toRupiah(result.penjelasanLaba.modal),
        labaKotor: toRupiah(result.penjelasanLaba.labaKotor),
        jumlahBarisRugi: result.penjelasanLaba.jumlahBarisRugi,
        totalRugi: toRupiah(result.penjelasanLaba.totalRugi),
        barisRugi: result.penjelasanLaba.barisRugi.map((row) => ({
          saleItemId: row.saleItemId,
          productUnitId: row.productUnitId,
          productId: row.productId,
          saleId: row.saleId,
          tanggal: row.tanggal,
          namaItem: row.namaItem,
          satuan: row.satuan,
          // a count of goods, not money
          qty: row.qty,
          hargaJual: toRupiah(row.hargaJual),
          hargaPokok: toRupiah(row.hargaPokok),
          diskon: toRupiah(row.diskon),
          omzet: toRupiah(row.omzet),
          modal: toRupiah(row.modal),
          laba: toRupiah(row.laba),
        })),
        saran: result.penjelasanLaba.saran.map((row) => ({
          status: row.status,
          kode: row.kode,
          // a count, not money
          jumlah: row.jumlah,
          nilai: toRupiah(row.nilai),
          // a percentage, not money
          persen: row.persen,
          contoh: row.contoh,
          produk: row.produk,
          saleIds: row.saleIds,
        })),
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
      piutangPerPelanggan: result.piutangPerPelanggan.map((row) => ({
        customerId: row.customerId,
        namaPelanggan: row.namaPelanggan,
        telepon: row.telepon,
        totalPiutang: toRupiah(row.totalPiutang),
        jumlahBon: row.jumlahBon,
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
