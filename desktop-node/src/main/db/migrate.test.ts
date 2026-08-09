import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, eq, sql } from 'drizzle-orm'
import { createDb } from './migrate'
import { products, productUnits, units } from './schema'

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
  it('creates all 15 business tables', () => {
    const db = createDb(':memory:', migrationsFolder)

    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
    )
    const tableNames = rows.map((row) => row.name).sort()

    expect(tableNames).toEqual(
      [
        'bon_payments',
        'categories',
        'product_price_histories',
        'product_price_tiers',
        'product_units',
        'products',
        'purchase_items',
        'purchases',
        'sale_items',
        'sales',
        'stock_adjustments',
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
    // Base rows carry the product's harga_jual; promoted rows keep their own price.
    expect(rows.find((r) => r.product_id === 1 && r.is_base_unit === 1)?.harga_jual).toBe(150000)
    expect(rows.find((r) => r.product_id === 3)?.id).toBe(3)
  })
})
