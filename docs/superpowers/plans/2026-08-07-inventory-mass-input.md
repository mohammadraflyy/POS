# Inventory Slice 3: Mass Input & Import Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full-page Mass Input grid (blank-add and edit-selected modes) plus an Import Excel button, closing the last two gaps in the Katalog Produk module — "Tambah Produk" and "Edit Massal" have been disabled since Slice 1.

**Architecture:** A new `main/inventory-bulk.ts` houses batch create/update business logic shared by both features (`saveProductRows`), plus each feature's own entry point (`bulkSaveProducts` for Mass Input's all-or-nothing validated save, `importProducts` for Excel's lenient parse-and-save). New IPC channels expose these; a new `MassInput.tsx` page and small `Inventory.tsx` additions wire up the renderer.

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, `xlsx` (SheetJS, new dependency), Vitest.

## Global Constraints

- **`xlsx` (SheetJS)** is the new dependency for Excel parsing — pure JavaScript, zero native bindings (deliberately chosen to avoid this project's prior native-dependency pain from the ESC/POS printing work). Install via `npm install xlsx` (unpinned — let npm resolve the current published version).
- **File picking happens in the main process** via Electron's native `dialog.showOpenDialog`, never in the renderer.
- **Mass Input is all-or-nothing**: every row is validated before any write; if any row fails, nothing is saved and a per-row error map returns to the grid. Implemented via `db.transaction(...)`, this codebase's established atomic-write pattern (already used in `kasir.ts`'s checkout/cancelSale/recordBonPayment).
- **Import Excel is lenient/partial**: invalid or incomplete rows are skipped and counted, never block the rest of the file. This is a deliberate, faithful asymmetry from Mass Input.
- **Stock handling differs by path**: Mass Input never touches stock on an update (`updateStok: false`, only set on create) — stock changes route through Purchase/Stock Opname. Import Excel's sheet value wins on update (`updateStok: true`), and any actual change is logged to `stock_adjustments` with `alasan: 'Import Excel'` — the first desktop-node feature to write that table.
- **Deliberate improvement over the web app** (prevents a real crash, not scope creep): Import Excel deduplicates `kodeItem` collisions *within the uploaded file itself* before saving (first occurrence wins, later ones skip+count) — the original app has no such check and a same-file duplicate would crash on the database's unique constraint.
- **Money validation**: every `hargaPokok`/`hargaJual` input requires `Number.isFinite(...)` AND `>= 0` checks in business logic (mirrors Slices 1-2's fix for the `Number("") === 0` bug class). Client-side forms must reject empty/whitespace input before calling `Number(...)` and before any IPC call.
- Money crosses the IPC boundary as Rupiah `number`; stored/computed in integer cents in `main/inventory-bulk.ts` (local `toRupiah`/`toCents`, matching the per-file convention already in `ipc/inventory.ts`). `importProducts` is the one exception: since it reads the spreadsheet directly in the main process (no IPC round-trip for those raw numbers), the Rupiah→cents conversion happens inside `importProducts` itself.
- Every IPC handler is auth-guarded: `if (!getCurrentUser()) { throw new Error('Silakan login terlebih dahulu.') }`.
- `getProductsByIds`/Mass Input's badge column reuse Slice 2's already-built `ProductDetailDialog` component as-is — no changes to it.
- No changes to Kasir, Slice 1's core grid validation, or any other existing feature beyond the specific edits named in this plan.

---

### Task 1: Shared batch-save business logic (`saveProductRows`, `bulkSaveProducts`, `getProductsByIds`)

**Files:**
- Create: `desktop-node/src/main/inventory-bulk.ts`
- Test: `desktop-node/src/main/inventory-bulk.test.ts`

**Interfaces:**
- Consumes: `categories`, `products`, `productPriceHistories`, `productUnits`, `productPriceTiers`, `stockAdjustments` from `./db/schema` (existing).
- Produces:
  - `export interface BulkSaveRow { key: string; id: number | null; kodeItem: string; barcode: string | null; namaItem: string; kategori: string | null; satuan: string; hargaPokok: number; hargaJual: number; stok: number }` (money in cents)
  - `export interface ProductForBulkEdit { id: number; kodeItem: string; barcode: string | null; namaItem: string; categoryName: string | null; satuan: string; hargaPokok: number; hargaJual: number; stok: number; unitsCount: number; priceTiersCount: number }` (money in cents)
  - `export function getProductsByIds(db, ids: number[]): ProductForBulkEdit[]`
  - `export function validateBulkRows(db, rows: BulkSaveRow[]): Record<string, Record<string, string>>`
  - `export interface SaveProductRowsOptions { updateStok: boolean; userId: number | null }`
  - `export interface SaveProductRowsResult { created: number; updated: number; unchanged: number }`
  - `export function saveProductRows(db, rows: BulkSaveRow[], options: SaveProductRowsOptions): SaveProductRowsResult`
  - `export type BulkSaveResult = { success: true; created: number; updated: number; unchanged: number } | { success: false; rowErrors: Record<string, Record<string, string>> }`
  - `export function bulkSaveProducts(db, rows: BulkSaveRow[], userId: number | null): BulkSaveResult`
  - Task 2's IPC layer calls all of the above with these exact signatures. Task 4 extends this same file with `importProducts`, reusing `saveProductRows`.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/inventory-bulk.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, stockAdjustments } from './db/schema'
import { getProductsByIds, saveProductRows, validateBulkRows, bulkSaveProducts, type BulkSaveRow } from './inventory-bulk'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(categories).values({ id: 1, nama: 'Sembako', createdAt: now, updatedAt: now }).run()

  db.insert(products)
    .values({
      id: 1,
      kodeItem: 'BRS5',
      barcode: '1234567890',
      namaItem: 'Beras 5kg',
      categoryId: 1,
      satuan: 'PCS',
      hargaPokok: 60000_00,
      hargaJual: 65000_00,
      stok: 10,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run inventory-bulk.test.ts`
Expected: FAIL — `Cannot find module './inventory-bulk'`.

- [ ] **Step 3: Implement `inventory-bulk.ts`**

Create `desktop-node/src/main/inventory-bulk.ts`:

```typescript
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run inventory-bulk.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/inventory-bulk.ts src/main/inventory-bulk.test.ts
git status --short
```

Verify the output shows ONLY those two files — never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add shared batch product-save business logic for Mass Input"
```

---

### Task 2: Mass Input IPC handlers, preload, renderer types

**Files:**
- Modify: `desktop-node/src/main/ipc/inventory.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `getProductsByIds`, `bulkSaveProducts`, `BulkSaveRow` from Task 1's `main/inventory-bulk.ts`.
- Produces: IPC channels `inventory:getProductsByIds`, `inventory:bulkSaveProducts`; `window.api.inventory.getProductsByIds`/`bulkSaveProducts` — Task 3's renderer calls these exact names.

- [ ] **Step 1: Extend the IPC handlers**

In `desktop-node/src/main/ipc/inventory.ts`, find:

```typescript
import {
  getProductDetail,
  setProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  type ProductUnitRow,
} from '../inventory-units'
import { getCurrentUser } from './auth'
```

Replace with:

```typescript
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
```

Find the closing `}` of `registerInventoryIpc` (immediately after the existing `inventory:deletePriceTier` handler):

```typescript
  ipcMain.handle('inventory:deletePriceTier', (_event, productId: number, tierId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deletePriceTier(db, productId, tierId)
  })
}
```

Replace with:

```typescript
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
```

- [ ] **Step 2: Expose the new channels in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    deletePriceTier: (productId: number, tierId: number) => invoke('inventory:deletePriceTier', productId, tierId),
  },
}
```

Replace with:

```typescript
    deletePriceTier: (productId: number, tierId: number) => invoke('inventory:deletePriceTier', productId, tierId),
    getProductsByIds: (ids: number[]) => invoke('inventory:getProductsByIds', ids),
    bulkSaveProducts: (
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
    ) => invoke('inventory:bulkSaveProducts', rows),
  },
}
```

- [ ] **Step 3: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
        deletePriceTier: (productId: number, tierId: number) => Promise<void>
      }
    }
  }
}
```

Replace with:

```typescript
        deletePriceTier: (productId: number, tierId: number) => Promise<void>
        getProductsByIds: (ids: number[]) => Promise<
          {
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
          }[]
        >
        bulkSaveProducts: (
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
        ) => Promise<
          | { success: true; created: number; updated: number; unchanged: number }
          | { success: false; rowErrors: Record<string, Record<string, string>> }
        >
      }
    }
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (no new automated tests in this task; business logic is already covered by Task 1).

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/ipc/inventory.ts src/preload/index.ts src/renderer/env.d.ts
git status --short
```

Verify the output shows ONLY those three files.

```bash
git commit -m "Add Mass Input IPC handlers"
```

---

### Task 3: `MassInput.tsx` page, routing, enable Tambah Produk/Edit Massal, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/inventory/MassInput.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `window.api.inventory.getProductsByIds`/`bulkSaveProducts` (Task 2); `ProductDetailDialog` (Slice 2, existing, unchanged); `AppShell`, `DataGrid`/`renderTextEditor`, `Badge`, `Button`, `useElementWidth`, `useAvailableHeight`, `useAppearance` (all existing).
- Produces: `export function MassInput()` — a full page component; `App.tsx` renders it at `/inventory/mass-input`.

- [ ] **Step 1: Create `MassInput.tsx`**

Create `desktop-node/src/renderer/pages/inventory/MassInput.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Column } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { AppShell } from '../../layouts/AppShell'
import type { BreadcrumbItem } from '../../types'
import { ProductDetailDialog } from './ProductDetailDialog'

