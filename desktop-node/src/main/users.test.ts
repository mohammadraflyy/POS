import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { users } from './db/schema'
import { verifyLogin } from './auth'
import { listUsers, createUser, updateUser, deleteUser } from './users'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')
const db = createDb(':memory:', migrationsFolder)

let adminId = 0

beforeEach(() => {
  db.delete(users).run()
  const now = new Date()

  adminId = db
    .insert(users)
    .values({
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin', 10),
      name: 'Admin',
      role: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: users.id })
    .get().id
})

describe('createUser', () => {
  it('stores a hashed password the new account can log in with', () => {
    createUser(db, { username: 'Kasir1', name: 'Kasir Satu', password: 'rahasia', role: 'kasir' })

    const row = db.select().from(users).where(eq(users.username, 'kasir1')).get()
    expect(row?.passwordHash).not.toBe('rahasia')
    expect(verifyLogin(db, 'kasir1', 'rahasia')).toMatchObject({ name: 'Kasir Satu', role: 'kasir' })
  })

  it('lowercases and trims the username so logins cannot fork on casing', () => {
    createUser(db, { username: '  Budi  ', name: 'Budi', password: 'rahasia', role: 'kasir' })

    expect(listUsers(db).map((user) => user.username)).toContain('budi')
  })

  it('rejects a duplicate username', () => {
    createUser(db, { username: 'budi', name: 'Budi', password: 'rahasia', role: 'kasir' })

    expect(() => createUser(db, { username: 'BUDI', name: 'Budi Lain', password: 'rahasia', role: 'kasir' })).toThrow(
      'Username sudah dipakai.',
    )
  })

  it('rejects a blank username or name', () => {
    expect(() => createUser(db, { username: '   ', name: 'Budi', password: 'rahasia', role: 'kasir' })).toThrow(
      'Username wajib diisi.',
    )
    expect(() => createUser(db, { username: 'budi', name: '  ', password: 'rahasia', role: 'kasir' })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('rejects a password below the minimum length', () => {
    expect(() => createUser(db, { username: 'budi', name: 'Budi', password: 'abc', role: 'kasir' })).toThrow(
      'Password minimal 4 karakter.',
    )
  })
})

describe('updateUser', () => {
  it('changes the name and role without touching the password when none is given', () => {
    const id = createUser(db, { username: 'budi', name: 'Budi', password: 'rahasia', role: 'kasir' })

    updateUser(db, id, { name: 'Budi Santoso', role: 'admin', password: null })

    expect(verifyLogin(db, 'budi', 'rahasia')).toMatchObject({ name: 'Budi Santoso', role: 'admin' })
  })

  it('replaces the password when one is given', () => {
    const id = createUser(db, { username: 'budi', name: 'Budi', password: 'rahasia', role: 'kasir' })

    updateUser(db, id, { name: 'Budi', role: 'kasir', password: 'rahasiabaru' })

    expect(() => verifyLogin(db, 'budi', 'rahasia')).toThrow('Username atau password salah')
    expect(verifyLogin(db, 'budi', 'rahasiabaru').name).toBe('Budi')
  })

  it('refuses to demote the last admin', () => {
    expect(() => updateUser(db, adminId, { name: 'Admin', role: 'kasir', password: null })).toThrow(
      'Admin terakhir tidak bisa dihapus atau diturunkan jadi kasir.',
    )
  })

  it('allows demoting an admin once another admin exists', () => {
    createUser(db, { username: 'owner', name: 'Owner', password: 'rahasia', role: 'admin' })

    updateUser(db, adminId, { name: 'Admin', role: 'kasir', password: null })

    expect(verifyLogin(db, 'admin', 'admin').role).toBe('kasir')
  })

  it('throws for an unknown id', () => {
    expect(() => updateUser(db, 999, { name: 'X', role: 'kasir', password: null })).toThrow('Pengguna tidak ditemukan.')
  })
})

describe('deleteUser', () => {
  it('removes another account', () => {
    const id = createUser(db, { username: 'budi', name: 'Budi', password: 'rahasia', role: 'kasir' })

    deleteUser(db, id, adminId)

    expect(listUsers(db).map((user) => user.username)).toEqual(['admin'])
  })

  it('refuses to delete the account currently signed in', () => {
    expect(() => deleteUser(db, adminId, adminId)).toThrow('Tidak bisa menghapus akun yang sedang dipakai.')
  })

  it('refuses to delete the last admin', () => {
    const otherAdmin = createUser(db, { username: 'owner', name: 'Owner', password: 'rahasia', role: 'admin' })
    deleteUser(db, adminId, otherAdmin)

    expect(() => deleteUser(db, otherAdmin, 999)).toThrow('Admin terakhir tidak bisa dihapus atau diturunkan jadi kasir.')
  })

  it('throws for an unknown id', () => {
    expect(() => deleteUser(db, 999, adminId)).toThrow('Pengguna tidak ditemukan.')
  })
})

describe('listUsers', () => {
  it('lists accounts by username without exposing the password hash', () => {
    createUser(db, { username: 'budi', name: 'Budi', password: 'rahasia', role: 'kasir' })

    const rows = listUsers(db)
    expect(rows.map((user) => user.username)).toEqual(['admin', 'budi'])
    expect(Object.keys(rows[0])).toEqual(['id', 'username', 'name', 'role', 'createdAt'])
  })
})
