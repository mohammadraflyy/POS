import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { getServerStatus, generatePairingCodeForAdmin } from '../device'
import { listPairedDevices, revokeDevice } from '../device-tokens'
import { requireAdmin } from './auth'

export function registerDeviceIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('device:generatePairingCode', () => {
    requireAdmin()

    const { code, expiresAt, serverAddress } = generatePairingCodeForAdmin()

    return { code, expiresAt: expiresAt.toISOString(), serverAddress }
  })

  // no guard, same as kasir:getStoreSettings - server status is not sensitive
  ipcMain.handle('device:getServerStatus', () => {
    return getServerStatus()
  })

  ipcMain.handle('device:listPairedDevices', () => {
    requireAdmin()

    return listPairedDevices(db).map((device) => ({
      id: device.id,
      namaPerangkat: device.namaPerangkat,
      userName: device.userName,
      createdAt: device.createdAt.toISOString(),
      lastUsedAt: device.lastUsedAt?.toISOString() ?? null,
      revokedAt: device.revokedAt?.toISOString() ?? null,
    }))
  })

  ipcMain.handle('device:revokeDevice', (_event, id: number) => {
    requireAdmin()

    revokeDevice(db, id)
  })
}
