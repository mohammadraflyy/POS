import { and, eq, inArray, desc, sql } from 'drizzle-orm'
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
  /** the smaller unit this one is measured in; null means the base unit */
  parentUnitId: number | null
  jumlahKemasan: number
  conversionFactor: number
  hargaJual: number
  hargaPokok: number
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
      parentUnitId: productUnits.parentUnitId,
      jumlahKemasan: productUnits.jumlahKemasan,
      conversionFactor: productUnits.conversionFactor,
      hargaJual: productUnits.hargaJual,
      hargaPokok: productUnits.hargaPokok,
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
 * Carries a new base cost across to the units that were never given a cost of their own.
 *
 * A unit still sitting at exactly `old base x conversion` has never been priced by hand or
 * by a purchase, so it should follow the product form. One that differs was set deliberately
 * - the owner typed what a DUS costs, or a purchase averaged it - and must survive an edit
 * to the base price. The base row always follows, since it mirrors `products.hargaPokok`.
 */
export function syncUnitCostsFromBase(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  hargaPokokLama: number,
  hargaPokokBaru: number,
): void {
  db.update(productUnits)
    .set({ hargaPokok: sql`${hargaPokokBaru} * ${productUnits.conversionFactor}`, updatedAt: new Date() })
    .where(
      and(
        eq(productUnits.productId, productId),
        sql`(${productUnits.isBaseUnit} = 1 or ${productUnits.hargaPokok} = ${hargaPokokLama} * ${productUnits.conversionFactor})`,
      ),
    )
    .run()
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
  const product = db.select({ hargaPokok: products.hargaPokok }).from(products).where(eq(products.id, productId)).get()

  db.insert(productUnits)
    .values({
      productId,
      unitId,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual,
      // the base row mirrors products.hargaPokok, conversion factor being 1
      hargaPokok: product?.hargaPokok ?? 0,
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
  /**
   * Cost of one of this unit. Omit to derive it from the product's base cost -
   * a purchase in this unit will overwrite it either way.
   */
  hargaPokok?: number
  /**
   * The smaller unit this one is measured in. `null` means the base unit; omitting it
   * on `addProductUnit` stacks the new unit on the largest one that exists, which is
   * what "add another packaging on top" meant before units could branch.
   */
  parentUnitId?: number | null
}

/**
 * Every unit that is measured in `unitRowId`, directly or through another unit -
 * a DUS measured in RENTENG is a container of RENTENG, and a BAL measured in DUS
 * is one too. Resizing or deleting a unit has to reach all of them.
 */
function unitsContaining(chain: ProductUnitRow[], unitRowId: number): ProductUnitRow[] {
  const found: ProductUnitRow[] = []
  let frontier = [unitRowId]

  while (frontier.length > 0) {
    const children = chain.filter((row) => row.parentUnitId !== null && frontier.includes(row.parentUnitId))
    // a cycle would spin here forever; the parent validation below is what prevents one
    const fresh = children.filter((row) => !found.some((seen) => seen.id === row.id))
    if (fresh.length === 0) {
      break
    }
    found.push(...fresh)
    frontier = fresh.map((row) => row.id)
  }

  return found
}

/** the minimum a row needs for the tree walks; `purchase.ts` selects its own narrower shape */
export interface UnitTreeNode {
  id: number
  parentUnitId: number | null
  isBaseUnit: boolean
}

/**
 * The chain of smaller units a purchase in `unitRowId` physically delivers, base last.
 * Siblings are deliberately excluded: buying a SAK puts pieces on the shelf, but says
 * nothing about what a RENTENG costs, because no renteng came out of that sak.
 */
export function unitsInside<T extends UnitTreeNode>(chain: T[], unitRowId: number): T[] {
  const inside: T[] = []
  let current = chain.find((row) => row.id === unitRowId)

  while (current) {
    const parent = current.parentUnitId === null ? null : chain.find((row) => row.id === current!.parentUnitId)
    if (!parent || inside.some((seen) => seen.id === parent.id)) {
      break
    }
    inside.push(parent)
    current = parent
  }

  const base = chain.find((row) => row.isBaseUnit)
  if (base && base.id !== unitRowId && !inside.some((seen) => seen.id === base.id)) {
    inside.push(base)
  }

  return inside
}

/**
 * Resolves the parent a caller asked for and returns its conversion factor.
 * Rejects anything that would leave the tree malformed - a parent from another
 * product, a unit pointing at itself, or a loop through its own containers.
 */
function resolveParentConversion(
  chain: ProductUnitRow[],
  parentUnitId: number | null | undefined,
  fallbackConversion: number,
  selfId?: number,
): { parentUnitId: number | null; conversion: number } {
  if (parentUnitId === undefined) {
    return { parentUnitId: null, conversion: fallbackConversion }
  }

  if (parentUnitId === null) {
    return { parentUnitId: null, conversion: 1 }
  }

  const parent = chain.find((row) => row.id === parentUnitId)
  if (!parent) {
    throw new Error('Satuan acuan tidak ditemukan pada produk ini.')
  }

  if (parent.isBaseUnit) {
    // the base row is the implicit root; pointing at it explicitly is the same as null
    return { parentUnitId: null, conversion: 1 }
  }

  if (selfId !== undefined) {
    if (parent.id === selfId) {
      throw new Error('Satuan tidak bisa mengacu ke dirinya sendiri.')
    }
    if (unitsContaining(chain, selfId).some((row) => row.id === parent.id)) {
      throw new Error('Satuan acuan tidak boleh satuan yang justru berisi satuan ini.')
    }
  }

  return { parentUnitId: parent.id, conversion: parent.conversionFactor }
}

function validateUnitInput(input: UpsertProductUnitInput): void {
  if (!Number.isFinite(input.jumlahKemasan) || !Number.isInteger(input.jumlahKemasan) || input.jumlahKemasan < 1) {
    throw new Error('Jumlah kemasan minimal 1.')
  }
  if (!Number.isFinite(input.hargaJual) || input.hargaJual < 0) {
    throw new Error('Harga jual wajib diisi dan tidak boleh negatif.')
  }
  if (input.hargaPokok !== undefined && (!Number.isFinite(input.hargaPokok) || input.hargaPokok < 0)) {
    throw new Error('Harga beli tidak boleh negatif.')
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
  // no parent given means the historical behaviour: stack on the largest unit so far
  const largestConversion = derivedChain.length > 0 ? derivedChain[derivedChain.length - 1].conversionFactor : 1
  const largestId = derivedChain.length > 0 ? derivedChain[derivedChain.length - 1].id : null
  const parent =
    input.parentUnitId === undefined
      ? { parentUnitId: largestId, conversion: largestConversion }
      : resolveParentConversion(chain, input.parentUnitId, largestConversion)
  const conversionFactor = input.jumlahKemasan * parent.conversion
  const product = db.select({ hargaPokok: products.hargaPokok }).from(products).where(eq(products.id, productId)).get()
  const now = new Date()

  db.insert(productUnits)
    .values({
      productId,
      unitId: input.unitId,
      parentUnitId: parent.parentUnitId,
      jumlahKemasan: input.jumlahKemasan,
      conversionFactor,
      hargaJual: input.hargaJual,
      // buying a DUS is its own price, not twelve times the piece price, so the cost is
      // typed per unit. Left blank it falls back to the product's base cost scaled up.
      hargaPokok: input.hargaPokok ?? (product?.hargaPokok ?? 0) * conversionFactor,
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
  const target = chain[idx]

  if (chain.some((u) => u.id !== unitRowId && u.unitId === input.unitId)) {
    throw new Error('Satuan ini sudah dipakai untuk produk ini.')
  }

  const parent = resolveParentConversion(
    chain,
    // leaving it out keeps the unit where it hangs; passing null moves it onto the base
    input.parentUnitId === undefined ? target.parentUnitId : input.parentUnitId,
    1,
    unitRowId,
  )
  const conversionFactor = input.jumlahKemasan * parent.conversion

  db.transaction((tx) => {
    tx.update(productUnits)
      .set({
        unitId: input.unitId,
        parentUnitId: parent.parentUnitId,
        jumlahKemasan: input.jumlahKemasan,
        conversionFactor,
        hargaJual: input.hargaJual,
        // Only the edited row's cost is restated. Its containers are still the same
        // physical package - a DUS is a DUS whether we believe it holds 10 or 20
        // pieces - so what the owner paid for one of them does not change here.
        hargaPokok: input.hargaPokok ?? target.hargaPokok,
        updatedAt: now,
      })
      .where(eq(productUnits.id, unitRowId))
      .run()

    // Resizing a unit changes how many base units every container of it holds.
    // unitsContaining walks outward level by level, so a parent is always rewritten
    // before the unit measured in it reads the new figure.
    const conversionById = new Map<number, number>([[unitRowId, conversionFactor]])

    for (const row of unitsContaining(chain, unitRowId)) {
      const parentConversion =
        row.parentUnitId === null
          ? 1
          : (conversionById.get(row.parentUnitId) ??
            chain.find((candidate) => candidate.id === row.parentUnitId)?.conversionFactor ??
            1)
      const rowConversion = row.jumlahKemasan * parentConversion
      conversionById.set(row.id, rowConversion)

      tx.update(productUnits)
        .set({ conversionFactor: rowConversion, updatedAt: now })
        .where(eq(productUnits.id, row.id))
        .run()
    }
  })
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

  // whatever is measured in this unit loses its yardstick, so it goes with it
  const idsToDelete = [unitRowId, ...unitsContaining(chain, unitRowId).map((row) => row.id)]
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
  /** the detail screen is a page of its own now, so it has to name the product itself */
  namaItem: string
  kodeItem: string
  units: ProductUnitRow[]
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

export function getProductDetail(db: BetterSQLite3Database<typeof schema>, productId: number): ProductDetail {
  const product = db
    .select({ namaItem: products.namaItem, kodeItem: products.kodeItem })
    .from(products)
    .where(eq(products.id, productId))
    .get()

  if (!product) {
    throw new Error('Produk tidak ditemukan.')
  }

  return {
    namaItem: product.namaItem,
    kodeItem: product.kodeItem,
    units: listProductUnits(db, productId),
    priceTiers: listPriceTiers(db, productId),
    priceHistory: listPriceHistory(db, productId),
  }
}
