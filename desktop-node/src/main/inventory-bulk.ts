import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as XLSX from 'xlsx'
import * as schema from './db/schema'
import { categories, products, productPriceHistories, productUnits, productPriceTiers, stockAdjustments } from './db/schema'

type Db = BetterSQLite3Database<typeof schema>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never
type DbOrTx = Db | Tx

export interface BulkSaveRow {
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
}

export interface ProductForBulkEdit {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  hargaPokok: number
  hargaJual: number
  stok: number
  unitsCount: number
  priceTiersCount: number
}

export function getProductsByIds(db: Db, ids: number[]): ProductForBulkEdit[] {
  if (ids.length === 0) {
    return []
  }

  return db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      barcode: products.barcode,
      namaItem: products.namaItem,
      categoryName: categories.nama,
      satuan: products.satuan,
      hargaPokok: products.hargaPokok,
      hargaJual: products.hargaJual,
      stok: products.stok,
      unitsCount: sql<number>`(SELECT COUNT(*) FROM ${productUnits} WHERE ${productUnits.productId} = ${products.id})`,
      priceTiersCount: sql<number>`(SELECT COUNT(*) FROM ${productPriceTiers} WHERE ${productPriceTiers.productId} = ${products.id})`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(inArray(products.id, ids))
    .orderBy(products.namaItem)
    .all()
}

function findKodeItemCollision(db: DbOrTx, kodeItem: string, excludeId: number | null) {
  const condition =
    excludeId !== null ? and(eq(products.kodeItem, kodeItem), ne(products.id, excludeId)) : eq(products.kodeItem, kodeItem)
  return db.select({ id: products.id }).from(products).where(condition).get()
}

function findBarcodeCollision(db: DbOrTx, barcode: string, excludeId: number | null) {
  const condition =
    excludeId !== null ? and(eq(products.barcode, barcode), ne(products.id, excludeId)) : eq(products.barcode, barcode)
  return db.select({ id: products.id }).from(products).where(condition).get()
}

export function validateBulkRows(db: DbOrTx, rows: BulkSaveRow[]): Record<string, Record<string, string>> {
  const errors: Record<string, Record<string, string>> = {}

  function addError(key: string, field: string, message: string) {
    errors[key] = { ...(errors[key] ?? {}), [field]: message }
  }

  for (const row of rows) {
    if (!row.kodeItem.trim()) {
      addError(row.key, 'kodeItem', 'Kode item wajib diisi.')
    } else if (row.kodeItem.length > 50) {
      addError(row.key, 'kodeItem', 'Kode item maksimal 50 karakter.')
    }

    if (!row.namaItem.trim()) {
      addError(row.key, 'namaItem', 'Nama item wajib diisi.')
    } else if (row.namaItem.length > 255) {
      addError(row.key, 'namaItem', 'Nama item maksimal 255 karakter.')
    }

    if (!row.satuan.trim()) {
      addError(row.key, 'satuan', 'Satuan wajib diisi.')
    } else if (row.satuan.length > 20) {
      addError(row.key, 'satuan', 'Satuan maksimal 20 karakter.')
    }

    if (row.barcode && row.barcode.length > 100) {
      addError(row.key, 'barcode', 'Barcode maksimal 100 karakter.')
    }

    if (row.kategori && row.kategori.length > 255) {
      addError(row.key, 'kategori', 'Kategori maksimal 255 karakter.')
    }

    if (!Number.isFinite(row.hargaPokok)) {
      addError(row.key, 'hargaPokok', 'Harga pokok wajib diisi.')
    } else if (row.hargaPokok < 0) {
      addError(row.key, 'hargaPokok', 'Harga pokok tidak boleh negatif.')
    }

    if (!Number.isFinite(row.hargaJual)) {
      addError(row.key, 'hargaJual', 'Harga jual wajib diisi.')
    } else if (row.hargaJual < 0) {
      addError(row.key, 'hargaJual', 'Harga jual tidak boleh negatif.')
    }
  }

  const byKodeItem = new Map<string, string[]>()
  for (const row of rows) {
    const kode = row.kodeItem.trim()
    if (!kode) continue
    byKodeItem.set(kode, [...(byKodeItem.get(kode) ?? []), row.key])
  }
  for (const keys of byKodeItem.values()) {
    if (keys.length > 1) {
      for (const key of keys) {
        addError(key, 'kodeItem', 'Kode item duplikat pada baris ini.')
      }
    }
  }

  const byBarcode = new Map<string, string[]>()
  for (const row of rows) {
    const barcode = row.barcode?.trim()
    if (!barcode) continue
    byBarcode.set(barcode, [...(byBarcode.get(barcode) ?? []), row.key])
  }
  for (const keys of byBarcode.values()) {
    if (keys.length > 1) {
      for (const key of keys) {
        addError(key, 'barcode', 'Barcode duplikat pada baris ini.')
      }
    }
  }

  for (const row of rows) {
    const kode = row.kodeItem.trim()
    if (kode && !errors[row.key]?.kodeItem) {
      if (findKodeItemCollision(db, kode, row.id)) {
        addError(row.key, 'kodeItem', 'Kode item sudah digunakan.')
      }
    }

    const barcode = row.barcode?.trim()
    if (barcode && !errors[row.key]?.barcode) {
      if (findBarcodeCollision(db, barcode, row.id)) {
        addError(row.key, 'barcode', 'Barcode sudah digunakan.')
      }
    }
  }

  return errors
}

