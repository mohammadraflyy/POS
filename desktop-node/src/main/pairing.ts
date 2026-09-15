import crypto from 'node:crypto'

const PAIRING_TTL_MS = 5 * 60 * 1000

/**
 * One pairing code at a time, held in memory - never persisted. Same shape as
 * `currentUser` in `ipc/auth.ts`: this app runs on one PC for one owner, so
 * module-level state is the right size for it, and a code that dies with the
 * process is exactly what a "scan this in the next 5 minutes" code should do.
 */
let current: { code: string; expiresAt: Date } | null = null

export interface PairingCode {
  code: string
  expiresAt: Date
}

/** Generating a new code silently retires whatever code was showing before. */
export function generatePairingCode(): PairingCode {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS)

  current = { code, expiresAt }

  return { code, expiresAt }
}

/**
 * Redeems a pairing code. Throws rather than returning a boolean so the HTTP
 * layer's catch-and-401 handling covers this the same way it covers a bad
 * password - one failure path, not two.
 *
 * Single-use: a code is cleared the instant it is redeemed, successful or not
 * a second time, so a stolen QR photo is worthless once the real phone has paired.
 */
export function consumePairingCode(code: string): void {
  if (!current || current.code !== code) {
    throw new Error('Kode pairing tidak valid.')
  }

  const isExpired = current.expiresAt.getTime() < Date.now()
  current = null

  if (isExpired) {
    throw new Error('Kode pairing sudah kedaluwarsa.')
  }
}
