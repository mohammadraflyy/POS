import { describe, expect, it, afterEach } from 'vitest'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as XLSX from 'xlsx'
import { and, eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, productPriceTiers, productUnits, stockAdjustments, units, users } from './db/schema'
import {
  getProductsByIds,
  saveProductRows,
  validateBulkRows,
  bulkSaveProducts,
  importProducts,
  importSatuan,
  importHargaBertingkat,
  importBarcode,
  type BulkSaveRow,
  type ImportHargaBertingkatResult,
  type ImportBarcodeResult,
} from './inventory-bulk'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  // Create test users
  db.insert(users)
    .values([
      { id: 3, username: 'testuser3', passwordHash: 'hash', name: 'Test User 3', createdAt: now, updatedAt: now },
      { id: 5, username: 'testuser5', passwordHash: 'hash', name: 'Test User 5', createdAt: now, updatedAt: now },
      { id: 7, username: 'testuser7', passwordHash: 'hash', name: 'Test User 7', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(categories).values({ id: 1, nama: 'Sembako', createdAt: now, updatedAt: now }).run()

  db.insert(products)
    .values({
      id: 1,
      kodeItem: 'BRS5',
      barcode: '1234567890',
      namaItem: 'Beras 5kg',
      categoryId: 1,
      hargaPokok: 60000_00,
      hargaJual: 65000_00,
      stok: 10,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  db.insert(units)
    .values({ id: 1, code: 'PCS', name: 'Pieces', symbol: 'pcs', createdAt: now, updatedAt: now })
    .run()

  db.insert(productUnits)
    .values({
      id: 101,
      productId: 1,
      unitId: 1,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual: 65000_00,
      isBaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

/**
 * The derived (non-base) rows of a product's satuan chain, with the unit code
 * joined back in - importSatuan only ever writes these.
 */
function derivedUnits(db: ReturnType<typeof createDb>, productId: number) {
  return db
    .select({
      satuan: units.code,
      jumlahKemasan: productUnits.jumlahKemasan,
      konversi: productUnits.conversionFactor,
      hargaJual: productUnits.hargaJual,
    })
    .from(productUnits)
    .innerJoin(units, eq(productUnits.unitId, units.id))
    .where(and(eq(productUnits.productId, productId), eq(productUnits.isBaseUnit, false)))
    .all()
}

function baseRow(overrides: Partial<BulkSaveRow> = {}): BulkSaveRow {
  return {
    key: 'row-1',
    id: null,
    kodeItem: 'NEW1',
    barcode: null,
    namaItem: 'Produk Baru',
    kategori: null,
    satuan: 'PCS',
    hargaPokok: 1000_00,
    hargaJual: 1500_00,
    stok: 5,
    ...overrides,
  }
}

describe('getProductsByIds', () => {
  it('returns matching products ordered by namaItem, with zero unit/tier counts by default', () => {
    const db = seedDb()
    const result = getProductsByIds(db, [1])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 1,
      kodeItem: 'BRS5',
      namaItem: 'Beras 5kg',
      categoryName: 'Sembako',
      unitsCount: 0,
      priceTiersCount: 0,
    })
  })

  it('returns an empty array for an empty id list', () => {
    const db = seedDb()
    expect(getProductsByIds(db, [])).toEqual([])
  })
})

describe('validateBulkRows', () => {
  it('returns no errors for valid rows', () => {
    const db = seedDb()
    expect(validateBulkRows(db, [baseRow()])).toEqual({})
  })

  it('flags missing required fields', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ kodeItem: '', namaItem: '', satuan: '' })])
    expect(errors['row-1']).toMatchObject({
      kodeItem: 'Kode item wajib diisi.',
      namaItem: 'Nama item wajib diisi.',
      satuan: 'Satuan wajib diisi.',
    })
  })

  it('flags non-finite and negative prices', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ hargaPokok: NaN, hargaJual: -1 })])
    expect(errors['row-1']).toMatchObject({
      hargaPokok: 'Harga pokok wajib diisi.',
      hargaJual: 'Harga jual tidak boleh negatif.',
    })
  })

  it('flags negative stok but accepts a fractional one', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ stok: -5 })])
    expect(errors['row-1'].stok).toBe('Stok harus berupa angka dan tidak boleh negatif.')

    const errors2 = validateBulkRows(db, [baseRow({ key: 'row-2', stok: 2.5 })])
    expect(errors2['row-2']?.stok).toBeUndefined()
  })

  it('flags every row sharing a duplicate kodeItem within the batch', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [
      baseRow({ key: 'a', kodeItem: 'DUPE' }),
      baseRow({ key: 'b', kodeItem: 'DUPE' }),
    ])
    expect(errors.a.kodeItem).toBe('Kode item duplikat pada baris ini.')
    expect(errors.b.kodeItem).toBe('Kode item duplikat pada baris ini.')
  })

  it('flags every row sharing a duplicate barcode within the batch', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [
      baseRow({ key: 'a', kodeItem: 'A1', barcode: '999' }),
      baseRow({ key: 'b', kodeItem: 'B1', barcode: '999' }),
    ])
    expect(errors.a.barcode).toBe('Barcode duplikat pada baris ini.')
    expect(errors.b.barcode).toBe('Barcode duplikat pada baris ini.')
  })

  it('flags a kodeItem already used by a different product in the database', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ kodeItem: 'BRS5' })])
    expect(errors['row-1'].kodeItem).toBe('Kode item sudah digunakan.')
  })

  it('does not flag a row editing its own existing kodeItem', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg' })])
    expect(errors['row-1']).toBeUndefined()
  })
})

