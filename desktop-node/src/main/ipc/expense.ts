import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { recordCashExpense, listCashExpenses, deleteCashExpense } from '../expense'
import { requireAdmin, requireUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

export function registerExpenseIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle(
    'expense:recordExpense',
    (_event, input: { tanggal: string; kategori: string; jumlah: number; keterangan: string | null }) => {
      const user = requireUser()

      return recordCashExpense(db, {
        tanggal: input.tanggal,
        kategori: input.kategori,
        jumlah: toCents(input.jumlah),
        keterangan: input.keterangan,
        userId: user.id,
      })
    },
  )

  ipcMain.handle(
    'expense:listExpenses',
    (_event, input: { from?: string; to?: string; page: number; pageSize?: number }) => {
      requireUser()

      const result = listCashExpenses(db, input)

      return {
        data: result.data.map((expense) => ({
          id: expense.id,
          tanggal: expense.tanggal,
          kategori: expense.kategori,
          jumlah: toRupiah(expense.jumlah),
          keterangan: expense.keterangan,
          userName: expense.userName,
        })),
        currentPage: result.currentPage,
        lastPage: result.lastPage,
        total: result.total,
        totalJumlah: toRupiah(result.totalJumlah),
      }
    },
  )

  // deleting rewrites the cash record, so it stays with the owner
  ipcMain.handle('expense:deleteExpense', (_event, id: number) => {
    requireAdmin()

    deleteCashExpense(db, id)
  })
}
