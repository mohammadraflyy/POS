import { and, desc, eq, gte, inArray, like, lt, lte, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import {
  products,
  productUnits,
  productPriceTiers,
  units,
  sales,
  saleItems,
  saleEdits,
  bonPayments,
  stockMovements,
  storeSettings,
  users,
} from './db/schema'
import { findOrCreateCustomerByName, listCustomerNames } from './customer'
import { bulatkanQty, QTY_DECIMALS } from './qty'
import { toRupiah } from './money'

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
  priceSource: 'normal' | 'price_tier' | 'manual'
  /** whole cents taken off this line by hand, already checked against the line's gross */
  diskon: number
  /**
   * True unless resolved with `allowStockShortage` and the shop doesn't actually have
   * enough on the shelf. Every existing caller (checkout, updateSale, addItemsToSale)
   * never sets that option, so for them this is always true - a shortage still throws
   * before a line can come back with this false.
   */
  stokCukup: boolean
}

export interface ResolveItemsOptions {
  /**
   * Report a stock shortfall as `stokCukup: false` on the line instead of throwing.
   * Used only by the mobile cart preview (`previewCart`), where two cashiers checking
   * the same product at once is an expected race, not a broken request - the phone
   * needs to see the rest of the cart's pricing even when one line can't be filled.
   */
  allowStockShortage?: boolean
}

/** what a line is worth before any discount - qty may be fractional, prices are integer cents */
export function lineGross(qty: number, hargaJual: number): number {
  return Math.round(qty * hargaJual)
}

/** what a line actually contributes to the bill: its gross less its own manual discount */
export function lineSubtotal(item: { qty: number; hargaJual: number; diskon: number }): number {
  return lineGross(item.qty, item.hargaJual) - item.diskon
}

export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow,
  priceTiers: PriceTier[],
  qty: number,
  /** whole cents; set only when a sale is being corrected by hand */
  hargaOverride?: number | null,
  /** whole cents off this line; may zero the line but never take it below zero */
  diskon?: number | null,
  opts?: ResolveItemsOptions,
): ResolvedItem {
  const normalPrice = productUnit.hargaJual
  const tier = findTierForQty(priceTiers, qty)

  const hargaJual = hargaOverride != null ? hargaOverride : (tier?.hargaJual ?? normalPrice)
  const priceSource: 'normal' | 'price_tier' | 'manual' =
    hargaOverride != null ? 'manual' : tier ? 'price_tier' : 'normal'

  // A price set by hand may not sell the line at a loss. Only the manual price is
  // checked: master and tier prices are the owner's own decision, and the line's
  // discount is deliberately left out - a discount is a concession that was given,
  // not an item that was mispriced.
  if (hargaOverride != null && hargaOverride < productUnit.hargaPokok) {
    throw new Error(`Harga ${product.namaItem} di bawah harga pokok satuan ${productUnit.unitCode}.`)
  }

  const qtyDasar = bulatkanQty(qty * productUnit.conversionFactor)
  const stokCukup = product.stok >= qtyDasar

  if (!stokCukup && !opts?.allowStockShortage) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  const diskonBaris = diskon ?? 0

  if (!Number.isInteger(diskonBaris) || diskonBaris < 0) {
    throw new Error(`Diskon ${product.namaItem} tidak valid.`)
  }

  if (diskonBaris > lineGross(qty, hargaJual)) {
    throw new Error(`Diskon ${product.namaItem} melebihi harga barisnya.`)
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
    diskon: diskonBaris,
    stokCukup,
  }
}

/**
 * The customer master, by name, for the register's picker. A name typed at the
 * till still works: `checkout` files it under a master row, creating one when the
 * name is new, so the picker lists it from the next sale on.
 */
export function listCustomers(db: BetterSQLite3Database<typeof schema>): string[] {
  return listCustomerNames(db)
}

export interface CartItemInput {
  productId: number
  productUnitId: number | null
  qty: number
  /** whole cents; overrides master and tier pricing for this line alone */
  hargaJual?: number | null
  /** whole cents off this line alone, on top of any bill-wide discount */
  diskon?: number | null
}

/**
 * Checks a bill-wide discount against what the lines came to. Rejecting rather than
 * clamping is deliberate: a discount larger than the bill means the cashier and the
 * till disagree about what is being sold, and silently charging zero hides that.
 */