describe('saveProductRows', () => {
  it('creates a new product', () => {
    const db = seedDb()
    const result = saveProductRows(db, [baseRow()], { updateStok: false, userId: null })
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0 })
    const created = db.select().from(products).where(eq(products.kodeItem, 'NEW1')).get()
    expect(created).toMatchObject({ namaItem: 'Produk Baru', stok: 5, isActive: true })
  })

  it('updates an existing product and logs price history when prices change', () => {
    const db = seedDb()
    const result = saveProductRows(
      db,
      [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg', hargaPokok: 61000_00, hargaJual: 66000_00 })],
      { updateStok: false, userId: 7 },
    )
    expect(result).toEqual({ created: 0, updated: 1, unchanged: 0 })
    const history = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ hargaPokokLama: 60000_00, hargaPokokBaru: 61000_00, userId: 7 })
  })

  it('counts a row as unchanged when nothing actually differs', () => {
    const db = seedDb()
    const result = saveProductRows(
      db,
      [
        baseRow({
          id: 1,
          kodeItem: 'BRS5',
          barcode: '1234567890',
          namaItem: 'Beras 5kg',
          kategori: 'Sembako',
          satuan: 'PCS',
          hargaPokok: 60000_00,
          hargaJual: 65000_00,
          stok: 999,
        }),
      ],
      { updateStok: false, userId: null },
    )
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 1 })
  })

  it('does not touch stock on update when updateStok is false, even if the row specifies a different value', () => {
    const db = seedDb()
    saveProductRows(db, [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg Baru', stok: 999 })], {
      updateStok: false,
      userId: null,
    })
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(10)
  })

  it('updates stock and logs a stock adjustment when updateStok is true and stock changed', () => {
    const db = seedDb()
    saveProductRows(db, [baseRow({ id: 1, kodeItem: 'BRS5', namaItem: 'Beras 5kg', stok: 25 })], {
      updateStok: true,
      userId: 3,
    })
    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(25)
    const adjustments = db.select().from(stockAdjustments).where(eq(stockAdjustments.productId, 1)).all()
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({ stokSebelum: 10, stokSesudah: 25, selisih: 15, alasan: 'Import Excel', userId: 3 })
  })

  it('resolves kategori via find-or-create', () => {
    const db = seedDb()
    saveProductRows(db, [baseRow({ kategori: 'Baru' })], { updateStok: false, userId: null })
    const category = db.select().from(categories).where(eq(categories.nama, 'Baru')).get()
    expect(category).toBeDefined()
    const product = db.select().from(products).where(eq(products.kodeItem, 'NEW1')).get()
    expect(product?.categoryId).toBe(category?.id)
  })

  it('skips a row referencing a non-existent id rather than throwing', () => {
    const db = seedDb()
    const result = saveProductRows(db, [baseRow({ id: 999, kodeItem: 'GHOST' })], { updateStok: false, userId: null })
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 0 })
  })
})

