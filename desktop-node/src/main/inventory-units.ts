import { and, eq, inArray, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, units, users, products } from './db/schema'
import { resolveOrCreateUnit } from './master-satuan'

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

/** the base unit's code, or null when the product has no base row yet */
export function getBaseUnitCode(db: BetterSQLite3Database<typeof schema>, productId: number): string | null {
  const row = unitRowSelect(db)
    .where(and(eq(productUnits.productId, productId), eq(productUnits.isBaseUnit, true)))
    .get()

  return row?.unitCode ?? null
}

/**
 * Points a product's base row at the unit named by `satuanText` (creating that
 * unit on first sight) and mirrors `hargaJual` onto it. Product forms and the
 * Excel import both still submit one satuan + one price per product, so both
 * funnel through here rather than writing product_units themselves.
 */
export function syncBaseProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  satuanText: string,
  hargaJual: number,
): void {
  const unitId = resolveOrCreateUnit(db, satuanText)
  const now = new Date()
  const baseUnit = db
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(and(eq(productUnits.productId, productId), eq(productUnits.isBaseUnit, true)))
    .get()

  if (baseUnit) {
    db.update(productUnits).set({ unitId, hargaJual, updatedAt: now }).where(eq(productUnits.id, baseUnit.id)).run()

    return
  }

  // pre-migration data, or a product created before base rows existed - heal it
  db.insert(productUnits)
    .values({
      productId,
      unitId,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual,
      isBaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()
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

  if (chain.some((u) => u.id !== unitRowId && u.unitId === input.unitId)) {
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
  productUnitId: number
  minQty: number
  /** null means the range runs open-ended above minQty */
  maxQty: number | null
  hargaJual: number
}

export interface AddPriceTierInput {
  minQty: number
  maxQty: number | null
  hargaJual: number
}

/** closed [min, max] ranges, with null max reading as unbounded above */
function rangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null): boolean {
  return aMin <= (bMax ?? Infinity) && bMin <= (aMax ?? Infinity)
}

export function addPriceTier(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  productUnitId: number,
  input: AddPriceTierInput,
): void {
  if (!Number.isFinite(input.minQty)) {
    throw new Error('Qty minimal wajib diisi.')
  }

  if (!Number.isInteger(input.minQty) || input.minQty <= 0) {
    throw new Error('Qty minimal harus lebih dari 0.')
  }

  if (input.maxQty !== null) {
    if (!Number.isFinite(input.maxQty) || !Number.isInteger(input.maxQty) || input.maxQty < input.minQty) {
      throw new Error('Qty maksimal harus lebih besar atau sama dengan qty minimal.')
    }
  }

  if (!Number.isFinite(input.hargaJual)) {
    throw new Error('Harga jual wajib diisi.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  const unit = db
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(and(eq(productUnits.id, productUnitId), eq(productUnits.productId, productId)))
    .get()

  if (!unit) {
    throw new Error('Satuan tidak ditemukan.')
  }

  // Overlap is checked per unit, not per product: 1-10 PCS and 1-10 DUS are
  // different prices for different things, so both are legal side by side.
  const existing = db
    .select({ minQty: productPriceTiers.minQty, maxQty: productPriceTiers.maxQty })
    .from(productPriceTiers)
    .where(eq(productPriceTiers.productUnitId, productUnitId))
    .all()

  if (existing.some((tier) => rangesOverlap(input.minQty, input.maxQty, tier.minQty, tier.maxQty))) {
    throw new Error('Rentang qty tumpang tindih dengan tier yang sudah ada.')
  }

  const now = new Date()

  db.insert(productPriceTiers)
    .values({
      productId,
      productUnitId,
      minQty: input.minQty,
      maxQty: input.maxQty,
      hargaJual: input.hargaJual,
      createdAt: now,
      updatedAt: now,
    })
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

/** omit `productUnitId` to get every unit's tiers, as the product detail view does */
export function listPriceTiers(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  productUnitId?: number,
): PriceTierRow[] {
  const conditions = productUnitId
    ? and(eq(productPriceTiers.productId, productId), eq(productPriceTiers.productUnitId, productUnitId))
    : eq(productPriceTiers.productId, productId)

  return db
    .select({
      id: productPriceTiers.id,
      productUnitId: productPriceTiers.productUnitId,
      minQty: productPriceTiers.minQty,
      maxQty: productPriceTiers.maxQty,
      hargaJual: productPriceTiers.hargaJual,
    })
    .from(productPriceTiers)
    .where(conditions)
    .orderBy(productPriceTiers.productUnitId, productPriceTiers.minQty)
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
