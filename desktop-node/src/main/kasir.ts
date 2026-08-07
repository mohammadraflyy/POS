import { eq, inArray, lt, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments, storeSettings } from './db/schema'

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
  if (input.items.length < 1) {
    throw new Error('Keranjang tidak boleh kosong.')
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      throw new Error('Qty harus bilangan bulat minimal 1.')
    }
  }

  if (input.metodePembayaran === 'bon' && !input.namaPelanggan?.trim()) {
    throw new Error('Nama pelanggan wajib diisi untuk transaksi bon.')
  }

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
  const qtyDasarByProduct = new Map<number, number>()

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

    const resolved = resolveCartItem(product, unit, tiers, item.qty)
    const previousQtyDasar = qtyDasarByProduct.get(product.id) ?? 0
    const totalQtyDasar = previousQtyDasar + resolved.qtyDasar
    if (product.stok < totalQtyDasar) {
      throw new Error(`Stok ${product.namaItem} tidak cukup.`)
    }
    qtyDasarByProduct.set(product.id, totalQtyDasar)
    resolvedItems.push(resolved)
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

export function cancelSale(db: BetterSQLite3Database<typeof schema>, saleId: number): void {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  if (sale.status === 'dibatalkan') {
    throw new Error('Transaksi sudah dibatalkan.')
  }

  const hasBonPayment = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).get()

  if (hasBonPayment) {
    throw new Error('Tidak bisa membatalkan, bon sudah ada pembayaran.')
  }

  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

  db.transaction((tx) => {
    for (const item of items) {
      tx.update(products)
        .set({ stok: sql`${products.stok} + ${item.qty * item.konversi}` })
        .where(eq(products.id, item.productId))
        .run()
    }

    tx.update(sales).set({ status: 'dibatalkan' }).where(eq(sales.id, saleId)).run()
  })
}

export function recordBonPayment(
  db: BetterSQLite3Database<typeof schema>,
  saleId: number,
  jumlahCents: number,
  keterangan: string | null,
): void {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  if (sale.metodePembayaran !== 'bon' || sale.status !== 'selesai') {
    throw new Error('Transaksi ini bukan bon aktif.')
  }

  if (!Number.isInteger(jumlahCents) || jumlahCents <= 0) {
    throw new Error('Jumlah bayar harus lebih dari 0.')
  }

  const trimmedKeterangan = keterangan?.trim() || null

  if (trimmedKeterangan && trimmedKeterangan.length > 500) {
    throw new Error('Keterangan maksimal 500 karakter.')
  }

  const sisaPiutang = sale.total - sale.dibayar

  if (jumlahCents > sisaPiutang) {
    throw new Error('Jumlah bayar melebihi sisa piutang.')
  }

  const now = new Date()
  const tanggal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  db.transaction((tx) => {
    tx.insert(bonPayments)
      .values({
        saleId,
        jumlah: jumlahCents,
        tanggal,
        keterangan: trimmedKeterangan,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    tx.update(sales)
      .set({ dibayar: sql`${sales.dibayar} + ${jumlahCents}` })
      .where(eq(sales.id, saleId))
      .run()
  })
}

export function updateStoreSettings(
  db: BetterSQLite3Database<typeof schema>,
  input: {
    namaToko: string
    alamat: string | null
    telepon: string | null
    pesanFooter: string | null
    printerName: string | null
    receiptWidth: '58mm' | '80mm'
  },
): void {
  if (!input.namaToko.trim()) {
    throw new Error('Nama toko wajib diisi.')
  }

  if (input.namaToko.length > 255) {
    throw new Error('Nama toko maksimal 255 karakter.')
  }

  if (input.alamat && input.alamat.length > 255) {
    throw new Error('Alamat maksimal 255 karakter.')
  }

  if (input.telepon && input.telepon.length > 50) {
    throw new Error('Telepon maksimal 50 karakter.')
  }

  if (input.pesanFooter && input.pesanFooter.length > 255) {
    throw new Error('Pesan footer maksimal 255 karakter.')
  }

  if (input.receiptWidth !== '58mm' && input.receiptWidth !== '80mm') {
    throw new Error('Lebar kertas tidak valid.')
  }

  const now = new Date()
  const existing = db.select().from(storeSettings).get()

  if (existing) {
    db.update(storeSettings)
      .set({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
        printerName: input.printerName,
        receiptWidth: input.receiptWidth,
      })
      .where(eq(storeSettings.id, existing.id))
      .run()
  } else {
    db.insert(storeSettings)
      .values({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
        printerName: input.printerName,
        receiptWidth: input.receiptWidth,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
}

export function purgeSalesBefore(db: BetterSQLite3Database<typeof schema>, beforeDate: Date): number {
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  if (beforeDate > endOfToday) {
    throw new Error('Tanggal tidak boleh di masa depan.')
  }

  const result = db.delete(sales).where(lt(sales.createdAt, beforeDate)).run()
  return result.changes
}