interface DraftRow {
  key: string
  id: number | null
  kodeItem: string
  barcode: string
  namaItem: string
  kategori: string
  satuan: string
  hargaPokok: string
  hargaJual: string
  stok: string
  unitsCount: number
  priceTiersCount: number
}

function emptyRow(): DraftRow {
  return {
    key: crypto.randomUUID(),
    id: null,
    kodeItem: '',
    barcode: '',
    namaItem: '',
    kategori: '',
    satuan: '',
    hargaPokok: '',
    hargaJual: '',
    stok: '0',
    unitsCount: 0,
    priceTiersCount: 0,
  }
}

const OTHER_COLUMNS_WIDTH = 110 + 130 + 130 + 90 + 110 + 110 + 90 + 170 + 60
const MIN_NAMA_WIDTH = 220

const BREADCRUMBS: BreadcrumbItem[] = [
  { title: 'Katalog Produk', href: '/inventory' },
  { title: 'Input Massal', href: '/inventory/mass-input' },
]

export function MassInput() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72)

  const [rows, setRows] = useState<DraftRow[]>([emptyRow(), emptyRow(), emptyRow()])
  const [rowErrors, setRowErrors] = useState<Record<string, Record<string, string>>>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [processing, setProcessing] = useState(false)
  const [detailProductId, setDetailProductId] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const idsParam = searchParams.get('ids')

    if (!idsParam) {
      setLoaded(true)
      return
    }

    const ids = idsParam
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))

    if (ids.length === 0) {
      setLoaded(true)
      return
    }

    window.api.inventory.getProductsByIds(ids).then((fetched) => {
      setRows(
        fetched.map((p) => ({
          key: `product-${p.id}`,
          id: p.id,
          kodeItem: p.kodeItem,
          barcode: p.barcode ?? '',
          namaItem: p.namaItem,
          kategori: p.categoryName ?? '',
          satuan: p.satuan,
          hargaPokok: String(p.hargaPokok),
          hargaJual: String(p.hargaJual),
          stok: String(p.stok),
          unitsCount: p.unitsCount,
          priceTiersCount: p.priceTiersCount,
        })),
      )
      setLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }

  function refreshRowCounts(productId: number) {
    window.api.inventory.getProductsByIds([productId]).then((results) => {
      const updated = results[0]
      if (!updated) {
        return
      }
      setRows((prev) =>
        prev.map((row) =>
          row.id === productId ? { ...row, unitsCount: updated.unitsCount, priceTiersCount: updated.priceTiersCount } : row,
        ),
      )
    })
  }

  function validateClientSide(): Record<string, Record<string, string>> {
    const errors: Record<string, Record<string, string>> = {}

    function addError(key: string, field: string, message: string) {
      errors[key] = { ...(errors[key] ?? {}), [field]: message }
    }

    for (const row of rows) {
      if (!row.kodeItem.trim()) {
        addError(row.key, 'kodeItem', 'Wajib diisi.')
      }
      if (!row.namaItem.trim()) {
        addError(row.key, 'namaItem', 'Wajib diisi.')
      }
      if (!row.satuan.trim()) {
        addError(row.key, 'satuan', 'Wajib diisi.')
      }
      if (row.hargaPokok.trim() === '' || !Number.isFinite(Number(row.hargaPokok))) {
        addError(row.key, 'hargaPokok', 'Harus angka.')
      }
      if (row.hargaJual.trim() === '' || !Number.isFinite(Number(row.hargaJual))) {
        addError(row.key, 'hargaJual', 'Harus angka.')
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

    return errors
  }

  function submit() {
    const clientErrors = validateClientSide()

    if (Object.keys(clientErrors).length > 0) {
      setRowErrors(clientErrors)
      setFormError('Periksa kembali baris yang bertanda merah.')
      return
    }

    setProcessing(true)
    setFormError(undefined)

    window.api.inventory
      .bulkSaveProducts(
        rows.map((row) => ({
          key: row.key,
          id: row.id,
          kodeItem: row.kodeItem,
          barcode: row.barcode || null,
          namaItem: row.namaItem,
          kategori: row.kategori || null,
          satuan: row.satuan,
          hargaPokok: Number(row.hargaPokok),
          hargaJual: Number(row.hargaJual),
          stok: Number(row.stok) || 0,
        })),
      )
      .then((result) => {
        if (result.success) {
          navigate('/inventory')
          return
        }

        setRowErrors(result.rowErrors)
        setFormError('Beberapa baris gagal disimpan, periksa kembali.')
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan')
      })
      .finally(() => setProcessing(false))
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  function textColumn(key: keyof DraftRow, name: string, width?: number): Column<DraftRow> {
    return {
      key,
      name,
      width,
      editable: true,
      renderEditCell: renderTextEditor,
      cellClass: (row) => (rowErrors[row.key]?.[key] ? 'bg-red-100 dark:bg-red-950' : undefined),
    }
  }

  const columns: Column<DraftRow>[] = [
    textColumn('kodeItem', 'Kode Item', 110),
    textColumn('barcode', 'Barcode', 130),
    textColumn('namaItem', 'Nama Item', namaWidth),
    textColumn('kategori', 'Kategori', 130),
    textColumn('satuan', 'Satuan', 90),
    textColumn('hargaPokok', 'Harga Pokok', 110),
    textColumn('hargaJual', 'Harga Jual', 110),
    {
      key: 'stok',
      name: 'Stok',
      width: 90,
      editable: (row) => row.id === null,
      renderEditCell: renderTextEditor,
      renderCell: ({ row }) => (row.id === null ? row.stok : <span className="text-muted-foreground">{row.stok}</span>),
    },
    {
      key: 'units',
      name: 'Satuan/Harga Bertingkat',
      width: 170,
      renderCell: ({ row }) => {
        if (row.id === null) {
          return <span className="text-xs text-muted-foreground">Simpan baris dulu</span>
        }
        return (
          <button type="button" className="flex h-full items-center gap-1" onClick={() => setDetailProductId(row.id)}>
            <Badge variant={row.unitsCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {row.unitsCount} unit
            </Badge>
            <Badge variant={row.priceTiersCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {row.priceTiersCount} tingkat
            </Badge>
          </button>
        )
      },
    },
    {
      key: 'remove',
      name: '',
      width: 60,
      renderCell: ({ row }) => (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => removeRow(row.key)}
        >
          Hapus
        </button>
      ),
    },
  ]

  const errorSummary = rows.flatMap((row, index) =>
    Object.values(rowErrors[row.key] ?? {}).map((message) => `Baris ${index + 1}: ${message}`),
  )

  if (!loaded) {
    return (
      <AppShell breadcrumbs={BREADCRUMBS}>
        <div className="p-4 text-sm text-muted-foreground">Memuat...</div>
      </AppShell>
    )
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Input Massal Produk</h1>
          <Button variant="outline" size="sm" onClick={addRow}>
            + Tambah Baris
          </Button>
        </div>

        <div
          ref={(node) => {
            widthRef(node)
            heightRef(node)
          }}
          className="overflow-x-auto"
        >
          {gridWidth > 0 && (
            <DataGrid
              className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.key}
              onRowsChange={setRows}
              style={{ blockSize: gridHeight, minHeight: 300 }}
            />
          )}
        </div>

        {errorSummary.length > 0 && (
          <div className="space-y-1 text-sm text-destructive">
            {errorSummary.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={submit} disabled={processing}>
            Simpan Semua
          </Button>
          <Button variant="outline" onClick={() => navigate('/inventory')}>
            Batal
          </Button>
        </div>
      </div>

      <ProductDetailDialog
        productId={detailProductId}
        productNama={rows.find((r) => r.id === detailProductId)?.namaItem ?? null}
        baseSatuan={rows.find((r) => r.id === detailProductId)?.satuan ?? ''}
        onOpenChange={(open) => !open && setDetailProductId(null)}
        onChanged={() => detailProductId !== null && refreshRowCounts(detailProductId)}
      />
    </AppShell>
  )
}
```

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, find:

```typescript
import { Inventory } from './pages/Inventory'
```

Replace with:

```typescript
import { Inventory } from './pages/Inventory'
import { MassInput } from './pages/inventory/MassInput'
```

Find:

```typescript
        <Route path="/inventory" element={<Inventory />} />
```

Replace with:

```typescript
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/mass-input" element={<MassInput />} />
```

- [ ] **Step 3: Enable "Tambah Produk" and "Edit Massal"**

In `desktop-node/src/renderer/pages/Inventory.tsx`, find:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
```

Replace with:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
```

Find:

```typescript
export function Inventory() {
  const { resolvedAppearance } = useAppearance()
```

Replace with:

```typescript
export function Inventory() {
  const navigate = useNavigate()
  const { resolvedAppearance } = useAppearance()
```

Find:

```typescript
            <Button type="button" variant="outline" disabled title="Menunggu fitur Mass Input">
              Edit Massal ({selectedIds.size})
            </Button>
            <Button type="button" variant="destructive" disabled={selectedIds.size === 0} onClick={deleteSelected}>
              Hapus Terpilih ({selectedIds.size})
            </Button>
            <Button type="button" disabled title="Menunggu fitur Mass Input">
              Tambah Produk
            </Button>
```

Replace with:

```typescript
            <Button
              type="button"
              variant="outline"
              disabled={selectedIds.size === 0}
              onClick={() => navigate(`/inventory/mass-input?ids=${[...selectedIds].join(',')}`)}
            >
              Edit Massal ({selectedIds.size})
            </Button>
            <Button type="button" variant="destructive" disabled={selectedIds.size === 0} onClick={deleteSelected}>
              Hapus Terpilih ({selectedIds.size})
            </Button>
            <Button type="button" onClick={() => navigate('/inventory/mass-input')}>
              Tambah Produk
            </Button>
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green, no regressions.

- [ ] **Step 6: Rebuild for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 7: Manual end-to-end verification via CDP**

Log in as `admin`/`password`. Using the established CDP pattern (query `http://127.0.0.1:9222/json`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`, and at least one `Page.captureScreenshot` for real visual confirmation, not just `innerText`):

1. On `/inventory`, confirm "Tambah Produk" and "Edit Massal (0)" are no longer dimmed/disabled (compare against a still-genuinely-disabled Kasir-side button if any remain, or just check `.disabled` on the DOM node is `false`/absent for Tambah Produk, and `true` for Edit Massal while 0 rows are selected).
2. Click "Tambah Produk". Confirm navigation to `/inventory/mass-input`, breadcrumb reads "Katalog Produk / Input Massal", grid shows 3 blank rows.
3. Click "+ Tambah Baris" — confirm a 4th blank row appears.
4. Fill in one row's Kode Item/Nama Item/Satuan/Harga Pokok/Harga Jual with valid values, leave the other 3 rows blank, click "Simpan Semua". Confirm the all-or-nothing behavior: since the blank rows are invalid, NOTHING should save — confirm red-cell highlighting appears on the blank rows' required fields, an error summary lists them, and the URL stays on `/inventory/mass-input` (no navigation away).
5. Click "Hapus" on the 3 blank rows to remove them from the grid (client-side only), leaving just the one valid row. Click "Simpan Semua" again — confirm it succeeds this time (navigates back to `/inventory`), and the new product appears in the main grid.
6. From `/inventory`, select 2 products via checkboxes, click "Edit Massal (2)". Confirm navigation to `/inventory/mass-input?ids=...`, and the grid pre-fills exactly those 2 products' current values (kode item, nama, harga, etc. match what's shown in the main grid) — confirm their Stok cells are NOT editable (no edit cursor/read-only styling) and their Satuan/Harga Bertingkat column shows real badge counts (not "Simpan baris dulu"), matching Slice 2's dialog data for those products.
7. Edit one of the pre-filled rows' Nama Item, click "Simpan Semua". Confirm it succeeds and the change is reflected back on `/inventory`'s main grid after navigating back.
8. Attempt to add a new row (via "+ Tambah Baris") with a Kode Item that collides with an EXISTING product already in the database (not in this batch) — confirm the server-side "Kode item sudah digunakan." error appears after clicking "Simpan Semua" (this exercises the DB-uniqueness check, not just the client-side within-batch check).
9. On a saved row (has a real product id), click its Satuan/Harga Bertingkat badges — confirm Slice 2's `ProductDetailDialog` opens showing that exact product's data (reusing the already-built, already-tested dialog with zero changes).
10. Click "Batal" — confirm navigation back to `/inventory` with no save attempted.
11. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/inventory/MassInput.tsx src/renderer/App.tsx src/renderer/pages/Inventory.tsx
git status --short
```

Verify the output shows ONLY those three files.

```bash
git commit -m "Add Mass Input page, enable Tambah Produk and Edit Massal"
```

---

### Task 4: `xlsx` dependency and `importProducts` business logic

**Files:**
- Modify: `desktop-node/package.json`, `desktop-node/package-lock.json` (via `npm install`)
- Modify: `desktop-node/src/main/inventory-bulk.ts`
- Modify: `desktop-node/src/main/inventory-bulk.test.ts`

**Interfaces:**
- Consumes: `saveProductRows`, `BulkSaveRow` from Task 1 (same file).
- Produces: `export interface ImportResult { created: number; updated: number; unchanged: number; skipped: number }`; `export function importProducts(db, filePath: string, userId: number | null): ImportResult` — Task 5's IPC layer calls this exact signature.

- [ ] **Step 1: Install the dependency**

```bash
cd desktop-node
npm install xlsx
```

Expected: `package.json`'s `dependencies` gains an `"xlsx": "^X.Y.Z"` entry (whatever version npm resolves), `package-lock.json` updates accordingly.

- [ ] **Step 2: Write the failing tests**

In `desktop-node/src/main/inventory-bulk.test.ts`, find:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, stockAdjustments } from './db/schema'
import { getProductsByIds, saveProductRows, validateBulkRows, bulkSaveProducts, type BulkSaveRow } from './inventory-bulk'
```

Replace with:

```typescript
import { describe, expect, it, afterEach } from 'vitest'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, stockAdjustments } from './db/schema'
import {
  getProductsByIds,
  saveProductRows,
  validateBulkRows,
  bulkSaveProducts,
  importProducts,
  type BulkSaveRow,
} from './inventory-bulk'
```

Then append this at the end of the file:

```typescript
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

    const result = importProducts(db, filePath, 4)
    expect(result).toEqual({ created: 0, updated: 1, unchanged: 0, skipped: 0 })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(999)

    const adjustments = db.select().from(stockAdjustments).where(eq(stockAdjustments.productId, 1)).all()
    expect(adjustments).toHaveLength(1)
    expect(adjustments[0]).toMatchObject({ stokSebelum: 10, stokSesudah: 999, alasan: 'Import Excel', userId: 4 })
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run inventory-bulk.test.ts`
Expected: FAIL — `importProducts` not exported yet.

- [ ] **Step 4: Implement `importProducts`**

In `desktop-node/src/main/inventory-bulk.ts`, find:

```typescript
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productPriceHistories, productUnits, productPriceTiers, stockAdjustments } from './db/schema'
```

Replace with:

```typescript
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as XLSX from 'xlsx'
import * as schema from './db/schema'
import { categories, products, productPriceHistories, productUnits, productPriceTiers, stockAdjustments } from './db/schema'
```

Then append at the end of the file:

```typescript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run inventory-bulk.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 8: Commit**

```bash
cd desktop-node
git add package.json package-lock.json src/main/inventory-bulk.ts src/main/inventory-bulk.test.ts
git status --short
```

Verify the output shows ONLY those four files.

```bash
git commit -m "Add xlsx dependency and Import Excel business logic"
```

---

### Task 5: Import Excel IPC handler, preload, renderer wiring, verification

**Files:**
- Modify: `desktop-node/src/main/ipc/inventory.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`
- Modify: `desktop-node/src/renderer/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `importProducts` from Task 4's `main/inventory-bulk.ts`; `getMainWindow` from `../index` (existing, already used by `ipc/kasir.ts`).
- Produces: IPC channel `inventory:importProducts`; `window.api.inventory.importProducts()`.

- [ ] **Step 1: Add the IPC handler**

In `desktop-node/src/main/ipc/inventory.ts`, find:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
```

Replace with:

```typescript
import { dialog, ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { getMainWindow } from '../index'
```

Find:

```typescript
import { getProductsByIds, bulkSaveProducts, type BulkSaveRow } from '../inventory-bulk'
```

Replace with:

```typescript
import { getProductsByIds, bulkSaveProducts, importProducts, type BulkSaveRow } from '../inventory-bulk'
```

Find the closing `}` of `registerInventoryIpc` (immediately after the existing `inventory:bulkSaveProducts` handler):

```typescript
      return bulkSaveProducts(db, bulkRows, user.id)
    },
  )
}
```

Replace with:

```typescript
      return bulkSaveProducts(db, bulkRows, user.id)
    },
  )

  ipcMain.handle('inventory:importProducts', async () => {
    const user = getCurrentUser()
    if (!user) {
      throw new Error('Silakan login terlebih dahulu.')
    }

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
}
```

- [ ] **Step 2: Expose the channel in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    ) => invoke('inventory:bulkSaveProducts', rows),
  },
}
```

Replace with:

```typescript
    ) => invoke('inventory:bulkSaveProducts', rows),
    importProducts: () => invoke('inventory:importProducts'),
  },
}
```

- [ ] **Step 3: Add the renderer type**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
          | { success: true; created: number; updated: number; unchanged: number }
          | { success: false; rowErrors: Record<string, Record<string, string>> }
        >
      }
    }
  }
}
```

