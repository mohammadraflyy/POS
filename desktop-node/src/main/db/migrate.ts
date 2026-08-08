import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export function createDb(dbPath: string, migrationsFolder: string) {
  const sqlite = new Database(dbPath)
  // better-sqlite3 enables foreign_keys by default (unlike stock SQLite), so it must be
  // turned off before migrating: Drizzle runs migrations inside BEGIN...COMMIT, and SQLite
  // ignores PRAGMA foreign_keys changes made inside a transaction. With enforcement left on,
  // table-rebuild migrations (DROP TABLE + recreate) fire ON DELETE actions against every
  // referencing row instead of leaving them alone.
  sqlite.pragma('foreign_keys = OFF')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  sqlite.pragma('foreign_keys = ON')
  return db
}
