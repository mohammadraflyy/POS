import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from '../inventory'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

interface ProductListItemDto {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  hargaPokok: number
  hargaJual: number
  stok: number
  isActive: boolean
}

function toDto(item: ReturnType<typeof searchProductsQuick>[number]): ProductListItemDto {
  return {
    id: item.id,
    kodeItem: item.kodeItem,
    barcode: item.barcode,
    namaItem: item.namaItem,
    categoryName: item.categoryName,
    satuan: item.satuan,
    hargaPokok: toRupiah(item.hargaPokok),
    hargaJual: toRupiah(item.hargaJual),
    stok: item.stok,
    isActive: item.isActive,
  }
}

export function registerInventoryIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle(
    'inventory:listProducts',
    (_event, input: { search?: string; page: number; pageSize?: number }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      const result = listProducts(db, input)

      return {
        data: result.data.map(toDto),
        currentPage: result.currentPage,
        lastPage: result.lastPage,
        total: result.total,
      }
    },
  )

  ipcMain.handle(
    'inventory:updateProduct',
    (
      _event,
      id: number,
      input: {
        kodeItem: string
        barcode: string | null
        namaItem: string
        kategori: string | null
        satuan: string
        hargaPokok: number
        hargaJual: number
        isActive: boolean
      },
    ) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      updateProduct(db, id, {
        kodeItem: input.kodeItem,
        barcode: input.barcode,
        namaItem: input.namaItem,
        kategori: input.kategori,
        satuan: input.satuan,
        hargaPokok: toCents(input.hargaPokok),
        hargaJual: toCents(input.hargaJual),
        isActive: input.isActive,
      })
    },
  )

  ipcMain.handle('inventory:deleteProduct', (_event, id: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteProduct(db, id)
  })

  ipcMain.handle('inventory:bulkDeleteProducts', (_event, ids: number[]) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return bulkDeleteProducts(db, ids)
  })

  ipcMain.handle('inventory:searchProducts', (_event, q: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsQuick(db, q).map(toDto)
  })
}
