import crypto from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { deviceTokens, users } from './db/schema'
import type { AuthUser } from './auth'

type Db = BetterSQLite3Database<typeof schema>

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export interface IssueDeviceTokenInput {
  userId: number
  namaPerangkat: string | null
}

export interface IssuedDeviceToken {
  id: number
  /** the plaintext token - returned once, never stored, never retrievable again */
  token: string
}

/**
 * A device token is high-entropy (256 random bits) and only ever checked by exact
 * match, unlike a user's password. Hashing it with bcrypt - which is deliberately
 * slow, built to make brute-forcing a low-entropy human password expensive - would
 * only slow down every authenticated request from every paired phone, for no
 * security benefit a plain sha256 lookup doesn't already give.
 */
export function issueDeviceToken(db: Db, input: IssueDeviceTokenInput): IssuedDeviceToken {
  const token = crypto.randomBytes(32).toString('hex')
  const now = new Date()

  const row = db
    .insert(deviceTokens)
    .values({
      userId: input.userId,
      namaPerangkat: input.namaPerangkat,
      tokenHash: hashToken(token),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: deviceTokens.id })
    .get()

  return { id: row.id, token }
}

/** the paired phone's identity, or null when the token is unknown or has been revoked */
export function resolveDeviceToken(db: Db, token: string): AuthUser | null {
  const row = db
    .select({
      tokenId: deviceTokens.id,
      userId: users.id,
      username: users.username,
      name: users.name,
      role: users.role,
    })
    .from(deviceTokens)
    .innerJoin(users, eq(deviceTokens.userId, users.id))
    .where(and(eq(deviceTokens.tokenHash, hashToken(token)), isNull(deviceTokens.revokedAt)))
    .get()

  if (!row) {
    return null
  }

  db.update(deviceTokens).set({ lastUsedAt: new Date() }).where(eq(deviceTokens.id, row.tokenId)).run()

  return { id: row.userId, username: row.username, name: row.name, role: row.role }
}

export interface PairedDevice {
  id: number
  namaPerangkat: string | null
  userId: number
  userName: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/** every paired device, active and revoked alike - the Settings list shows both */
export function listPairedDevices(db: Db): PairedDevice[] {
  return db
    .select({
      id: deviceTokens.id,
      namaPerangkat: deviceTokens.namaPerangkat,
      userId: deviceTokens.userId,
      userName: users.name,
      createdAt: deviceTokens.createdAt,
      lastUsedAt: deviceTokens.lastUsedAt,
      revokedAt: deviceTokens.revokedAt,
    })
    .from(deviceTokens)
    .innerJoin(users, eq(deviceTokens.userId, users.id))
    .orderBy(deviceTokens.createdAt)
    .all()
}

export function revokeDevice(db: Db, id: number): void {
  const existing = db.select({ id: deviceTokens.id }).from(deviceTokens).where(eq(deviceTokens.id, id)).get()

  if (!existing) {
    throw new Error('Perangkat tidak ditemukan.')
  }

  db.update(deviceTokens).set({ revokedAt: new Date() }).where(eq(deviceTokens.id, id)).run()
}
