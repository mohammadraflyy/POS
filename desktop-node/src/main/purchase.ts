import { desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { purchases, purchaseItems, products, suppliers, productUnits, stockMovements, units } from './db/schema'
import { getBaseProductUnit, listProductUnits } from './inventory-units'

export interface PurchaseItemInput {
  productId: number
  productUnitId: number | null
  qty: number
  hargaBeli: number
}

export interface RecordPurchaseInput {
  supplierId: number | null
  tanggal: string
  catatan: string | null
  items: PurchaseItemInput[]
  userId: number | null
}

export interface RecordPurchaseResult {
  purchaseId: number
}

interface ResolvedPurchaseItem {
  productId: number
  productUnitId: number | null
  /** the product_units row the line actually resolved to, even when the input said null (base) */
  resolvedUnitId: number
  qty: number
  konversi: number
  satuan: string | null
  hargaBeli: number
  subtotal: number
}

export function recordPurchase(db: BetterSQLite3Database<typeof schema>, input: RecordPurchaseInput): RecordPurchaseResult {
  if (!input.tanggal.trim()) {
    throw new Error('Tanggal wajib diisi.')
  }

  if (input.items.length < 1) {
    throw new Error('Item pembelian tidak boleh kosong.')
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      throw new Error('Qty harus bilangan bulat minimal 1.')
    }

    if (!Number.isFinite(item.hargaBeli)) {
      throw new Error('Harga beli wajib diisi.')
    }

    if (item.hargaBeli < 0) {
      throw new Error('Harga beli tidak boleh negatif.')
    }
  }

  const productIds = input.items.map((item) => item.productId)
  const productRows = db.select().from(products).where(inArray(products.id, productIds)).all()
  const productsById = new Map(productRows.map((p) => [p.id, p]))

  const unitRows = db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      satuan: units.code,
      konversi: productUnits.conversionFactor,
      isBaseUnit: productUnits.isBaseUnit,
    })
    .from(productUnits)
    .innerJoin(units, eq(productUnits.unitId, units.id))
    .where(inArray(productUnits.productId, productIds))
    .all()

  const resolvedItems: ResolvedPurchaseItem[] = []

  for (const item of input.items) {
    const product = productsById.get(item.productId)

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    // a null productUnitId still means "the base unit" at the input level -
    // it now resolves to a real product_units row instead of an implicit one
    const unit =
      item.productUnitId !== null
        ? unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)
        : unitRows.find((row) => row.productId === product.id && row.isBaseUnit)

    if (!unit) {
      throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
    }

    const subtotal = item.qty * item.hargaBeli

    resolvedItems.push({
      productId: item.productId,
      productUnitId: item.productUnitId,
      resolvedUnitId: unit.id,
      qty: item.qty,
      konversi: unit.konversi,
      satuan: unit.satuan,
      hargaBeli: item.hargaBeli,
      subtotal,
    })
  }

  return db.transaction((tx) => {
    const now = new Date()

    const purchase = tx
      .insert(purchases)
      .values({
        supplierId: input.supplierId,
        userId: input.userId,
        tanggal: input.tanggal,
        total: 0,
        catatan: input.catatan,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    let total = 0

    for (const item of resolvedItems) {
      total += item.subtotal

      tx.insert(purchaseItems)
        .values({
          purchaseId: purchase.id,
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: item.qty,
          konversi: item.konversi,
          satuan: item.satuan,
          hargaBeli: item.hargaBeli,
          subtotal: item.subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`${products.stok} + ${item.qty * item.konversi}` })
        .where(eq(products.id, item.productId))
        .run()

      tx.insert(stockMovements)
        .values({
          productId: item.productId,
          productUnitId: item.resolvedUnitId,
          quantity: item.qty,
          conversionFactor: item.konversi,
          baseQuantity: item.qty * item.konversi,
          movementType: 'purchase',
          referenceId: purchase.id,
          createdAt: now,
        })
        .run()
    }

    tx.update(purchases).set({ total }).where(eq(purchases.id, purchase.id)).run()

    return { purchaseId: purchase.id }
  })
}

export interface PurchaseListItem {
  id: number
  tanggal: string
  total: number
  catatan: string | null
  supplierName: string | null
  itemSummary: string
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

export function listPurchases(
  db: BetterSQLite3Database<typeof schema>,
  input: { page: number; pageSize?: number },
): { data: PurchaseListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(purchases).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const purchaseRows = db
    .select({
      id: purchases.id,
      tanggal: purchases.tanggal,
      total: purchases.total,
      catatan: purchases.catatan,
      supplierName: suppliers.nama,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .orderBy(desc(purchases.tanggal), desc(purchases.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  const purchaseIds = purchaseRows.map((p) => p.id)

  const itemRows =
    purchaseIds.length > 0
      ? db
          .select({
            purchaseId: purchaseItems.purchaseId,
            qty: purchaseItems.qty,
            namaItem: products.namaItem,
          })
          .from(purchaseItems)
          .innerJoin(products, eq(purchaseItems.productId, products.id))
          .where(inArray(purchaseItems.purchaseId, purchaseIds))
          .all()
      : []

  const data: PurchaseListItem[] = purchaseRows.map((purchase) => {
    const items = itemRows.filter((item) => item.purchaseId === purchase.id)
    const itemSummary = items.map((item) => `${item.namaItem} x${item.qty}`).join(', ')

    return {
      id: purchase.id,
      tanggal: purchase.tanggal,
      total: purchase.total,
      catatan: purchase.catatan,
      supplierName: purchase.supplierName,
      itemSummary,
    }
  })

  return { data, currentPage: page, lastPage, total }
}

export interface PurchaseProductOption {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; satuan: string; konversi: number }[]
}

export function searchProductsForPurchase(db: BetterSQLite3Database<typeof schema>, q: string): PurchaseProductOption[] {
  const whereClause = q
    ? or(like(products.kodeItem, `%${q}%`), like(products.namaItem, `%${q}%`), like(products.barcode, `%${q}%`))
    : undefined

  const rows = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      namaItem: products.namaItem,
      hargaPokok: products.hargaPokok,
    })
    .from(products)
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(20)
    .all()

  return rows.map((row) => {
    // the base unit is the product's own satuan label; the picker lists only
    // the derived ones, matching how a null productUnitId means "base"
    const baseUnit = getBaseProductUnit(db, row.id)
    const derivedUnits = listProductUnits(db, row.id)
      .filter((u) => !u.isBaseUnit)
      .map((u) => ({ id: u.id, satuan: u.unitCode, konversi: u.conversionFactor }))

    return { ...row, satuan: baseUnit.unitCode, units: derivedUnits }
  })
}
