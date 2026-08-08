import { and, eq, inArray, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, users } from './db/schema'

export interface ProductUnitRow {
  id: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}

function unitRowSelect(db: BetterSQLite3Database<typeof schema>) {
  return db.select({
    id: productUnits.id,
    satuan: productUnits.satuan,
    jumlahKemasan: productUnits.jumlahKemasan,
    konversi: productUnits.konversi,
    hargaJual: productUnits.hargaJual,
  }).from(productUnits)
}

export function listProductUnits(db: BetterSQLite3Database<typeof schema>, productId: number): ProductUnitRow[] {
  return unitRowSelect(db).where(eq(productUnits.productId, productId)).orderBy(productUnits.konversi, productUnits.id).all()
}

export interface UpsertProductUnitInput {
  satuan: string
  jumlahKemasan: number
  hargaJual: number
}

function validateUnitInput(input: UpsertProductUnitInput): void {
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
}

export function addProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, input: UpsertProductUnitInput): void {
  validateUnitInput(input)

  const chain = listProductUnits(db, productId)

  if (chain.some((u) => u.satuan === input.satuan)) {
    throw new Error(`Satuan "${input.satuan}" sudah ada.`)
  }

  const prevKonversi = chain.length > 0 ? chain[chain.length - 1].konversi : 1
  const konversi = input.jumlahKemasan * prevKonversi
  const now = new Date()

  db.insert(productUnits)
    .values({
      productId,
      satuan: input.satuan,
      jumlahKemasan: input.jumlahKemasan,
      konversi,
      hargaJual: input.hargaJual,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function updateProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  unitId: number,
  input: UpsertProductUnitInput,
): void {
  validateUnitInput(input)

  const chain = listProductUnits(db, productId)
  const idx = chain.findIndex((u) => u.id === unitId)

  if (idx === -1) {
    throw new Error('Satuan tidak ditemukan.')
  }

  if (chain.some((u) => u.id !== unitId && u.satuan === input.satuan)) {
    throw new Error(`Satuan "${input.satuan}" sudah ada.`)
  }

  const now = new Date()
  let prevKonversi = idx === 0 ? 1 : chain[idx - 1].konversi

  for (let i = idx; i < chain.length; i++) {
    const jumlahKemasan = i === idx ? input.jumlahKemasan : chain[i].jumlahKemasan
    const satuan = i === idx ? input.satuan : chain[i].satuan
    const hargaJual = i === idx ? input.hargaJual : chain[i].hargaJual
    const konversi = jumlahKemasan * prevKonversi

    db.update(productUnits)
      .set({ satuan, jumlahKemasan, konversi, hargaJual, updatedAt: now })
      .where(eq(productUnits.id, chain[i].id))
      .run()

    prevKonversi = konversi
  }
}

export function deleteProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, unitId: number): void {
  const chain = listProductUnits(db, productId)
  const idx = chain.findIndex((u) => u.id === unitId)

  if (idx === -1) {
    return
  }

  const idsToDelete = chain.slice(idx).map((u) => u.id)
  db.delete(productUnits).where(inArray(productUnits.id, idsToDelete)).run()
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
  units: ProductUnitRow[]
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

export function getProductDetail(db: BetterSQLite3Database<typeof schema>, productId: number): ProductDetail {
  return {
    units: listProductUnits(db, productId),
    priceTiers: listPriceTiers(db, productId),
    priceHistory: listPriceHistory(db, productId),
  }
}
