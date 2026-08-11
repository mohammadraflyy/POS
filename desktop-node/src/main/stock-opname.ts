import { and, eq, inArray, like, or } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productUnits, stockAdjustments, units } from './db/schema'

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
}

export interface RecordStockAdjustmentResult {
  id: number
}

export function recordStockAdjustment(
  db: BetterSQLite3Database<typeof schema>,
  input: RecordStockAdjustmentInput,
): RecordStockAdjustmentResult {
  if (!Number.isInteger(input.stokSesudah) || input.stokSesudah < 0) {
    throw new Error('Stok fisik harus bilangan bulat, minimal 0.')
  }

  const alasan = input.alasan?.trim() || null

  if (alasan !== null && alasan.length > 255) {
    throw new Error('Alasan maksimal 255 karakter.')
  }

  return db.transaction((tx) => {
    const product = tx.select().from(products).where(eq(products.id, input.productId)).get()

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    const stokSebelum = product.stok
    const selisih = input.stokSesudah - stokSebelum
    const now = new Date()
    const tanggal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    const adjustment = tx
      .insert(stockAdjustments)
      .values({
        productId: input.productId,
        userId: input.userId,
        stokSebelum,
        stokSesudah: input.stokSesudah,
        selisih,
        alasan,
        tanggal,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    tx.update(products).set({ stok: input.stokSesudah }).where(eq(products.id, input.productId)).run()

    return { id: adjustment.id }
  })
}
