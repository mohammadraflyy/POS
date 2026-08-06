import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from './db/migrate'
import { users } from './db/schema'
import { verifyLogin } from './auth'

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
    expect(result).toEqual({ id: expect.any(Number), username: 'kasir1', name: 'Kasir Satu' })
  })

  it('throws when the password is wrong', () => {
    expect(() => verifyLogin(db, 'kasir1', 'salah')).toThrow('Username atau password salah')
  })

  it('throws when the username does not exist', () => {
    expect(() => verifyLogin(db, 'tidak_ada', 'apapun')).toThrow('Username atau password salah')
  })
})
