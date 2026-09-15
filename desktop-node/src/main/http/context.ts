import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { resolveDeviceToken } from '../device-tokens'
import type { AuthUser } from '../auth'

export interface HttpRequest {
  method: string
  /** pathname only - no query string */
  path: string
  /** parsed from the query string, e.g. `?q=beras&page=2` -> `{ q: 'beras', page: '2' }` */
  query: Record<string, string>
  headers: Record<string, string | undefined>
  /** already JSON-parsed, or undefined for a body-less request */
  body: unknown
}

export interface HttpResponse {
  status: number
  body: unknown
}

/**
 * Electron-touching dependencies a route may need but the router itself must never
 * import directly - `printReceipt` needs `getMainWindow` from `../index`, and `index.ts`
 * has module-level `app.on(...)` side effects that break outside a real Electron
 * process. `index.ts` builds the real implementation and passes it into
 * `startHttpServer`; tests simply omit it.
 */
export interface RouterDeps {
  printReceipt?: (db: BetterSQLite3Database<typeof schema>, saleId: number, kasirName: string | null) => Promise<void>
}

/**
 * Matches a `/v1/sales/:id`-style pattern against a real path, returning the
 * captured segments in order, or `null` when it doesn't match. No router library -
 * there are only a handful of routes with one dynamic segment each.
 */
export function matchPath(pattern: string, path: string): string[] | null {
  const patternParts = pattern.split('/')
  const pathParts = path.split('/')

  if (patternParts.length !== pathParts.length) {
    return null
  }

  const params: string[] = []

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params.push(decodeURIComponent(pathParts[i]))
    } else if (patternParts[i] !== pathParts[i]) {
      return null
    }
  }

  return params
}

function bearerToken(headers: Record<string, string | undefined>): string | null {
  const header = headers['authorization']

  if (!header?.startsWith('Bearer ')) {
    return null
  }

  return header.slice('Bearer '.length).trim() || null
}

/**
 * Every business route shares this: resolve the device token to a user, then run
 * `fn` and turn anything it throws into a 400 with the error's own message - the same
 * message the IPC layer already surfaces verbatim to the till, so the phone gets the
 * same wording. A missing/invalid/revoked token is 401, never 400: that distinction is
 * what tells the phone whether to retry or fall back to the pairing screen.
 */
export async function withAuth(
  db: BetterSQLite3Database<typeof schema>,
  headers: Record<string, string | undefined>,
  fn: (user: AuthUser) => HttpResponse | Promise<HttpResponse>,
): Promise<HttpResponse> {
  const token = bearerToken(headers)

  if (!token) {
    return { status: 401, body: { error: 'Token tidak ditemukan.' } }
  }

  const user = resolveDeviceToken(db, token)

  if (!user) {
    return { status: 401, body: { error: 'Token tidak valid atau sudah dicabut.' } }
  }

  try {
    return await fn(user)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Permintaan ditolak.'
    return { status: 400, body: { error: message } }
  }
}
