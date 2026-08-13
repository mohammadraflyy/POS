import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { users } from './db/schema'
import { assertAdmin, assertLoggedIn, verifyLogin, type AuthUser } from './auth'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')
const db = createDb(':memory:', migrationsFolder)

beforeEach(() => {
  db.delete(users).run()
  const now = new Date()
  db.insert(users)
    .values({
      username: 'kasir1',
      passwordHash: bcrypt.hashSync('rahasia123', 10),
      name: 'Kasir Satu',
      createdAt: now,
      updatedAt: now,
    })
    .run()
})

describe('verifyLogin', () => {
  it('returns the user when credentials are correct', () => {
    const result = verifyLogin(db, 'kasir1', 'rahasia123')
    expect(result).toEqual({ id: expect.any(Number), username: 'kasir1', name: 'Kasir Satu', role: 'kasir' })
  })

  it('throws when the password is wrong', () => {
    expect(() => verifyLogin(db, 'kasir1', 'salah')).toThrow('Username atau password salah')
  })

  it('throws when the username does not exist', () => {
    expect(() => verifyLogin(db, 'tidak_ada', 'apapun')).toThrow('Username atau password salah')
  })

  it('carries the stored role', () => {
    db.update(users).set({ role: 'admin' }).where(eq(users.username, 'kasir1')).run()

    expect(verifyLogin(db, 'kasir1', 'rahasia123').role).toBe('admin')
  })
})

const adminUser: AuthUser = { id: 1, username: 'admin', name: 'Admin', role: 'admin' }
const kasirUser: AuthUser = { id: 2, username: 'kasir1', name: 'Kasir Satu', role: 'kasir' }

describe('assertLoggedIn', () => {
  it('returns the user when there is a session', () => {
    expect(assertLoggedIn(kasirUser)).toBe(kasirUser)
  })

  it('throws when there is no session', () => {
    expect(() => assertLoggedIn(null)).toThrow('Silakan login terlebih dahulu.')
  })
})

describe('assertAdmin', () => {
  it('lets an admin through', () => {
    expect(assertAdmin(adminUser)).toBe(adminUser)
  })

  it('rejects a kasir', () => {
    expect(() => assertAdmin(kasirUser)).toThrow('Akses ditolak. Hanya admin yang boleh melakukan ini.')
  })

  it('rejects an absent session before it ever looks at the role', () => {
    expect(() => assertAdmin(null)).toThrow('Silakan login terlebih dahulu.')
  })
})
