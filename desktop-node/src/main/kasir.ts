import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { products, productUnits, productPriceTiers, units, sales, saleItems, bonPayments, stockMovements, storeSettings } from './db/schema'

export interface PriceTier {
  minQty: number
  maxQty: number | null
  hargaJual: number
}

/**
 * Tiers are closed [minQty, maxQty] ranges, with a null maxQty running
 * open-ended above. Write-time validation keeps them non-overlapping per unit,
 * so at most one can match - but migration 0008 backfilled every pre-existing
 * tier as unbounded, and the old schema allowed "10+" and "50+" together on one
 * product. Those pairs overlap, so the highest satisfied minQty is taken first,
 * which prices them the way they were priced before the migration.
 */
export function findTierForQty(priceTiers: PriceTier[], qty: number): PriceTier | undefined {
  return [...priceTiers]
    .sort((a, b) => b.minQty - a.minQty)
    .find((tier) => qty >= tier.minQty && (tier.maxQty === null || qty <= tier.maxQty))
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  return findTierForQty(priceTiers, qty)?.hargaJual ?? hargaJualDasar
}

export interface ProductRow {
  id: number
  namaItem: string
  hargaJual: number
  hargaPokok: number
  stok: number
}

export interface ProductUnitRow {
  id: number
  unitId: number
  unitCode: string
  conversionFactor: number
  hargaJual: number
  hargaPokok: number
}

export interface ResolvedItem {
  productId: number
  productUnitId: number
  satuan: string
  konversi: number
  hargaJual: number
  hargaPokok: number
  qty: number
  qtyDasar: number
  priceSource: 'normal' | 'price_tier'
}

export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow,
  priceTiers: PriceTier[],
  qty: number,
): ResolvedItem {
  const normalPrice = productUnit.hargaJual
  const tier = findTierForQty(priceTiers, qty)
  const hargaJual = tier?.hargaJual ?? normalPrice
  const priceSource: 'normal' | 'price_tier' = tier ? 'price_tier' : 'normal'

  const qtyDasar = qty * productUnit.conversionFactor

  if (product.stok < qtyDasar) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  return {
    productId: product.id,
    productUnitId: productUnit.id,
    satuan: productUnit.unitCode,
    konversi: productUnit.conversionFactor,
    hargaJual,
    // the cost of the unit actually being sold - a DUS line carries the DUS cost, so
    // rekap never has to multiply back up through konversi
    hargaPokok: productUnit.hargaPokok,
    qty,
    qtyDasar,
    priceSource,
  }
}

/**
 * Every distinct customer name ever used on a sale, most recently used first.
 * There is no customer master table - names typed at the register are the list,
 * so a brand new name shows up here after its first sale.
 */
export function listCustomers(db: BetterSQLite3Database<typeof schema>): string[] {
  const rows = db
    .select({ nama: sales.namaPelanggan })
    .from(sales)
    .where(sql`${sales.namaPelanggan} is not null and trim(${sales.namaPelanggan}) <> ''`)
    .groupBy(sales.namaPelanggan)
    .orderBy(sql`max(${sales.id}) desc`)
    .limit(200)
    .all()

  return rows.map((row) => row.nama as string)
}

export interface CartItemInput {
  productId: number
  productUnitId: number | null
  qty: number
}

/** settled in full at checkout, but the money never lands in the drawer */
export const METODE_NON_TUNAI = ['qris', 'transfer'] as const

export type MetodePembayaran = 'tunai' | 'bon' | 'qris' | 'transfer'

/**
 * Parses the local `YYYY-MM-DDTHH:mm` string a `datetime-local` input produces.
 * A future-dated sale would land in a rekap period that has not happened yet, so it is
 * rejected. Backdating has no limit - entering yesterday's sale this morning is normal.
 */
export function parseTanggalTransaksi(tanggal: string): Date {
  const parsed = new Date(tanggal)

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Tanggal transaksi tidak valid.')
  }

  if (parsed.getTime() > Date.now()) {
    throw new Error('Tanggal transaksi tidak boleh melewati waktu sekarang.')
  }

  return parsed
}

