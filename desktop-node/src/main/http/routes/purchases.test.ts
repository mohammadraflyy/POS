import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from '../../db/migrate'
import { users, products, productUnits, units, suppliers } from '../../db/schema'
import { issueDeviceToken } from '../../device-tokens'
import { handleHttpRequest } from '../router'
import type { HttpRequest } from '../context'

const migrationsFolder = path.resolve(__dirname, '../../../../drizzle')
const db = createDb(':memory:', migrationsFolder)

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { query: {}, headers: {}, body: undefined, ...partial }
}

let token: string
let productId: number

beforeEach(() => {
  db.delete(suppliers).run()
  db.delete(productUnits).run()
  db.delete(units).run()
  db.delete(products).run()
  db.delete(users).run()

  const now = new Date()

  const user = db
    .insert(users)
    .values({ username: 'kasir1', passwordHash: bcrypt.hashSync('rahasia123', 10), name: 'Kasir Satu', createdAt: now, updatedAt: now })
    .returning({ id: users.id })
    .get()
  token = issueDeviceToken(db, { userId: user.id, namaPerangkat: 'Test Phone' }).token

  const product = db
    .insert(products)
    .values({ kodeItem: 'BRS5', namaItem: 'Beras 5kg', hargaJual: 65000_00, hargaPokok: 60000_00, stok: 10, createdAt: now, updatedAt: now })
    .returning({ id: products.id })
    .get()
  productId = product.id

  db.insert(units).values({ code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now }).run()
  const unit = db.select().from(units).get()!

  db.insert(productUnits)
    .values({
      productId,
      unitId: unit.id,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual: 65000_00,
      hargaPokok: 60000_00,
      isBaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()
})

function auth() {
  return { authorization: `Bearer ${token}` }
}

describe('supplier routes', () => {
  it('creates a supplier and lists it back', async () => {
    const createRes = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/suppliers', headers: auth(), body: { nama: 'Toko Grosir', telepon: null, alamat: null, keterangan: null } }),
    )

    expect(createRes.status).toBe(200)

    const listRes = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/suppliers', headers: auth(), query: { page: '1' } }))

    expect(listRes.status).toBe(200)
    const body = listRes.body as { data: { nama: string }[] }
    expect(body.data.map((s) => s.nama)).toContain('Toko Grosir')
  })

  it('rejects a supplier with no name', async () => {
    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/suppliers', headers: auth(), body: { nama: '', telepon: null, alamat: null, keterangan: null } }),
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /v1/purchases/products', () => {
  it('finds the seeded product', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/purchases/products', headers: auth(), query: { q: 'beras' } }))

    expect(res.status).toBe(200)
    const body = res.body as { data: { namaItem: string; hargaPokok: number }[] }
    expect(body.data[0]).toMatchObject({ namaItem: 'Beras 5kg', hargaPokok: 60000 })
  })
})

describe('GET /v1/purchases/products/barcode/:code', () => {
  it('answers 404 for a barcode nobody has', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/purchases/products/barcode/0000000000', headers: auth() }))

    expect(res.status).toBe(404)
  })
})

describe('POST /v1/purchases', () => {
  it('records a purchase and increases stock', async () => {
    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/purchases',
        headers: auth(),
        body: {
          supplierId: null,
          tanggal: '2026-09-15',
          catatan: null,
          items: [{ productId, productUnitId: null, qty: 5, hargaBeli: 60000 }],
        },
      }),
    )

    expect(res.status).toBe(200)
    const updated = db.select().from(products).get()
    expect(updated?.stok).toBe(15)
  })

  it('rejects a purchase with no items', async () => {
    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/purchases', headers: auth(), body: { supplierId: null, tanggal: '2026-09-15', catatan: null, items: [] } }),
    )

    expect(res.status).toBe(400)
  })
})
