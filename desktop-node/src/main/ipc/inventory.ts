import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from '../inventory'
import {
  getProductDetail,
  setProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  type ProductUnitRow,
} from '../inventory-units'
import { getProductsByIds, bulkSaveProducts, type BulkSaveRow } from '../inventory-bulk'
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
  unitsCount: number
  priceTiersCount: number
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
    unitsCount: item.unitsCount,
    priceTiersCount: item.priceTiersCount,
  }
}

function toUnitDto(unit: ProductUnitRow) {
  return {
    id: unit.id,
    level: unit.level,
    satuan: unit.satuan,
    jumlahKemasan: unit.jumlahKemasan,
    konversi: unit.konversi,
    hargaJual: toRupiah(unit.hargaJual),
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

  ipcMain.handle('inventory:getProductDetail', (_event, productId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const detail = getProductDetail(db, productId)

    return {
      units: {
        level2: detail.units.level2 ? toUnitDto(detail.units.level2) : null,
        level3: detail.units.level3 ? toUnitDto(detail.units.level3) : null,
      },
      priceTiers: detail.priceTiers.map((tier) => ({ id: tier.id, minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
      priceHistory: detail.priceHistory.map((entry) => ({
        id: entry.id,
        hargaPokokLama: toRupiah(entry.hargaPokokLama),
        hargaPokokBaru: toRupiah(entry.hargaPokokBaru),
        hargaJualLama: toRupiah(entry.hargaJualLama),
        hargaJualBaru: toRupiah(entry.hargaJualBaru),
        createdAt: entry.createdAt.toISOString(),
        userName: entry.userName,
      })),
    }
  })

  ipcMain.handle(
    'inventory:setProductUnit',
    (_event, productId: number, level: 2 | 3, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      setProductUnit(db, productId, level, {
        satuan: input.satuan,
        jumlahKemasan: input.jumlahKemasan,
        hargaJual: toCents(input.hargaJual),
      })
    },
  )

  ipcMain.handle('inventory:deleteProductUnit', (_event, productId: number, level: 2 | 3) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteProductUnit(db, productId, level)
  })

  ipcMain.handle('inventory:addPriceTier', (_event, productId: number, input: { minQty: number; hargaJual: number }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    addPriceTier(db, productId, { minQty: input.minQty, hargaJual: toCents(input.hargaJual) })
  })

  ipcMain.handle('inventory:deletePriceTier', (_event, productId: number, tierId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deletePriceTier(db, productId, tierId)
  })

  ipcMain.handle('inventory:getProductsByIds', (_event, ids: number[]) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return getProductsByIds(db, ids).map((p) => ({
      id: p.id,
      kodeItem: p.kodeItem,
      barcode: p.barcode,
      namaItem: p.namaItem,
      categoryName: p.categoryName,
      satuan: p.satuan,
      hargaPokok: toRupiah(p.hargaPokok),
      hargaJual: toRupiah(p.hargaJual),
      stok: p.stok,
      unitsCount: p.unitsCount,
      priceTiersCount: p.priceTiersCount,
    }))
  })

  ipcMain.handle(
    'inventory:bulkSaveProducts',
    (
      _event,
      rows: {
        key: string
        id: number | null
        kodeItem: string
        barcode: string | null
        namaItem: string
        kategori: string | null
        satuan: string
        hargaPokok: number
        hargaJual: number
        stok: number
      }[],
    ) => {
      const user = getCurrentUser()
      if (!user) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      const bulkRows: BulkSaveRow[] = rows.map((row) => ({
        key: row.key,
        id: row.id,
        kodeItem: row.kodeItem,
        barcode: row.barcode,
        namaItem: row.namaItem,
        kategori: row.kategori,
        satuan: row.satuan,
        hargaPokok: toCents(row.hargaPokok),
        hargaJual: toCents(row.hargaJual),
        stok: row.stok,
      }))

      return bulkSaveProducts(db, bulkRows, user.id)
    },
  )
}
