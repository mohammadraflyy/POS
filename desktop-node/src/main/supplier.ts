import { eq, like, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { suppliers } from './db/schema'

export interface SupplierListItem {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  purchaseCount: number
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

function supplierListSelect(db: BetterSQLite3Database<typeof schema>) {
  return db
    .select({
      id: suppliers.id,
      nama: suppliers.nama,
      telepon: suppliers.telepon,
      alamat: suppliers.alamat,
      keterangan: suppliers.keterangan,
      purchaseCount: sql<number>`(SELECT COUNT(*) FROM purchases WHERE supplier_id = suppliers.id)`,
    })
    .from(suppliers)
}

export function listSuppliers(
  db: BetterSQLite3Database<typeof schema>,
  input: { search?: string; page: number; pageSize?: number },
): { data: SupplierListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const whereClause = input.search ? like(suppliers.nama, `%${input.search}%`) : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(suppliers).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const rows = supplierListSelect(db)
    .where(whereClause)
    .orderBy(suppliers.nama)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data: rows, currentPage: page, lastPage, total }
}

export interface SupplierInput {
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
}

function validateSupplierInput(input: SupplierInput): void {
  if (!input.nama.trim()) {
    throw new Error('Nama wajib diisi.')
  }

  if (input.nama.length > 255) {
    throw new Error('Nama maksimal 255 karakter.')
  }
}

export function createSupplier(db: BetterSQLite3Database<typeof schema>, input: SupplierInput): number {
  validateSupplierInput(input)

  const now = new Date()
  const created = db
    .insert(suppliers)
    .values({
      nama: input.nama,
      telepon: input.telepon,
      alamat: input.alamat,
      keterangan: input.keterangan,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  return created.id
}

export function updateSupplier(db: BetterSQLite3Database<typeof schema>, id: number, input: SupplierInput): void {
  validateSupplierInput(input)

  db.update(suppliers)
    .set({
      nama: input.nama,
      telepon: input.telepon,
      alamat: input.alamat,
      keterangan: input.keterangan,
    })
    .where(eq(suppliers.id, id))
    .run()
}

export function deleteSupplier(db: BetterSQLite3Database<typeof schema>, id: number): void {
  db.delete(suppliers).where(eq(suppliers.id, id)).run()
}