export interface CheckoutInput {
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  dibayar: number | null
  userId: number
  /** local `YYYY-MM-DDTHH:mm`; omit to stamp the sale with the current time */
  tanggal?: string | null
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
    if (!(item.qty > 0)) {
      throw new Error('Qty harus lebih dari 0.')
    }
  }

  if (input.metodePembayaran === 'bon' && !input.namaPelanggan?.trim()) {
    throw new Error('Nama pelanggan wajib diisi untuk transaksi bon.')
  }

  const productIds = input.items.map((item) => item.productId)
  const productRows = db.select().from(products).where(inArray(products.id, productIds)).all()
  const productsById = new Map(productRows.map((product) => [product.id, product]))

  const unitRows = db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      unitId: productUnits.unitId,
      unitCode: units.code,
      conversionFactor: productUnits.conversionFactor,
      hargaJual: productUnits.hargaJual,
      hargaPokok: productUnits.hargaPokok,
      isBaseUnit: productUnits.isBaseUnit,
    })
    .from(productUnits)
    .innerJoin(units, eq(productUnits.unitId, units.id))
    .where(inArray(productUnits.productId, productIds))
    .all()
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

    const unit = item.productUnitId
      ? unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)
      : unitRows.find((row) => row.productId === product.id && row.isBaseUnit)

    if (!unit) {
      throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
    }

    // tiers hang off the unit being sold, so a DUS line prices against DUS tiers
    // and never against the base unit's
    const tiers: PriceTier[] = tierRows
      .filter((row) => row.productUnitId === unit.id)
      .map((row) => ({ minQty: row.minQty, maxQty: row.maxQty, hargaJual: row.hargaJual }))

    const resolved = resolveCartItem(product, unit, tiers, item.qty)
    const previousQtyDasar = qtyDasarByProduct.get(product.id) ?? 0
    const totalQtyDasar = previousQtyDasar + resolved.qtyDasar
    if (product.stok < totalQtyDasar) {
      throw new Error(`Stok ${product.namaItem} tidak cukup.`)
    }
    qtyDasarByProduct.set(product.id, totalQtyDasar)
    resolvedItems.push(resolved)
  }

  const now = input.tanggal ? parseTanggalTransaksi(input.tanggal) : new Date()

  return db.transaction((tx) => {
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
      // qty may be fractional (e.g. 0.25 kg) - hargaJual is stored in integer cents
      const subtotal = Math.round(line.qty * line.hargaJual)
      total += subtotal

      tx.insert(saleItems)
        .values({
          saleId: sale.id,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          konversi: line.konversi,
          baseQuantity: line.qtyDasar,
          satuan: line.satuan,
          hargaJual: line.hargaJual,
          hargaPokok: line.hargaPokok,
          priceSource: line.priceSource,
          subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`${products.stok} - ${line.qtyDasar}` })
        .where(eq(products.id, line.productId))
        .run()

      tx.insert(stockMovements)
        .values({
          productId: line.productId,
          productUnitId: line.productUnitId,
          quantity: -line.qty,
          conversionFactor: line.konversi,
          baseQuantity: -line.qtyDasar,
          movementType: 'sale',
          referenceId: sale.id,
          createdAt: now,
        })
        .run()
    }

    // qris and transfer settle the exact amount at checkout - nothing owed, no change given
    const lunasNonTunai = (METODE_NON_TUNAI as readonly string[]).includes(input.metodePembayaran)
    tx.update(sales)
      .set({ total, dibayar: lunasNonTunai ? total : dibayarAwal })
      .where(eq(sales.id, sale.id))
      .run()

    if (input.metodePembayaran === 'tunai' && dibayarAwal < total) {
      throw new Error('Uang bayar kurang dari total belanja.')
    }

    return { saleId: sale.id, total }
  })
}

type Db = BetterSQLite3Database<typeof schema>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

/**
 * Puts sold stock back and logs the reversal. Both callers (cancelSale and purgeTodaySales)
 * move real stock, so both write to the ledger - otherwise the movement sum drifts away
 * from products.stok.
 */
function restoreStockForItems(
  tx: Tx,
  items: { saleId: number; productId: number; productUnitId: number | null; qty: number; konversi: number }[],
): void {
  const now = new Date()

  for (const item of items) {
    tx.update(products)
      .set({ stok: sql`${products.stok} + ${item.qty * item.konversi}` })
      .where(eq(products.id, item.productId))
      .run()

    tx.insert(stockMovements)
      .values({
        productId: item.productId,
        productUnitId: item.productUnitId,
        quantity: item.qty,
        conversionFactor: item.konversi,
        baseQuantity: item.qty * item.konversi,
        movementType: 'sale_cancel',
        referenceId: item.saleId,
        createdAt: now,
      })
      .run()
  }
}

export function cancelSale(db: Db, saleId: number): void {
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
    restoreStockForItems(tx, items)
    tx.update(sales).set({ status: 'dibatalkan' }).where(eq(sales.id, saleId)).run()
  })
}

export function deleteSale(db: Db, saleId: number): void {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  const hasBonPayment = db.select().from(bonPayments).where(eq(bonPayments.saleId, saleId)).get()

  if (hasBonPayment) {
    throw new Error('Tidak bisa menghapus, bon sudah ada pembayaran.')
  }

  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

  db.transaction((tx) => {
    // a cancelled sale already gave its stock back
    if (sale.status !== 'dibatalkan') {
      restoreStockForItems(tx, items)
    }

    tx.delete(sales).where(eq(sales.id, saleId)).run()
  })
}

export function purgeTodaySales(db: Db): { deleted: number; skipped: number } {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const todaySales = db
    .select()
    .from(sales)
    .where(and(gte(sales.createdAt, startOfToday), lte(sales.createdAt, endOfToday)))
    .all()

  let deleted = 0
  let skipped = 0

  db.transaction((tx) => {
    for (const sale of todaySales) {
      const hasBonPayment = tx.select().from(bonPayments).where(eq(bonPayments.saleId, sale.id)).get()

      if (hasBonPayment) {
        skipped++
        continue
      }

      if (sale.status !== 'dibatalkan') {
        const items = tx.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).all()
        restoreStockForItems(tx, items)
      }

      tx.delete(sales).where(eq(sales.id, sale.id)).run()
      deleted++
    }
  })

  return { deleted, skipped }
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
