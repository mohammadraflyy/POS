import { generatePairingCode, type PairingCode } from './pairing'
import { getServerStatus as getHttpServerStatus, type HttpServerStatus } from './http/server'

export function getServerStatus(): HttpServerStatus {
  return getHttpServerStatus()
}

export interface PairingCodeForAdmin extends PairingCode {
  serverAddress: string | null
}

export function generatePairingCodeForAdmin(): PairingCodeForAdmin {
  const pairing = generatePairingCode()
  const status = getHttpServerStatus()

  return { ...pairing, serverAddress: status.address ? `${status.address}:${status.port}` : null }
}
