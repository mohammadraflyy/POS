import { dialog, ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { getMainWindow } from '../index'
import {
  listProducts,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  searchProductsQuick,
  findProductByBarcode,
} from '../inventory'
import {
  getProductDetail,
  addProductUnit,
  updateProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  getBaseProductUnit,
  type ProductUnitRow,
} from '../inventory-units'
import { getProductsByIds, bulkSaveProducts, importProducts, importSatuan, type BulkSaveRow } from '../inventory-bulk'
import { listUnits, createUnit, updateUnit, deactivateUnit } from '../master-satuan'
import { requireAdmin, requireUser } from './auth'

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
    unitId: unit.unitId,
    satuan: unit.unitCode,
    parentUnitId: unit.parentUnitId,
    jumlahKemasan: unit.jumlahKemasan,
    konversi: unit.conversionFactor,
    hargaJual: toRupiah(unit.hargaJual),
    hargaPokok: toRupiah(unit.hargaPokok),
    isBaseUnit: unit.isBaseUnit,
  }
}

export function registerInventoryIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle(
    'inventory:listProducts',
    (_event, input: { search?: string; page: number; pageSize?: number }) => {
      requireUser()

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
      requireAdmin()

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
    requireAdmin()

    deleteProduct(db, id)
  })

  ipcMain.handle('inventory:bulkDeleteProducts', (_event, ids: number[]) => {
    requireAdmin()

    return bulkDeleteProducts(db, ids)
  })

  ipcMain.handle('inventory:searchProducts', (_event, q: string) => {
    requireUser()

    return searchProductsQuick(db, q).map(toDto)
  })

  ipcMain.handle('inventory:findByBarcode', (_event, barcode: string) => {
    requireUser()

    const product = findProductByBarcode(db, barcode)

    return product ? toDto(product) : null
  })

  ipcMain.handle('inventory:getProductDetail', (_event, productId: number) => {
    requireUser()

    const detail = getProductDetail(db, productId)

    return {
      namaItem: detail.namaItem,
      kodeItem: detail.kodeItem,
      units: detail.units.map(toUnitDto),
      priceTiers: detail.priceTiers.map((tier) => ({
        id: tier.id,
        productUnitId: tier.productUnitId,
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        hargaJual: toRupiah(tier.hargaJual),
      })),
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
    'inventory:addProductUnit',
    (_event, productId: number, input: { unitId: number; jumlahKemasan: number; hargaJual: number; hargaPokok?: number; parentUnitId?: number | null }) => {
      requireAdmin()

      addProductUnit(db, productId, {
        unitId: input.unitId,
        jumlahKemasan: input.jumlahKemasan,
        hargaJual: toCents(input.hargaJual),
        hargaPokok: input.hargaPokok === undefined ? undefined : toCents(input.hargaPokok),
        parentUnitId: input.parentUnitId,
      })
    },
  )

  ipcMain.handle(
    'inventory:updateProductUnit',
    (
      _event,
      productId: number,
      unitRowId: number,
      input: { unitId: number; jumlahKemasan: number; hargaJual: number; hargaPokok?: number; parentUnitId?: number | null },
    ) => {
      requireAdmin()

      updateProductUnit(db, productId, unitRowId, {
        unitId: input.unitId,
        jumlahKemasan: input.jumlahKemasan,
        hargaJual: toCents(input.hargaJual),
        hargaPokok: input.hargaPokok === undefined ? undefined : toCents(input.hargaPokok),
        parentUnitId: input.parentUnitId,
      })
    },
  )

  ipcMain.handle('inventory:deleteProductUnit', (_event, productId: number, unitId: number) => {
    requireAdmin()

    deleteProductUnit(db, productId, unitId)
  })

  ipcMain.handle(
    'inventory:addPriceTier',
    (
      _event,
      productId: number,
      input: { minQty: number; maxQty?: number | null; hargaJual: number; productUnitId?: number },
    ) => {
      requireAdmin()

      // The tier form is still product-scoped and open-ended, so an omitted unit
      // means the base one and an omitted maxQty means unbounded - the behaviour
      // tiers have always had. Task 16 adds the per-unit, ranged form.
      const productUnitId = input.productUnitId ?? getBaseProductUnit(db, productId).id

      addPriceTier(db, productId, productUnitId, {
        minQty: input.minQty,
        maxQty: input.maxQty ?? null,
        hargaJual: toCents(input.hargaJual),
      })
    },
  )

  ipcMain.handle('inventory:deletePriceTier', (_event, productId: number, tierId: number) => {
    requireAdmin()

    deletePriceTier(db, productId, tierId)
  })

  ipcMain.handle('inventory:getProductsByIds', (_event, ids: number[]) => {
    requireUser()

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
      const user = requireAdmin()

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

  ipcMain.handle('inventory:importProducts', async () => {
    const user = requireAdmin()

    const window = getMainWindow()
    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return importProducts(db, result.filePaths[0], user.id)
  })

  ipcMain.handle('inventory:importSatuan', async () => {
    requireAdmin()

    const window = getMainWindow()
    if (!window) {
      throw new Error('Jendela aplikasi tidak ditemukan.')
    }

    const result = await dialog.showOpenDialog(window, {
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return importSatuan(db, result.filePaths[0])
  })

  ipcMain.handle('master-satuan:list', () => {
    requireUser()

    return listUnits(db)
  })

  ipcMain.handle('master-satuan:create', (_event, input: { code: string; name: string; symbol: string }) => {
    requireAdmin()

    createUnit(db, input)
  })

  ipcMain.handle(
    'master-satuan:update',
    (_event, id: number, input: { code: string; name: string; symbol: string; isActive: boolean }) => {
      requireAdmin()

      updateUnit(db, id, input)
    },
  )

  ipcMain.handle('master-satuan:deactivate', (_event, id: number) => {
    requireAdmin()

    deactivateUnit(db, id)
  })
}
