import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { verifyLogin } from '../auth'
import { consumePairingCode } from '../pairing'
import { issueDeviceToken } from '../device-tokens'
import { withAuth, type HttpRequest, type HttpResponse, type RouterDeps } from './context'
import { handleCatalogRoutes } from './routes/catalog'
import { handleCartsRoutes } from './routes/carts'
import { handleSalesRoutes } from './routes/sales'
import { handlePurchasesRoutes } from './routes/purchases'
import { handleOpnameRoutes } from './routes/opname'
import pkg from '../../../package.json'

export type { HttpRequest, HttpResponse, RouterDeps } from './context'

const APP_VERSION = pkg.version

interface PairBody {
  pairingCode: string
  username: string
  password: string
  deviceName: string | null
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

function handleMe(db: BetterSQLite3Database<typeof schema>, headers: Record<string, string | undefined>): Promise<HttpResponse> {
  return withAuth(db, headers, (user) => ({ status: 200, body: { user, appVersion: APP_VERSION } }))
}

/**
 * Pure request dispatch - no socket, no `node:http`, so it can be exercised
 * directly by tests with plain objects. `http/server.ts` is the only caller
 * that ever touches a real network.
 *
 * Routes are grouped by domain module (catalog, carts, sales, purchases, opname),
 * one file each under `routes/`, mirroring how the IPC layer is split one file per
 * module - each group returns `null` when nothing in it matches, so dispatch just
 * tries them in turn and falls through to 404.
 */
export async function handleHttpRequest(
  db: BetterSQLite3Database<typeof schema>,
  req: HttpRequest,
  deps: RouterDeps = {},
): Promise<HttpResponse> {
  try {
    if (req.method === 'GET' && req.path === '/v1/health') {
      return { status: 200, body: { ok: true, appVersion: APP_VERSION } }
    }

    if (req.method === 'POST' && req.path === '/v1/pair') {
      return handlePair(db, req.body)
    }

    if (req.method === 'GET' && req.path === '/v1/me') {
      return await handleMe(db, req.headers)
    }

    return (
      (await handleCatalogRoutes(db, req)) ??
      (await handleCartsRoutes(db, req)) ??
      (await handleSalesRoutes(db, req, deps)) ??
      (await handlePurchasesRoutes(db, req)) ??
      (await handleOpnameRoutes(db, req)) ??
      { status: 404, body: { error: 'Not found' } }
    )
  } catch (err) {
    // Anything that reaches here is a genuine bug, not an expected rejection -
    // handlePair and withAuth already turn their own rejections into 401/400 above this.
    const message = err instanceof Error ? err.message : 'Terjadi kesalahan.'
    return { status: 500, body: { error: message } }
  }
}