Replace with:

```typescript
          | { success: true; created: number; updated: number; unchanged: number }
          | { success: false; rowErrors: Record<string, Record<string, string>> }
        >
        importProducts: () => Promise<{ created: number; updated: number; unchanged: number; skipped: number } | null>
      }
    }
  }
}
```

- [ ] **Step 4: Wire the "Import Excel" button into `Inventory.tsx`**

In `desktop-node/src/renderer/pages/Inventory.tsx`, find:

```typescript
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<ProductRow[]>([])

  const [detailProductId, setDetailProductId] = useState<number | null>(null)
```

Replace with:

```typescript
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<ProductRow[]>([])

  const [detailProductId, setDetailProductId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  function runImport() {
    setImporting(true)
    setImportResult(null)

    window.api.inventory
      .importProducts()
      .then((result) => {
        if (result === null) {
          return
        }

        setImportResult(
          `${result.created} produk baru, ${result.updated} diperbarui, ${result.unchanged} tidak berubah, ${result.skipped} baris dilewati.`,
        )
        loadPage(currentPage)
      })
      .catch((err) => {
        setImportResult(err instanceof Error ? err.message : 'Gagal mengimpor')
      })
      .finally(() => setImporting(false))
  }
```

Find:

```typescript
            <Button
              type="button"
              variant="outline"
              disabled={selectedIds.size === 0}
              onClick={() => navigate(`/inventory/mass-input?ids=${[...selectedIds].join(',')}`)}
            >
              Edit Massal ({selectedIds.size})
            </Button>
```

