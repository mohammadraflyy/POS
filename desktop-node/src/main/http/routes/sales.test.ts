import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from '../../db/migrate'
import { users, products, productUnits, units } from '../../db/schema'
import { issueDeviceToken } from '../../device-tokens'
import { handleHttpRequest } from '../router'
import type { HttpRequest, RouterDeps } from '../context'

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

const checkoutBody = {
  metodePembayaran: 'tunai' as const,
  namaPelanggan: null,
  dibayar: 65000,
  items: [{ productId: 0, productUnitId: null, qty: 1 }],
}

describe('POST /v1/sales', () => {
  it('checks out and prints via the injected dependency', async () => {
    const printReceipt = vi.fn().mockResolvedValue(undefined)
    const deps: RouterDeps = { printReceipt }

    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/sales', headers: auth(), body: { ...checkoutBody, items: [{ ...checkoutBody.items[0], productId }] } }),
      deps,
    )

    expect(res.status).toBe(200)
    const body = res.body as { saleId: number; total: number; printed: boolean }
    expect(body.total).toBe(65000)
    expect(body.printed).toBe(true)
    expect(printReceipt).toHaveBeenCalledWith(db, body.saleId, 'Kasir Satu')
  })

  it('still commits the sale when no print dependency is wired up', async () => {
    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/sales', headers: auth(), body: { ...checkoutBody, items: [{ ...checkoutBody.items[0], productId }] } }),
    )

    expect(res.status).toBe(200)
    expect((res.body as { printed: boolean }).printed).toBe(false)
  })

  it('reports a print failure without undoing the sale', async () => {
    const printReceipt = vi.fn().mockRejectedValue(new Error('Tidak ada printer default.'))

    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/sales', headers: auth(), body: { ...checkoutBody, items: [{ ...checkoutBody.items[0], productId }] } }),
      { printReceipt },
    )

    const body = res.body as { saleId: number; printed: boolean; printError?: string }
    expect(res.status).toBe(200)
    expect(body.printed).toBe(false)
    expect(body.printError).toBe('Tidak ada printer default.')
    expect(typeof body.saleId).toBe('number')
  })

  it('rejects a checkout that leaves cash short with 400', async () => {
    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/sales',
        headers: auth(),
        body: { ...checkoutBody, dibayar: 1, items: [{ ...checkoutBody.items[0], productId }] },
      }),
    )

    expect(res.status).toBe(400)
  })
})

describe('GET /v1/sales, GET /v1/sales/:id, POST /v1/sales/:id/print', () => {
  async function checkoutOne() {
    const res = await handleHttpRequest(
      db,
      req({ method: 'POST', path: '/v1/sales', headers: auth(), body: { ...checkoutBody, items: [{ ...checkoutBody.items[0], productId }] } }),
    )
    return (res.body as { saleId: number }).saleId
  }

  it('lists today\'s sale in history', async () => {
    await checkoutOne()

    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/sales', headers: auth(), query: { page: '1' } }))

    expect(res.status).toBe(200)
    const body = res.body as { data: { total: number }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.data[0].total).toBe(65000)
  })

  it('returns sale detail by id', async () => {
    const saleId = await checkoutOne()

    const res = await handleHttpRequest(db, req({ method: 'GET', path: `/v1/sales/${saleId}`, headers: auth() }))

    expect(res.status).toBe(200)
    expect((res.body as { id: number }).id).toBe(saleId)
  })

  it('answers 400 for a detail id that does not exist', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/sales/999999', headers: auth() }))

    expect(res.status).toBe(400)
  })

  it('reprints via the injected dependency', async () => {
    const saleId = await checkoutOne()
    const printReceipt = vi.fn().mockResolvedValue(undefined)

    const res = await handleHttpRequest(db, req({ method: 'POST', path: `/v1/sales/${saleId}/print`, headers: auth() }), { printReceipt })

    expect(res.status).toBe(200)
    expect(printReceipt).toHaveBeenCalledWith(db, saleId, 'Kasir Satu')
  })

  it('answers 400 for reprint when no print dependency is wired up', async () => {
    const saleId = await checkoutOne()

    const res = await handleHttpRequest(db, req({ method: 'POST', path: `/v1/sales/${saleId}/print`, headers: auth() }))

    expect(res.status).toBe(400)
  })
})
