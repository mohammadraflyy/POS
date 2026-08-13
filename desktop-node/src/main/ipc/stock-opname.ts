import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listCategories, searchProductsForOpname, recordStockAdjustment } from '../stock-opname'
import { requireUser } from './auth'

export function registerStockOpnameIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('stock-opname:listCategories', () => {
    requireUser()

    return listCategories(db)
  })

  ipcMain.handle('stock-opname:searchProducts', (_event, input: { q: string; categoryIds: number[] }) => {
    requireUser()

    return searchProductsForOpname(db, input)
  })

  ipcMain.handle(
    'stock-opname:recordAdjustment',
    (_event, input: { productId: number; stokSesudah: number; alasan: string | null }) => {
      const user = requireUser()

      return recordStockAdjustment(db, {
        productId: input.productId,
        stokSesudah: input.stokSesudah,
        alasan: input.alasan,
        userId: user.id,
      })
    },
  )
}