describe('bulkSaveProducts', () => {
  it('saves all valid rows atomically and returns counts', () => {
    const db = seedDb()
    const result = bulkSaveProducts(db, [baseRow({ key: 'a', kodeItem: 'A1' }), baseRow({ key: 'b', kodeItem: 'B1' })], 5)
    expect(result).toEqual({ success: true, created: 2, updated: 0, unchanged: 0 })
  })

  it('writes nothing when any row is invalid (all-or-nothing)', () => {
    const db = seedDb()
    const result = bulkSaveProducts(db, [baseRow({ key: 'a', kodeItem: 'A1' }), baseRow({ key: 'b', kodeItem: '' })], null)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.rowErrors.b.kodeItem).toBe('Kode item wajib diisi.')
    }
    const created = db.select().from(products).where(eq(products.kodeItem, 'A1')).get()
    expect(created).toBeUndefined()
  })
})

const importTempDirs: string[] = []

afterEach(() => {
  for (const dir of importTempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  importTempDirs.length = 0
})

function writeTestSheet(rows: unknown[][]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'inventory-import-'))
  importTempDirs.push(dir)
  const filePath = path.join(dir, 'test.xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1')
  XLSX.writeFile(workbook, filePath)
  return filePath
}

describe('importProducts', () => {
  it('creates new products from a valid sheet', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual', 'Stok'],
      ['IMP1', 'Produk Impor 1', 'PCS', 1000, 1500, 20],
      ['IMP2', 'Produk Impor 2', 'PCS', 2000, 2500, 10],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0 })

    const product = db.select().from(products).where(eq(products.kodeItem, 'IMP1')).get()
    expect(product).toMatchObject({ namaItem: 'Produk Impor 1', hargaPokok: 1000_00, hargaJual: 1500_00, stok: 20 })
  })

  it('updates an existing product by kodeItem and overwrites stock', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual', 'Stok'],
      ['BRS5', 'Beras 5kg', 'PCS', 61000, 66000, 999],
    ])

    const result = importProducts(db, filePath, 3)
    expect(result).toEqual({ created: 0, updated: 1, unchanged: 0, skipped: 0 })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(999)

    const adjustments = db.select().from(stockAdjustments).where(eq(stockAdjustments.productId, 1)).all()
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({ stokSebelum: 10, stokSesudah: 999, alasan: 'Import Excel', userId: 3 })
  })

  it('locates the header row even when preceded by a title block', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Laporan Katalog Produk', '', '', ''],
      ['Dicetak: 2026-01-01', '', '', ''],
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['IMP1', 'Produk Impor', 'PCS', 1000, 1500],
    ])

    const result = importProducts(db, filePath, null)
    expect(result.created).toBe(1)
  })

  it('finds headers regardless of column order', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Harga Jual', 'Satuan', 'Nama Item', 'Kode Item', 'Harga Pokok'],
      [1500, 'PCS', 'Produk Impor', 'IMP1', 1000],
    ])

    const result = importProducts(db, filePath, null)
    expect(result.created).toBe(1)
  })

  it('skips rows missing namaItem or satuan and counts them', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['IMP1', '', 'PCS', 1000, 1500],
      ['IMP2', 'Produk Impor', '', 1000, 1500],
      ['IMP3', 'Produk Valid', 'PCS', 1000, 1500],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 2 })
  })

  it('silently ignores rows with a blank kodeItem (not counted as skipped)', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['', 'Baris Kosong', 'PCS', 1000, 1500],
      ['IMP1', 'Produk Valid', 'PCS', 1000, 1500],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0 })
  })

  it('deduplicates a kodeItem repeated within the file, keeping the first occurrence', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['DUP1', 'Pertama', 'PCS', 1000, 1500],
      ['DUP1', 'Kedua', 'PCS', 2000, 2500],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 1 })

    const product = db.select().from(products).where(eq(products.kodeItem, 'DUP1')).get()
    expect(product?.namaItem).toBe('Pertama')
  })

  it('parses numbers with thousands-separator commas', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['IMP1', 'Produk Impor', 'PCS', '15,000', '18,500'],
    ])

    const result = importProducts(db, filePath, null)
    expect(result.created).toBe(1)
    const product = db.select().from(products).where(eq(products.kodeItem, 'IMP1')).get()
    expect(product).toMatchObject({ hargaPokok: 15000_00, hargaJual: 18500_00 })
  })

  it('skips rows with a non-numeric price cell instead of silently importing at Rp 0', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['IMP1', 'Harga Rusak', 'PCS', 'N/A', 1500],
      ['IMP2', 'Produk Valid', 'PCS', 1000, 1500],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 1 })

    const broken = db.select().from(products).where(eq(products.kodeItem, 'IMP1')).get()
    expect(broken).toBeUndefined()
  })

  it('still allows an explicitly blank price cell to default to 0 (not treated as garbage)', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Nama Item', 'Satuan', 'Harga Pokok', 'Harga Jual'],
      ['IMP1', 'Harga Nol', 'PCS', '', 1500],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0 })

    const product = db.select().from(products).where(eq(products.kodeItem, 'IMP1')).get()
    expect(product?.hargaPokok).toBe(0)
  })

  it('returns all-zero counts when no header row is found', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Ini', 'Bukan', 'Header', 'Yang', 'Valid'],
      ['a', 'b', 'c', 'd', 'e'],
    ])

    const result = importProducts(db, filePath, null)
    expect(result).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 0 })
  })
})

