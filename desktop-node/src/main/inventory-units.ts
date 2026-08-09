import { and, eq, inArray, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, units, users, products } from './db/schema'

export interface ProductUnitRow {
  id: number
  unitId: number
  unitCode: string
  unitName: string
  unitSymbol: string
  jumlahKemasan: number
  conversionFactor: number
  hargaJual: number
  isBaseUnit: boolean
  isDefaultSalesUnit: boolean
  isDefaultPurchaseUnit: boolean
}

function unitRowSelect(db: BetterSQLite3Database<typeof schema>) {
  return db
    .select({
      id: productUnits.id,
      unitId: productUnits.unitId,
      unitCode: units.code,
      unitName: units.name,
      unitSymbol: units.symbol,
      jumlahKemasan: productUnits.jumlahKemasan,
      conversionFactor: productUnits.conversionFactor,
      hargaJual: productUnits.hargaJual,
      isBaseUnit: productUnits.isBaseUnit,
      isDefaultSalesUnit: productUnits.isDefaultSalesUnit,
      isDefaultPurchaseUnit: productUnits.isDefaultPurchaseUnit,
      productId: productUnits.productId,
    })
    .from(productUnits)
    .innerJoin(units, eq(productUnits.unitId, units.id))
}

export function listProductUnits(db: BetterSQLite3Database<typeof schema>, productId: number): ProductUnitRow[] {
  return unitRowSelect(db)
    .where(eq(productUnits.productId, productId))
    .orderBy(productUnits.conversionFactor, productUnits.id)
    .all()
}

export function getBaseProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number): ProductUnitRow {
  const row = unitRowSelect(db).where(and(eq(productUnits.productId, productId), eq(productUnits.isBaseUnit, true))).get()
  if (!row) {
    throw new Error(`Produk ${productId} tidak memiliki satuan dasar.`)
  }
  return row
}

export interface UpsertProductUnitInput {
  unitId: number
  jumlahKemasan: number
  hargaJual: number
}

function validateUnitInput(input: UpsertProductUnitInput): void {
  if (!Number.isFinite(input.jumlahKemasan) || !Number.isInteger(input.jumlahKemasan) || input.jumlahKemasan < 1) {
    throw new Error('Jumlah kemasan minimal 1.')
  }
  if (!Number.isFinite(input.hargaJual) || input.hargaJual < 0) {
    throw new Error('Harga jual wajib diisi dan tidak boleh negatif.')
  }
}

export function addProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, input: UpsertProductUnitInput): void {
  validateUnitInput(input)

  const unit = db.select({ id: units.id, isActive: units.isActive }).from(units).where(eq(units.id, input.unitId)).get()
  if (!unit || !unit.isActive) {
    throw new Error('Satuan tidak ditemukan atau tidak aktif.')
  }

  const chain = listProductUnits(db, productId)
  if (chain.some((u) => u.unitId === input.unitId)) {
    throw new Error('Satuan ini sudah dipakai untuk produk ini.')
  }

  const derivedChain = chain.filter((u) => !u.isBaseUnit)
  const prevConversion = derivedChain.length > 0 ? derivedChain[derivedChain.length - 1].conversionFactor : 1
  const conversionFactor = input.jumlahKemasan * prevConversion
  const now = new Date()

  db.insert(productUnits)
    .values({
      productId,
      unitId: input.unitId,
      jumlahKemasan: input.jumlahKemasan,
      conversionFactor,
      hargaJual: input.hargaJual,
      isBaseUnit: false,
      isDefaultSalesUnit: false,
      isDefaultPurchaseUnit: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function updateProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  unitRowId: number,
  input: UpsertProductUnitInput,
): void {
  const chain = listProductUnits(db, productId)
  const idx = chain.findIndex((u) => u.id === unitRowId)
  if (idx === -1) {
    throw new Error('Satuan tidak ditemukan.')
  }

  const now = new Date()

  if (chain[idx].isBaseUnit) {
    // base unit's identity/conversion is fixed - only hargaJual can change, and it must
    // stay mirrored onto products.hargaJual (design spec decision 2: hargaJual is a cache)
    if (!Number.isFinite(input.hargaJual) || input.hargaJual < 0) {
      throw new Error('Harga jual wajib diisi dan tidak boleh negatif.')
    }
    db.transaction((tx) => {
      tx.update(productUnits).set({ hargaJual: input.hargaJual, updatedAt: now }).where(eq(productUnits.id, unitRowId)).run()
      tx.update(products).set({ hargaJual: input.hargaJual, updatedAt: now }).where(eq(products.id, productId)).run()
    })
    return
  }

  validateUnitInput(input)
  const derivedChain = chain.filter((u) => !u.isBaseUnit)
  const derivedIdx = derivedChain.findIndex((u) => u.id === unitRowId)

  if (derivedChain.some((u, i) => i !== derivedIdx && u.unitId === input.unitId)) {
    throw new Error('Satuan ini sudah dipakai untuk produk ini.')
  }

  let prevConversion = derivedIdx === 0 ? 1 : derivedChain[derivedIdx - 1].conversionFactor

  for (let i = derivedIdx; i < derivedChain.length; i++) {
    const jumlahKemasan = i === derivedIdx ? input.jumlahKemasan : derivedChain[i].jumlahKemasan
    const unitId = i === derivedIdx ? input.unitId : derivedChain[i].unitId
    const hargaJual = i === derivedIdx ? input.hargaJual : derivedChain[i].hargaJual
    const conversionFactor = jumlahKemasan * prevConversion

    db.update(productUnits)
      .set({ unitId, jumlahKemasan, conversionFactor, hargaJual, updatedAt: now })
      .where(eq(productUnits.id, derivedChain[i].id))
      .run()

    prevConversion = conversionFactor
  }
}

export function deleteProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, unitRowId: number): void {
  const chain = listProductUnits(db, productId)
  const target = chain.find((u) => u.id === unitRowId)
  if (!target) {
    return
  }
  if (target.isBaseUnit) {
    throw new Error('Satuan dasar tidak bisa dihapus.')
  }

  const derivedChain = chain.filter((u) => !u.isBaseUnit)
  const idx = derivedChain.findIndex((u) => u.id === unitRowId)
  const idsToDelete = derivedChain.slice(idx).map((u) => u.id)
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
