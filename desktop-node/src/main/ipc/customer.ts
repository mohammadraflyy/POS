import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listCustomers, createCustomer, updateCustomer, deleteCustomer, type CustomerInput } from '../customer'
import { requireAdmin, requireUser } from './auth'

export function registerCustomerIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('customer:listCustomers', (_event, input: { search?: string; page: number; pageSize?: number }) => {
    requireUser()

    return listCustomers(db, input)
  })

  ipcMain.handle('customer:createCustomer', (_event, input: CustomerInput) => {
    requireUser()

    return createCustomer(db, input)
  })

  ipcMain.handle('customer:updateCustomer', (_event, id: number, input: CustomerInput) => {
    requireUser()

    updateCustomer(db, id, input)
  })

  ipcMain.handle('customer:deleteCustomer', (_event, id: number) => {
    requireAdmin()

    deleteCustomer(db, id)
  })
}
