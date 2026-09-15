import http from 'node:http'
import os from 'node:os'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { handleHttpRequest } from './router'
import type { RouterDeps } from './context'

export interface HttpServerHandle {
  stop(): void
}

export interface HttpServerStatus {
  running: boolean
  /** `<lan-ip>:<port>`, or null while not listening or when no LAN NIC is found */
  address: string | null
  port: number
}

let listening = false
let currentPort: number | null = null

/**
 * The first non-internal IPv4 address this PC has. A shop PC normally has exactly
 * one active NIC, so "first match" is fine; a multi-NIC PC (VPN, dual ethernet) may
 * pick the wrong one, in which case the owner will see it in the QR/status text and
 * can plug in the other cable - there is no way to guess "the right one" from here.
 */
function getLanAddress(): string | null {
  const interfaces = os.networkInterfaces()

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.family === 'IPv4') {
        return entry.address
      }
    }
  }

  return null
}

export function getServerStatus(): HttpServerStatus {
  return { running: listening, address: listening ? getLanAddress() : null, port: currentPort ?? 0 }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')

      if (raw.trim() === '') {
        resolve(undefined)
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Thin `node:http` wrapper: turns a real request into the plain object
 * `handleHttpRequest` (the tested, socket-free router) already knows how to
 * answer, then writes that answer back out. No routing logic belongs here.
 */
export function startHttpServer(db: BetterSQLite3Database<typeof schema>, port: number, deps: RouterDeps = {}): HttpServerHandle {
  currentPort = port

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const query: Record<string, string> = {}
      for (const [key, value] of url.searchParams) {
        query[key] = value
      }

      let body: unknown
      if (req.method === 'POST' || req.method === 'PUT') {
        try {
          body = await readJsonBody(req)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Body bukan JSON yang valid.' }))
          return
        }
      }

      const headers: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value
      }

      const result = await handleHttpRequest(db, { method: req.method ?? 'GET', path: url.pathname, query, headers, body }, deps)

      res.writeHead(result.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result.body))
    })()
  })

  server.on('listening', () => {
    listening = true
  })

  // A second app instance (there is no single-instance lock yet) would hit
  // EADDRINUSE here. Reporting it through getServerStatus() instead of letting
  // it throw keeps the rest of the app - and every IPC handler - running.
  server.on('error', () => {
    listening = false
  })

  server.on('close', () => {
    listening = false
  })

  server.listen(port)

  return {
    stop() {
      server.close()
    },
  }
}