describe('importSatuan', () => {
  // The unlabeled column right after "Qty/Paket" is the "relative to which satuan" reference -
  // matching the real legacy report's layout (a blank header cell at that position).
  const SATUAN_HEADER = ['Kode Item', 'Satuan', 'Qty/Paket', '', 'Harga Jual']

  it('creates a derived unit relative to the base satuan', () => {
    const db = seedDb() // BRS5, satuan PCS
    const filePath = writeTestSheet([
      SATUAN_HEADER,
      ['BRS5', 'PCS', 1, 'PCS', 1500],
      ['BRS5', 'DUS', 12, 'PCS', 17000],
    ])

    const result = importSatuan(db, filePath)
    expect(result).toEqual({
      produkDiperbarui: 1,
      satuanDitambahkan: 1,
      dilewatiTidakDitemukan: 0,
      dilewatiSatuanTidakCocok: 0,
      dilewatiRantaiTidakValid: 0,
    })

    const unit = derivedUnits(db, 1)[0]
    expect(unit).toMatchObject({ satuan: 'DUS', jumlahKemasan: 12, konversi: 12, hargaJual: 17000_00 })
  })

  it('resolves a non-adjacent relative reference (e.g. DUS relative to PCS, skipping SLOP)', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      SATUAN_HEADER,
      ['BRS5', 'PCS', 1, 'PCS', 1500],
      ['BRS5', 'SLOP', 10, 'PCS', 14000],
      ['BRS5', 'DUS', 50, 'PCS', 65000], // relative to PCS, not SLOP - 50 PCS = 5 SLOP
    ])

    const result = importSatuan(db, filePath)
    expect(result.produkDiperbarui).toBe(1)
    expect(result.satuanDitambahkan).toBe(2)

    const chain = derivedUnits(db, 1)
    const bySatuan = Object.fromEntries(chain.map((u) => [u.satuan, u]))
    expect(bySatuan.SLOP).toMatchObject({ jumlahKemasan: 10, konversi: 10 })
    expect(bySatuan.DUS).toMatchObject({ jumlahKemasan: 5, konversi: 50 }) // re-derived relative to SLOP, not PCS
  })

  it('skips a kodeItem with no matching product', () => {
    const db = seedDb()
    const filePath = writeTestSheet([SATUAN_HEADER, ['GHOST', 'PCS', 1, 'PCS', 1500], ['GHOST', 'DUS', 12, 'PCS', 17000]])

    const result = importSatuan(db, filePath)
    expect(result).toEqual({ ...emptySatuanResult(), dilewatiTidakDitemukan: 1 })
  })

  it('skips when the file base satuan does not match the product current satuan', () => {
    const db = seedDb() // BRS5, satuan PCS
    const filePath = writeTestSheet([SATUAN_HEADER, ['BRS5', 'KG', 1, 'KG', 1500], ['BRS5', 'DUS', 12, 'KG', 17000]])

    const result = importSatuan(db, filePath)
    expect(result).toEqual({ ...emptySatuanResult(), dilewatiSatuanTidakCocok: 1 })

    expect(derivedUnits(db, 1)).toHaveLength(0)
  })

  it('skips when a relative reference cannot be resolved', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      SATUAN_HEADER,
      ['BRS5', 'PCS', 1, 'PCS', 1500],
      ['BRS5', 'DUS', 12, 'ENTAH', 17000], // "ENTAH" is never defined for this product
    ])

    const result = importSatuan(db, filePath)
    expect(result).toEqual({ ...emptySatuanResult(), dilewatiRantaiTidakValid: 1 })
  })

  it('skips when a re-derived ratio is not a clean whole number', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      SATUAN_HEADER,
      ['BRS5', 'PCS', 1, 'PCS', 1500],
      ['BRS5', 'SLOP', 10, 'PCS', 14000],
      ['BRS5', 'DUS', 25, 'PCS', 65000], // 25 PCS / 10 PCS-per-SLOP = 2.5 SLOP, not a whole number
    ])

    const result = importSatuan(db, filePath)
    expect(result).toEqual({ ...emptySatuanResult(), dilewatiRantaiTidakValid: 1 })
  })

  it('is a no-op for a kodeItem with only a base row (nothing to add)', () => {
    const db = seedDb()
    const filePath = writeTestSheet([SATUAN_HEADER, ['BRS5', 'PCS', 1, 'PCS', 1500]])

    const result = importSatuan(db, filePath)
    expect(result).toEqual(emptySatuanResult())
    expect(derivedUnits(db, 1)).toHaveLength(0)
  })

  it('is idempotent: re-running updates the existing unit instead of duplicating it', () => {
    const db = seedDb()
    const filePath = writeTestSheet([SATUAN_HEADER, ['BRS5', 'PCS', 1, 'PCS', 1500], ['BRS5', 'DUS', 12, 'PCS', 17000]])

    importSatuan(db, filePath)

    const filePath2 = writeTestSheet([SATUAN_HEADER, ['BRS5', 'PCS', 1, 'PCS', 1500], ['BRS5', 'DUS', 12, 'PCS', 18000]])
    const result = importSatuan(db, filePath2)

    expect(result.satuanDitambahkan).toBe(1)
    const chain = derivedUnits(db, 1)
    expect(chain).toHaveLength(1)
    expect(chain[0]).toMatchObject({ hargaJual: 18000_00 })
  })

  it('locates the header row even when preceded by a title block', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['DAFTAR ITEM', '', '', '', ''],
      ['TOKO SEMBAKO', '', '', '', ''],
      SATUAN_HEADER,
      ['BRS5', 'PCS', 1, 'PCS', 1500],
      ['BRS5', 'DUS', 12, 'PCS', 17000],
    ])

    const result = importSatuan(db, filePath)
    expect(result.produkDiperbarui).toBe(1)
  })

  it('finds headers regardless of column order', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Harga Jual', 'Qty/Paket', '', 'Satuan', 'Kode Item'],
      [1500, 1, 'PCS', 'PCS', 'BRS5'],
      [17000, 12, 'PCS', 'DUS', 'BRS5'],
    ])

    const result = importSatuan(db, filePath)
    expect(result.produkDiperbarui).toBe(1)
  })

  it('returns all-zero counts when no header row is found', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Ini', 'Bukan', 'Header', 'Yang', 'Valid'],
      ['a', 'b', 'c', 'd', 'e'],
    ])

    const result = importSatuan(db, filePath)
    expect(result).toEqual(emptySatuanResult())
  })
})

