import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { createDb } from './migrate'
import { products, productUnits, stockMovements, units } from './schema'

const migrationsFolder = path.resolve(__dirname, '../../../drizzle')

/**
 * Builds a migrations folder containing every migration *before* `tag`, so a database can be
 * seeded in its pre-migration shape and then reopened through the full folder to exercise
 * `tag`'s backfill against existing data.
 *
 * @return {{ partialFolder: string, dbFile: string, cleanup: () => void }}
 */
function partialMigrationsBefore(tag: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf-8')) as {
    entries: { tag: string }[]
  }
  const priorEntries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag))
  expect(priorEntries.length).toBeGreaterThan(0)

  const partialFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-migrate-partial-'))
  fs.mkdirSync(path.join(partialFolder, 'meta'))
  fs.writeFileSync(path.join(partialFolder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: priorEntries }))
  for (const entry of priorEntries) {
    fs.copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(partialFolder, `${entry.tag}.sql`))
  }

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-migrate-db-'))

  return {
    partialFolder,
    dbFile: path.join(dbDir, 'test.db'),
    cleanup: () => {
      fs.rmSync(partialFolder, { recursive: true, force: true })
      fs.rmSync(dbDir, { recursive: true, force: true })
    },
  }
}

describe('createDb', () => {
  it('creates all 18 business tables', () => {
    const db = createDb(':memory:', migrationsFolder)

    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
    )
    const tableNames = rows.map((row) => row.name).sort()

    expect(tableNames).toEqual(
      [
        'bon_payments',
        'cash_expenses',
        'categories',
        'product_price_histories',
        'product_price_tiers',
        'product_units',
        'products',
        'purchase_items',
        'purchase_payments',
        'purchases',
        'sale_items',
        'sales',
        'stock_adjustments',
        'stock_movements',
        'store_settings',
        'suppliers',
        'units',
        'users',
      ].sort(),
    )
  })

  it('does not null out sale_items.product_unit_id when applying the product_units table-rebuild migration to a database with existing data', () => {
    // Migration 0005 rebuilds product_units via DROP TABLE, which triggers sale_items'
    // ON DELETE SET NULL if foreign_keys enforcement is active during the migration
    // transaction. To exercise that, seed data on a database migrated only up to 0004
    // (before the rebuild), then reopen it through the full migrations folder.
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0005_massive_siren')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'RKK1', 'Rokok A', 'Pcs', 100000, 150000, 100, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, satuan, jumlah_kemasan, konversi, harga_jual, created_at, updated_at)
      VALUES (1, 1, 'Renteng', 12, 12, 1500000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (1, 'tunai', 'selesai', 1500000, 1500000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, product_unit_id, qty, konversi, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (1, 1, 1, 1, 1, 12, 'Renteng', 1500000, 1200000, 1500000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const row = fullDb.all<{ product_unit_id: number | null }>(sql`SELECT product_unit_id FROM sale_items WHERE id = 1`)[0]
    fullDb.$client.close()
    cleanup()

    expect(row?.product_unit_id).toBe(1)
  })

  it('seeds the units table from every distinct satuan string already in products/product_units, deduping case/whitespace variants', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0006_robust_daimon_hellstrom')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'TEST1', 'Test Product 1', 'Pcs', 100000, 150000, 100, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, satuan, jumlah_kemasan, konversi, harga_jual, created_at, updated_at)
      VALUES (1, 1, 'PCS', 12, 12, 1500000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (2, 'TEST2', 'Test Product 2', '  BOX  ', 200000, 300000, 50, 1, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const rows = fullDb.select().from(units).all()
    fullDb.$client.close()
    cleanup()

    const rowsByCode = Object.fromEntries(rows.map((row) => [row.code, row]))
    expect(Object.keys(rowsByCode).sort()).toEqual(['BOX', 'PCS'])
    expect(rowsByCode['PCS']?.name).toBe('PCS')
    expect(rowsByCode['PCS']?.symbol).toBe('pcs')
    expect(rowsByCode['BOX']?.name).toBe('BOX')
    expect(rowsByCode['BOX']?.symbol).toBe('box')
  })

  it('gives every product exactly one is_base_unit=true product_units row with conversion_factor 1', () => {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()
    const unit = db.insert(units).values({ code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true, createdAt: now, updatedAt: now }).returning().get()
    const product = db.insert(products).values({ kodeItem: 'T1', namaItem: 'Test', hargaJual: 1000, stok: 10, createdAt: now, updatedAt: now }).returning().get()
    db.insert(productUnits).values({ productId: product.id, unitId: unit.id, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 1000, isBaseUnit: true, isDefaultSalesUnit: true, isDefaultPurchaseUnit: true, createdAt: now, updatedAt: now }).run()

    const baseRows = db.select().from(productUnits).where(and(eq(productUnits.productId, product.id), eq(productUnits.isBaseUnit, true))).all()
    expect(baseRows).toHaveLength(1)
    expect(baseRows[0].conversionFactor).toBe(1)
  })

  it('backfills a base-unit row per product and rewrites derived rows to unit_id when migrating a database with pre-0007 data', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0007_lovely_layla_miller')

    const partialDb = createDb(dbFile, partialFolder)
    // Product 1: base 'Pcs' with a derived 'Renteng' referenced by a sale item.
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Rokok A', 'Pcs', 100000, 150000, 100, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, satuan, jumlah_kemasan, konversi, harga_jual, created_at, updated_at)
      VALUES (1, 1, 'Renteng', 12, 12, 1500000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, satuan, jumlah_kemasan, konversi, harga_jual, created_at, updated_at)
      VALUES (2, 1, 'Slop', 10, 120, 15000000, unixepoch(), unixepoch())`)
    // Product 2: base '  kg  ' (whitespace + case variant), no derived units.
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (2, 'P2', 'Gula', '  kg  ', 1000000, 1400000, 20, 1, unixepoch(), unixepoch())`)
    // Product 3: a derived row that already uses the product's own base satuan (case variant) —
    // must be promoted to the base row rather than producing a duplicate (product_id, unit_id).
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (3, 'P3', 'Kopi', 'PAK', 500000, 700000, 30, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, satuan, jumlah_kemasan, konversi, harga_jual, created_at, updated_at)
      VALUES (3, 3, 'Pak', 6, 6, 4000000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (1, 'tunai', 'selesai', 1500000, 1500000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, product_unit_id, qty, konversi, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (1, 1, 1, 1, 1, 12, 'Renteng', 1500000, 1200000, 1500000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const rows = fullDb
      .all<{ product_id: number; code: string; jumlah_kemasan: number; conversion_factor: number; harga_jual: number; is_base_unit: number; id: number }>(
        sql`SELECT pu.id, pu.product_id, u.code, pu.jumlah_kemasan, pu.conversion_factor, pu.harga_jual, pu.is_base_unit
            FROM product_units pu JOIN units u ON u.id = pu.unit_id ORDER BY pu.product_id, pu.conversion_factor`,
      )
    const productsWithoutExactlyOneBase = fullDb.all<{ id: number }>(
      sql`SELECT p.id FROM products p
          WHERE (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.is_base_unit = 1) != 1`,
    )
    const saleItem = fullDb.all<{ product_unit_id: number | null }>(sql`SELECT product_unit_id FROM sale_items WHERE id = 1`)[0]
    fullDb.$client.close()
    cleanup()

    expect(productsWithoutExactlyOneBase).toEqual([])
    // Derived rows keep their ids so sale_items/purchase_items references stay intact.
    expect(saleItem?.product_unit_id).toBe(1)
    expect(rows.map((r) => [r.product_id, r.code, r.conversion_factor, r.is_base_unit])).toEqual([
      [1, 'PCS', 1, 1], // base row synthesised from products.satuan
      [1, 'RENTENG', 12, 0],
      [1, 'SLOP', 120, 0],
      [2, 'KG', 1, 1], // whitespace/case variant resolves to the same units row
      [3, 'PAK', 1, 1], // pre-existing derived row promoted to base
    ])
    // Every base row is priced per base unit, i.e. products.harga_jual — including the promoted
    // row, whose old price (4000000) was for a pack of 6, not for one base unit.
    expect(rows.find((r) => r.product_id === 1 && r.is_base_unit === 1)?.harga_jual).toBe(150000)
    expect(rows.find((r) => r.product_id === 3 && r.is_base_unit === 1)?.harga_jual).toBe(700000)
    expect(rows.find((r) => r.product_id === 3)?.id).toBe(3)
  })

  it('aborts rather than silently dropping a product_units row whose satuan resolves to no unit', () => {
    // No cleanup() here: createDb throws before it can return the handle, so the sqlite file stays
    // open and Windows refuses to remove the directory. The OS temp dir takes care of it.
    const { partialFolder, dbFile } = partialMigrationsBefore('0007_lovely_layla_miller')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, satuan, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Rokok A', 'Pcs', 100000, 150000, 100, 1, unixepoch(), unixepoch())`)
    // Blank satuan never gets a units row (0006/0007 skip it), so the backfill must fail loudly:
    // silently dropping this row would free its id for reuse and re-attach stale sale_items to it.
    partialDb.run(sql`INSERT INTO product_units (id, product_id, satuan, jumlah_kemasan, konversi, harga_jual, created_at, updated_at)
      VALUES (1, 1, '   ', 12, 12, 1500000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    let cause = ''
    try {
      createDb(dbFile, migrationsFolder)
    } catch (error) {
      cause = String((error as { cause?: Error }).cause?.message ?? error)
    }

    expect(cause).toMatch(/NOT NULL constraint failed: __new_product_units.unit_id/)
  })

  it('backfills every existing price tier onto its product base unit row, open-ended above min_qty', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0008_flat_wendell_vaughn')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Rokok A', 100000, 150000, 100, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (1, 'PCS', 'Pieces', 'pcs', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (2, 'SLOP', 'Slop', 'slop', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (10, 1, 1, 1, 1, 150000, 1, 1, 1, unixepoch(), unixepoch())`)
    // a derived row exists too - the backfill must not attach the tiers to it
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (11, 1, 2, 10, 10, 1400000, 0, 0, 0, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_price_tiers (id, product_id, min_qty, harga_jual, created_at, updated_at)
      VALUES (5, 1, 10, 140000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_price_tiers (id, product_id, min_qty, harga_jual, created_at, updated_at)
      VALUES (6, 1, 50, 130000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const tiers = fullDb.all<{ id: number; product_id: number; product_unit_id: number; min_qty: number; max_qty: number | null; harga_jual: number }>(
      sql`SELECT id, product_id, product_unit_id, min_qty, max_qty, harga_jual FROM product_price_tiers ORDER BY min_qty`,
    )
    fullDb.$client.close()
    cleanup()

    // ids survive, both tiers land on the base row (10) rather than the derived one (11),
    // and max_qty stays NULL so each tier keeps reading as open-ended above min_qty
    expect(tiers).toEqual([
      { id: 5, product_id: 1, product_unit_id: 10, min_qty: 10, max_qty: null, harga_jual: 140000 },
      { id: 6, product_id: 1, product_unit_id: 10, min_qty: 50, max_qty: null, harga_jual: 130000 },
    ])
  })

  it('records a stock movement referencing a product unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const now = new Date()
    const unit = db.insert(units).values({ code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true, createdAt: now, updatedAt: now }).returning().get()
    const product = db.insert(products).values({ kodeItem: 'M1', namaItem: 'Test', hargaJual: 1000, stok: 10, createdAt: now, updatedAt: now }).returning().get()
    const baseUnit = db
      .insert(productUnits)
      .values({ productId: product.id, unitId: unit.id, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 1000, isBaseUnit: true, isDefaultSalesUnit: true, isDefaultPurchaseUnit: true, createdAt: now, updatedAt: now })
      .returning()
      .get()

    db.insert(stockMovements)
      .values({ productId: product.id, productUnitId: baseUnit.id, quantity: -5, conversionFactor: 1, baseQuantity: -5, movementType: 'sale', referenceId: 1, createdAt: now })
      .run()

    const movements = db.select().from(stockMovements).all()
    expect(movements).toHaveLength(1)
    expect(movements[0].baseQuantity).toBe(-5)
    expect(movements[0].movementType).toBe('sale')
  })

  it('backfills sale_items.base_quantity from qty * konversi, leaving price_source at its default', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0009_lyrical_scarlet_spider')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Rokok A', 100000, 150000, 100, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (1, 'tunai', 'selesai', 1500000, 1500000, unixepoch(), unixepoch())`)
    // a base-unit line (konversi 1) and a derived-unit line (konversi 12)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, qty, konversi, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (1, 1, 1, 3, 1, 'PCS', 150000, 100000, 450000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, qty, konversi, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (2, 1, 1, 2, 12, 'Renteng', 1500000, 1200000, 3000000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const rows = fullDb.all<{ id: number; qty: number; konversi: number; base_quantity: number; price_source: string }>(
      sql`SELECT id, qty, konversi, base_quantity, price_source FROM sale_items ORDER BY id`,
    )
    fullDb.$client.close()
    cleanup()

    expect(rows).toEqual([
      { id: 1, qty: 3, konversi: 1, base_quantity: 3, price_source: 'normal' },
      { id: 2, qty: 2, konversi: 12, base_quantity: 24, price_source: 'normal' },
    ])
  })

  it('backfills product_units.harga_pokok from base cost x conversion and bakes konversi into sale_items.harga_pokok', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0012_friendly_sally_floyd')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Kopi ABC', 500000, 700000, 300, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (1, 'PCS', 'Pieces', 'pcs', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (2, 'DUS', 'Dus', 'dus', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (10, 1, 1, 1, 1, 700000, 1, 1, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (11, 1, 2, 100, 100, 68000000, 0, 0, 0, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (1, 'tunai', 'selesai', 68700000, 68700000, unixepoch(), unixepoch())`)
    // one base-unit line (konversi 1) and one DUS line (konversi 100)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, product_unit_id, qty, konversi, base_quantity, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (1, 1, 1, 10, 1, 1, 1, 'PCS', 700000, 500000, 700000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, product_unit_id, qty, konversi, base_quantity, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (2, 1, 1, 11, 1, 100, 100, 'DUS', 68000000, 500000, 68000000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const unitCosts = fullDb.all<{ id: number; harga_pokok: number }>(
      sql`SELECT id, harga_pokok FROM product_units ORDER BY id`,
    )
    const saleCosts = fullDb.all<{ id: number; harga_pokok: number }>(
      sql`SELECT id, harga_pokok FROM sale_items ORDER BY id`,
    )
    fullDb.$client.close()
    cleanup()

    expect(unitCosts).toEqual([
      { id: 10, harga_pokok: 500000 },
      { id: 11, harga_pokok: 50000000 },
    ])
    // profit is unchanged: it used to be subtotal - qty * konversi * harga_pokok,
    // and is now subtotal - qty * harga_pokok against these baked-in values
    expect(saleCosts).toEqual([
      { id: 1, harga_pokok: 500000 },
      { id: 2, harga_pokok: 50000000 },
    ])
  })

  it('backfills parent_unit_id to the chain each derived unit was implicitly measured in', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0013_calm_silhouette')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Kopi ABC', 100000, 150000, 300, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (1, 'PCS', 'Pieces', 'pcs', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (2, 'RTG', 'Renteng', 'rtg', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (3, 'DUS', 'Dus', 'dus', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (10, 1, 1, 1, 1, 150000, 100000, 1, 1, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (11, 1, 2, 12, 12, 1500000, 1200000, 0, 0, 0, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (12, 1, 3, 20, 240, 25000000, 22000000, 0, 0, 0, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const rows = fullDb.all<{ id: number; parent_unit_id: number | null }>(
      sql`SELECT id, parent_unit_id FROM product_units ORDER BY id`,
    )
    fullDb.$client.close()
    cleanup()

    // the base row has no parent; RTG was measured in the base; DUS was measured in RTG
    expect(rows).toEqual([
      { id: 10, parent_unit_id: null },
      { id: 11, parent_unit_id: null },
      { id: 12, parent_unit_id: 11 },
    ])
  })
})

describe('migration 0014', () => {
  it('backfills existing purchases as paid in full so no debt is invented', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0014_jittery_marten_broadcloak')

    try {
      const before = createDb(dbFile, partialFolder)
      const now = Date.now()

      before.run(
        sql`INSERT INTO purchases (id, supplier_id, user_id, tanggal, total, catatan, created_at, updated_at)
            VALUES (1, NULL, NULL, '2026-08-01', 500000, NULL, ${now}, ${now}),
                   (2, NULL, NULL, '2026-08-02', 0, NULL, ${now}, ${now})`,
      )

      before.$client.close()

      const after = createDb(dbFile, migrationsFolder)
      const rows = after.all<{ id: number; total: number; dibayar: number }>(
        sql`SELECT id, total, dibayar FROM purchases ORDER BY id`,
      )
      after.$client.close()

      expect(rows).toEqual([
        { id: 1, total: 500000, dibayar: 500000 },
        { id: 2, total: 0, dibayar: 0 },
      ])
    } finally {
      cleanup()
    }
  })
})