Replace with:

```typescript
            <Button type="button" variant="outline" disabled={importing} onClick={runImport}>
              {importing ? 'Mengimpor...' : 'Import Excel'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={selectedIds.size === 0}
              onClick={() => navigate(`/inventory/mass-input?ids=${[...selectedIds].join(',')}`)}
            >
              Edit Massal ({selectedIds.size})
            </Button>
```

Find:

```typescript
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
```

Replace with:

```typescript
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        {importResult && (
          <p role="status" className="text-sm text-muted-foreground">
            {importResult}
          </p>
        )}
```

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green, no regressions.

- [ ] **Step 7: Rebuild for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

- [ ] **Step 8: Manual verification via CDP — with an explicit, deliberate scope boundary**

Electron's `dialog.showOpenDialog` opens a native OS-level file picker that Chrome DevTools Protocol cannot see or interact with (it lives entirely outside the page's DOM/JS context) — this is a structural limitation of CDP-based testing, not a corner being cut. Task 4's business-logic tests already comprehensively cover `importProducts`'s actual parsing/import correctness against real `.xlsx` files (9 tests: creation, update, header-detection with a title block, column-order independence, leniency/skip-counting, blank-row handling, within-file dedup, thousands-separator parsing, no-header-found). This step verifies only the renderer-side UI wiring (button state, result message rendering) by stubbing the IPC call to bypass the native dialog:

