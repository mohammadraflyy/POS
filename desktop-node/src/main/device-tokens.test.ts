import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from './db/migrate'
import { users } from './db/schema'
import { issueDeviceToken, resolveDeviceToken, listPairedDevices, revokeDevice } from './device-tokens'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')
const db = createDb(':memory:', migrationsFolder)

let userId: number

beforeEach(() => {
  db.delete(users).run()
  const now = new Date()
  const row = db
    .insert(users)
    .values({
      username: 'kasir1',
      passwordHash: bcrypt.hashSync('rahasia123', 10),
      name: 'Kasir Satu',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get()
  userId = row.id
})

describe('issueDeviceToken + resolveDeviceToken', () => {
  it('round-trips: an issued token resolves back to its owning user', () => {
    const { token } = issueDeviceToken(db, { userId, namaPerangkat: 'HP Kasir 1' })

    expect(resolveDeviceToken(db, token)).toEqual({
      id: userId,
      username: 'kasir1',
      name: 'Kasir Satu',
      role: 'kasir',
    })
  })

  it('returns null for a token that was never issued', () => {
    expect(resolveDeviceToken(db, 'never-issued')).toBeNull()
  })

  it('returns null once the device has been revoked', () => {
    const { token, id } = issueDeviceToken(db, { userId, namaPerangkat: null })
    revokeDevice(db, id)

    expect(resolveDeviceToken(db, token)).toBeNull()
  })

  it('touches lastUsedAt on a successful resolve', () => {
    const { token, id } = issueDeviceToken(db, { userId, namaPerangkat: null })

    expect(listPairedDevices(db).find((d) => d.id === id)?.lastUsedAt).toBeNull()

    resolveDeviceToken(db, token)

    expect(listPairedDevices(db).find((d) => d.id === id)?.lastUsedAt).toBeInstanceOf(Date)
  })
})

describe('listPairedDevices', () => {
  it('joins the owning user name', () => {
    issueDeviceToken(db, { userId, namaPerangkat: 'HP Kasir 1' })

    const rows = listPairedDevices(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ namaPerangkat: 'HP Kasir 1', userId, userName: 'Kasir Satu' })
  })
})

describe('revokeDevice', () => {
  it('throws when the device does not exist', () => {
    expect(() => revokeDevice(db, 999)).toThrow('Perangkat tidak ditemukan.')
  })
})
