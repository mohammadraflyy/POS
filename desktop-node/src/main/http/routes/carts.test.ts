import { beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from '../../db/migrate'
import { users, products, productUnits, units } from '../../db/schema'
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

describe('POST /v1/carts/price', () => {
  it('prices a cart in rupiah and reports enough stock', async () => {
    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/carts/price',
        headers: auth(),
        body: { items: [{ productId, productUnitId: null, qty: 2 }] },
      }),
    )

    expect(res.status).toBe(200)
    const body = res.body as { lines: { subtotal: number; stokCukup: boolean }[]; total: number }
    expect(body.lines[0]).toMatchObject({ subtotal: 130000, stokCukup: true })
    expect(body.total).toBe(130000)
  })

  it('reports a shortfall as data instead of failing the whole request', async () => {
    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/carts/price',
        headers: auth(),
        body: { items: [{ productId, productUnitId: null, qty: 20 }] },
      }),
    )

    expect(res.status).toBe(200)
    const body = res.body as { lines: { stokCukup: boolean }[] }
    expect(body.lines[0].stokCukup).toBe(false)
  })

  it('rejects an empty cart with 400, not 401 or 500', async () => {
    const res = await handleHttpRequest(db, req({ method: 'POST', path: '/v1/carts/price', headers: auth(), body: { items: [] } }))

    expect(res.status).toBe(400)
  })

  it('rejects without a token', async () => {
    const res = await handleHttpRequest(db, req({ method: 'POST', path: '/v1/carts/price', body: { items: [{ productId, productUnitId: null, qty: 1 }] } }))

    expect(res.status).toBe(401)
  })
})
