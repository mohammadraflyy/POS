import { dialog, ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
import * as schema from '../db/schema'
import {
  recordCashExpense,
  updateCashExpense,
  listCashExpenses,
  listAllCashExpenses,
  buildExpenseWorkbook,
  deleteCashExpense,
} from '../expense'
import { getMainWindow } from '../index'
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

  // editing rewrites the cash record like deleting does, so both stay with the owner
  ipcMain.handle(
    'expense:updateExpense',
    (_event, id: number, input: { tanggal: string; kategori: string; jumlah: number; keterangan: string | null }) => {
      requireAdmin()

      updateCashExpense(db, id, {
        tanggal: input.tanggal,
        kategori: input.kategori,
        jumlah: toCents(input.jumlah),
        keterangan: input.keterangan,
      })
    },
  )

  ipcMain.handle(
    'expense:listExpenses',
    (_event, input: { from?: string; to?: string; q?: string; page: number; pageSize?: number }) => {
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

  ipcMain.handle('expense:deleteExpense', (_event, id: number) => {
    requireAdmin()

    deleteCashExpense(db, id)
  })

  ipcMain.handle('expense:exportExcel', async (_event, input: { from?: string; to?: string; q?: string }) => {
    requireAdmin()

    const window = getMainWindow()
    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const result = await dialog.showSaveDialog(window, {
      defaultPath: `pengeluaran-${input.from ?? 'semua'}-${input.to ?? 'semua'}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    const expenses = listAllCashExpenses(db, input)
    const workbook = buildExpenseWorkbook(expenses)
    XLSX.writeFile(workbook, result.filePath)

    return result.filePath
  })
}
