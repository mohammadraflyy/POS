import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier, type SupplierInput } from '../supplier'
import { getCurrentUser } from './auth'

export function registerSupplierIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('supplier:listSuppliers', (_event, input: { search?: string; page: number; pageSize?: number }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return listSuppliers(db, input)
  })

  ipcMain.handle('supplier:createSupplier', (_event, input: SupplierInput) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return createSupplier(db, input)
  })

  ipcMain.handle('supplier:updateSupplier', (_event, id: number, input: SupplierInput) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    updateSupplier(db, id, input)
  })

  ipcMain.handle('supplier:deleteSupplier', (_event, id: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteSupplier(db, id)
  })
}
