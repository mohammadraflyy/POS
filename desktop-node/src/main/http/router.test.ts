import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from '../db/migrate'
import { users } from '../db/schema'
import { handleHttpRequest, type HttpRequest } from './router'
import { generatePairingCode } from '../pairing'
import { revokeDevice, listPairedDevices } from '../device-tokens'

const migrationsFolder = path.resolve(__dirname, '../../../drizzle')
const db = createDb(':memory:', migrationsFolder)

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { query: {}, headers: {}, body: undefined, ...partial }
}

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
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /v1/health', () => {
  it('answers without any auth', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/health' }))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true })
  })
})

describe('POST /v1/pair + GET /v1/me', () => {
  it('pairs with a valid code and credentials, then resolves via the issued token', async () => {
    const { code } = generatePairingCode()

    const pairRes = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/pair',
        body: { pairingCode: code, username: 'kasir1', password: 'rahasia123', deviceName: 'Test Phone' },
      }),
    )

    expect(pairRes.status).toBe(200)
    const { token, user } = pairRes.body as { token: string; user: { username: string } }
    expect(user.username).toBe('kasir1')
    expect(typeof token).toBe('string')

    const meRes = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/me', headers: { authorization: `Bearer ${token}` } }))

    expect(meRes.status).toBe(200)
    expect((meRes.body as { user: { username: string } }).user.username).toBe('kasir1')
  })

  it('rejects a wrong password', async () => {
    const { code } = generatePairingCode()

    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/pair',
        body: { pairingCode: code, username: 'kasir1', password: 'salah', deviceName: null },
      }),
    )

    expect(res.status).toBe(401)
  })

  it('rejects an unknown pairing code', async () => {
    const res = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/pair',
        body: { pairingCode: '000000', username: 'kasir1', password: 'rahasia123', deviceName: null },
      }),
    )

    expect(res.status).toBe(401)
  })

  it('rejects a pairing code that has already been used', async () => {
    const { code } = generatePairingCode()
    const body = { pairingCode: code, username: 'kasir1', password: 'rahasia123', deviceName: null }

    await handleHttpRequest(db, req({ method: 'POST', path: '/v1/pair', body }))
    const second = await handleHttpRequest(db, req({ method: 'POST', path: '/v1/pair', body }))

    expect(second.status).toBe(401)
  })

  it('rejects /v1/me with no Authorization header', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/me' }))

    expect(res.status).toBe(401)
  })

  it('rejects /v1/me with a garbage token', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/me', headers: { authorization: 'Bearer garbage' } }))

    expect(res.status).toBe(401)
  })

  it('rejects /v1/me once the device has been revoked', async () => {
    const { code } = generatePairingCode()

    const pairRes = await handleHttpRequest(
      db,
      req({
        method: 'POST',
        path: '/v1/pair',
        body: { pairingCode: code, username: 'kasir1', password: 'rahasia123', deviceName: null },
      }),
    )
    const { token } = pairRes.body as { token: string }

    const deviceId = listPairedDevices(db)[0].id
    revokeDevice(db, deviceId)

    const meRes = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/me', headers: { authorization: `Bearer ${token}` } }))

    expect(meRes.status).toBe(401)
  })
})

describe('unknown route', () => {
  it('answers 404', async () => {
    const res = await handleHttpRequest(db, req({ method: 'GET', path: '/v1/nope' }))

    expect(res.status).toBe(404)
  })
})
