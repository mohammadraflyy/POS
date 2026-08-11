import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import XLSX from 'xlsx'
import * as schema from './db/schema'
import { categories, products, productPriceHistories, productUnits, productPriceTiers, stockAdjustments, units } from './db/schema'
import { getBaseUnitCode, syncBaseProductUnit } from './inventory-units'
import { resolveOrCreateUnit } from './master-satuan'

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
      satuan: units.code,
      hargaPokok: products.hargaPokok,
      hargaJual: products.hargaJual,
      stok: products.stok,
      unitsCount: sql<number>`(SELECT COUNT(*) FROM ${productUnits} WHERE ${productUnits.productId} = ${products.id} AND ${productUnits.isBaseUnit} = 0)`,
      priceTiersCount: sql<number>`(SELECT COUNT(*) FROM ${productPriceTiers} WHERE ${productPriceTiers.productId} = ${products.id})`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(productUnits, and(eq(productUnits.productId, products.id), eq(productUnits.isBaseUnit, true)))
    .leftJoin(units, eq(productUnits.unitId, units.id))
    .where(inArray(products.id, ids))
    .orderBy(products.namaItem)
    .all()
    .map((row) => ({ ...row, satuan: row.satuan ?? '' }))
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

    if (!Number.isInteger(row.stok) || row.stok < 0) {
      addError(row.key, 'stok', 'Stok harus bilangan bulat dan tidak boleh negatif.')
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
        // satuan lives on the base unit row now, and is compared by normalized
        // code so a case-only difference is not counted as a change
        getBaseUnitCode(db, row.id) !== row.satuan.trim().toUpperCase() ||
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
          hargaPokok: row.hargaPokok,
          hargaJual: row.hargaJual,
          ...(options.updateStok ? { stok: row.stok } : {}),
        })
        .where(eq(products.id, row.id))
        .run()

      syncBaseProductUnit(db, row.id, row.satuan, row.hargaJual)

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
      const createdProduct = db
        .insert(products)
        .values({
          kodeItem: row.kodeItem,
          barcode: row.barcode,
          namaItem: row.namaItem,
          categoryId,
          hargaPokok: row.hargaPokok,
          hargaJual: row.hargaJual,
          stok: row.stok,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()

      // a product is not usable without its base unit row - checkout, purchase
      // and every report resolve their satuan through it
      syncBaseProductUnit(db, createdProduct.id, row.satuan, row.hargaJual)

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

function parseImportNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  const clean = String(value ?? '').replace(/[, ]/g, '')

  if (clean === '') {
    return 0
  }

  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : null
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
    const stok = resolvedColumns.stok !== undefined ? Math.trunc(parseImportNumber(sheetRow[resolvedColumns.stok]) ?? 0) : 0

    if (
      hargaPokok === null ||
      hargaJual === null ||
      hargaPokok < 0 ||
      hargaJual < 0 ||
      stok < 0 ||
      namaItem.length > 255 ||
      satuan.length > 20 ||
      kodeItem.length > 50
    ) {
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

const IMPORT_SATUAN_COLUMN_LABELS: Record<string, string[]> = {
  kodeItem: ['kode item'],
  satuan: ['satuan'],
  jumlahKemasan: ['qty/paket', 'qty per paket'],
  hargaJual: ['harga jual'],
}

const IMPORT_SATUAN_REQUIRED_COLUMNS = ['kodeItem', 'satuan', 'jumlahKemasan', 'hargaJual']

function resolveImportSatuanColumns(sheetRow: unknown[]): Record<string, number> | null {
  const found: Record<string, number> = {}

  sheetRow.forEach((cell, index) => {
    const text = String(cell ?? '').trim().toLowerCase()
    if (!text) {
      return
    }

    for (const [field, labels] of Object.entries(IMPORT_SATUAN_COLUMN_LABELS)) {
      if (!(field in found) && labels.includes(text)) {
        found[field] = index
      }
    }
  })

  const hasAllRequired = IMPORT_SATUAN_REQUIRED_COLUMNS.every((field) => field in found)
  return hasAllRequired ? found : null
}

export interface ImportSatuanResult {
  produkDiperbarui: number
  satuanDitambahkan: number
  dilewatiTidakDitemukan: number
  dilewatiSatuanTidakCocok: number
  dilewatiRantaiTidakValid: number
}

const EMPTY_IMPORT_SATUAN_RESULT: ImportSatuanResult = {
  produkDiperbarui: 0,
  satuanDitambahkan: 0,
  dilewatiTidakDitemukan: 0,
  dilewatiSatuanTidakCocok: 0,
  dilewatiRantaiTidakValid: 0,
}

interface SatuanFileRow {
  satuan: string
  jumlahKemasan: number
  relatifKe: string
  hargaJual: number
}

/**
 * Reads a report-style spreadsheet (a legacy POS's "DAFTAR ITEM" export: a title block,
 * then a header row, then one or more rows per product - one per satuan tier, each row
 * naming which other satuan its `jumlahKemasan` is relative to via the unlabeled column
 * immediately after "Qty/Paket"). Matches products by kodeItem only - never creates new
 * products, only fills in `product_units` (derived satuan) for products that already exist.
 */
export function importSatuan(db: Db, filePath: string): ImportSatuanResult {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    return EMPTY_IMPORT_SATUAN_RESULT
  }

  const sheet = workbook.Sheets[sheetName]
  const sheetRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  let columns: Record<string, number> | null = null
  let headerIndex = -1

  for (let i = 0; i < sheetRows.length; i++) {
    const resolved = resolveImportSatuanColumns(sheetRows[i])
    if (resolved) {
      columns = resolved
      headerIndex = i
      break
    }
  }

  if (!columns) {
    return EMPTY_IMPORT_SATUAN_RESULT
  }

  const resolvedColumns = columns
  const relatifKeIndex = resolvedColumns.jumlahKemasan + 1
  const dataRows = sheetRows.slice(headerIndex + 1)

  const groups = new Map<string, SatuanFileRow[]>()

  for (const sheetRow of dataRows) {
    const kodeItem = String(sheetRow[resolvedColumns.kodeItem] ?? '').trim()
    const satuan = String(sheetRow[resolvedColumns.satuan] ?? '').trim()
    const relatifKe = String(sheetRow[relatifKeIndex] ?? '').trim()
    const jumlahKemasan = parseImportNumber(sheetRow[resolvedColumns.jumlahKemasan])
    const hargaJual = parseImportNumber(sheetRow[resolvedColumns.hargaJual])

    if (!kodeItem || !satuan || !relatifKe || jumlahKemasan === null || jumlahKemasan <= 0 || hargaJual === null || hargaJual < 0) {
      continue
    }

    const list = groups.get(kodeItem) ?? []
    list.push({ satuan, jumlahKemasan, relatifKe, hargaJual })
    groups.set(kodeItem, list)
  }

  const existingProducts = new Map(
    db
      .select({ id: products.id, kodeItem: products.kodeItem, satuan: units.code })
      .from(products)
      .leftJoin(productUnits, and(eq(productUnits.productId, products.id), eq(productUnits.isBaseUnit, true)))
      .leftJoin(units, eq(productUnits.unitId, units.id))
      .all()
      .map((p) => [p.kodeItem, { ...p, satuan: p.satuan ?? '' }]),
  )

  const result = { ...EMPTY_IMPORT_SATUAN_RESULT }

  db.transaction((tx) => {
    for (const [kodeItem, rows] of groups) {
      const product = existingProducts.get(kodeItem)

      if (!product) {
        result.dilewatiTidakDitemukan++
        continue
      }

      const baseRow = rows.find((r) => r.satuan.toUpperCase() === r.relatifKe.toUpperCase())

      if (!baseRow || baseRow.satuan.toUpperCase() !== product.satuan.trim().toUpperCase()) {
        result.dilewatiSatuanTidakCocok++
        continue
      }

      // Resolve every derived row's absolute conversion-to-base by following its "relatifKe"
      // reference, which may point at the base row or at any other already-resolved row -
      // not necessarily the tier directly below it (the source data does this, e.g. "DUS"
      // relative to "PCS" while a "SLOP" tier sits in between).
      const absKonversi = new Map<string, number>([[baseRow.satuan.toUpperCase(), 1]])
      const derivedRows = rows.filter((r) => r !== baseRow)
      let remaining = derivedRows
      let progress = true

      while (remaining.length > 0 && progress) {
        progress = false
        remaining = remaining.filter((r) => {
          const relKey = r.relatifKe.toUpperCase()
          const relKonversi = absKonversi.get(relKey)

          if (relKonversi === undefined) {
            return true
          }

          absKonversi.set(r.satuan.toUpperCase(), r.jumlahKemasan * relKonversi)
          progress = true
          return false
        })
      }

      if (remaining.length > 0) {
        result.dilewatiRantaiTidakValid++
        continue
      }

      // The app's own satuan chain always stores jumlahKemasan relative to the tier directly
      // below, so re-derive it from the absolute conversions above rather than trusting the
      // file's own (possibly non-adjacent) jumlahKemasan values.
      const sortedUnits = derivedRows
        .map((r) => ({ ...r, absKonversi: absKonversi.get(r.satuan.toUpperCase()) as number }))
        .sort((a, b) => a.absKonversi - b.absKonversi)

      const finalUnits: { satuan: string; jumlahKemasan: number; konversi: number; hargaJual: number }[] = []
      let prevKonversi = 1
      let chainValid = true

      for (const unit of sortedUnits) {
        const ratio = unit.absKonversi / prevKonversi
        const roundedRatio = Math.round(ratio)

        if (unit.satuan.length > 20 || roundedRatio < 1 || Math.abs(ratio - roundedRatio) > 0.01) {
          chainValid = false
          break
        }

        finalUnits.push({ satuan: unit.satuan, jumlahKemasan: roundedRatio, konversi: unit.absKonversi, hargaJual: unit.hargaJual })
        prevKonversi = unit.absKonversi
      }

      if (!chainValid) {
        result.dilewatiRantaiTidakValid++
        continue
      }

      if (finalUnits.length === 0) {
        continue
      }

      const now = new Date()

      for (const unit of finalUnits) {
        // resolveOrCreateUnit runs on the outer handle, which is the same
        // connection this transaction holds - a rollback takes the unit with it
        const unitId = resolveOrCreateUnit(db, unit.satuan)

        // importSatuan only ever writes derived rows; the base row already came
        // from product creation, so it is matched by unitId, never replaced
        const existingUnit = tx
          .select({ id: productUnits.id })
          .from(productUnits)
          .where(
            and(
              eq(productUnits.productId, product.id),
              eq(productUnits.unitId, unitId),
              eq(productUnits.isBaseUnit, false),
            ),
          )
          .get()

        if (existingUnit) {
          tx.update(productUnits)
            .set({
              jumlahKemasan: unit.jumlahKemasan,
              conversionFactor: unit.konversi,
              hargaJual: Math.round(unit.hargaJual * 100),
              updatedAt: now,
            })
            .where(eq(productUnits.id, existingUnit.id))
            .run()
        } else {
          tx.insert(productUnits)
            .values({
              productId: product.id,
              unitId,
              jumlahKemasan: unit.jumlahKemasan,
              conversionFactor: unit.konversi,
              hargaJual: Math.round(unit.hargaJual * 100),
              isBaseUnit: false,
              createdAt: now,
              updatedAt: now,
            })
            .run()
        }

        result.satuanDitambahkan++
      }

      result.produkDiperbarui++
    }
  })

  return result
}