function assertDiskonNota(diskon: number, subtotal: number): void {
  if (!Number.isInteger(diskon) || diskon < 0) {
    throw new Error('Diskon nota tidak valid.')
  }

  if (diskon > subtotal) {
    throw new Error('Diskon nota melebihi total belanja.')
  }
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
  /** whole cents off the whole bill, applied after every line's own discount */
  diskon?: number | null
  /** a free note on the sale; optional, blank is stored as null */
  keterangan?: string | null
  items: CartItemInput[]
}

export interface CheckoutResult {
  saleId: number
  total: number
}

type Db = BetterSQLite3Database<typeof schema>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

/**
 * Turns cart lines into priced, stock-checked sale lines. Shared by `checkout` and
 * `addItemsToSale` so a line added to an existing bon is priced by exactly the same
 * tier rules and cost snapshot as one rung up at the till.
 */
function resolveItems(db: Pick<Db, 'select'>, items: CartItemInput[], opts?: ResolveItemsOptions): ResolvedItem[] {
  const productIds = items.map((item) => item.productId)
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

  for (const item of items) {
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

    const resolved = resolveCartItem(product, unit, tiers, item.qty, item.hargaJual, item.diskon, opts)
    const previousQtyDasar = qtyDasarByProduct.get(product.id) ?? 0
    const totalQtyDasar = previousQtyDasar + resolved.qtyDasar
    const cukupGabungan = product.stok >= totalQtyDasar

    if (!cukupGabungan) {
      if (!opts?.allowStockShortage) {
        throw new Error(`Stok ${product.namaItem} tidak cukup.`)
      }

      // a single line can look fine on its own (resolveCartItem's own check) but
      // still be unfillable once combined with an earlier line for the same product
      resolved.stokCukup = false
    }

    qtyDasarByProduct.set(product.id, totalQtyDasar)
    resolvedItems.push(resolved)
  }

  return resolvedItems
}

export interface PreviewCartInput {
  items: CartItemInput[]
  /** whole cents off the whole bill, applied after every line's own discount */
  diskon?: number | null
}

export interface PreviewCartLine extends ResolvedItem {
  subtotal: number
}

export interface PreviewCartResult {
  lines: PreviewCartLine[]
  subtotal: number
  diskon: number
  total: number
}

/**
 * Prices a cart exactly like `checkout` would, without writing anything to the
 * database. Used by the mobile app to show a running total as the cart changes -
 * `resolveItems` is called with `allowStockShortage` so a line that's briefly out of
 * stock (another cashier just sold the last one) comes back flagged, not as a thrown
 * error that would blank the whole cart on the phone's screen.
 */
