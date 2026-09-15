import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from '../../db/migrate'
import { users, products, productUnits, units, categories } from '../../db/schema'
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
let categoryId: number

beforeEach(() => {
  db.delete(categories).run()
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

  const category = db.insert(categories).values({ nama: 'Sembako', createdAt: now, updatedAt: now }).returning({ id: categories.id }).get()
  categoryId = category.id

  const product = db
    .insert(products)
    .values({ kodeItem: 'BRS5', namaItem: 'Beras 5kg', categoryId, hargaJual: 65000_00, hargaPokok: 60000_00, stok: 10, isActive: true, createdAt: now, updatedAt: now })
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

describe('GET /v1/opname/categories', () => {
  it('lists the seeded category', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/opname/categories', headers: auth() }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [{ id: categoryId, nama: 'Sembako' }] })
  })
})

describe('GET /v1/opname/products', () => {
  it('browses every active product in a category when q is empty', async () => {
    const res = await handleHttpRequest(
      db,
      req({ method: 'GET', path: '/v1/opname/products', headers: auth(), query: { q: '', categoryIds: String(categoryId) } }),
    )

    expect(res.status).toBe(200)
    const body = res.body as { data: { namaItem: string; stok: number }[] }
    expect(body.data).toEqual([expect.objectContaining({ namaItem: 'Beras 5kg', stok: 10 })])
  })
})

describe('POST /v1/opname/adjustments', () => {
  it('overwrites stock to the counted amount, up or down', async () => {
    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/opname/adjustments',
        headers: auth(),
        body: { productId, stokSesudah: 7, alasan: 'opname rutin' },
      }),
    )

    expect(res.status).toBe(200)
    const updated = db.select().from(products).get()
    expect(updated?.stok).toBe(7)
  })

  it('rejects a negative counted stock', async () => {
    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/opname/adjustments', headers: auth(), body: { productId, stokSesudah: -1, alasan: null } }),
    )

    expect(res.status).toBe(400)
  })
})