1. Log in, navigate to `/inventory`. Confirm the "Import Excel" button is present and enabled (not dimmed).
2. Via CDP `Runtime.evaluate`, temporarily monkey-patch `window.api.inventory.importProducts` to return a canned promise instead of calling the real IPC channel:
   ```js
   window.api.inventory.importProducts = () => new Promise((resolve) => setTimeout(() => resolve({ created: 3, updated: 1, unchanged: 2, skipped: 1 }), 300))
   ```
3. Click "Import Excel". Confirm the button immediately shows "Mengimpor..." and is disabled while the (stubbed) promise is pending.
4. After it resolves, confirm the button reverts to "Import Excel" (enabled), and the result message renders: `"3 produk baru, 1 diperbarui, 2 tidak berubah, 1 baris dilewati."` — take a screenshot confirming this text is genuinely visible (not clipped/invisible), matching this project's established convention of visually confirming error/status text after Slice 1's final review caught a case where DOM text existed but wasn't actually visible.
5. Reload the page (clearing the monkey-patch) and confirm the real `window.api.inventory.importProducts` is restored to the genuine IPC-backed implementation (i.e., calling it now would open the real native dialog — do not actually click the button again post-reload, since there is no way to drive the resulting native dialog via CDP; simply confirm via `typeof window.api.inventory.importProducts === 'function'` that the page reload restored the original preload-injected function, not the stubbed one).
6. If a real bug is found in the button/message UI wiring (not the business logic, which Task 4 already verified), fix it and re-verify.