export interface SaveProductRowsOptions {
  updateStok: boolean
  userId: number | null
}

export interface SaveProductRowsResult {
  created: number
  updated: number
  unchanged: number
}

export function saveProductRows(db: DbOrTx, rows: BulkSaveRow[], options: SaveProductRowsOptions): SaveProductRowsResult {
  let created = 0
  let updated = 0
  let unchanged = 0
  const now = new Date()

  for (const row of rows) {
    let categoryId: number | null = null
    const kategori = row.kategori?.trim()

    if (kategori) {
      const existing = db.select().from(categories).where(eq(categories.nama, kategori)).get()
      if (existing) {
        categoryId = existing.id
      } else {
        const createdCategory = db.insert(categories).values({ nama: kategori, createdAt: now, updatedAt: now }).returning().get()
        categoryId = createdCategory.id
      }
    }

    if (row.id !== null) {
      const existingProduct = db.select().from(products).where(eq(products.id, row.id)).get()
      if (!existingProduct) {
        continue
      }

      const changed =
        existingProduct.kodeItem !== row.kodeItem ||
        existingProduct.barcode !== row.barcode ||
        existingProduct.namaItem !== row.namaItem ||
        existingProduct.categoryId !== categoryId ||
        existingProduct.satuan !== row.satuan ||
        existingProduct.hargaPokok !== row.hargaPokok ||
        existingProduct.hargaJual !== row.hargaJual ||
        (options.updateStok && existingProduct.stok !== row.stok)

      if (!changed) {
        unchanged++
        continue
      }

      db.update(products)
        .set({
          kodeItem: row.kodeItem,
          barcode: row.barcode,
          namaItem: row.namaItem,
          categoryId,
          satuan: row.satuan,
          hargaPokok: row.hargaPokok,
          hargaJual: row.hargaJual,
          ...(options.updateStok ? { stok: row.stok } : {}),
        })
        .where(eq(products.id, row.id))
        .run()

      updated++

      if (existingProduct.hargaPokok !== row.hargaPokok || existingProduct.hargaJual !== row.hargaJual) {
        db.insert(productPriceHistories)
          .values({
            productId: row.id,
            userId: options.userId,
            hargaPokokLama: existingProduct.hargaPokok,
            hargaPokokBaru: row.hargaPokok,
            hargaJualLama: existingProduct.hargaJual,
            hargaJualBaru: row.hargaJual,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      }

      if (options.updateStok && existingProduct.stok !== row.stok) {
        db.insert(stockAdjustments)
          .values({
            productId: row.id,
            userId: options.userId,
            stokSebelum: existingProduct.stok,
            stokSesudah: row.stok,
            selisih: row.stok - existingProduct.stok,
            alasan: 'Import Excel',
            tanggal: now.toISOString().slice(0, 10),
            createdAt: now,
            updatedAt: now,
          })
          .run()
      }
    } else {
      db.insert(products)
        .values({
          kodeItem: row.kodeItem,
          barcode: row.barcode,
          namaItem: row.namaItem,
          categoryId,
          satuan: row.satuan,
          hargaPokok: row.hargaPokok,
          hargaJual: row.hargaJual,
          stok: row.stok,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      created++
    }
  }

  return { created, updated, unchanged }
}

export type BulkSaveResult =
  | { success: true; created: number; updated: number; unchanged: number }
  | { success: false; rowErrors: Record<string, Record<string, string>> }

export function bulkSaveProducts(db: Db, rows: BulkSaveRow[], userId: number | null): BulkSaveResult {
  const rowErrors = validateBulkRows(db, rows)

  if (Object.keys(rowErrors).length > 0) {
    return { success: false, rowErrors }
  }

  const result = db.transaction((tx) => saveProductRows(tx, rows, { updateStok: false, userId }))

  return { success: true, ...result }
}

const IMPORT_COLUMN_LABELS: Record<string, string[]> = {
  kodeItem: ['kode item'],
  barcode: ['kode barcode', 'barcode'],
  namaItem: ['nama item'],
  kategori: ['jenis', 'kategori'],
  satuan: ['satuan'],
  hargaPokok: ['harga beli', 'harga pokok'],
  hargaJual: ['harga jual'],
  stok: ['stok'],
}

const IMPORT_REQUIRED_COLUMNS = ['kodeItem', 'namaItem', 'satuan', 'hargaPokok', 'hargaJual']

function resolveImportColumns(sheetRow: unknown[]): Record<string, number> | null {
  const found: Record<string, number> = {}

  sheetRow.forEach((cell, index) => {
    const text = String(cell ?? '').trim().toLowerCase()
    if (!text) {
      return
    }

    for (const [field, labels] of Object.entries(IMPORT_COLUMN_LABELS)) {
      if (!(field in found) && labels.includes(text)) {
        found[field] = index
      }
    }
  })

  const hasAllRequired = IMPORT_REQUIRED_COLUMNS.every((field) => field in found)
  return hasAllRequired ? found : null
}

function parseImportNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const clean = String(value ?? '').replace(/[, ]/g, '')
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface ImportResult {
  created: number
  updated: number
  unchanged: number
  skipped: number
}

export function importProducts(db: Db, filePath: string, userId: number | null): ImportResult {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    return { created: 0, updated: 0, unchanged: 0, skipped: 0 }
  }

  const sheet = workbook.Sheets[sheetName]
  const sheetRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  let columns: Record<string, number> | null = null
  let headerIndex = -1

  for (let i = 0; i < sheetRows.length; i++) {
    const resolved = resolveImportColumns(sheetRows[i])
    if (resolved) {
      columns = resolved
      headerIndex = i
      break
    }
  }

  if (!columns) {
    return { created: 0, updated: 0, unchanged: 0, skipped: 0 }
  }

  const resolvedColumns = columns
  const dataRows = sheetRows.slice(headerIndex + 1)

  const existingByKodeItem = new Map<string, number>()
  for (const product of db.select({ id: products.id, kodeItem: products.kodeItem }).from(products).all()) {
    existingByKodeItem.set(product.kodeItem, product.id)
  }

  const rows: BulkSaveRow[] = []
  const seenInFile = new Set<string>()
  let skipped = 0

  for (const sheetRow of dataRows) {
    const kodeItem = String(sheetRow[resolvedColumns.kodeItem] ?? '').trim()

    if (!kodeItem) {
      continue
    }

    if (seenInFile.has(kodeItem)) {
      skipped++
      continue
    }

    const namaItem = String(sheetRow[resolvedColumns.namaItem] ?? '').trim()
    const satuan = String(sheetRow[resolvedColumns.satuan] ?? '').trim()

    if (!namaItem || !satuan) {
      skipped++
      continue
    }

    const barcodeRaw = resolvedColumns.barcode !== undefined ? String(sheetRow[resolvedColumns.barcode] ?? '').trim() : ''
    const kategoriRaw = resolvedColumns.kategori !== undefined ? String(sheetRow[resolvedColumns.kategori] ?? '').trim() : ''
    const hargaPokok = parseImportNumber(sheetRow[resolvedColumns.hargaPokok])
    const hargaJual = parseImportNumber(sheetRow[resolvedColumns.hargaJual])
    const stok = resolvedColumns.stok !== undefined ? Math.trunc(parseImportNumber(sheetRow[resolvedColumns.stok])) : 0

    if (hargaPokok < 0 || hargaJual < 0 || stok < 0 || namaItem.length > 255 || satuan.length > 20 || kodeItem.length > 50) {
      skipped++
      continue
    }

    seenInFile.add(kodeItem)

    rows.push({
      key: `import-${kodeItem}`,
      id: existingByKodeItem.get(kodeItem) ?? null,
      kodeItem,
      barcode: barcodeRaw || null,
      namaItem,
      kategori: kategoriRaw || null,
      satuan,
      hargaPokok: Math.round(hargaPokok * 100),
      hargaJual: Math.round(hargaJual * 100),
      stok,
    })
  }

  let created = 0
  let updated = 0
  let unchanged = 0

  db.transaction((tx) => {
    for (const row of rows) {
      try {
        const result = saveProductRows(tx, [row], { updateStok: true, userId })
        created += result.created
        updated += result.updated
        unchanged += result.unchanged
      } catch {
        skipped++
      }
    }
  })

  return { created, updated, unchanged, skipped }
}
