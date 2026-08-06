import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { users } from './db/schema'

export interface AuthUser {
  id: number
  username: string
  name: string
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

  return { id: row.id, username: row.username, name: row.name }
}
