import { and, eq, like, ne, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productPriceHistories } from './db/schema'

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
}

const DEFAULT_PAGE_SIZE = 25

function toListItem(row: {
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
}): ProductListItem {
  return row
}

export function listProducts(
  db: BetterSQLite3Database<typeof schema>,
  input: { search?: string; page: number; pageSize?: number },
): { data: ProductListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
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

  const rows = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      barcode: products.barcode,
      namaItem: products.namaItem,
      categoryName: categories.nama,
      satuan: products.satuan,
      hargaPokok: products.hargaPokok,
      hargaJual: products.hargaJual,
      stok: products.stok,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
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

  if (input.hargaPokok < 0) {
    throw new Error('Harga pokok tidak boleh negatif.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  let categoryId: number | null = null
  const kategori = input.kategori?.trim()

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
      satuan: input.satuan,
      hargaPokok: input.hargaPokok,
      hargaJual: input.hargaJual,
      isActive: input.isActive,
    })
    .where(eq(products.id, id))
    .run()

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

  const rows = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      barcode: products.barcode,
      namaItem: products.namaItem,
      categoryName: categories.nama,
      satuan: products.satuan,
      hargaPokok: products.hargaPokok,
      hargaJual: products.hargaJual,
      stok: products.stok,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(20)
    .all()

  return rows.map(toListItem)
}
