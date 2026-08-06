import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { verifyLogin, type AuthUser } from '../auth'

let currentUser: AuthUser | null = null

export function registerAuthIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('auth:login', (_event, username: string, password: string) => {
    currentUser = verifyLogin(db, username, password)
    return currentUser
  })

  ipcMain.handle('auth:logout', () => {
    currentUser = null
  })

  ipcMain.handle('auth:me', () => {
    return currentUser
  })
}