function emptySatuanResult() {
  return {
    produkDiperbarui: 0,
    satuanDitambahkan: 0,
    dilewatiTidakDitemukan: 0,
    dilewatiSatuanTidakCocok: 0,
    dilewatiRantaiTidakValid: 0,
  }
}

describe('importHargaBertingkat', () => {
  // Mirrors the real legacy export: four fixed (Jml N, Harga Jml N) pairs, unused ones zeroed.
  const TIER_HEADER = [
    'Kode Item',
    'Konversi',
    'Satuan',
    'Jml 1',
    'Harga Jml 1',
    'Jml 2',
    'Harga Jml 2',
    'Jml 3',
    'Harga Jml 3',
    'Jml 4',
    'Harga Jml 4',
  ]

  function emptyTierResult(): ImportHargaBertingkatResult {
    return {
      satuanDiperbarui: 0,
      tierDitambahkan: 0,
      dilewatiProdukTidakDitemukan: 0,
      dilewatiSatuanTidakDitemukan: 0,
    }
  }

  function tiersFor(db: ReturnType<typeof createDb>, productUnitId: number) {
    return db
      .select({
        minQty: productPriceTiers.minQty,
        maxQty: productPriceTiers.maxQty,
        hargaJual: productPriceTiers.hargaJual,
      })
      .from(productPriceTiers)
      .where(eq(productPriceTiers.productUnitId, productUnitId))
      .orderBy(productPriceTiers.minQty)
      .all()
  }

  /** Adds a DUS satuan (12 PCS) to the seeded BRS5 product, as product_units id 102. */
  function seedDusUnit(db: ReturnType<typeof createDb>) {
    const now = new Date()
    db.insert(units).values({ id: 2, code: 'DUS', name: 'Dus', symbol: 'dus', createdAt: now, updatedAt: now }).run()
    db.insert(productUnits)
      .values({
        id: 102,
        productId: 1,
        unitId: 2,
        jumlahKemasan: 12,
        conversionFactor: 12,
        hargaJual: 780000_00,
        isBaseUnit: false,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  it('stores every filled tier pair against the base unit, in cents and open-ended', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1000, 5, 950, 10, 925, 0, 0]])

    const result = importHargaBertingkat(db, filePath)

    expect(result).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 3 })
    expect(tiersFor(db, 101)).toEqual([
      { minQty: 1, maxQty: null, hargaJual: 1000_00 },
      { minQty: 5, maxQty: null, hargaJual: 950_00 },
      { minQty: 10, maxQty: null, hargaJual: 925_00 },
    ])
  })

  it('takes minQty from Jml verbatim on a derived unit row', () => {
    const db = seedDb()
    seedDusUnit(db)
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 12, 'DUS', 3, 770000, 0, 0, 0, 0, 0, 0]])

    const result = importHargaBertingkat(db, filePath)

    expect(result).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    // 3 means three DUS, not three PCS - Konversi is not applied
    expect(tiersFor(db, 102)).toEqual([{ minQty: 3, maxQty: null, hargaJual: 770000_00 }])
    expect(tiersFor(db, 101)).toEqual([])
  })

  it('matches the satuan case-insensitively', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'pcs', 2, 950, 0, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
  })

  it('leaves existing tiers alone for a row whose tier columns are all zero', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(productPriceTiers)
      .values({ productId: 1, productUnitId: 101, minQty: 6, maxQty: null, hargaJual: 60000_00, createdAt: now, updatedAt: now })
      .run()

    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 0, 0, 0, 0, 0, 0, 0, 0]])

    // a blank tier block means "not specified", never "delete what you have"
    expect(importHargaBertingkat(db, filePath)).toEqual(emptyTierResult())
    expect(tiersFor(db, 101)).toEqual([{ minQty: 6, maxQty: null, hargaJual: 60000_00 }])
  })

  it('skips a tier pair whose price is zero', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1000, 5, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 1, maxQty: null, hargaJual: 1000_00 }])
  })

  it('counts an unknown kodeItem as dilewatiProdukTidakDitemukan', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['GHOST', 1, 'PCS', 1, 1000, 0, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), dilewatiProdukTidakDitemukan: 1 })
  })

  it('counts a satuan the product does not have as dilewatiSatuanTidakDitemukan', () => {
    const db = seedDb() // BRS5 only has PCS
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 12, 'DUS', 1, 780000, 0, 0, 0, 0, 0, 0]])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), dilewatiSatuanTidakDitemukan: 1 })
  })

  it('collapses a duplicated Jml into one tier, the later pair winning', () => {
    const db = seedDb()
    const filePath = writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 5, 1000, 5, 900, 0, 0, 0, 0]])

    // the unique index on (product_unit_id, min_qty) would reject two rows here
    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 5, maxQty: null, hargaJual: 900_00 }])
  })

  it('replaces rather than accumulates when re-run', () => {
    const db = seedDb()
    importHargaBertingkat(db, writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1000, 5, 950, 0, 0, 0, 0]]))

    const result = importHargaBertingkat(db, writeTestSheet([TIER_HEADER, ['BRS5', 1, 'PCS', 1, 1100, 0, 0, 0, 0, 0, 0]]))

    expect(result).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 1, maxQty: null, hargaJual: 1100_00 }])
  })

  it('works when the sheet carries only the first tier pair', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Satuan', 'Jml 1', 'Harga Jml 1'],
      ['BRS5', 'PCS', 2, 950],
    ])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
    expect(tiersFor(db, 101)).toEqual([{ minQty: 2, maxQty: null, hargaJual: 950_00 }])
  })

  it('locates the header row even when preceded by a title block', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['DATA HARGA BERTINGKAT', '', '', '', '', '', '', '', '', '', ''],
      TIER_HEADER,
      ['BRS5', 1, 'PCS', 1, 1000, 0, 0, 0, 0, 0, 0],
    ])

    expect(importHargaBertingkat(db, filePath)).toEqual({ ...emptyTierResult(), satuanDiperbarui: 1, tierDitambahkan: 1 })
  })

  it('returns all-zero counts when no header row is found', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Ini', 'Bukan', 'Header'],
      ['a', 'b', 'c'],
    ])

    expect(importHargaBertingkat(db, filePath)).toEqual(emptyTierResult())
  })
})

