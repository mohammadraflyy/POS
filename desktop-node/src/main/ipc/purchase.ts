import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { recordPurchase, listPurchases, searchProductsForPurchase, type PurchaseItemInput } from '../purchase'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

export function registerPurchaseIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle(
    'purchase:recordPurchase',
    (
      _event,
      input: {
        supplierId: number | null
        tanggal: string
        catatan: string | null
        items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
      },
    ) => {
      const user = getCurrentUser()
      if (!user) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      const items: PurchaseItemInput[] = input.items.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        hargaBeli: toCents(item.hargaBeli),
      }))

      return recordPurchase(db, {
        supplierId: input.supplierId,
        tanggal: input.tanggal,
        catatan: input.catatan,
        items,
        userId: user.id,
      })
    },
  )

  ipcMain.handle('purchase:listPurchases', (_event, input: { page: number; pageSize?: number }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const result = listPurchases(db, input)

    return {
      data: result.data.map((purchase) => ({
        id: purchase.id,
        tanggal: purchase.tanggal,
        total: toRupiah(purchase.total),
        catatan: purchase.catatan,
        supplierName: purchase.supplierName,
        itemSummary: purchase.itemSummary,
      })),
      currentPage: result.currentPage,
      lastPage: result.lastPage,
      total: result.total,
    }
  })

  ipcMain.handle('purchase:searchProducts', (_event, q: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsForPurchase(db, q).map((product) => ({
      id: product.id,
      kodeItem: product.kodeItem,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaPokok: toRupiah(product.hargaPokok),
      units: product.units,
    }))
  })
}
