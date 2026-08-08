import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from './migrate'
import { products, productUnits, sales, saleItems } from './schema'

describe('createDb', () => {
  it('creates all 14 business tables', () => {
    const migrationsFolder = path.resolve(__dirname, '../../../drizzle')
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
        'users',
      ].sort(),
    )
  })

  it('does not null out sale_items.product_unit_id when applying the product_units table-rebuild migration to a database with existing data', () => {
    const migrationsFolder = path.resolve(__dirname, '../../../drizzle')

    // Migration 0005 rebuilds product_units via DROP TABLE, which triggers sale_items'
    // ON DELETE SET NULL if foreign_keys enforcement is active during the migration
    // transaction. To exercise that, seed data on a database migrated only up to 0004
    // (before the rebuild), then reopen it through the full migrations folder so 0005
    // runs against a database that already has a sale_items row pointing at product_units.
    const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf-8')) as {
      entries: { tag: string }[]
    }
    const rebuildIndex = journal.entries.findIndex((e) => e.tag === '0005_massive_siren')
    const priorEntries = journal.entries.slice(0, rebuildIndex)

    const partialFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-migrate-partial-'))
    fs.mkdirSync(path.join(partialFolder, 'meta'))
    fs.writeFileSync(path.join(partialFolder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: priorEntries }))
    for (const entry of priorEntries) {
      fs.copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(partialFolder, `${entry.tag}.sql`))
    }

    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-migrate-db-'))
    const dbFile = path.join(dbDir, 'test.db')
    const now = new Date()

    const partialDb = createDb(dbFile, partialFolder)
    partialDb
      .insert(products)
      .values({
        id: 1,
        kodeItem: 'RKK1',
        barcode: null,
        namaItem: 'Rokok A',
        categoryId: null,
        satuan: 'Pcs',
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 100,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    partialDb
      .insert(productUnits)
      .values({ id: 1, productId: 1, satuan: 'Renteng', jumlahKemasan: 12, konversi: 12, hargaJual: 15000_00, createdAt: now, updatedAt: now })
      .run()
    partialDb
      .insert(sales)
      .values({ id: 1, userId: null, namaPelanggan: null, metodePembayaran: 'tunai', status: 'selesai', total: 15000_00, dibayar: 15000_00, createdAt: now, updatedAt: now })
      .run()
    partialDb
      .insert(saleItems)
      .values({ id: 1, saleId: 1, productId: 1, productUnitId: 1, qty: 1, konversi: 12, satuan: 'Renteng', hargaJual: 15000_00, hargaPokok: 12000_00, subtotal: 15000_00, createdAt: now, updatedAt: now })
      .run()
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const row = fullDb.select({ productUnitId: saleItems.productUnitId }).from(saleItems).where(sql`${saleItems.id} = 1`).get()
    fullDb.$client.close()

    fs.rmSync(partialFolder, { recursive: true, force: true })
    fs.rmSync(dbDir, { recursive: true, force: true })

    expect(row?.productUnitId).toBe(1)
  })
})