describe('importBarcode', () => {
  function emptyBarcodeResult(): ImportBarcodeResult {
    return {
      diperbarui: 0,
      dilewatiSudahSama: 0,
      dilewatiProdukTidakDitemukan: 0,
      dilewatiBarcodeDipakai: 0,
      dilewatiBarcodeTerlaluPanjang: 0,
    }
  }

  function barcodeOf(db: ReturnType<typeof createDb>, kodeItem: string) {
    return db.select({ barcode: products.barcode }).from(products).where(eq(products.kodeItem, kodeItem)).get()?.barcode
  }

  /** a second product with no barcode of its own, as products id 2 */
  function seedSecondProduct(db: ReturnType<typeof createDb>) {
    const now = new Date()
    db.insert(products)
      .values({
        id: 2,
        kodeItem: 'GLA1',
        barcode: null,
        namaItem: 'Gula 1kg',
        categoryId: 1,
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 5,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  it('sets a barcode on a product matched by kodeItem', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['GLA1', '8991234500015'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1 })
    expect(barcodeOf(db, 'GLA1')).toBe('8991234500015')
  })

  it('accepts a plain "Barcode" header too', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['Kode Item', 'Barcode'],
      ['GLA1', '8991234500015'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1 })
  })

  it('reads a barcode typed as a number', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['GLA1', 8991234500015],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1 })
    expect(barcodeOf(db, 'GLA1')).toBe('8991234500015')
  })

  it('replaces a barcode the product already had', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['BRS5', '9998887776665'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1 })
    expect(barcodeOf(db, 'BRS5')).toBe('9998887776665')
  })

  it('counts a row whose barcode is already the one on file', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['BRS5', '1234567890'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), dilewatiSudahSama: 1 })
  })

  it('leaves a blank barcode cell alone instead of clearing the product', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['BRS5', ''],
    ])

    expect(importBarcode(db, filePath)).toEqual(emptyBarcodeResult())
    expect(barcodeOf(db, 'BRS5')).toBe('1234567890')
  })

  it('counts a kodeItem that is not in the catalog', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['TIDAKADA', '8991234500015'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), dilewatiProdukTidakDitemukan: 1 })
  })

  it('skips a barcode already used by another product rather than failing the import', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['GLA1', '1234567890'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), dilewatiBarcodeDipakai: 1 })
    expect(barcodeOf(db, 'GLA1')).toBeNull()
  })

  it('treats a barcode claimed by an earlier row of the same file as taken', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['GLA1', '8991234500015'],
      ['BRS5', '8991234500015'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1, dilewatiBarcodeDipakai: 1 })
    expect(barcodeOf(db, 'BRS5')).toBe('1234567890')
  })

  it('skips a barcode longer than 100 characters', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['Kode Item', 'Kode Barcode'],
      ['GLA1', '9'.repeat(101)],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), dilewatiBarcodeTerlaluPanjang: 1 })
    expect(barcodeOf(db, 'GLA1')).toBeNull()
  })

  it('finds the header below a title row', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const filePath = writeTestSheet([
      ['DATA BARCODE', ''],
      ['Kode Item', 'Kode Barcode'],
      ['GLA1', '8991234500015'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1 })
  })

  it('returns all-zero counts when no header row is found', () => {
    const db = seedDb()
    const filePath = writeTestSheet([
      ['Ini', 'Bukan', 'Header'],
      ['a', 'b', 'c'],
    ])

    expect(importBarcode(db, filePath)).toEqual(emptyBarcodeResult())
  })

  // Mirrors the real "DAFTAR ITEM" export: a title block above the header, and the two
  // columns that matter sitting at indexes 1 and 5 with empty spacer columns between
  // them. Roughly half of that file's rows carry no barcode at all.
  it('reads the legacy DAFTAR ITEM layout, header buried under a title block', () => {
    const db = seedDb()
    seedSecondProduct(db)
    const spacer = ['', '', '', '', '', '', '', '']
    const filePath = writeTestSheet([
      spacer,
      ['', '', '', '', 'DAFTAR ITEM', '', '', ''],
      ['', '', '', '', 'TOKO SEMBAKO RATNA', '', '', ''],
      spacer,
      ['', 'Kode Item', '', '', '', 'Kode Barcode', '', 'Nama Item'],
      spacer,
      ['', 'GLA1', '', '', '', '8991002105584', '', 'Gula 1kg'],
      ['', 'BRS5', '', '', '', '', '', 'Beras 5kg'],
    ])

    expect(importBarcode(db, filePath)).toEqual({ ...emptyBarcodeResult(), diperbarui: 1 })
    expect(barcodeOf(db, 'GLA1')).toBe('8991002105584')
    // the blank barcode cell left the existing one untouched
    expect(barcodeOf(db, 'BRS5')).toBe('1234567890')
  })
})
