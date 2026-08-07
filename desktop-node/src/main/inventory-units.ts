import { and, desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, users } from './db/schema'

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

export interface PriceTierRow {
  id: number
  minQty: number
  hargaJual: number
}

export interface AddPriceTierInput {
  minQty: number
  hargaJual: number
}

export function addPriceTier(db: BetterSQLite3Database<typeof schema>, productId: number, input: AddPriceTierInput): void {
  if (!Number.isFinite(input.minQty)) {
    throw new Error('Qty minimal wajib diisi.')
  }

  if (!Number.isInteger(input.minQty) || input.minQty < 2) {
    throw new Error('Qty minimal harus 2 atau lebih.')
  }

  if (!Number.isFinite(input.hargaJual)) {
    throw new Error('Harga jual wajib diisi.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  const existing = db
    .select({ id: productPriceTiers.id })
    .from(productPriceTiers)
    .where(and(eq(productPriceTiers.productId, productId), eq(productPriceTiers.minQty, input.minQty)))
    .get()

  if (existing) {
    throw new Error(`Harga bertingkat untuk qty ${input.minQty} sudah ada.`)
  }

  const now = new Date()

  db.insert(productPriceTiers)
    .values({ productId, minQty: input.minQty, hargaJual: input.hargaJual, createdAt: now, updatedAt: now })
    .run()
}

export function deletePriceTier(db: BetterSQLite3Database<typeof schema>, productId: number, tierId: number): void {
  const tier = db
    .select({ id: productPriceTiers.id })
    .from(productPriceTiers)
    .where(and(eq(productPriceTiers.id, tierId), eq(productPriceTiers.productId, productId)))
    .get()

  if (!tier) {
    throw new Error('Harga bertingkat tidak ditemukan.')
  }

  db.delete(productPriceTiers).where(eq(productPriceTiers.id, tierId)).run()
}

export function listPriceTiers(db: BetterSQLite3Database<typeof schema>, productId: number): PriceTierRow[] {
  return db
    .select({ id: productPriceTiers.id, minQty: productPriceTiers.minQty, hargaJual: productPriceTiers.hargaJual })
    .from(productPriceTiers)
    .where(eq(productPriceTiers.productId, productId))
    .orderBy(productPriceTiers.minQty)
    .all()
}

export interface PriceHistoryRow {
  id: number
  hargaPokokLama: number
  hargaPokokBaru: number
  hargaJualLama: number
  hargaJualBaru: number
  createdAt: Date
  userName: string | null
}

export function listPriceHistory(db: BetterSQLite3Database<typeof schema>, productId: number): PriceHistoryRow[] {
  return db
    .select({
      id: productPriceHistories.id,
      hargaPokokLama: productPriceHistories.hargaPokokLama,
      hargaPokokBaru: productPriceHistories.hargaPokokBaru,
      hargaJualLama: productPriceHistories.hargaJualLama,
      hargaJualBaru: productPriceHistories.hargaJualBaru,
      createdAt: productPriceHistories.createdAt,
      userName: users.name,
    })
    .from(productPriceHistories)
    .leftJoin(users, eq(productPriceHistories.userId, users.id))
    .where(eq(productPriceHistories.productId, productId))
    .orderBy(desc(productPriceHistories.createdAt))
    .all()
}

export interface ProductDetail {
  units: { level2: ProductUnitRow | null; level3: ProductUnitRow | null }
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

export function getProductDetail(db: BetterSQLite3Database<typeof schema>, productId: number): ProductDetail {
  return {
    units: getProductUnits(db, productId),
    priceTiers: listPriceTiers(db, productId),
    priceHistory: listPriceHistory(db, productId),
  }
}
