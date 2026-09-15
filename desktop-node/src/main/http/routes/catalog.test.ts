import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from '../../db/migrate'
import { users, products, productUnits, units, customers } from '../../db/schema'
import { issueDeviceToken } from '../../device-tokens'
import { handleHttpRequest } from '../router'
import type { HttpRequest } from '../context'

const migrationsFolder = path.resolve(__dirname, '../../../../drizzle')
const db = createDb(':memory:', migrationsFolder)

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { query: {}, headers: {}, body: undefined, ...partial }
}

let token: string

beforeEach(() => {
  db.delete(customers).run()
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

  db.insert(customers).values({ nama: 'Budi', telepon: null, alamat: null, keterangan: null, createdAt: now, updatedAt: now }).run()

  const product = db
    .insert(products)
    .values({ kodeItem: 'BRS5', namaItem: 'Beras 5kg', hargaJual: 65000_00, hargaPokok: 60000_00, stok: 10, createdAt: now, updatedAt: now })
    .returning({ id: products.id })
    .get()

  db.insert(units).values({ code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now }).run()
  const unit = db.select().from(units).get()!

  db.insert(productUnits)
    .values({
      productId: product.id,
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

function auth(headers: Record<string, string | undefined> = {}) {
  return { ...headers, authorization: `Bearer ${token}` }
}

describe('GET /v1/customers', () => {
  it('lists customer names', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/customers', headers: auth() }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ names: ['Budi'] })
  })

  it('rejects without a token', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/customers' }))

    expect(res.status).toBe(401)
  })
})

describe('GET /v1/catalog/search', () => {
  it('returns the product in rupiah, with its base unit and empty tier list', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/catalog/search', query: { q: 'beras' }, headers: auth() }))

    expect(res.status).toBe(200)
    const body = res.body as { data: { namaItem: string; hargaJual: number; stok: number }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.data[0]).toMatchObject({ namaItem: 'Beras 5kg', hargaJual: 65000, stok: 10 })
  })

  it('finds nothing for an unmatched keyword', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/catalog/search', query: { q: 'tidak-ada' }, headers: auth() }))

    const body = res.body as { data: unknown[]; total: number }
    expect(body.total).toBe(0)
    expect(body.data).toHaveLength(0)
  })
})
