import { ipcMain } from 'electron'
import { and, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments, storeSettings, units, users } from '../db/schema'
import {
  checkout,
  addItemsToSale,
  cancelSale,
  deleteSale,
  listCustomers,
  recordBonPayment,
  updateStoreSettings,
  purgeSalesBefore,
  purgeTodaySales,
  updateSaleDate,
  type CheckoutInput,
} from '../kasir'
import { buildReceiptEscPos, SAMPLE_RECEIPT, type PaperWidth } from '../escpos'
import { printRaw } from '../print-windows'
import { requireAdmin, requireUser } from './auth'
import { getMainWindow } from '../index'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

interface CheckoutRendererInput {
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  namaPelanggan: string | null
  dibayar: number | null
  tanggal?: string | null
  items: { productId: number; productUnitId: number | null; qty: number }[]
}

function getReceipt(db: BetterSQLite3Database<typeof schema>, saleId: number, kasirName: string | null) {
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
      subtotal: toRupiah(item.subtotal),
    })),
  }
}

async function resolvePrinterName(savedName: string | null): Promise<string> {
  if (savedName) {
    return savedName
  }

  const window = getMainWindow()

  if (!window) {
    throw new Error('Jendela aplikasi tidak ditemukan.')
  }

  const printers = await window.webContents.getPrintersAsync()
  const defaultPrinter = printers.find((printer) => printer.isDefault)

  if (!defaultPrinter) {
    throw new Error('Tidak ada printer default. Pilih printer di Pengaturan.')
  }

  return defaultPrinter.name
}

