import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { customers, sales, users } from './db/schema'
import {
  createCustomer,
  deleteCustomer,
  findOrCreateCustomerByName,
  listCustomerNames,
  listCustomers,
  updateCustomer,
} from './customer'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  return db
}

function emptyInput(nama: string) {
  return { nama, telepon: null, alamat: null, keterangan: null }
}

describe('customer master', () => {
  it('creates, lists, and updates a customer', () => {
    const db = seedDb()

    const id = createCustomer(db, { nama: 'Budi', telepon: '0812', alamat: 'Jl. Mawar', keterangan: null })
    updateCustomer(db, id, { nama: 'Budi Santoso', telepon: '0813', alamat: 'Jl. Mawar', keterangan: 'langganan' })

    const result = listCustomers(db, { page: 1 })

    expect(result.total).toBe(1)
    expect(result.data[0]).toMatchObject({ id, nama: 'Budi Santoso', telepon: '0813', saleCount: 0 })
  })

  it('rejects a blank name', () => {
    const db = seedDb()

    expect(() => createCustomer(db, emptyInput('   '))).toThrow('Nama wajib diisi.')
  })

  it('filters the list by name and pages it', () => {
    const db = seedDb()

    createCustomer(db, emptyInput('Budi'))
    createCustomer(db, emptyInput('Citra'))

    expect(listCustomers(db, { search: 'ud', page: 1 }).data.map((c) => c.nama)).toEqual(['Budi'])
    expect(listCustomerNames(db)).toEqual(['Budi', 'Citra'])
  })

  it('counts the sales filed under a customer', () => {
    const db = seedDb()
    const now = new Date()
    const id = createCustomer(db, emptyInput('Budi'))

    db.insert(sales)
      .values({
        customerId: id,
        namaPelanggan: 'Budi',
        metodePembayaran: 'tunai',
        total: 1000_00,
        dibayar: 1000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    expect(listCustomers(db, { page: 1 }).data[0].saleCount).toBe(1)
  })
})

describe('findOrCreateCustomerByName', () => {
  it('creates the row once and reuses it regardless of case', () => {
    const db = seedDb()

    const first = findOrCreateCustomerByName(db, 'Budi')
    const second = findOrCreateCustomerByName(db, '  budi ')

    expect(second).toBe(first)
    expect(db.select().from(customers).all()).toHaveLength(1)
  })

  it('returns null for a blank name instead of creating an unnamed customer', () => {
    const db = seedDb()

    expect(findOrCreateCustomerByName(db, '   ')).toBeNull()
    expect(db.select().from(customers).all()).toHaveLength(0)
  })
})

describe('deleting a customer', () => {
  it('clears the link but keeps the name recorded on the sale', () => {
    const db = seedDb()
    const now = new Date()
    const id = createCustomer(db, emptyInput('Budi'))

    const sale = db
      .insert(sales)
      .values({
        customerId: id,
        namaPelanggan: 'Budi',
        metodePembayaran: 'bon',
        total: 1000_00,
        dibayar: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    deleteCustomer(db, id)

    const after = db.select().from(sales).where(eq(sales.id, sale.id)).get()

    expect(after?.customerId).toBeNull()
    expect(after?.namaPelanggan).toBe('Budi')
  })
})
