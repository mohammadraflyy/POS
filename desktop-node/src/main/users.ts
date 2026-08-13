import bcrypt from 'bcryptjs'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { users } from './db/schema'
import type { UserRole } from './auth'

export interface UserRow {
  id: number
  username: string
  name: string
  role: UserRole
  createdAt: Date
}

export interface CreateUserInput {
  username: string
  name: string
  password: string
  role: UserRole
}

export interface UpdateUserInput {
  name: string
  role: UserRole
  /** null leaves the existing password alone */
  password: string | null
}

const MIN_PASSWORD_LENGTH = 4

export function listUsers(db: BetterSQLite3Database<typeof schema>): UserRow[] {
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.username)
    .all()
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`)
  }
}

/** guards the app against ending up with no one who can administer it */
function assertNotLastAdmin(db: BetterSQLite3Database<typeof schema>, userId: number): void {
  const target = db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get()

  if (!target || target.role !== 'admin') {
    return
  }

  const otherAdmins = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.role, 'admin'), ne(users.id, userId)))
    .get()

  if ((otherAdmins?.count ?? 0) === 0) {
    throw new Error('Admin terakhir tidak bisa dihapus atau diturunkan jadi kasir.')
  }
}

export function createUser(db: BetterSQLite3Database<typeof schema>, input: CreateUserInput): number {
  const username = input.username.trim().toLowerCase()
  const name = input.name.trim()

  if (!username) {
    throw new Error('Username wajib diisi.')
  }

  if (!name) {
    throw new Error('Nama wajib diisi.')
  }

  validatePassword(input.password)

  const existing = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()

  if (existing) {
    throw new Error('Username sudah dipakai.')
  }

  const now = new Date()

  const row = db
    .insert(users)
    .values({
      username,
      name,
      passwordHash: bcrypt.hashSync(input.password, 10),
      role: input.role,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get()

  return row.id
}

export function updateUser(db: BetterSQLite3Database<typeof schema>, id: number, input: UpdateUserInput): void {
  const existing = db.select().from(users).where(eq(users.id, id)).get()

  if (!existing) {
    throw new Error('Pengguna tidak ditemukan.')
  }

  const name = input.name.trim()

  if (!name) {
    throw new Error('Nama wajib diisi.')
  }

  if (existing.role === 'admin' && input.role !== 'admin') {
    assertNotLastAdmin(db, id)
  }

  const values: { name: string; role: UserRole; updatedAt: Date; passwordHash?: string } = {
    name,
    role: input.role,
    updatedAt: new Date(),
  }

  if (input.password !== null) {
    validatePassword(input.password)
    values.passwordHash = bcrypt.hashSync(input.password, 10)
  }

  db.update(users).set(values).where(eq(users.id, id)).run()
}

export function deleteUser(db: BetterSQLite3Database<typeof schema>, id: number, currentUserId: number): void {
  if (id === currentUserId) {
    throw new Error('Tidak bisa menghapus akun yang sedang dipakai.')
  }

  const existing = db.select({ id: users.id }).from(users).where(eq(users.id, id)).get()

  if (!existing) {
    throw new Error('Pengguna tidak ditemukan.')
  }

  assertNotLastAdmin(db, id)

  // sales, purchases and price histories all reference users with ON DELETE SET NULL,
  // so removing an account leaves its past transactions in place, merely unattributed
  db.delete(users).where(eq(users.id, id)).run()
}
