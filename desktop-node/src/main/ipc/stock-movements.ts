import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listStockMovements, type StockMovementFilters } from '../stock-movements'
import { requireUser } from './auth'

export function registerStockMovementsIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('stockMovements:list', (_event, input: StockMovementFilters) => {
    requireUser()

    const result = listStockMovements(db, input)

    return {
      data: result.data.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      currentPage: result.currentPage,
      lastPage: result.lastPage,
      total: result.total,
    }
  })
}