- [ ] **Step 9: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 10: Commit**

```bash
cd desktop-node
git add src/main/ipc/inventory.ts src/preload/index.ts src/renderer/env.d.ts src/renderer/pages/Inventory.tsx
git status --short
```

Verify the output shows ONLY those four files.

```bash
git commit -m "Add Import Excel button and wire the native file-picker IPC flow"
```

---

## Plan Self-Review

**Spec coverage:** §1 (file structure, `xlsx` dependency, main-process file picking) → Tasks 1/4/5. §2 Mass Input (route/entry points, grid shape, stok editable-only-when-new, badge column reusing `ProductDetailDialog`, client+server validation, within-batch and DB-level duplicate detection, all-or-nothing atomic save, `saveProductRows` create/update/unchanged/price-history logic) → Tasks 1-3. §3 Import Excel (flow, column detection with title-block/column-order tolerance, leniency/skip-counting, within-file dedup improvement, `updateStok: true`/`stock_adjustments` logging, result summary) → Tasks 4-5. §4 shared `saveProductRows` → Task 1, reused unchanged by Task 4. Out-of-scope items (units/tiers editing pre-save, undo, preview-before-import, no Kasir changes) — untouched by every task.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code. The `DbOrTx`/`Tx` type derivation was empirically verified to compile against this project's actual installed `drizzle-orm` version before being written into the plan (not assumed).

**Type consistency:** `BulkSaveRow`/`ProductForBulkEdit`/`SaveProductRowsOptions`/`SaveProductRowsResult`/`BulkSaveResult` (Task 1) match Task 2's IPC DTO shapes, `env.d.ts` signatures, and Task 3's `MassInput.tsx` call sites and `DraftRow`-to-`BulkSaveRow` mapping, field-for-field. `ImportResult` (Task 4) matches Task 5's IPC handler return type and `Inventory.tsx`'s result-message formatting. `window.api.inventory.getProductsByIds`/`bulkSaveProducts`/`importProducts` signatures are identical across preload, `env.d.ts`, and every call site in `MassInput.tsx`/`Inventory.tsx`.
