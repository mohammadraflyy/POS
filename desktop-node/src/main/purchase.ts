import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import {
  purchases,
  purchaseItems,
  purchasePayments,
  products,
  productPriceHistories,
  suppliers,
  productUnits,
  stockMovements,
  units,
} from './db/schema'
import { getBaseProductUnit, listProductUnits, unitsInside } from './inventory-units'

/**
 * Weighted-average cost of one `konversi`-sized unit after receiving `qtyDasarMasuk`
 * base units for `nilaiBeli` rupiah. Works in whole rupiah of inventory value rather
 * than a per-unit price so a derived-unit purchase (5 DUS at 120.000) is not rounded
 * twice on its way between units.
 *
 * The stock basis stays in base units for every unit, so no fractional stock is ever
 * materialised: averaging in unit V wants
 * `(stokDasar/K * lama + nilaiBeli) / (stokDasar/K + qtyDasar/K)`, and multiplying
 * through by K clears both divisions into the integer form below.
 */
export function hitungHargaPokokSatuan(
  stokDasarLama: number,
  hargaPokokSatuanLama: number,
  konversi: number,
  qtyDasarMasuk: number,
  nilaiBeli: number,
): number {
  // negative stock (possible after a manual adjustment) carries no value to average against
  const basisStok = Math.max(0, stokDasarLama)
  const totalQty = basisStok + qtyDasarMasuk

  if (totalQty <= 0) {
    return hargaPokokSatuanLama
  }

  return Math.round((basisStok * hargaPokokSatuanLama + nilaiBeli * konversi) / totalQty)
}

