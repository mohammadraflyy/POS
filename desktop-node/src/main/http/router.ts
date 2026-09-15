import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { verifyLogin } from '../auth'
import { consumePairingCode } from '../pairing'
import { issueDeviceToken, resolveDeviceToken } from '../device-tokens'
import pkg from '../../../package.json'

const APP_VERSION = pkg.version

export interface HttpRequest {
  method: string
  /** pathname only - no query string */
  path: string
  headers: Record<string, string | undefined>
  /** already JSON-parsed, or undefined for a body-less request */
  body: unknown
}

export interface HttpResponse {
  status: number
  body: unknown
}

interface PairBody {
  pairingCode: string
  username: string
  password: string
  deviceName: string | null
}

function bearerToken(headers: Record<string, string | undefined>): string | null {
  const header = headers['authorization']
  if (!header?.startsWith('Bearer ')) {
    return null
  }

  return header.slice('Bearer '.length).trim() || null
}

function handlePair(db: BetterSQLite3Database<typeof schema>, body: unknown): HttpResponse {
  const input = body as Partial<PairBody> | null

  if (!input?.pairingCode || !input.username || !input.password) {
    return { status: 400, body: { error: 'pairingCode, username, dan password wajib diisi.' } }
  }

  try {
    // Both throw a plain Error on failure - a wrong pairing code and a wrong
    // password are indistinguishable to whoever is holding the phone, and both
    // are reported the same way: a 401, not a 500.
    consumePairingCode(input.pairingCode)
    const user = verifyLogin(db, input.username, input.password)
    const { token } = issueDeviceToken(db, { userId: user.id, namaPerangkat: input.deviceName ?? null })

    return { status: 200, body: { token, user, appVersion: APP_VERSION } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pairing gagal.'
    return { status: 401, body: { error: message } }
  }
}

function handleMe(db: BetterSQLite3Database<typeof schema>, headers: Record<string, string | undefined>): HttpResponse {
  const token = bearerToken(headers)

  if (!token) {
    return { status: 401, body: { error: 'Token tidak ditemukan.' } }
  }

  const user = resolveDeviceToken(db, token)

  if (!user) {
    return { status: 401, body: { error: 'Token tidak valid atau sudah dicabut.' } }
  }

  return { status: 200, body: { user, appVersion: APP_VERSION } }
}

/**
 * Pure request dispatch - no socket, no `node:http`, so it can be exercised
 * directly by tests with plain objects. `http/server.ts` is the only caller
 * that ever touches a real network.
 */
export function handleHttpRequest(db: BetterSQLite3Database<typeof schema>, req: HttpRequest): HttpResponse {
  try {
    if (req.method === 'GET' && req.path === '/v1/health') {
      return { status: 200, body: { ok: true, appVersion: APP_VERSION } }
    }

    if (req.method === 'POST' && req.path === '/v1/pair') {
      return handlePair(db, req.body)
    }

    if (req.method === 'GET' && req.path === '/v1/me') {
      return handleMe(db, req.headers)
    }

    return { status: 404, body: { error: 'Not found' } }
  } catch (err) {
    // Anything that reaches here is a genuine bug, not an expected rejection -
    // handlePair already turns its own auth failures into a 401 above this.
    const message = err instanceof Error ? err.message : 'Terjadi kesalahan.'
    return { status: 500, body: { error: message } }
  }
}
