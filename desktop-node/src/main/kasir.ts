export interface PriceTier {
  minQty: number
  hargaJual: number
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const applicable = priceTiers
    .filter((tier) => qty >= tier.minQty)
    .sort((a, b) => b.minQty - a.minQty)

  return applicable[0]?.hargaJual ?? hargaJualDasar
}

export interface ProductRow {
  id: number
  namaItem: string
  satuan: string
  hargaJual: number
  hargaPokok: number
  stok: number
}

export interface ProductUnitRow {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
}

export interface ResolvedItem {
  productId: number
  productUnitId: number | null
  satuan: string
  konversi: number
  hargaJual: number
  hargaPokok: number
  qty: number
  qtyDasar: number
}

export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow | null,
  priceTiers: PriceTier[],
  qty: number,
): ResolvedItem {
  let satuan: string
  let konversi: number
  let hargaJual: number
  let productUnitId: number | null

  if (productUnit) {
    satuan = productUnit.satuan
    konversi = productUnit.konversi
    hargaJual = productUnit.hargaJual
    productUnitId = productUnit.id
  } else {
    satuan = product.satuan
    konversi = 1
    hargaJual = priceForQty(priceTiers, product.hargaJual, qty)
    productUnitId = null
  }

  const qtyDasar = qty * konversi

  if (product.stok < qtyDasar) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  return {
    productId: product.id,
    productUnitId,
    satuan,
    konversi,
    hargaJual,
    hargaPokok: product.hargaPokok,
    qty,
    qtyDasar,
  }
}

import { eq, inArray, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems } from './db/schema'

export interface CartItemInput {
  productId: number
  productUnitId: number | null
  qty: number
}

export interface CheckoutInput {
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  dibayar: number | null
  userId: number
  items: CartItemInput[]
}

export interface CheckoutResult {
  saleId: number
  total: number
}

export function checkout(db: BetterSQLite3Database<typeof schema>, input: CheckoutInput): CheckoutResult {
  const productIds = input.items.map((item) => item.productId)
  const productRows = db.select().from(products).where(inArray(products.id, productIds)).all()
  const productsById = new Map(productRows.map((product) => [product.id, product]))

  const unitRows = db.select().from(productUnits).where(inArray(productUnits.productId, productIds)).all()
  const tierRows = db
    .select()
    .from(productPriceTiers)
    .where(inArray(productPriceTiers.productId, productIds))
    .all()

  const resolvedItems: ResolvedItem[] = []

  for (const item of input.items) {
    const product = productsById.get(item.productId)

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    let unit: ProductUnitRow | null = null
    if (item.productUnitId) {
      const found = unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)
      if (!found) {
        throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
      }
      unit = { id: found.id, satuan: found.satuan, konversi: found.konversi, hargaJual: found.hargaJual }
    }

    const tiers: PriceTier[] = tierRows
      .filter((row) => row.productId === product.id)
      .map((row) => ({ minQty: row.minQty, hargaJual: row.hargaJual }))

    resolvedItems.push(resolveCartItem(product, unit, tiers, item.qty))
  }

  return db.transaction((tx) => {
    const now = new Date()
    const dibayarAwal = input.metodePembayaran === 'tunai' ? (input.dibayar ?? 0) : 0

    const sale = tx
      .insert(sales)
      .values({
        userId: input.userId,
        namaPelanggan: input.namaPelanggan,
        metodePembayaran: input.metodePembayaran,
        status: 'selesai',
        total: 0,
        dibayar: dibayarAwal,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    let total = 0

    for (const line of resolvedItems) {
      const subtotal = line.qty * line.hargaJual
      total += subtotal

      tx.insert(saleItems)
        .values({
          saleId: sale.id,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          konversi: line.konversi,
          satuan: line.satuan,
          hargaJual: line.hargaJual,
          hargaPokok: line.hargaPokok,
          subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`${products.stok} - ${line.qtyDasar}` })
        .where(eq(products.id, line.productId))
        .run()
    }

    tx.update(sales).set({ total }).where(eq(sales.id, sale.id)).run()

    if (input.metodePembayaran === 'tunai' && dibayarAwal < total) {
      throw new Error('Uang bayar kurang dari total belanja.')
    }

    return { saleId: sale.id, total }
  })
}
