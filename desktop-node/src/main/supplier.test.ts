import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { suppliers, purchases } from './db/schema'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from './supplier'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(suppliers)
    .values([
      {
        id: 1,
        nama: 'CV Sumber Makmur',
        telepon: '08123456789',
        alamat: 'Jl. Merdeka 1',
        keterangan: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        nama: 'Toko Aneka Jaya',
        telepon: null,
        alamat: null,
        keterangan: 'Grosir sembako',
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  return db
}

describe('listSuppliers', () => {
  it('returns all suppliers ordered by nama', () => {
    const db = seedDb()
    const result = listSuppliers(db, { page: 1 })
    expect(result.total).toBe(2)
    expect(result.data.map((s) => s.nama)).toEqual(['CV Sumber Makmur', 'Toko Aneka Jaya'])
  })

  it('filters by search on nama', () => {
    const db = seedDb()
    const result = listSuppliers(db, { search: 'aneka', page: 1 })
    expect(result.data.map((s) => s.id)).toEqual([2])
  })

  it('includes purchaseCount, zero when no purchases exist', () => {
    const db = seedDb()
    const result = listSuppliers(db, { page: 1 })
    expect(result.data.every((s) => s.purchaseCount === 0)).toBe(true)
  })

  it('counts purchases referencing a supplier', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(purchases)
      .values([
        { id: 1, supplierId: 1, userId: null, tanggal: '2026-08-01', total: 10000, catatan: null, createdAt: now, updatedAt: now },
        { id: 2, supplierId: 1, userId: null, tanggal: '2026-08-02', total: 20000, catatan: null, createdAt: now, updatedAt: now },
      ])
      .run()

    const result = listSuppliers(db, { page: 1 })
    const supplier1 = result.data.find((s) => s.id === 1)
    expect(supplier1?.purchaseCount).toBe(2)
  })

  it('paginates with the given pageSize, computing lastPage and total', () => {
    const db = seedDb()
    const now = new Date()
    const extra = Array.from({ length: 10 }, (_, i) => ({
      nama: `Supplier Extra ${i}`,
      telepon: null,
      alamat: null,
      keterangan: null,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(suppliers).values(extra).run()
    // total = 2 seeded + 10 extra = 12

    const page1 = listSuppliers(db, { page: 1, pageSize: 10 })
    expect(page1.data).toHaveLength(10)
    expect(page1.currentPage).toBe(1)
    expect(page1.lastPage).toBe(2)
    expect(page1.total).toBe(12)

    const page2 = listSuppliers(db, { page: 2, pageSize: 10 })
    expect(page2.data).toHaveLength(2)
  })

  it('defaults to pageSize 25 when none is given', () => {
    const db = seedDb()
    const result = listSuppliers(db, { page: 1 })
    expect(result.lastPage).toBe(1)
  })

  it('falls back to pageSize 25 when given an invalid pageSize', () => {
    const db = seedDb()
    const now = new Date()
    const extra = Array.from({ length: 27 }, (_, i) => ({
      nama: `Supplier Invalid Pagesize ${i}`,
      telepon: null,
      alamat: null,
      keterangan: null,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(suppliers).values(extra).run()
    // total = 2 seeded + 27 extra = 29

    const result = listSuppliers(db, { page: 1, pageSize: 999 })
    expect(result.data).toHaveLength(25)
    expect(result.lastPage).toBe(2)
  })
})

describe('createSupplier', () => {
  it('creates a supplier and returns its id', () => {
    const db = seedDb()
    const id = createSupplier(db, { nama: 'Supplier Baru', telepon: '0811', alamat: null, keterangan: null })
    const created = db.select().from(suppliers).where(eq(suppliers.id, id)).get()
    expect(created).toMatchObject({ nama: 'Supplier Baru', telepon: '0811', alamat: null, keterangan: null })
  })

  it('throws when nama is empty', () => {
    const db = seedDb()
    expect(() => createSupplier(db, { nama: '', telepon: null, alamat: null, keterangan: null })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('throws when nama is only whitespace', () => {
    const db = seedDb()
    expect(() => createSupplier(db, { nama: '   ', telepon: null, alamat: null, keterangan: null })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('throws when nama exceeds 255 characters', () => {
    const db = seedDb()
    expect(() =>
      createSupplier(db, { nama: 'a'.repeat(256), telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Nama maksimal 255 karakter.')
  })
})

describe('updateSupplier', () => {
  it('updates supplier fields', () => {
    const db = seedDb()
    updateSupplier(db, 1, { nama: 'CV Sumber Makmur Baru', telepon: '0899', alamat: 'Jl. Baru', keterangan: 'catatan' })
    const updated = db.select().from(suppliers).where(eq(suppliers.id, 1)).get()
    expect(updated).toMatchObject({
      nama: 'CV Sumber Makmur Baru',
      telepon: '0899',
      alamat: 'Jl. Baru',
      keterangan: 'catatan',
    })
  })

  it('throws when nama is empty', () => {
    const db = seedDb()
    expect(() => updateSupplier(db, 1, { nama: '', telepon: null, alamat: null, keterangan: null })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('throws when nama exceeds 255 characters', () => {
    const db = seedDb()
    expect(() =>
      updateSupplier(db, 1, { nama: 'a'.repeat(256), telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Nama maksimal 255 karakter.')
  })
})

describe('deleteSupplier', () => {
  it('deletes a supplier with no purchases', () => {
    const db = seedDb()
    deleteSupplier(db, 2)
    expect(db.select().from(suppliers).where(eq(suppliers.id, 2)).get()).toBeUndefined()
  })

  it('deletes a supplier even when purchases reference it, nulling their supplierId', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(purchases)
      .values({ id: 1, supplierId: 1, userId: null, tanggal: '2026-08-01', total: 10000, catatan: null, createdAt: now, updatedAt: now })
      .run()

    deleteSupplier(db, 1)

    expect(db.select().from(suppliers).where(eq(suppliers.id, 1)).get()).toBeUndefined()
    const purchase = db.select().from(purchases).where(eq(purchases.id, 1)).get()
    expect(purchase?.supplierId).toBeNull()
  })

  it('is a no-op when the supplier does not exist', () => {
    const db = seedDb()
    expect(() => deleteSupplier(db, 999)).not.toThrow()
  })
})
