import { ipcMain } from 'electron'
import { and, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems, bonPayments, storeSettings, users } from '../db/schema'
import { checkout, cancelSale, recordBonPayment, type CheckoutInput } from '../kasir'
import { getCurrentUser } from './auth'
import { getMainWindow } from '../index'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

interface CheckoutRendererInput {
  metodePembayaran: 'tunai' | 'bon'
  namaPelanggan: string | null
  dibayar: number | null
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

export function registerKasirIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('kasir:listProducts', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const productRows = db.select().from(products).where(eq(products.isActive, true)).orderBy(products.namaItem).all()
    const unitRows = db.select().from(productUnits).all()
    const tierRows = db.select().from(productPriceTiers).all()

    return productRows.map((product) => ({
      id: product.id,
      kodeItem: product.kodeItem,
      barcode: product.barcode,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaJual: toRupiah(product.hargaJual),
      stok: product.stok,
      productUnits: unitRows
        .filter((unit) => unit.productId === product.id)
        .map((unit) => ({
          id: unit.id,
          satuan: unit.satuan,
          konversi: unit.konversi,
          hargaJual: toRupiah(unit.hargaJual),
        })),
      priceTiers: tierRows
        .filter((tier) => tier.productId === product.id)
        .map((tier) => ({ minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
    }))
  })

  ipcMain.handle('kasir:listSalesToday', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

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
    const user = getCurrentUser()
    if (!user) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const checkoutInput: CheckoutInput = {
      metodePembayaran: input.metodePembayaran,
      namaPelanggan: input.namaPelanggan,
      dibayar: input.dibayar === null ? null : toCents(input.dibayar),
      userId: user.id,
      items: input.items,
    }

    const result = checkout(db, checkoutInput)

    return getReceipt(db, result.saleId, user.name)
  })

  ipcMain.handle('kasir:cancelSale', (_event, saleId: number) => {
    const user = getCurrentUser()
    if (!user) {
      throw new Error('Silakan login terlebih dahulu.')
    }
    cancelSale(db, saleId)
  })

  ipcMain.handle('kasir:getStoreSettings', () => {
    const setting = db.select().from(storeSettings).get()

    return {
      namaToko: setting?.namaToko ?? 'Toko',
      alamat: setting?.alamat ?? null,
      telepon: setting?.telepon ?? null,
      pesanFooter: setting?.pesanFooter ?? null,
    }
  })

  ipcMain.handle('kasir:printReceipt', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const window = getMainWindow()

    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    return new Promise<void>((resolve, reject) => {
      window.webContents.print({ silent: true }, (success, errorType) => {
        if (success) {
          resolve()
        } else {
          reject(new Error(errorType || 'Gagal mencetak struk.'))
        }
      })
    })
  })

  ipcMain.handle('kasir:getReceiptForSale', (_event, saleId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const sale = db.select().from(sales).where(eq(sales.id, saleId)).get()

    if (!sale) {
      throw new Error('Transaksi tidak ditemukan.')
    }

    const kasir = sale.userId ? db.select().from(users).where(eq(users.id, sale.userId)).get() : null

    return getReceipt(db, saleId, kasir?.name ?? null)
  })

  ipcMain.handle(
    'kasir:listSalesHistory',
    (
      _event,
      input: {
        dari?: string
        sampai?: string
        status?: 'selesai' | 'dibatalkan'
        metodePembayaran?: 'tunai' | 'bon'
        search?: string
        page: number
      },
    ) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

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
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

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

    return {
      id: sale.id,
      namaPelanggan: sale.namaPelanggan,
      metodePembayaran: sale.metodePembayaran,
      status: sale.status,
      total: toRupiah(sale.total),
      dibayar: toRupiah(sale.dibayar),
      createdAt: sale.createdAt.toISOString(),
      items: itemRows.map((item) => ({
        id: item.id,
        qty: item.qty,
        satuan: item.satuan,
        namaItem: productNameById.get(item.productId) ?? '',
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
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      recordBonPayment(db, input.saleId, toCents(input.jumlah), input.keterangan)
    },
  )
}
