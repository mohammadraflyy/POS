import { ipcMain } from 'electron'
import { eq, gte, inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { products, productUnits, productPriceTiers, sales, saleItems } from '../db/schema'
import { checkout, cancelSale, type CheckoutInput } from '../kasir'
import { getCurrentUser } from './auth'

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
    return { saleId: result.saleId, total: toRupiah(result.total) }
  })

  ipcMain.handle('kasir:cancelSale', (_event, saleId: number) => {
    const user = getCurrentUser()
    if (!user) {
      throw new Error('Silakan login terlebih dahulu.')
    }
    cancelSale(db, saleId)
  })
}
