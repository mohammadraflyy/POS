import { and, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productUnits, stockAdjustments, stockMovements, units } from './db/schema'
import { bulatkanQty, isQtyValid } from './qty'

export interface CategoryOption {
  id: number
  nama: string
}

export function listCategories(db: BetterSQLite3Database<typeof schema>): CategoryOption[] {
  return db.select({ id: categories.id, nama: categories.nama }).from(categories).orderBy(categories.nama).all()
}

export interface ProductOpnameRow {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  stok: number
  stockRevision: number
}

export function searchProductsForOpname(
  db: BetterSQLite3Database<typeof schema>,
  input: { q: string; categoryIds: number[] },
): ProductOpnameRow[] {
  const q = input.q.trim()
  const browsing = q === '' && input.categoryIds.length > 0

  const conditions = [eq(products.isActive, true)]

  if (input.categoryIds.length > 0) {
    conditions.push(inArray(products.categoryId, input.categoryIds))
  }

  if (q !== '') {
    const keywordMatch = or(
      like(products.kodeItem, `%${q}%`),
      like(products.namaItem, `%${q}%`),
      like(products.barcode, `%${q}%`),
      like(categories.nama, `%${q}%`),
    )
    if (keywordMatch) {
      conditions.push(keywordMatch)
    }
  }

  const baseQuery = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      barcode: products.barcode,
      namaItem: products.namaItem,
      categoryName: categories.nama,
      satuan: units.code,
      stok: products.stok,
      stockRevision: sql<number>`coalesce((select max(id) from stock_movements where product_id = ${products.id}), 0)`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    // left-joined, not inner: a product missing its base-unit row is a data
    // bug, but dropping it from an opname list would hide stock from the count
    .leftJoin(productUnits, and(eq(productUnits.productId, products.id), eq(productUnits.isBaseUnit, true)))
    .leftJoin(units, eq(productUnits.unitId, units.id))
    .where(and(...conditions))
    .orderBy(products.namaItem)

  const rows = browsing ? baseQuery.all() : baseQuery.limit(20).all()

  return rows.map((row) => ({ ...row, satuan: row.satuan ?? '' }))
}

export interface RecordStockAdjustmentInput {
  productId: number
  stokSesudah: number
  alasan: string | null
  userId: number | null
  expectedStock?: number
  expectedRevision?: number
}

export interface RecordStockAdjustmentResult {
  id: number
}

export function recordStockAdjustment(
  db: BetterSQLite3Database<typeof schema>,
  input: RecordStockAdjustmentInput,
): RecordStockAdjustmentResult {
  if (!isQtyValid(input.stokSesudah)) {
    throw new Error('Stok fisik harus berupa angka, minimal 0.')
  }

  // a counted stock level may be fractional (5,5 KG); keep it at 3 decimals
  const stokSesudah = bulatkanQty(input.stokSesudah)
  const alasan = input.alasan?.trim() || null

  if (alasan !== null && alasan.length > 255) {
    throw new Error('Alasan maksimal 255 karakter.')
  }

  return db.transaction((tx) => {
    const product = tx.select().from(products).where(eq(products.id, input.productId)).get()

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    const revision = tx.select({ value: sql<number>`coalesce(max(${stockMovements.id}), 0)` })
      .from(stockMovements).where(eq(stockMovements.productId, input.productId)).get()!.value
    if ((input.expectedStock !== undefined && input.expectedStock !== product.stok) ||
        (input.expectedRevision !== undefined && input.expectedRevision !== revision)) {
      throw new Error('Stok berubah sejak penghitungan. Refresh lalu hitung ulang sebelum menyimpan.')
    }

    const stokSebelum = product.stok
    const selisih = bulatkanQty(stokSesudah - stokSebelum)
    const now = new Date()
    const tanggal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    const adjustment = tx
      .insert(stockAdjustments)
      .values({
        productId: input.productId,
        userId: input.userId,
        stokSebelum,
        stokSesudah,
        selisih,
        alasan,
        tanggal,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    tx.update(products).set({ stok: stokSesudah }).where(eq(products.id, input.productId)).run()

    // adjustments are always counted in base units, so the base row is the unit to log against
    const baseUnit = tx
      .select({ id: productUnits.id })
      .from(productUnits)
      .where(and(eq(productUnits.productId, input.productId), eq(productUnits.isBaseUnit, true)))
      .get()

    tx.insert(stockMovements)
      .values({
        productId: input.productId,
        productUnitId: baseUnit?.id ?? null,
        quantity: selisih,
        conversionFactor: 1,
        baseQuantity: selisih,
        movementType: 'stock_adjustment',
        referenceId: adjustment.id,
        createdAt: now,
      })
      .run()

    return { id: adjustment.id }
  })
}
