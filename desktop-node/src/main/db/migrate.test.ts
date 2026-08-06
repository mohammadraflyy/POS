import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { createDb } from './migrate'

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
})
