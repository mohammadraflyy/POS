import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { stockMovements, products, productUnits, units } from './db/schema'

export type StockMovementType = 'sale' | 'sale_cancel' | 'purchase' | 'stock_adjustment'

export interface StockMovementRow {
  id: number
  createdAt: Date
  productId: number
  kodeItem: string
  namaItem: string
  /** the transacted unit's label, or null if that satuan row has since been deleted */
  satuan: string | null
  /** signed, in the transacted unit - negative when stock left, positive when it arrived */
  quantity: number
  /** the same change expressed in the product's base unit */
  baseQuantity: number
  movementType: StockMovementType
  /** id of the sale/purchase/adjustment that caused this row - not a foreign key here, just context */
  referenceId: number
}

export interface StockMovementFilters {
  /** matches kodeItem or namaItem */
  q?: string
  movementType?: StockMovementType
  dari?: string
  sampai?: string
  page: number
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

/**
 * The append-only ledger every sale, purchase and stock opname already writes to
 * (`kasir.ts`, `purchase.ts`, `stock-opname.ts`), read back out as one combined
 * history - "kenapa stok produk ini berubah" in one place instead of having to
 * cross-reference three separate history pages.
 */
export function listStockMovements(
  db: BetterSQLite3Database<typeof schema>,
  input: StockMovementFilters,
): { data: StockMovementRow[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const conditions = []

  if (input.q) {
    const q = `%${input.q}%`
    conditions.push(or(like(products.kodeItem, q), like(products.namaItem, q)))
  }

  if (input.movementType) {
    conditions.push(eq(stockMovements.movementType, input.movementType))
  }

  if (input.dari) {
    conditions.push(gte(stockMovements.createdAt, new Date(`${input.dari}T00:00:00`)))
  }

  if (input.sampai) {
    conditions.push(lte(stockMovements.createdAt, new Date(`${input.sampai}T23:59:59`)))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    .where(whereClause)
    .get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const data: StockMovementRow[] = db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      productId: stockMovements.productId,
      kodeItem: products.kodeItem,
      namaItem: products.namaItem,
      satuan: units.code,
      quantity: stockMovements.quantity,
      baseQuantity: stockMovements.baseQuantity,
      movementType: stockMovements.movementType,
      referenceId: stockMovements.referenceId,
    })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    // left-joined: productUnitId goes null if the satuan row was deleted since,
    // and the row must still show up in history rather than disappear
    .leftJoin(productUnits, eq(stockMovements.productUnitId, productUnits.id))
    .leftJoin(units, eq(productUnits.unitId, units.id))
    .where(whereClause)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data, currentPage: page, lastPage, total }
}
