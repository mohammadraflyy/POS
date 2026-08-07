import { and, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits } from './db/schema'

export interface ProductUnitRow {
  id: number
  level: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}

function unitRowSelect(db: BetterSQLite3Database<typeof schema>) {
  return db.select({
    id: productUnits.id,
    level: productUnits.level,
    satuan: productUnits.satuan,
    jumlahKemasan: productUnits.jumlahKemasan,
    konversi: productUnits.konversi,
    hargaJual: productUnits.hargaJual,
  }).from(productUnits)
}

export function getProductUnits(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
): { level2: ProductUnitRow | null; level3: ProductUnitRow | null } {
  const rows = unitRowSelect(db).where(eq(productUnits.productId, productId)).all()

  return {
    level2: rows.find((r) => r.level === 2) ?? null,
    level3: rows.find((r) => r.level === 3) ?? null,
  }
}

export interface SetProductUnitInput {
  satuan: string
  jumlahKemasan: number
  hargaJual: number
}

export function setProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  level: 2 | 3,
  input: SetProductUnitInput,
): void {
  if (!input.satuan.trim()) {
    throw new Error('Satuan wajib diisi.')
  }

  if (input.satuan.length > 20) {
    throw new Error('Satuan maksimal 20 karakter.')
  }

  if (!Number.isFinite(input.jumlahKemasan)) {
    throw new Error('Jumlah kemasan wajib diisi.')
  }

  if (!Number.isInteger(input.jumlahKemasan) || input.jumlahKemasan < 1) {
    throw new Error('Jumlah kemasan minimal 1.')
  }

  if (!Number.isFinite(input.hargaJual)) {
    throw new Error('Harga jual wajib diisi.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  let konversi: number

  if (level === 2) {
    konversi = input.jumlahKemasan
  } else {
    const level2 = db
      .select({ konversi: productUnits.konversi })
      .from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.level, 2)))
      .get()

    if (!level2) {
      throw new Error('Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3.')
    }

    konversi = input.jumlahKemasan * level2.konversi
  }

  const existing = db
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(and(eq(productUnits.productId, productId), eq(productUnits.level, level)))
    .get()

  const now = new Date()

  if (existing) {
    db.update(productUnits)
      .set({ satuan: input.satuan, jumlahKemasan: input.jumlahKemasan, konversi, hargaJual: input.hargaJual, updatedAt: now })
      .where(eq(productUnits.id, existing.id))
      .run()
  } else {
    db.insert(productUnits)
      .values({
        productId,
        level,
        satuan: input.satuan,
        jumlahKemasan: input.jumlahKemasan,
        konversi,
        hargaJual: input.hargaJual,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  if (level === 2) {
    const level3 = db
      .select({ id: productUnits.id, jumlahKemasan: productUnits.jumlahKemasan })
      .from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.level, 3)))
      .get()

    if (level3) {
      db.update(productUnits)
        .set({ konversi: level3.jumlahKemasan * konversi, updatedAt: now })
        .where(eq(productUnits.id, level3.id))
        .run()
    }
  }
}

export function deleteProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, level: 2 | 3): void {
  if (level === 2) {
    db.delete(productUnits).where(and(eq(productUnits.productId, productId), eq(productUnits.level, 3))).run()
  }

  db.delete(productUnits).where(and(eq(productUnits.productId, productId), eq(productUnits.level, level))).run()
}