export function registerKasirIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('kasir:listProducts', () => {
    requireUser()

    const productRows = db.select().from(products).where(eq(products.isActive, true)).orderBy(products.namaItem).all()
    const unitRows = db
      .select({
        id: productUnits.id,
        productId: productUnits.productId,
        satuan: units.code,
        konversi: productUnits.conversionFactor,
        hargaJual: productUnits.hargaJual,
        isBaseUnit: productUnits.isBaseUnit,
      })
      .from(productUnits)
      .innerJoin(units, eq(productUnits.unitId, units.id))
      .all()
    const tierRows = db.select().from(productPriceTiers).all()

    return productRows.map((product) => {
      // products.satuan is gone - the base-unit product_units row carries the label now
      const baseUnit = unitRows.find((unit) => unit.productId === product.id && unit.isBaseUnit)

      return {
        id: product.id,
        kodeItem: product.kodeItem,
        barcode: product.barcode,
        namaItem: product.namaItem,
        satuan: baseUnit?.satuan ?? '',
        hargaJual: toRupiah(product.hargaJual),
        stok: product.stok,
        // the cart says "base unit" as productUnitId: null, but tiers name real
        // product_units rows, so the renderer needs the base row's id to match them
        baseProductUnitId: baseUnit?.id ?? 0,
        // the base unit stays out of this list: the renderer still treats
        // productUnitId === null as "base unit", so listing it here would show
        // the same satuan twice. Revisit in Task 10's cart-logic rewrite.
        productUnits: unitRows
          .filter((unit) => unit.productId === product.id && !unit.isBaseUnit)
          .map((unit) => ({
            id: unit.id,
            satuan: unit.satuan,
            konversi: unit.konversi,
            hargaJual: toRupiah(unit.hargaJual),
          })),
        priceTiers: tierRows
          .filter((tier) => tier.productId === product.id)
          .map((tier) => ({
            productUnitId: tier.productUnitId,
            minQty: tier.minQty,
            maxQty: tier.maxQty,
            hargaJual: toRupiah(tier.hargaJual),
          })),
      }
    })
  })

  ipcMain.handle('kasir:listCustomers', () => {
    requireUser()

    return listCustomers(db)
  })

  ipcMain.handle('kasir:listSalesToday', () => {
    requireUser()

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const saleRows = db.select().from(sales).where(gte(sales.createdAt, startOfDay)).all()
    const saleIds = saleRows.map((sale) => sale.id)
    const itemRows = saleIds.length > 0 ? db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds)).all() : []

    return saleRows
      .map((sale) => ({
        id: sale.id,
        namaPelanggan: sale.namaPelanggan,
        metodePembayaran: sale.metodePembayaran,
        status: sale.status,
        total: toRupiah(sale.total),
        dibayar: toRupiah(sale.dibayar),
        items: itemRows
          .filter((item) => item.saleId === sale.id)
          .map((item) => ({
            productId: item.productId,
            qty: item.qty,
            satuan: item.satuan,
            hargaJual: toRupiah(item.hargaJual),
            subtotal: toRupiah(item.subtotal),
          })),
      }))
      .sort((a, b) => b.id - a.id)
  })

  ipcMain.handle('kasir:checkout', (_event, input: CheckoutRendererInput) => {
    const user = requireUser()

    const checkoutInput: CheckoutInput = {
      metodePembayaran: input.metodePembayaran,
      namaPelanggan: input.namaPelanggan,
      dibayar: input.dibayar === null ? null : toCents(input.dibayar),
      userId: user.id,
      tanggal: input.tanggal ?? null,
      items: input.items,
    }

    const result = checkout(db, checkoutInput)

    return getReceipt(db, result.saleId, user.name)
  })

  ipcMain.handle('kasir:cancelSale', (_event, saleId: number) => {
    requireAdmin()

    cancelSale(db, saleId)
  })

  ipcMain.handle('kasir:deleteSale', (_event, saleId: number) => {
    requireAdmin()

    deleteSale(db, saleId)
  })

  // requireAdmin, not requireUser: redating a saved sale shifts the rekap and the cash
  // book on two days at once, the same blast radius as delete and purge.
  ipcMain.handle('kasir:updateSaleDate', (_event, input: { saleId: number; tanggal: string }) => {
    requireAdmin()

    updateSaleDate(db, input.saleId, input.tanggal)
  })

  ipcMain.handle('kasir:getStoreSettings', () => {
    const setting = db.select().from(storeSettings).get()

    return {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
      printerName: setting?.printerName ?? null,
      receiptWidth: setting?.receiptWidth ?? '58mm',
    }
  })

  ipcMain.handle('kasir:printReceipt', async (_event, saleId: number) => {
    requireUser()

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const kasir = sale.userId ? db.select().from(users).where(eq(users.id, sale.userId)).get() : null
    const receipt = getReceipt(db, saleId, kasir?.name ?? null)

    const setting = db.select().from(storeSettings).get()
    const storeInfo = {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
    const paperWidth: PaperWidth = setting?.receiptWidth ?? '58mm'

    const bytes = buildReceiptEscPos(receipt, storeInfo, paperWidth)
    const printerName = await resolvePrinterName(setting?.printerName ?? null)
    await printRaw(printerName, bytes)
  })

  ipcMain.handle('kasir:listPrinters', async () => {
    requireUser()

    const window = getMainWindow()

    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const printers = await window.webContents.getPrintersAsync()
    return printers.map((printer) => ({ name: printer.name, displayName: printer.displayName, isDefault: printer.isDefault }))
  })

  ipcMain.handle('kasir:testPrint', async () => {
    requireUser()

    const setting = db.select().from(storeSettings).get()
    const storeInfo = {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
    const paperWidth: PaperWidth = setting?.receiptWidth ?? '58mm'

    const bytes = buildReceiptEscPos(SAMPLE_RECEIPT, storeInfo, paperWidth)
    const printerName = await resolvePrinterName(setting?.printerName ?? null)
    await printRaw(printerName, bytes)
  })

  ipcMain.handle(
    'kasir:listSalesHistory',
    (
      _event,
      input: {
        dari?: string
        sampai?: string
        status?: 'selesai' | 'dibatalkan'
        metodePembayaran?: 'tunai' | 'bon' | 'qris' | 'transfer'
        search?: string
        page: number
      },
    ) => {
      requireUser()

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
        data: saleRows.map((sale) => ({
          id: sale.id,
          createdAt: sale.createdAt.toISOString(),
          namaPelanggan: sale.namaPelanggan,
          metodePembayaran: sale.metodePembayaran,
          status: sale.status,
          total: toRupiah(sale.total),
          dibayar: toRupiah(sale.dibayar),
          items: itemRows
            .filter((item) => item.saleId === sale.id)
            .map((item) => ({ namaItem: productNameById.get(item.productId) ?? '', qty: item.qty })),
        })),
        currentPage: page,
        lastPage,
        total,
      }
    },
  )

  ipcMain.handle('kasir:getSaleDetail', (_event, saleId: number) => {
    requireUser()

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

    const kasir = sale.userId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, sale.userId)).get()
      : null

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      total: toRupiah(sale.total),
      dibayar: toRupiah(sale.dibayar),
      createdAt: sale.createdAt.toISOString(),
      kasirName: kasir?.name ?? null,
      items: itemRows.map((item) => ({
        id: item.id,
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        satuan: item.satuan,
        namaItem: productNameById.get(item.productId) ?? '',
        hargaJual: toRupiah(item.hargaJual),
        subtotal: toRupiah(item.subtotal),
        priceSource: item.priceSource,
      })),
      bonPayments: paymentRows.map((payment) => ({
        id: payment.id,
        jumlah: toRupiah(payment.jumlah),
        tanggal: payment.tanggal,
        keterangan: payment.keterangan,
      })),
    }
  })

  ipcMain.handle(
    'kasir:recordBonPayment',
    (_event, input: { saleId: number; jumlah: number; keterangan: string | null }) => {
      requireUser()

      recordBonPayment(db, input.saleId, toCents(input.jumlah), input.keterangan)
    },
  )

  ipcMain.handle(
    'kasir:addItemsToSale',
    (_event, input: { saleId: number; items: { productId: number; productUnitId: number | null; qty: number }[] }) => {
      requireUser()

      const result = addItemsToSale(db, input.saleId, input.items)

      return { total: toRupiah(result.total) }
    },
  )

  ipcMain.handle(
    'kasir:updateStoreSettings',
    (
      _event,
      input: {
        namaToko: string
        alamat: string | null
        telepon: string | null
        pesanFooter: string | null
        printerName: string | null
        receiptWidth: '58mm' | '80mm'
      },
    ) => {
      requireAdmin()

      updateStoreSettings(db, input)
    },
  )

  ipcMain.handle('kasir:purgeSalesBefore', (_event, before: string) => {
    requireAdmin()

    const deleted = purgeSalesBefore(db, new Date(`${before}T00:00:00`))
    return { deleted }
  })

  ipcMain.handle('kasir:purgeTodaySales', () => {
    requireAdmin()

    return purgeTodaySales(db)
  })
}
