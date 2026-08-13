import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { users } from './db/schema'

export type UserRole = 'admin' | 'kasir'

export interface AuthUser {
  id: number
  username: string
  name: string
  role: UserRole
}

/**
 * Access checks live here rather than in the IPC layer so they can be tested without
 * booting Electron. The session itself stays in `ipc/auth.ts`; these only judge it.
 */
export function assertLoggedIn(user: AuthUser | null): AuthUser {
  if (!user) {
    throw new Error('Silakan login terlebih dahulu.')
  }

  return user
}

export function assertAdmin(user: AuthUser | null): AuthUser {
  const loggedIn = assertLoggedIn(user)

  if (loggedIn.role !== 'admin') {
    throw new Error('Akses ditolak. Hanya admin yang boleh melakukan ini.')
  }

  return loggedIn
}

export function verifyLogin(
  db: BetterSQLite3Database<typeof schema>,
  username: string,
  password: string,
): AuthUser {
  const row = db.select().from(users).where(eq(users.username, username)).get()
  if (!row) {
    throw new Error('Username atau password salah')
  }

  const valid = bcrypt.compareSync(password, row.passwordHash)
  if (!valid) {
    throw new Error('Username atau password salah')
  }

  return { id: row.id, username: row.username, name: row.name, role: row.role }
}
