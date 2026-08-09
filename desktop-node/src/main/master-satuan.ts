import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { units } from './db/schema'

export interface UnitRow {
  id: number
  code: string
  name: string
  symbol: string
  isActive: boolean
}

export interface UpsertUnitInput {
  code: string
  name: string
  symbol: string
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

function validate(input: UpsertUnitInput): void {
  if (!input.code.trim()) {
    throw new Error('Kode satuan wajib diisi.')
  }
  if (!input.name.trim()) {
    throw new Error('Nama wajib diisi.')
  }
  if (!input.symbol.trim()) {
    throw new Error('Simbol wajib diisi.')
  }
}

export function listUnits(db: BetterSQLite3Database<typeof schema>): UnitRow[] {
  return db
    .select({ id: units.id, code: units.code, name: units.name, symbol: units.symbol, isActive: units.isActive })
    .from(units)
    .orderBy(units.code)
    .all()
}

export function createUnit(db: BetterSQLite3Database<typeof schema>, input: UpsertUnitInput): void {
  validate(input)
  const code = normalizeCode(input.code)

  const existing = db.select({ id: units.id }).from(units).where(eq(units.code, code)).get()
  if (existing) {
    throw new Error('Kode satuan sudah ada.')
  }

  const now = new Date()
  db.insert(units)
    .values({ code, name: input.name.trim(), symbol: input.symbol.trim(), isActive: true, createdAt: now, updatedAt: now })
    .run()
}

export function updateUnit(
  db: BetterSQLite3Database<typeof schema>,
  id: number,
  input: UpsertUnitInput & { isActive: boolean },
): void {
  validate(input)
  const code = normalizeCode(input.code)

  const existing = db.select({ id: units.id }).from(units).where(eq(units.id, id)).get()
  if (!existing) {
    throw new Error('Satuan tidak ditemukan.')
  }

  const duplicate = db.select({ id: units.id }).from(units).where(eq(units.code, code)).get()
  if (duplicate && duplicate.id !== id) {
    throw new Error('Kode satuan sudah ada.')
  }

  db.update(units)
    .set({ code, name: input.name.trim(), symbol: input.symbol.trim(), isActive: input.isActive, updatedAt: new Date() })
    .where(eq(units.id, id))
    .run()
}

export function deactivateUnit(db: BetterSQLite3Database<typeof schema>, id: number): void {
  db.update(units).set({ isActive: false, updatedAt: new Date() }).where(eq(units.id, id)).run()
}