/** the base-unit case of {@link hitungHargaPokokSatuan}, kept for products.hargaPokok */
export function hitungHargaPokokRataRata(
  stokLama: number,
  hargaPokokLama: number,
  qtyDasar: number,
  nilaiBeli: number,
): number {
  return hitungHargaPokokSatuan(stokLama, hargaPokokLama, 1, qtyDasar, nilaiBeli)
}

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
  /** paid on arrival; omitted means the whole invoice was settled, so no debt is created */
  dibayar?: number
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
      hargaPokok: productUnits.hargaPokok,
      parentUnitId: productUnits.parentUnitId,
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

  const totalPembelian = resolvedItems.reduce((sum, item) => sum + item.subtotal, 0)
  const dibayar = input.dibayar ?? totalPembelian

  if (!Number.isInteger(dibayar)) {
    throw new Error('Dibayar harus bilangan bulat.')
  }

  if (dibayar < 0) {
    throw new Error('Dibayar tidak boleh negatif.')
  }

  if (dibayar > totalPembelian) {
    throw new Error('Dibayar tidak boleh melebihi total pembelian.')
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
        dibayar,
        catatan: input.catatan,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    let total = 0

    // A purchase can hold several lines for the same product (e.g. 2 DUS and 3 PCS
    // of the same item), so stock and cost have to compound line by line instead of
    // each line averaging against the pre-purchase figures.
    const stokBerjalan = new Map(productRows.map((p) => [p.id, p.stok]))
    const hargaPokokBerjalan = new Map(productRows.map((p) => [p.id, p.hargaPokok]))
    // same compounding, keyed by product_units.id: a purchase with two lines for one
    // product must average the second line against the first line's result
    const hargaPokokUnitBerjalan = new Map(unitRows.map((u) => [u.id, u.hargaPokok]))

    for (const item of resolvedItems) {
      total += item.subtotal

      const qtyDasar = item.qty * item.konversi
      const stokLama = stokBerjalan.get(item.productId) ?? 0
      const hargaPokokLama = hargaPokokBerjalan.get(item.productId) ?? 0
      const hargaPokokBaru = hitungHargaPokokRataRata(stokLama, hargaPokokLama, qtyDasar, item.subtotal)

      stokBerjalan.set(item.productId, stokLama + qtyDasar)
      hargaPokokBerjalan.set(item.productId, hargaPokokBaru)

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
        .set({ stok: sql`${products.stok} + ${qtyDasar}`, hargaPokok: hargaPokokBaru, updatedAt: now })
        .where(eq(products.id, item.productId))
        .run()

      // Cost travels inward, never outward: the stock physically arrived inside the
      // purchased packaging, so the units it is built from follow this purchase. Larger
      // units are untouched (loose pieces say nothing about a dus), and so are siblings -
      // buying a SAK delivers pieces, not rentengs.
      const productChain = unitRows.filter((row) => row.productId === item.productId)
      const purchasedUnit = productChain.find((row) => row.id === item.resolvedUnitId)
      const affected = purchasedUnit ? [purchasedUnit, ...unitsInside(productChain, item.resolvedUnitId)] : []

      for (const unitRow of affected) {
        const hargaPokokUnitLama = hargaPokokUnitBerjalan.get(unitRow.id) ?? 0
        const hargaPokokUnitBaru = hitungHargaPokokSatuan(
          stokLama,
          hargaPokokUnitLama,
          unitRow.konversi,
          qtyDasar,
          item.subtotal,
        )

        hargaPokokUnitBerjalan.set(unitRow.id, hargaPokokUnitBaru)
        tx.update(productUnits)
          .set({ hargaPokok: hargaPokokUnitBaru, updatedAt: now })
          .where(eq(productUnits.id, unitRow.id))
          .run()
      }

      if (hargaPokokBaru !== hargaPokokLama) {
        const product = productsById.get(item.productId)!

        tx.insert(productPriceHistories)
          .values({
            productId: item.productId,
            userId: input.userId,
            hargaPokokLama,
            hargaPokokBaru,
            // the purchase never touches the selling price - recorded unchanged so
            // the audit row still reads as a complete before/after snapshot
            hargaJualLama: product.hargaJual,
            hargaJualBaru: product.hargaJual,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      }

      tx.insert(stockMovements)
        .values({
          productId: item.productId,
          productUnitId: item.resolvedUnitId,
          quantity: item.qty,
          conversionFactor: item.konversi,
          baseQuantity: qtyDasar,
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
  dibayar: number
  /** the unpaid remainder of this invoice */
  sisa: number
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
      dibayar: purchases.dibayar,
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
      dibayar: purchase.dibayar,
      sisa: purchase.total - purchase.dibayar,
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

export interface SupplierDebtRow {
  purchaseId: number
  supplierId: number | null
  supplierName: string | null
  tanggal: string
  total: number
  dibayar: number
  sisa: number
}

/**
 * Unsettled purchases, oldest first - the order a lump payment is allocated in.
 * Pass `supplierId` to narrow to one supplier's invoices.
 */
export function listSupplierDebts(
  db: BetterSQLite3Database<typeof schema>,
  supplierId?: number,
): SupplierDebtRow[] {
  const rows = db
    .select({
      purchaseId: purchases.id,
      supplierId: purchases.supplierId,
      supplierName: suppliers.nama,
      tanggal: purchases.tanggal,
      total: purchases.total,
      dibayar: purchases.dibayar,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(
      and(
        sql`${purchases.dibayar} < ${purchases.total}`,
        supplierId === undefined ? undefined : eq(purchases.supplierId, supplierId),
      ),
    )
    .orderBy(purchases.tanggal, purchases.id)
    .all()

  return rows.map((row) => ({ ...row, sisa: row.total - row.dibayar }))
}

export interface SupplierPaymentInput {
  supplierId: number
  jumlah: number
  tanggal: string
  keterangan: string | null
  userId: number | null
}

export interface SupplierPaymentResult {
  alokasi: { purchaseId: number; jumlah: number }[]
}

/**
 * Pays a supplier a single lump sum and spreads it over that supplier's outstanding
 * invoices, oldest first. The owner pays per supplier, not per invoice, but the app still
 * has to know which invoice is settled - so one payment can write several
 * `purchase_payments` rows.
 */
export function recordSupplierPayment(
  db: BetterSQLite3Database<typeof schema>,
  input: SupplierPaymentInput,
): SupplierPaymentResult {
  const supplier = db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).get()

  if (!supplier) {
    throw new Error('Supplier tidak ditemukan.')
  }

  if (!Number.isInteger(input.jumlah) || input.jumlah <= 0) {
    throw new Error('Jumlah bayar harus lebih dari 0.')
  }

  if (!input.tanggal.trim()) {
    throw new Error('Tanggal wajib diisi.')
  }

  const keterangan = input.keterangan?.trim() || null

  if (keterangan && keterangan.length > 500) {
    throw new Error('Keterangan maksimal 500 karakter.')
  }

  const debts = listSupplierDebts(db, input.supplierId)
  const totalHutang = debts.reduce((sum, debt) => sum + debt.sisa, 0)

  if (input.jumlah > totalHutang) {
    throw new Error('Jumlah bayar melebihi sisa hutang supplier.')
  }

  return db.transaction((tx) => {
    const now = new Date()
    const alokasi: { purchaseId: number; jumlah: number }[] = []
    let belumTeralokasi = input.jumlah

    for (const debt of debts) {
      if (belumTeralokasi <= 0) {
        break
      }

      const porsi = Math.min(belumTeralokasi, debt.sisa)

      tx.insert(purchasePayments)
        .values({
          purchaseId: debt.purchaseId,
          userId: input.userId,
          jumlah: porsi,
          tanggal: input.tanggal,
          keterangan,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(purchases)
        .set({ dibayar: sql`${purchases.dibayar} + ${porsi}`, updatedAt: now })
        .where(eq(purchases.id, debt.purchaseId))
        .run()

      alokasi.push({ purchaseId: debt.purchaseId, jumlah: porsi })
      belumTeralokasi -= porsi
    }

    return { alokasi }
  })
}

export interface SupplierPaymentRow {
  id: number
  purchaseId: number
  jumlah: number
  tanggal: string
  keterangan: string | null
}

/** one supplier's instalment history, newest first */
export function listSupplierPayments(
  db: BetterSQLite3Database<typeof schema>,
  supplierId: number,
  limit = 50,
): SupplierPaymentRow[] {
  return db
    .select({
      id: purchasePayments.id,
      purchaseId: purchasePayments.purchaseId,
      jumlah: purchasePayments.jumlah,
      tanggal: purchasePayments.tanggal,
      keterangan: purchasePayments.keterangan,
    })
    .from(purchasePayments)
    .innerJoin(purchases, eq(purchasePayments.purchaseId, purchases.id))
    .where(eq(purchases.supplierId, supplierId))
    .orderBy(desc(purchasePayments.tanggal), desc(purchasePayments.id))
    .limit(limit)
    .all()
}
