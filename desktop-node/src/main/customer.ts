import { eq, like, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { customers } from './db/schema'

type Db = BetterSQLite3Database<typeof schema>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never
type DbOrTx = Db | Tx

export interface CustomerListItem {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  saleCount: number
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

function customerListSelect(db: Db) {
  return db
    .select({
      id: customers.id,
      nama: customers.nama,
      telepon: customers.telepon,
      alamat: customers.alamat,
      keterangan: customers.keterangan,
      // Raw SQL identifiers, not Drizzle's ${table.column} interpolation, because this
      // query has no JOIN - see the long explanation on the same subquery in supplier.ts.
      saleCount: sql<number>`(SELECT COUNT(*) FROM sales WHERE customer_id = customers.id)`,
    })
    .from(customers)
}

export function listCustomers(
  db: Db,
  input: { search?: string; page: number; pageSize?: number },
): { data: CustomerListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const whereClause = input.search ? like(customers.nama, `%${input.search}%`) : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(customers).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const rows = customerListSelect(db)
    .where(whereClause)
    .orderBy(customers.nama)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data: rows, currentPage: page, lastPage, total }
}

/** Names only, ordered for the register's customer picker. */
export function listCustomerNames(db: Db): string[] {
  return db
    .select({ nama: customers.nama })
    .from(customers)
    .orderBy(customers.nama)
    .all()
    .map((row) => row.nama)
}

export interface CustomerInput {
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
}

function validateCustomerInput(input: CustomerInput): void {
  if (!input.nama.trim()) {
    throw new Error('Nama wajib diisi.')
  }

  if (input.nama.length > 255) {
    throw new Error('Nama maksimal 255 karakter.')
  }
}

export function createCustomer(db: Db, input: CustomerInput): number {
  validateCustomerInput(input)

  const now = new Date()
  const created = db
    .insert(customers)
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

export function updateCustomer(db: Db, id: number, input: CustomerInput): void {
  validateCustomerInput(input)

  db.update(customers)
    .set({
      nama: input.nama,
      telepon: input.telepon,
      alamat: input.alamat,
      keterangan: input.keterangan,
    })
    .where(eq(customers.id, id))
    .run()
}

export function deleteCustomer(db: Db, id: number): void {
  db.delete(customers).where(eq(customers.id, id)).run()
}

/**
 * The id of the customer with this name, creating the row when there is none.
 *
 * Matching ignores case, because the register's picker already treats "Budi" and
 * "budi" as the same customer - resolving them to two master rows would hand the
 * cashier a list with an apparent duplicate they cannot merge.
 *
 * Takes a transaction handle so a sale and the customer it created either both
 * land or neither does.
 */
export function findOrCreateCustomerByName(db: DbOrTx, nama: string): number | null {
  const trimmed = nama.trim()

  if (trimmed === '') {
    return null
  }

  const existing = db
    .select({ id: customers.id })
    .from(customers)
    .where(sql`lower(${customers.nama}) = lower(${trimmed})`)
    .orderBy(customers.id)
    .get()

  if (existing) {
    return existing.id
  }

  const now = new Date()

  return db
    .insert(customers)
    .values({ nama: trimmed, telepon: null, alamat: null, keterangan: null, createdAt: now, updatedAt: now })
    .returning()
    .get().id
}
