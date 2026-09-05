import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import {
  recordPurchase,
  updatePurchase,
  deletePurchase,
  getPurchaseDetail,
  listPurchases,
  searchProductsForPurchase,
  findProductForPurchaseByBarcode,
  recordSupplierPayment,
  listSupplierDebts,
  listSupplierPayments,
  type PurchaseItemInput,
} from '../purchase'
import { requireUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

interface PurchaseFormInput {
  supplierId: number | null
  tanggal: string
  catatan: string | null
  items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
  dibayar?: number | null
}

function toPurchaseItems(items: PurchaseFormInput['items']): PurchaseItemInput[] {
  return items.map((item) => ({
    productId: item.productId,
    productUnitId: item.productUnitId,
    qty: item.qty,
    hargaBeli: toCents(item.hargaBeli),
  }))
}

/** null and undefined both mean "not specified", which records the invoice as settled */
function toDibayar(dibayar: number | null | undefined): number | undefined {
  return dibayar === null || dibayar === undefined ? undefined : toCents(dibayar)
}

export function registerPurchaseIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('purchase:recordPurchase', (_event, input: PurchaseFormInput) => {
    const user = requireUser()

    return recordPurchase(db, {
      supplierId: input.supplierId,
      tanggal: input.tanggal,
      catatan: input.catatan,
      items: toPurchaseItems(input.items),
      userId: user.id,
      dibayar: toDibayar(input.dibayar),
    })
  })

  ipcMain.handle('purchase:updatePurchase', (_event, purchaseId: number, input: PurchaseFormInput) => {
    const user = requireUser()

    const result = updatePurchase(db, purchaseId, {
      supplierId: input.supplierId,
      tanggal: input.tanggal,
      catatan: input.catatan,
      items: toPurchaseItems(input.items),
      userId: user.id,
      dibayar: toDibayar(input.dibayar),
    })

    return { total: toRupiah(result.total) }
  })

  ipcMain.handle('purchase:deletePurchase', (_event, purchaseId: number) => {
    requireUser()

    deletePurchase(db, purchaseId)
  })

  ipcMain.handle('purchase:getPurchaseDetail', (_event, purchaseId: number) => {
    requireUser()

    const detail = getPurchaseDetail(db, purchaseId)

    return {
      ...detail,
      total: toRupiah(detail.total),
      uangMuka: toRupiah(detail.uangMuka),
      cicilan: toRupiah(detail.cicilan),
      items: detail.items.map((item) => ({ ...item, hargaBeli: toRupiah(item.hargaBeli) })),
    }
  })

  ipcMain.handle('purchase:listPurchases', (_event, input: { page: number; pageSize?: number }) => {
    requireUser()

    const result = listPurchases(db, input)

    return {
      data: result.data.map((purchase) => ({
        id: purchase.id,
        tanggal: purchase.tanggal,
        total: toRupiah(purchase.total),
        dibayar: toRupiah(purchase.dibayar),
        sisa: toRupiah(purchase.sisa),
        catatan: purchase.catatan,
        supplierName: purchase.supplierName,
        itemSummary: purchase.itemSummary,
      })),
      currentPage: result.currentPage,
      lastPage: result.lastPage,
      total: result.total,
    }
  })

  ipcMain.handle('purchase:listSupplierDebts', (_event, supplierId?: number | null) => {
    requireUser()

    return listSupplierDebts(db, supplierId ?? undefined).map((debt) => ({
      purchaseId: debt.purchaseId,
      supplierId: debt.supplierId,
      supplierName: debt.supplierName,
      tanggal: debt.tanggal,
      total: toRupiah(debt.total),
      dibayar: toRupiah(debt.dibayar),
      sisa: toRupiah(debt.sisa),
    }))
  })

  ipcMain.handle(
    'purchase:recordSupplierPayment',
    (_event, input: { supplierId: number; jumlah: number; tanggal: string; keterangan: string | null }) => {
      const user = requireUser()

      const result = recordSupplierPayment(db, {
        supplierId: input.supplierId,
        jumlah: toCents(input.jumlah),
        tanggal: input.tanggal,
        keterangan: input.keterangan,
        userId: user.id,
      })

      return {
        alokasi: result.alokasi.map((a) => ({ purchaseId: a.purchaseId, jumlah: toRupiah(a.jumlah) })),
      }
    },
  )

  ipcMain.handle('purchase:listSupplierPayments', (_event, supplierId: number) => {
    requireUser()

    return listSupplierPayments(db, supplierId).map((payment) => ({
      id: payment.id,
      purchaseId: payment.purchaseId,
      jumlah: toRupiah(payment.jumlah),
      tanggal: payment.tanggal,
      keterangan: payment.keterangan,
    }))
  })

  ipcMain.handle('purchase:searchProducts', (_event, q: string) => {
    requireUser()

    return searchProductsForPurchase(db, q).map((product) => ({
      id: product.id,
      kodeItem: product.kodeItem,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaPokok: toRupiah(product.hargaPokok),
      units: product.units,
    }))
  })

  ipcMain.handle('purchase:findProductByBarcode', (_event, barcode: string) => {
    requireUser()

    const product = findProductForPurchaseByBarcode(db, barcode)

    if (!product) {
      return null
    }

    return {
      id: product.id,
      kodeItem: product.kodeItem,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaPokok: toRupiah(product.hargaPokok),
      units: product.units,
    }
  })
}