export function previewCart(db: BetterSQLite3Database<typeof schema>, input: PreviewCartInput): PreviewCartResult {
  if (input.items.length < 1) {
    throw new Error('Keranjang tidak boleh kosong.')
  }

  for (const item of input.items) {
    if (!(item.qty > 0)) {
      throw new Error('Qty harus lebih dari 0.')
    }
  }

  const resolvedItems = resolveItems(db, input.items, { allowStockShortage: true })
  const lines: PreviewCartLine[] = resolvedItems.map((line) => ({ ...line, subtotal: lineSubtotal(line) }))
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0)
  const diskonNota = input.diskon ?? 0

  assertDiskonNota(diskonNota, subtotal)

  return { lines, subtotal, diskon: diskonNota, total: subtotal - diskonNota }
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

  const resolvedItems = resolveItems(db, input.items)
  const diskonNota = input.diskon ?? 0
  assertDiskonNota(diskonNota, resolvedItems.reduce((sum, line) => sum + lineSubtotal(line), 0))

  const now = input.tanggal ? parseTanggalTransaksi(input.tanggal) : new Date()

  return db.transaction((tx) => {
    const dibayarAwal = input.metodePembayaran === 'tunai' ? (input.dibayar ?? 0) : 0

    const sale = tx
      .insert(sales)
      .values({
        userId: input.userId,
        customerId: findOrCreateCustomerByName(tx, input.namaPelanggan ?? ''),
        namaPelanggan: input.namaPelanggan,
        metodePembayaran: input.metodePembayaran,
        status: 'selesai',
        diskon: diskonNota,
        keterangan: input.keterangan?.trim() || null,
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
      const subtotal = lineSubtotal(line)
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
          diskon: line.diskon,
          subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`round(${products.stok} - ${line.qtyDasar}, ${QTY_DECIMALS})` })
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

    total -= diskonNota

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
      .set({ stok: sql`round(${products.stok} + ${bulatkanQty(item.qty * item.konversi)}, ${QTY_DECIMALS})` })
      .where(eq(products.id, item.productId))
      .run()

    tx.insert(stockMovements)
      .values({
        productId: item.productId,
        productUnitId: item.productUnitId,
        quantity: item.qty,
        conversionFactor: item.konversi,
        baseQuantity: bulatkanQty(item.qty * item.konversi),
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

export interface UpdateSaleInput {
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  /** whole cents; ignored for qris and transfer, which always settle in full */
  dibayar: number | null
  /** local `YYYY-MM-DDTHH:mm` */
  tanggal: string
  /** whole cents off the whole bill, applied after every line's own discount */
  diskon?: number | null
  /**
   * The sale's note. Optional: it is written to `sales.keterangan` and, when it says
   * anything, copied into the `sale_edits` row as the reason for this edit.
   */
  keterangan?: string | null
  /** the account doing the editing, taken from the session by the IPC layer */
  userId: number
  items: CartItemInput[]
}

/**
 * Rewrites a saved sale in place: its lines, its prices, who it is filed under, how it
 * was paid, and when it happened.
 *
 * The old lines are reversed *inside* the transaction before the new ones are priced,
 * which is what lets the cashier raise the qty of something this very sale sold out.
 * Reversal rows are logged as `sale_cancel` and the new lines as `sale`: nothing in the
 * app reads `movement_type` back, and what has to stay true is that the ledger still
 * sums to `products.stok`.
 *
 * A line that was already on the sale keeps the `hargaPokok` it was sold at. Re-reading
 * today's cost would rewrite historical margin every time an old sale is corrected.
 */
export function updateSale(db: Db, saleId: number, input: UpdateSaleInput): { total: number } {
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

  const tanggalBaru = parseTanggalTransaksi(input.tanggal)
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  // cancelSale restores stock but leaves the sale_items rows behind, so reversing
  // them again here would hand the same goods back to stock twice
  if (sale.status !== 'selesai') {
    throw new Error('Transaksi yang dibatalkan tidak bisa diubah.')
  }

  const sudahDibayar = db
    .select()
    .from(bonPayments)
    .where(eq(bonPayments.saleId, saleId))
    .all()
    .reduce((sum, row) => sum + row.jumlah, 0)

  return db.transaction((tx) => {
    const oldItems = tx.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()
    const totalSebelum = sale.total

    restoreStockForItems(
      tx,
      oldItems.map((item) => ({
        saleId,
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        konversi: item.konversi,
      })),
    )

    tx.delete(saleItems).where(eq(saleItems.saleId, saleId)).run()

    const resolvedItems = resolveItems(tx, input.items)
    const diskonNota = input.diskon ?? 0
    assertDiskonNota(diskonNota, resolvedItems.reduce((sum, line) => sum + lineSubtotal(line), 0))

    const hargaPokokLama = new Map(oldItems.map((item) => [`${item.productId}:${item.productUnitId}`, item.hargaPokok]))

    const now = new Date()
    let total = 0

    for (const line of resolvedItems) {
      const subtotal = lineSubtotal(line)
      total += subtotal

      tx.insert(saleItems)
        .values({
          saleId,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          konversi: line.konversi,
          baseQuantity: line.qtyDasar,
          satuan: line.satuan,
          hargaJual: line.hargaJual,
          hargaPokok: hargaPokokLama.get(`${line.productId}:${line.productUnitId}`) ?? line.hargaPokok,
          priceSource: line.priceSource,
          diskon: line.diskon,
          subtotal,
          createdAt: tanggalBaru,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`round(${products.stok} - ${line.qtyDasar}, ${QTY_DECIMALS})` })
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
          referenceId: saleId,
          createdAt: tanggalBaru,
        })
        .run()
    }

    total -= diskonNota

    const lunasNonTunai = (METODE_NON_TUNAI as readonly string[]).includes(input.metodePembayaran)
    // for bon, dibayar is allowed to sit above the sum of recorded bon_payments - deliberate,
    // so an admin can correct money that was taken but never entered. Consequence: recordBonPayment
    // then refuses further payments beyond (total - dibayar), which is smaller than it looks.
    const dibayarBaru = lunasNonTunai ? total : (input.dibayar ?? 0)

    if (input.metodePembayaran === 'tunai' && dibayarBaru < total) {
      throw new Error('Uang bayar kurang dari total belanja.')
    }

    if (dibayarBaru < sudahDibayar) {
      throw new Error('Dibayar tidak boleh kurang dari pembayaran yang sudah tercatat.')
    }

    tx.update(sales)
      .set({
        customerId: findOrCreateCustomerByName(tx, input.namaPelanggan ?? ''),
        namaPelanggan: input.namaPelanggan,
        metodePembayaran: input.metodePembayaran,
        diskon: diskonNota,
        keterangan: input.keterangan?.trim() || null,
        total,
        dibayar: dibayarBaru,
        createdAt: tanggalBaru,
        updatedAt: now,
      })
      .where(eq(sales.id, saleId))
      .run()

    // Inside the same transaction as the rewrite on purpose: a log describing a change
    // that never happened would be worse than no log.
    tx.insert(saleEdits)
      .values({
        saleId,
        userId: input.userId,
        // the note doubles as the edit's reason; an empty one still logs the edit itself,
        // which is the part that must never be lost
        keterangan: input.keterangan?.trim() ?? '',
        totalSebelum,
        totalSesudah: total,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    return { total }
  })
}

/**
 * Appends lines to an existing unpaid bon: the customer took more goods on the same tab.
 *
 * The new lines are stamped with today's date while `sales.createdAt` stays put - the
 * goods left today, but the debt is still the old debt. `dibayar` is untouched, so the
 * outstanding balance rises by exactly the added subtotal.
 *
 * Only unpaid bon qualify. A cash, qris or transfer sale is money already counted, and
 * editing it would silently disagree with the day's takings.
 */
export function addItemsToSale(db: Db, saleId: number, items: CartItemInput[]): { total: number } {
  if (items.length < 1) {
    throw new Error('Tidak ada item yang ditambahkan.')
  }

  for (const item of items) {
    if (!(item.qty > 0)) {
      throw new Error('Qty harus lebih dari 0.')
    }
  }

  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  if (sale.status !== 'selesai') {
    throw new Error('Transaksi yang dibatalkan tidak bisa ditambah item.')
  }

  if (sale.metodePembayaran !== 'bon') {
    throw new Error('Hanya transaksi bon yang bisa ditambah item.')
  }

  if (sale.dibayar >= sale.total) {
    throw new Error('Bon sudah lunas, tidak bisa ditambah item.')
  }

  const resolvedItems = resolveItems(db, items)

  return db.transaction((tx) => {
    const now = new Date()
    let tambahan = 0

    for (const line of resolvedItems) {
      const subtotal = lineSubtotal(line)
      tambahan += subtotal

      tx.insert(saleItems)
        .values({
          saleId,
          productId: line.productId,
          productUnitId: line.productUnitId,
          qty: line.qty,
          konversi: line.konversi,
          baseQuantity: line.qtyDasar,
          satuan: line.satuan,
          hargaJual: line.hargaJual,
          hargaPokok: line.hargaPokok,
          priceSource: line.priceSource,
          diskon: line.diskon,
          subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`round(${products.stok} - ${line.qtyDasar}, ${QTY_DECIMALS})` })
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
          referenceId: saleId,
          createdAt: now,
        })
        .run()
    }

    const total = sale.total + tambahan

    tx.update(sales).set({ total, updatedAt: now }).where(eq(sales.id, saleId)).run()

    return { total }
  })
}

export function deleteSale(db: Db, saleId: number): void {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  const items = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

  db.transaction((tx) => {
    // a cancelled sale already gave its stock back
    if (sale.status !== 'dibatalkan') {
      restoreStockForItems(tx, items)
    }

    // A paid bon goes too, instalments and all: `bon_payments` cascades off `sales`, so
    // the money drops out of the cash book by itself and the sale leaves nothing behind.
    // Deliberately unguarded - `cancelSale` still refuses, because a cancelled sale keeps
    // its row and would strand payments against a bill nobody owes.
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
    /**
     * Lowest acceptable margin as a percentage of the selling price. Omitted by callers that
     * only edit the receipt details - the stored value is kept rather than reset.
     */
    marginMinimalPersen?: number
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

  // 90% of the selling price as cost leaves a 10x markup; anything above that is a typo,
  // and a recommended price computed from it would be nonsense
  if (
    input.marginMinimalPersen !== undefined &&
    (!Number.isFinite(input.marginMinimalPersen) || input.marginMinimalPersen < 0 || input.marginMinimalPersen > 90)
  ) {
    throw new Error('Margin minimal harus antara 0 dan 90 persen.')
  }

  const now = new Date()
  const existing = db.select().from(storeSettings).get()
  const marginMinimalPersen = Math.round(input.marginMinimalPersen ?? existing?.marginMinimalPersen ?? 10)

  if (existing) {
    db.update(storeSettings)
      .set({
        namaToko: input.namaToko,
        alamat: input.alamat,
        telepon: input.telepon,
        pesanFooter: input.pesanFooter,
        printerName: input.printerName,
        receiptWidth: input.receiptWidth,
        marginMinimalPersen,
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
        marginMinimalPersen,
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

export interface CatalogUnit {
  id: number
  satuan: string
  konversi: number
  hargaJual: number
  hargaPokok: number
}

export interface CatalogPriceTier {
  productUnitId: number | null
  minQty: number
  maxQty: number | null
  hargaJual: number
}

export interface CatalogItem {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  satuan: string
  hargaJual: number
  hargaPokok: number
  stok: number
  baseProductUnitId: number
  productUnits: CatalogUnit[]
  priceTiers: CatalogPriceTier[]
}

const CATALOG_PAGE_SIZE = 25
const CATALOG_VALID_PAGE_SIZES = [10, 25, 50, 100]

/**
 * A paginated, searchable version of the per-product catalog `kasir:listProducts`
 * dumps in full for the till's own screen. The mobile app cannot afford that dump -
 * every request blocks the PC's main process, and a phone typically wants a handful
 * of matches, not all 1500 products (mobile-app-design spec).
 */
export function searchCatalogForSale(
  db: BetterSQLite3Database<typeof schema>,
  input: { q?: string; page: number; pageSize?: number },
): { data: CatalogItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && CATALOG_VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : CATALOG_PAGE_SIZE
  const page = Math.max(1, input.page)
  const q = input.q?.trim()

  const whereClause = q
    ? and(
        eq(products.isActive, true),
        or(like(products.kodeItem, `%${q}%`), like(products.namaItem, `%${q}%`), like(products.barcode, `%${q}%`)),
      )
    : eq(products.isActive, true)

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(products).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const productRows = db
    .select()
    .from(products)
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  const productIds = productRows.map((product) => product.id)

  const unitRows =
    productIds.length > 0
      ? db
          .select({
            id: productUnits.id,
            productId: productUnits.productId,
            satuan: units.code,
            konversi: productUnits.conversionFactor,
            hargaJual: productUnits.hargaJual,
            hargaPokok: productUnits.hargaPokok,
            isBaseUnit: productUnits.isBaseUnit,
          })
          .from(productUnits)
          .innerJoin(units, eq(productUnits.unitId, units.id))
          .where(inArray(productUnits.productId, productIds))
          .all()
      : []

  const tierRows =
    productIds.length > 0
      ? db.select().from(productPriceTiers).where(inArray(productPriceTiers.productId, productIds)).all()
      : []

  const data: CatalogItem[] = productRows.map((product) => {
    const baseUnit = unitRows.find((unit) => unit.productId === product.id && unit.isBaseUnit)

    return {
      id: product.id,
      kodeItem: product.kodeItem,
      barcode: product.barcode,
      namaItem: product.namaItem,
      satuan: baseUnit?.satuan ?? '',
      hargaJual: product.hargaJual,
      hargaPokok: baseUnit?.hargaPokok ?? product.hargaPokok,
      stok: product.stok,
      baseProductUnitId: baseUnit?.id ?? 0,
      productUnits: unitRows
        .filter((unit) => unit.productId === product.id && !unit.isBaseUnit)
        .map((unit) => ({
          id: unit.id,
          satuan: unit.satuan,
          konversi: unit.konversi,
          hargaJual: unit.hargaJual,
          hargaPokok: unit.hargaPokok,
        })),
      priceTiers: tierRows
        .filter((tier) => tier.productId === product.id)
        .map((tier) => ({
          productUnitId: tier.productUnitId,
          minQty: tier.minQty,
          maxQty: tier.maxQty,
          hargaJual: tier.hargaJual,
        })),
    }
  })

  return { data, currentPage: page, lastPage, total }
}

export interface ReceiptData {
  saleId: number
  diskon: number
  total: number
  dibayar: number
  metodePembayaran: MetodePembayaran
  namaPelanggan: string | null
  createdAt: string
  kasirName: string | null
  items: { namaItem: string; qty: number; satuan: string | null; hargaJual: number; diskon: number; subtotal: number }[]
}

/**
 * The struk in rupiah, ready for `buildReceiptEscPos` (escpos.ts) - unlike every other
 * function below this point, its numbers are already converted, because printing is the
 * only consumer and there's no reason to make every caller redo the same conversion.
 */
export function getReceipt(
  db: BetterSQLite3Database<typeof schema>,
  saleId: number,
  kasirName: string | null,
): ReceiptData {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()
  const productIds = itemRows.map((item) => item.productId)
  const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
  const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

  return {
    saleId: sale.id,
    diskon: toRupiah(sale.diskon),
    total: toRupiah(sale.total),
    dibayar: toRupiah(sale.dibayar),
    metodePembayaran: sale.metodePembayaran,
    namaPelanggan: sale.namaPelanggan,
    createdAt: sale.createdAt.toISOString(),
    kasirName,
    items: itemRows.map((item) => ({
      namaItem: productNameById.get(item.productId) ?? '',
      qty: item.qty,
      satuan: item.satuan,
      hargaJual: toRupiah(item.hargaJual),
      diskon: toRupiah(item.diskon),
      subtotal: toRupiah(item.subtotal),
    })),
  }
}

export interface SalesHistoryFilters {
  dari?: string
  sampai?: string
  status?: 'selesai' | 'dibatalkan'
  metodePembayaran?: MetodePembayaran
  search?: string
  page: number
}

export interface SalesHistoryItem {
  id: number
  createdAt: Date
  namaPelanggan: string | null
  metodePembayaran: MetodePembayaran
  status: 'selesai' | 'dibatalkan'
  total: number
  dibayar: number
  /** total less what the goods cost, at the harga_pokok each line was sold at */
  laba: number
  items: { namaItem: string; qty: number }[]
}

export function listSalesHistory(
  db: BetterSQLite3Database<typeof schema>,
  input: SalesHistoryFilters,
): { data: SalesHistoryItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = 20
  const page = Math.max(1, input.page)

  const conditions = []

  if (input.dari) {
    conditions.push(gte(sales.createdAt, new Date(`${input.dari}T00:00:00`)))
  }

  if (input.sampai) {
    conditions.push(lte(sales.createdAt, new Date(`${input.sampai}T23:59:59`)))
  }

  if (input.status) {
    conditions.push(eq(sales.status, input.status))
  }

  if (input.metodePembayaran) {
    conditions.push(eq(sales.metodePembayaran, input.metodePembayaran))
  }

  if (input.search) {
    const q = `%${input.search}%`
    const byCustomer = db.select({ id: sales.id }).from(sales).where(like(sales.namaPelanggan, q)).all()
    const byProduct = db
      .select({ id: saleItems.saleId })
      .from(saleItems)
      .innerJoin(products, eq(saleItems.productId, products.id))
      .where(like(products.namaItem, q))
      .all()
    const matchingIds = Array.from(new Set([...byCustomer.map((row) => row.id), ...byProduct.map((row) => row.id)]))
    conditions.push(matchingIds.length > 0 ? inArray(sales.id, matchingIds) : sql`0`)
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(sales).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const saleRows = db
    .select()
    .from(sales)
    .where(whereClause)
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  const saleIds = saleRows.map((sale) => sale.id)
  const itemRows = saleIds.length > 0 ? db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds)).all() : []
  const productIds = itemRows.map((item) => item.productId)
  const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
  const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

  return {
    data: saleRows.map((sale) => {
      const itemsOfSale = itemRows.filter((item) => item.saleId === sale.id)
      // hargaPokok is the cost of the unit that was sold, so qty alone scales it
      const modal = itemsOfSale.reduce((sum, item) => sum + Math.round(item.qty * item.hargaPokok), 0)

      return {
        id: sale.id,
        createdAt: sale.createdAt,
        namaPelanggan: sale.namaPelanggan,
        metodePembayaran: sale.metodePembayaran,
        status: sale.status,
        total: sale.total,
        dibayar: sale.dibayar,
        laba: sale.total - modal,
        items: itemsOfSale.map((item) => ({ namaItem: productNameById.get(item.productId) ?? '', qty: item.qty })),
      }
    }),
    currentPage: page,
    lastPage,
    total,
  }
}

export interface SaleDetailItem {
  id: number
  productId: number
  productUnitId: number | null
  qty: number
  satuan: string | null
  namaItem: string
  hargaJual: number
  diskon: number
  subtotal: number
  priceSource: 'normal' | 'price_tier' | 'manual'
}

export interface SaleDetailResult {
  id: number
  namaPelanggan: string | null
  metodePembayaran: MetodePembayaran
  status: 'selesai' | 'dibatalkan'
  diskon: number
  total: number
  dibayar: number
  keterangan: string | null
  createdAt: Date
  kasirName: string | null
  /** what the goods on this sale cost, at the harga_pokok each line was sold at */
  modal: number
  /**
   * Gross profit on this sale: `total` (already net of both discounts) less `modal`.
   * Negative when a discount was given past the margin - the till allows that on purpose.
   *
   * Computed for a cancelled sale too; the caller decides whether a reversed sale's margin
   * is worth showing. Unlike rekap.ts this needs no pro-rata split of the bill discount:
   * at sale level the whole discount already sits inside `total`.
   */
  laba: number
  items: SaleDetailItem[]
  bonPayments: { id: number; jumlah: number; tanggal: string; keterangan: string | null }[]
  edits: { id: number; keterangan: string; kasirName: string | null; totalSebelum: number; totalSesudah: number; createdAt: Date }[]
}

export function getSaleDetail(db: BetterSQLite3Database<typeof schema>, saleId: number): SaleDetailResult {
  const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

  if (!sale) {
    throw new Error('Transaksi tidak ditemukan.')
  }

  const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()
  const productIds = itemRows.map((item) => item.productId)
  const productRows = productIds.length > 0 ? db.select().from(products).where(inArray(products.id, productIds)).all() : []
  const productNameById = new Map(productRows.map((product) => [product.id, product.namaItem]))

  const paymentRows = db
    .select()
    .from(bonPayments)
    .where(eq(bonPayments.saleId, saleId))
    .orderBy(desc(bonPayments.tanggal), desc(bonPayments.id))
    .all()

  const kasir = sale.userId ? db.select({ name: users.name }).from(users).where(eq(users.id, sale.userId)).get() : null

  // hargaPokok is the cost of the unit that was sold, so qty alone scales it - the same
  // rule rekap.ts costs a line by
  const modal = itemRows.reduce((sum, item) => sum + Math.round(item.qty * item.hargaPokok), 0)

  const editRows = db
    .select({
      id: saleEdits.id,
      keterangan: saleEdits.keterangan,
      totalSebelum: saleEdits.totalSebelum,
      totalSesudah: saleEdits.totalSesudah,
      createdAt: saleEdits.createdAt,
      kasirName: users.name,
    })
    .from(saleEdits)
    .leftJoin(users, eq(saleEdits.userId, users.id))
    .where(eq(saleEdits.saleId, saleId))
    .orderBy(desc(saleEdits.id))
    .all()

  return {
    id: sale.id,
    namaPelanggan: sale.namaPelanggan,
    metodePembayaran: sale.metodePembayaran,
    status: sale.status,
    diskon: sale.diskon,
    total: sale.total,
    dibayar: sale.dibayar,
    keterangan: sale.keterangan,
    createdAt: sale.createdAt,
    kasirName: kasir?.name ?? null,
    modal,
    laba: sale.total - modal,
    items: itemRows.map((item) => ({
      id: item.id,
      productId: item.productId,
      productUnitId: item.productUnitId,
      qty: item.qty,
      satuan: item.satuan,
      namaItem: productNameById.get(item.productId) ?? '',
      hargaJual: item.hargaJual,
      diskon: item.diskon,
      subtotal: item.subtotal,
      priceSource: item.priceSource,
    })),
    bonPayments: paymentRows.map((payment) => ({
      id: payment.id,
      jumlah: payment.jumlah,
      tanggal: payment.tanggal,
      keterangan: payment.keterangan,
    })),
    edits: editRows.map((row) => ({
      id: row.id,
      keterangan: row.keterangan,
      kasirName: row.kasirName,
      totalSebelum: row.totalSebelum,
      totalSesudah: row.totalSesudah,
      createdAt: row.createdAt,
    })),
  }
}
