import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { cashExpenses, users } from './db/schema'

export interface CashExpenseInput {
  tanggal: string
  kategori: string
  jumlah: number
  keterangan: string | null
  userId: number | null
}

export interface CashExpenseListItem {
  id: number
  tanggal: string
  kategori: string
  jumlah: number
  keterangan: string | null
  userName: string | null
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

export function recordCashExpense(
  db: BetterSQLite3Database<typeof schema>,
  input: CashExpenseInput,
): { expenseId: number } {
  if (!input.tanggal.trim()) {
    throw new Error('Tanggal wajib diisi.')
  }

  const kategori = input.kategori.trim()

  if (!kategori) {
    throw new Error('Kategori wajib diisi.')
  }

  if (kategori.length > 50) {
    throw new Error('Kategori maksimal 50 karakter.')
  }

  if (!Number.isInteger(input.jumlah) || input.jumlah <= 0) {
    throw new Error('Jumlah harus lebih dari 0.')
  }

  const keterangan = input.keterangan?.trim() || null

  if (keterangan && keterangan.length > 500) {
    throw new Error('Keterangan maksimal 500 karakter.')
  }

  const now = new Date()

  const row = db
    .insert(cashExpenses)
    .values({
      userId: input.userId,
      tanggal: input.tanggal.trim(),
      kategori,
      jumlah: input.jumlah,
      keterangan,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: cashExpenses.id })
    .get()

  return { expenseId: row.id }
}

/**
 * `totalJumlah` sums every row the filter matches, not just the returned page - the cash
 * book wants the period's pengeluaran, and a page total would understate it.
 */
export function listCashExpenses(
  db: BetterSQLite3Database<typeof schema>,
  input: { from?: string; to?: string; page: number; pageSize?: number },
): { data: CashExpenseListItem[]; currentPage: number; lastPage: number; total: number; totalJumlah: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const whereClause = and(
    input.from ? gte(cashExpenses.tanggal, input.from) : undefined,
    input.to ? lte(cashExpenses.tanggal, input.to) : undefined,
  )

  const totals = db
    .select({ count: sql<number>`count(*)`, jumlah: sql<number>`coalesce(sum(${cashExpenses.jumlah}), 0)` })
    .from(cashExpenses)
    .where(whereClause)
    .get()

  const total = totals?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const data = db
    .select({
      id: cashExpenses.id,
      tanggal: cashExpenses.tanggal,
      kategori: cashExpenses.kategori,
      jumlah: cashExpenses.jumlah,
      keterangan: cashExpenses.keterangan,
      userName: users.name,
    })
    .from(cashExpenses)
    .leftJoin(users, eq(cashExpenses.userId, users.id))
    .where(whereClause)
    .orderBy(desc(cashExpenses.tanggal), desc(cashExpenses.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data, currentPage: page, lastPage, total, totalJumlah: totals?.jumlah ?? 0 }
}

export function deleteCashExpense(db: BetterSQLite3Database<typeof schema>, id: number): void {
  const existing = db.select({ id: cashExpenses.id }).from(cashExpenses).where(eq(cashExpenses.id, id)).get()

  if (!existing) {
    throw new Error('Pengeluaran tidak ditemukan.')
  }

  db.delete(cashExpenses).where(eq(cashExpenses.id, id)).run()
}
