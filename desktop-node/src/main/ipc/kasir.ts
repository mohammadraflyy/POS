import { ipcMain } from 'electron'
import { eq, gte, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems, storeSettings, units, users } from '../db/schema'
import {
  checkout,
  addItemsToSale,
  cancelSale,
  deleteSale,
  getReceipt,
  getSaleDetail,
  listCustomers,
  listSalesHistory,
  recordBonPayment,
  updateStoreSettings,
  purgeSalesBefore,
  purgeTodaySales,
  updateSale,
  type CheckoutInput,
} from '../kasir'
import { buildReceiptEscPos, SAMPLE_RECEIPT, type PaperWidth } from '../escpos'
import { printRaw } from '../print-windows'
import { printReceiptForSale, resolvePrinterName } from '../receipt'
import { requireAdmin, requireUser } from './auth'
import { getMainWindow } from '../index'
import { toRupiah, toCents } from '../money'

interface CheckoutRendererInput {
  metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
  namaPelanggan: string | null
  dibayar: number | null
  tanggal?: string | null
  /** rupiah off the whole bill */
  diskon?: number | null
  /** free note on the sale; optional from the first ring-up */
  keterangan?: string | null
  items: { productId: number; productUnitId: number | null; qty: number; diskon?: number | null }[]
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
        hargaPokok: productUnits.hargaPokok,
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
        // the floor a hand-set price may not go under; the base row mirrors
        // products.hargaPokok, so either source gives the same number
        hargaPokok: toRupiah(baseUnit?.hargaPokok ?? product.hargaPokok),
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
            hargaPokok: toRupiah(unit.hargaPokok),
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
      diskon: input.diskon == null ? null : toCents(input.diskon),
      keterangan: input.keterangan ?? null,
      items: input.items.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        diskon: item.diskon == null ? null : toCents(item.diskon),
      })),
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

  // requireAdmin, not requireUser: rewriting a saved sale shifts the rekap and the cash
  // book on two days at once, the same blast radius as delete and purge.
  ipcMain.handle('kasir:getSaleForEdit', (_event, saleId: number) => {
    requireAdmin()

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const itemRows = db.select().from(saleItems).where(eq(saleItems.saleId, saleId)).all()

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      diskon: toRupiah(sale.diskon),
      dibayar: toRupiah(sale.dibayar),
      keterangan: sale.keterangan,
      createdAt: sale.createdAt.toISOString(),
      items: itemRows.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        hargaJual: toRupiah(item.hargaJual),
        diskon: toRupiah(item.diskon),
        priceSource: item.priceSource,
      })),
    }
  })

  ipcMain.handle(
    'kasir:updateSale',
    (
      _event,
      input: {
        saleId: number
        metodePembayaran: 'tunai' | 'bon' | 'qris' | 'transfer'
        namaPelanggan: string | null
        dibayar: number | null
        tanggal: string
        diskon?: number | null
        keterangan?: string | null
        items: {
          productId: number
          productUnitId: number | null
          qty: number
          hargaJual?: number | null
          diskon?: number | null
        }[]
      },
    ) => {
      const admin = requireAdmin()

      const result = updateSale(db, input.saleId, {
        metodePembayaran: input.metodePembayaran,
        namaPelanggan: input.namaPelanggan,
        dibayar: input.dibayar === null ? null : toCents(input.dibayar),
        tanggal: input.tanggal,
        diskon: input.diskon == null ? null : toCents(input.diskon),
        keterangan: input.keterangan ?? null,
        userId: admin.id,
        items: input.items.map((item) => ({
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: item.qty,
          hargaJual: item.hargaJual == null ? null : toCents(item.hargaJual),
          diskon: item.diskon == null ? null : toCents(item.diskon),
        })),
      })

      return { total: toRupiah(result.total) }
    },
  )

  ipcMain.handle('kasir:getStoreSettings', () => {
    const setting = db.select().from(storeSettings).get()

    return {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
      printerName: setting?.printerName ?? null,
      receiptWidth: setting?.receiptWidth ?? '58mm',
      marginMinimalPersen: setting?.marginMinimalPersen ?? 10,
    }
  })

  ipcMain.handle('kasir:printReceipt', async (_event, saleId: number) => {
    requireUser()

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const kasir = sale.userId ? db.select().from(users).where(eq(users.id, sale.userId)).get() : null
    await printReceiptForSale(db, saleId, kasir?.name ?? null)
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

      const result = listSalesHistory(db, input)

      return {
        data: result.data.map((sale) => ({
          id: sale.id,
          createdAt: sale.createdAt.toISOString(),
          namaPelanggan: sale.namaPelanggan,
          metodePembayaran: sale.metodePembayaran,
          status: sale.status,
          total: toRupiah(sale.total),
          dibayar: toRupiah(sale.dibayar),
          laba: toRupiah(sale.laba),
          items: sale.items,
        })),
        currentPage: result.currentPage,
        lastPage: result.lastPage,
        total: result.total,
      }
    },
  )

  ipcMain.handle('kasir:getSaleDetail', (_event, saleId: number) => {
    requireUser()

    const detail = getSaleDetail(db, saleId)

    return {
      id: detail.id,
      namaPelanggan: detail.namaPelanggan,
      metodePembayaran: detail.metodePembayaran,
      status: detail.status,
      diskon: toRupiah(detail.diskon),
      total: toRupiah(detail.total),
      dibayar: toRupiah(detail.dibayar),
      keterangan: detail.keterangan,
      createdAt: detail.createdAt.toISOString(),
      kasirName: detail.kasirName,
      modal: toRupiah(detail.modal),
      laba: toRupiah(detail.laba),
      items: detail.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        satuan: item.satuan,
        namaItem: item.namaItem,
        hargaJual: toRupiah(item.hargaJual),
        diskon: toRupiah(item.diskon),
        subtotal: toRupiah(item.subtotal),
        priceSource: item.priceSource,
      })),
      bonPayments: detail.bonPayments.map((payment) => ({
        id: payment.id,
        jumlah: toRupiah(payment.jumlah),
        tanggal: payment.tanggal,
        keterangan: payment.keterangan,
      })),
      edits: detail.edits.map((row) => ({
        id: row.id,
        keterangan: row.keterangan,
        kasirName: row.kasirName,
        totalSebelum: toRupiah(row.totalSebelum),
        totalSesudah: toRupiah(row.totalSesudah),
        createdAt: row.createdAt.toISOString(),
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
        marginMinimalPersen?: number
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
