import { and, eq, like, ne, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productPriceHistories, productUnits, productPriceTiers, units } from './db/schema'
import { syncBaseProductUnit, syncUnitCostsFromBase } from './inventory-units'

export interface ProductListItem {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  hargaPokok: number
  hargaJual: number
  stok: number
  isActive: boolean
  unitsCount: number
  priceTiersCount: number
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

function productListSelect(db: BetterSQLite3Database<typeof schema>) {
  return db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      barcode: products.barcode,
      namaItem: products.namaItem,
      categoryName: categories.nama,
      satuan: units.code,
      hargaPokok: products.hargaPokok,
      hargaJual: products.hargaJual,
      stok: products.stok,
      isActive: products.isActive,
      // the base row is a unit like any other in storage, but the product list
      // has always counted only the derived ones ("satuan turunan")
      unitsCount: sql<number>`(SELECT COUNT(*) FROM ${productUnits} WHERE ${productUnits.productId} = ${products.id} AND ${productUnits.isBaseUnit} = 0)`,
      priceTiersCount: sql<number>`(SELECT COUNT(*) FROM ${productPriceTiers} WHERE ${productPriceTiers.productId} = ${products.id})`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    // left-joined: a product missing its base row is a data bug, but hiding it
    // from the product list would make it unfixable through the UI
    .leftJoin(productUnits, and(eq(productUnits.productId, products.id), eq(productUnits.isBaseUnit, true)))
    .leftJoin(units, eq(productUnits.unitId, units.id))
}

function toListItem(row: {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string | null
  hargaPokok: number
  hargaJual: number
  stok: number
  isActive: boolean
  unitsCount: number
  priceTiersCount: number
}): ProductListItem {
  return { ...row, satuan: row.satuan ?? '' }
}

export function listProducts(
  db: BetterSQLite3Database<typeof schema>,
  input: { search?: string; page: number; pageSize?: number },
): { data: ProductListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const whereClause = input.search
    ? or(
        like(products.kodeItem, `%${input.search}%`),
        like(products.namaItem, `%${input.search}%`),
        like(products.barcode, `%${input.search}%`),
      )
    : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(products).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const rows = productListSelect(db)
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data: rows.map(toListItem), currentPage: page, lastPage, total }
}

export interface UpdateProductInput {
  kodeItem: string
  barcode: string | null
  namaItem: string
  kategori: string | null
  satuan: string
  hargaPokok: number
  hargaJual: number
  isActive: boolean
}

export function updateProduct(db: BetterSQLite3Database<typeof schema>, id: number, input: UpdateProductInput): void {
  if (!input.kodeItem.trim()) {
    throw new Error('Kode item wajib diisi.')
  }

  if (input.kodeItem.length > 50) {
    throw new Error('Kode item maksimal 50 karakter.')
  }

  const kodeItemCollision = db
    .select()
    .from(products)
    .where(and(eq(products.kodeItem, input.kodeItem), ne(products.id, id)))
    .get()

  if (kodeItemCollision) {
    throw new Error('Kode item sudah digunakan.')
  }

  if (input.barcode && input.barcode.length > 100) {
    throw new Error('Barcode maksimal 100 karakter.')
  }

  if (input.barcode) {
    const barcodeCollision = db
      .select()
      .from(products)
      .where(and(eq(products.barcode, input.barcode), ne(products.id, id)))
      .get()

    if (barcodeCollision) {
      throw new Error('Barcode sudah digunakan.')
    }
  }

  if (!input.namaItem.trim()) {
    throw new Error('Nama item wajib diisi.')
  }

  if (input.namaItem.length > 255) {
    throw new Error('Nama item maksimal 255 karakter.')
  }

  if (!input.satuan.trim()) {
    throw new Error('Satuan wajib diisi.')
  }

  if (input.satuan.length > 20) {
    throw new Error('Satuan maksimal 20 karakter.')
  }

  if (!Number.isFinite(input.hargaPokok)) {
    throw new Error('Harga pokok wajib diisi.')
  }

  if (input.hargaPokok < 0) {
    throw new Error('Harga pokok tidak boleh negatif.')
  }

  if (!Number.isFinite(input.hargaJual)) {
    throw new Error('Harga jual wajib diisi.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  let categoryId: number | null = null
  const kategori = input.kategori?.trim()

  if (kategori && kategori.length > 255) {
    throw new Error('Kategori maksimal 255 karakter.')
  }

  if (kategori) {
    const existing = db.select().from(categories).where(eq(categories.nama, kategori)).get()

    if (existing) {
      categoryId = existing.id
    } else {
      const now = new Date()
      const created = db.insert(categories).values({ nama: kategori, createdAt: now, updatedAt: now }).returning().get()
      categoryId = created.id
    }
  }

  const existingProduct = db.select().from(products).where(eq(products.id, id)).get()

  db.update(products)
    .set({
      kodeItem: input.kodeItem,
      barcode: input.barcode,
      namaItem: input.namaItem,
      categoryId,
      hargaPokok: input.hargaPokok,
      hargaJual: input.hargaJual,
      isActive: input.isActive,
    })
    .where(eq(products.id, id))
    .run()

  // The form still submits one satuan + one hargaJual per product; both now live
  // on the base product_units row, with products.hargaJual kept as a cache of it
  // (design spec decision 2), so the two writes must stay in step.
  syncBaseProductUnit(db, id, input.satuan, input.hargaJual)
  // a hand-typed harga pokok overrides whatever the purchase history had averaged out
  syncUnitCostsFromBase(db, id, input.hargaPokok)

  if (existingProduct && (existingProduct.hargaPokok !== input.hargaPokok || existingProduct.hargaJual !== input.hargaJual)) {
    const now = new Date()
    db.insert(productPriceHistories)
      .values({
        productId: id,
        userId: null,
        hargaPokokLama: existingProduct.hargaPokok,
        hargaPokokBaru: input.hargaPokok,
        hargaJualLama: existingProduct.hargaJual,
        hargaJualBaru: input.hargaJual,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
}

export function deleteProduct(db: BetterSQLite3Database<typeof schema>, id: number): void {
  try {
    db.delete(products).where(eq(products.id, id)).run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint failed')) {
      throw new Error('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.')
    }
    throw err
  }
}

export function bulkDeleteProducts(
  db: BetterSQLite3Database<typeof schema>,
  ids: number[],
): { deleted: number; blocked: string[] } {
  let deleted = 0
  const blocked: string[] = []

  for (const id of ids) {
    const product = db.select().from(products).where(eq(products.id, id)).get()

    try {
      db.delete(products).where(eq(products.id, id)).run()
      deleted++
    } catch (err) {
      if (err instanceof Error && err.message.includes('FOREIGN KEY constraint failed')) {
        blocked.push(product?.namaItem ?? `Produk #${id}`)
      } else {
        throw err
      }
    }
  }

  return { deleted, blocked }
}

export function searchProductsQuick(db: BetterSQLite3Database<typeof schema>, q: string): ProductListItem[] {
  const whereClause = q
    ? or(like(products.kodeItem, `%${q}%`), like(products.namaItem, `%${q}%`), like(products.barcode, `%${q}%`))
    : undefined

  const rows = productListSelect(db)
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(20)
    .all()

  return rows.map(toListItem)
}
