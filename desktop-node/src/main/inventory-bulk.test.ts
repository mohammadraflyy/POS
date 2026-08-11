import { describe, expect, it, afterEach } from 'vitest'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as XLSX from 'xlsx'
import { and, eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, productUnits, stockAdjustments, units, users } from './db/schema'
import {
  getProductsByIds,
  saveProductRows,
  validateBulkRows,
  bulkSaveProducts,
  importProducts,
  importSatuan,
  type BulkSaveRow,
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

  it('flags negative or non-integer stok', () => {
    const db = seedDb()
    const errors = validateBulkRows(db, [baseRow({ stok: -5 })])
    expect(errors['row-1'].stok).toBe('Stok harus bilangan bulat dan tidak boleh negatif.')

    const errors2 = validateBulkRows(db, [baseRow({ key: 'row-2', stok: 2.5 })])
    expect(errors2['row-2'].stok).toBe('Stok harus bilangan bulat dan tidak boleh negatif.')
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
