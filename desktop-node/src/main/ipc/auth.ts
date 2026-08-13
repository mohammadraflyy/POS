import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { assertAdmin, assertLoggedIn, verifyLogin, type AuthUser, type UserRole } from '../auth'
import { listUsers, createUser, updateUser, deleteUser } from '../users'

let currentUser: AuthUser | null = null

/**
 * Every handler runs against this session, never against an id passed in from the
 * renderer - a caller must not be able to name the account it acts as.
 */
export function requireUser(): AuthUser {
  return assertLoggedIn(currentUser)
}

export function requireAdmin(): AuthUser {
  return assertAdmin(currentUser)
}

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

  ipcMain.handle('users:list', () => {
    requireAdmin()

    return listUsers(db).map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    }))
  })

  ipcMain.handle(
    'users:create',
    (_event, input: { username: string; name: string; password: string; role: UserRole }) => {
      requireAdmin()

      return createUser(db, input)
    },
  )

  ipcMain.handle(
    'users:update',
    (_event, id: number, input: { name: string; role: UserRole; password: string | null }) => {
      requireAdmin()

      updateUser(db, id, input)

      // a self-edit has to be mirrored onto the live session, otherwise the sidebar
      // keeps showing the old name until the next login
      if (currentUser && currentUser.id === id) {
        currentUser = { ...currentUser, name: input.name.trim(), role: input.role }
      }
    },
  )

  ipcMain.handle('users:delete', (_event, id: number) => {
    const admin = requireAdmin()

    deleteUser(db, id, admin.id)
  })
}

export function getCurrentUser(): AuthUser | null {
  return currentUser
}
