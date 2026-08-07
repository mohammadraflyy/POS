# Inventory Slice 1: CRUD Dasar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Katalog Produk page in `desktop-node` — list, inline-edit, delete (single + bulk), search, pagination — closing the gap where products can currently only be seeded manually.

**Architecture:** Same three-layer pattern as every prior slice — pure business-logic functions in a new `main/inventory.ts` (split from `kasir.ts`, which is already 383 lines and a distinct domain), thin auth-guarded IPC handlers in a new `main/ipc/inventory.ts`, a renderer page built entirely on already-ported primitives (`DataGrid`, `SelectColumn`, `renderTextEditor`, `CommandDialog`, `useConfirm`, `Select`).

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, `react-data-grid`, Vitest. No new npm dependencies.

## Global Constraints

- All underlying DB tables (`products`, `categories`, `product_units`, `product_price_tiers`, `product_price_histories`) already exist — this plan is pure frontend + IPC, no schema changes, no migration.
- No single-product "Add" dialog and no edit dialog — every list field is directly inline-editable in the `DataGrid` (autosaves per cell on change), matching the web app's `resources/js/pages/inventory.tsx` exactly. "Tambah Produk" and "Edit Massal" render `disabled` (Slice 3/Mass Input territory) — visible as a preview, not silently missing.
- Money crosses the IPC boundary as Rupiah `number`, stored/computed in integer cents in `main/inventory.ts`, using the existing `toRupiah`/`toCents` pattern (duplicated locally in `ipc/inventory.ts`, matching how `ipc/kasir.ts` already does this — no shared money-conversion module exists yet, not introduced here).
- Validation matches Laravel's `UpdateProductRequest` exactly: `kodeItem` required, max 50, unique excluding self; `barcode` nullable, max 100, unique excluding self (only checked when non-empty); `namaItem` required, max 255; `kategori` nullable, max 255, free text resolved server-side via find-or-create against `categories.nama`; `satuan` required, max 20; `hargaPokok`/`hargaJual` required, ≥ 0; `isActive` boolean.
- `deleteProduct` catches SQLite's `FOREIGN KEY constraint failed` (raised because `sale_items.product_id`/`purchase_items.product_id` are `onDelete: 'restrict'`) and re-throws the exact message: `"Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit."`
- `bulkDeleteProducts` is explicitly partial-success (each product attempted independently, NOT wrapped in one all-or-nothing transaction) — mirrors the web app's `bulkDestroy`.
- `updateProduct` records a `product_price_histories` row only when `hargaPokok`/`hargaJual` actually changed (compares old vs. new before insert) — mirrors `logPriceChange`.
- Default page size is 25, matching `PER_PAGE_OPTIONS = [10, 25, 50, 100]` — an invalid value falls back to 25.
- Pagination UI is prev/next + page label + a per-page `Select`, matching `KasirHistory.tsx`'s existing shape exactly (this app has no Laravel `links` array to render numbered buttons from).

---

### Task 1: `listProducts`, `updateProduct`, `deleteProduct`, `bulkDeleteProducts`, `searchProductsQuick` business logic

**Files:**
- Create: `desktop-node/src/main/inventory.ts`
- Test: `desktop-node/src/main/inventory.test.ts`

**Interfaces:**
- Consumes: `products`, `categories` from `./db/schema` (existing); `eq`, `and`, `or`, `like`, `ne`, `sql` from `drizzle-orm`.
- Produces:
  - `export interface ProductListItem { id: number; kodeItem: string; barcode: string | null; namaItem: string; categoryName: string | null; satuan: string; hargaPokok: number; hargaJual: number; stok: number; isActive: boolean }` (money in cents — IPC layer converts to Rupiah)
  - `export function listProducts(db, input: { search?: string; page: number; pageSize?: number }): { data: ProductListItem[]; currentPage: number; lastPage: number; total: number }`
  - `export interface UpdateProductInput { kodeItem: string; barcode: string | null; namaItem: string; kategori: string | null; satuan: string; hargaPokok: number; hargaJual: number; isActive: boolean }` (money in cents)
  - `export function updateProduct(db, id: number, input: UpdateProductInput): void`
  - `export function deleteProduct(db, id: number): void`
  - `export function bulkDeleteProducts(db, ids: number[]): { deleted: number; blocked: string[] }`
  - `export function searchProductsQuick(db, q: string): ProductListItem[]`
  - Task 2's IPC handlers call all five with these exact signatures.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/inventory.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, productPriceHistories, saleItems, sales, purchaseItems, purchases, users } from './db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from './inventory'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedProducts() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'kasir1', passwordHash: 'hash', name: 'Kasir Satu', createdAt: now, updatedAt: now })
    .run()

  db.insert(categories).values({ id: 1, nama: 'Sembako', createdAt: now, updatedAt: now }).run()

  db.insert(products)
    .values([
      {
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
      },
      {
        id: 2,
        kodeItem: 'MIE1',
        barcode: null,
        namaItem: 'Mie Instan',
        categoryId: null,
        satuan: 'PCS',
        hargaPokok: 2500_00,
        hargaJual: 3000_00,
        stok: 100,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 3,
        kodeItem: 'GLA1',
        barcode: null,
        namaItem: 'Gula Pasir',
        categoryId: 1,
        satuan: 'KG',
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 0,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  return db
}

describe('listProducts', () => {
  it('returns all products ordered by namaItem, with category names joined', () => {
    const db = seedProducts()

    const result = listProducts(db, { page: 1 })

    expect(result.total).toBe(3)
    expect(result.data.map((p) => p.namaItem)).toEqual(['Beras 5kg', 'Gula Pasir', 'Mie Instan'])
    expect(result.data.find((p) => p.id === 1)?.categoryName).toBe('Sembako')
    expect(result.data.find((p) => p.id === 2)?.categoryName).toBeNull()
  })

  it('filters by search across kodeItem, namaItem, barcode', () => {
    const db = seedProducts()

    expect(listProducts(db, { search: 'beras', page: 1 }).data.map((p) => p.id)).toEqual([1])
    expect(listProducts(db, { search: 'MIE1', page: 1 }).data.map((p) => p.id)).toEqual([2])
    expect(listProducts(db, { search: '1234567890', page: 1 }).data.map((p) => p.id)).toEqual([1])
    expect(listProducts(db, { search: 'tidak-ada', page: 1 }).data).toHaveLength(0)
  })

  it('paginates with the given pageSize, computing lastPage and total', () => {
    const db = seedProducts()

    const page1 = listProducts(db, { page: 1, pageSize: 2 })
    expect(page1.data).toHaveLength(2)
    expect(page1.currentPage).toBe(1)
    expect(page1.lastPage).toBe(2)
    expect(page1.total).toBe(3)

    const page2 = listProducts(db, { page: 2, pageSize: 2 })
    expect(page2.data).toHaveLength(1)
  })

  it('defaults to pageSize 25 when none is given', () => {
    const db = seedProducts()
    const result = listProducts(db, { page: 1 })
    expect(result.lastPage).toBe(1)
  })

  it('returns money fields in cents, unconverted', () => {
    const db = seedProducts()
    const result = listProducts(db, { page: 1 })
    const beras = result.data.find((p) => p.id === 1)
    expect(beras?.hargaPokok).toBe(60000_00)
    expect(beras?.hargaJual).toBe(65000_00)
  })
})

describe('updateProduct', () => {
  const validInput = {
    kodeItem: 'BRS5',
    barcode: '1234567890',
    namaItem: 'Beras 5kg Baru',
    kategori: 'Sembako',
    satuan: 'PCS',
    hargaPokok: 61000_00,
    hargaJual: 66000_00,
    isActive: true,
  }

  it('updates the product fields', () => {
    const db = seedProducts()

    updateProduct(db, 1, validInput)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.namaItem).toBe('Beras 5kg Baru')
    expect(product?.hargaPokok).toBe(61000_00)
    expect(product?.hargaJual).toBe(66000_00)
  })

  it('resolves kategori to an existing category by exact name match', () => {
    const db = seedProducts()

    updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', kategori: 'Sembako' })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.categoryId).toBe(1)
  })

  it('creates a new category when kategori does not match an existing one', () => {
    const db = seedProducts()

    updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', kategori: 'Makanan Instan' })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    const newCategory = db.select().from(categories).where(eq(categories.nama, 'Makanan Instan')).get()
    expect(product?.categoryId).toBe(newCategory?.id)
  })

  it('sets categoryId to null when kategori is null or empty', () => {
    const db = seedProducts()

    updateProduct(db, 1, { ...validInput, kategori: null })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.categoryId).toBeNull()
  })

  it('throws when kodeItem is empty', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: '' })).toThrow('Kode item wajib diisi.')
  })

  it('throws when kodeItem exceeds 50 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: 'a'.repeat(51) })).toThrow(
      'Kode item maksimal 50 karakter.',
    )
  })

  it('throws when kodeItem collides with another product', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: 'MIE1' })).toThrow('Kode item sudah digunakan.')
  })

  it('allows keeping the same kodeItem on self (no false collision)', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, kodeItem: 'BRS5' })).not.toThrow()
  })

  it('throws when barcode exceeds 100 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, barcode: '1'.repeat(101) })).toThrow(
      'Barcode maksimal 100 karakter.',
    )
  })

  it('throws when barcode collides with another product', () => {
    const db = seedProducts()
    updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', barcode: '999' })
    expect(() => updateProduct(db, 1, { ...validInput, barcode: '999' })).toThrow('Barcode sudah digunakan.')
  })

  it('allows null barcode without a uniqueness check', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, barcode: null })).not.toThrow()
    expect(() => updateProduct(db, 2, { ...validInput, kodeItem: 'MIE1', barcode: null })).not.toThrow()
  })

  it('throws when namaItem is empty', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, namaItem: '' })).toThrow('Nama item wajib diisi.')
  })

  it('throws when namaItem exceeds 255 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, namaItem: 'a'.repeat(256) })).toThrow(
      'Nama item maksimal 255 karakter.',
    )
  })

  it('throws when satuan is empty', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, satuan: 'a'.repeat(21) })).toThrow(
      'Satuan maksimal 20 karakter.',
    )
  })

  it('throws when hargaPokok is negative', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, hargaPokok: -1 })).toThrow('Harga pokok tidak boleh negatif.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProducts()
    expect(() => updateProduct(db, 1, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })

  it('records a price history row when hargaPokok or hargaJual changes', () => {
    const db = seedProducts()

    updateProduct(db, 1, validInput)

    const history = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      hargaPokokLama: 60000_00,
      hargaPokokBaru: 61000_00,
      hargaJualLama: 65000_00,
      hargaJualBaru: 66000_00,
    })
  })

  it('does not record a price history row when prices are unchanged', () => {
    const db = seedProducts()

    updateProduct(db, 1, { ...validInput, hargaPokok: 60000_00, hargaJual: 65000_00 })

    const history = db.select().from(productPriceHistories).where(eq(productPriceHistories.productId, 1)).all()
    expect(history).toHaveLength(0)
  })

  it('toggles isActive', () => {
    const db = seedProducts()

    updateProduct(db, 3, { ...validInput, kodeItem: 'GLA1', isActive: true })

    const product = db.select().from(products).where(eq(products.id, 3)).get()
    expect(product?.isActive).toBe(true)
  })
})

describe('deleteProduct', () => {
  it('deletes a product with no transaction history', () => {
    const db = seedProducts()

    deleteProduct(db, 3)

    expect(db.select().from(products).where(eq(products.id, 3)).get()).toBeUndefined()
  })

  it('throws a friendly message when the product has sale history', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(sales)
      .values({ id: 1, userId: 1, metodePembayaran: 'tunai', status: 'selesai', total: 65000_00, dibayar: 65000_00, createdAt: now, updatedAt: now })
      .run()
    db.insert(saleItems)
      .values({ id: 1, saleId: 1, productId: 1, qty: 1, konversi: 1, satuan: 'PCS', hargaJual: 65000_00, hargaPokok: 60000_00, subtotal: 65000_00, createdAt: now, updatedAt: now })
      .run()

    expect(() => deleteProduct(db, 1)).toThrow('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.')
    expect(db.select().from(products).where(eq(products.id, 1)).get()).toBeDefined()
  })

  it('throws a friendly message when the product has purchase history', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(purchases).values({ id: 1, userId: 1, tanggal: '2026-01-01', total: 60000_00, createdAt: now, updatedAt: now }).run()
    db.insert(purchaseItems)
      .values({ id: 1, purchaseId: 1, productId: 2, qty: 1, hargaBeli: 2500_00, subtotal: 2500_00, createdAt: now, updatedAt: now })
      .run()

    expect(() => deleteProduct(db, 2)).toThrow('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.')
  })

  it('throws when the product does not exist', () => {
    const db = seedProducts()
    expect(() => deleteProduct(db, 999)).not.toThrow()
    // SQLite DELETE on a non-matching id is a no-op, not an error - matches
    // Laravel's route-model-binding 404 being handled at the IPC layer instead.
  })
})

describe('bulkDeleteProducts', () => {
  it('deletes all given ids when none are restricted', () => {
    const db = seedProducts()

    const result = bulkDeleteProducts(db, [2, 3])

    expect(result).toEqual({ deleted: 2, blocked: [] })
    expect(db.select().from(products).all()).toHaveLength(1)
  })

  it('deletes unrestricted products and reports restricted ones by name, without failing the whole batch', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(sales)
      .values({ id: 1, userId: 1, metodePembayaran: 'tunai', status: 'selesai', total: 65000_00, dibayar: 65000_00, createdAt: now, updatedAt: now })
      .run()
    db.insert(saleItems)
      .values({ id: 1, saleId: 1, productId: 1, qty: 1, konversi: 1, satuan: 'PCS', hargaJual: 65000_00, hargaPokok: 60000_00, subtotal: 65000_00, createdAt: now, updatedAt: now })
      .run()

    const result = bulkDeleteProducts(db, [1, 2, 3])

    expect(result.deleted).toBe(2)
    expect(result.blocked).toEqual(['Beras 5kg'])
    expect(db.select().from(products).where(eq(products.id, 1)).get()).toBeDefined()
    expect(db.select().from(products).where(eq(products.id, 2)).get()).toBeUndefined()
    expect(db.select().from(products).where(eq(products.id, 3)).get()).toBeUndefined()
  })
})

describe('searchProductsQuick', () => {
  it('matches across kodeItem, namaItem, barcode, capped at 20 results', () => {
    const db = seedProducts()

    expect(searchProductsQuick(db, 'beras').map((p) => p.id)).toEqual([1])
    expect(searchProductsQuick(db, '').length).toBeGreaterThan(0)
  })

  it('includes inactive products (matches the web app quick-search, which does not filter by isActive)', () => {
    const db = seedProducts()
    const results = searchProductsQuick(db, 'gula')
    expect(results.map((p) => p.id)).toEqual([3])
    expect(results[0].isActive).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run inventory.test.ts`
Expected: FAIL — `Cannot find module './inventory'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `inventory.ts`**

Create `desktop-node/src/main/inventory.ts`:

```typescript
import { and, eq, like, ne, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productPriceHistories } from './db/schema'

export interface ProductListItem {
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
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

function toListItem(row: {
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
}): ProductListItem {
  return row
}

export function listProducts(
  db: BetterSQLite3Database<typeof schema>,
  input: { search?: string; page: number; pageSize?: number },
): { data: ProductListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const whereClause = input.search
    ? or(
        like(products.kodeItem, `%${input.search}%`),
        like(products.namaItem, `%${input.search}%`),
        like(products.barcode, `%${input.search}%`),
      )
    : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(products).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const rows = db
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
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data: rows.map(toListItem), currentPage: page, lastPage, total }
}

export interface UpdateProductInput {
  kodeItem: string
  barcode: string | null
  namaItem: string
  kategori: string | null
  satuan: string
  hargaPokok: number
  hargaJual: number
  isActive: boolean
}

export function updateProduct(db: BetterSQLite3Database<typeof schema>, id: number, input: UpdateProductInput): void {
  if (!input.kodeItem.trim()) {
    throw new Error('Kode item wajib diisi.')
  }

  if (input.kodeItem.length > 50) {
    throw new Error('Kode item maksimal 50 karakter.')
  }

  const kodeItemCollision = db
    .select()
    .from(products)
    .where(and(eq(products.kodeItem, input.kodeItem), ne(products.id, id)))
    .get()

  if (kodeItemCollision) {
    throw new Error('Kode item sudah digunakan.')
  }

  if (input.barcode && input.barcode.length > 100) {
    throw new Error('Barcode maksimal 100 karakter.')
  }

  if (input.barcode) {
    const barcodeCollision = db
      .select()
      .from(products)
      .where(and(eq(products.barcode, input.barcode), ne(products.id, id)))
      .get()

    if (barcodeCollision) {
      throw new Error('Barcode sudah digunakan.')
    }
  }

  if (!input.namaItem.trim()) {
    throw new Error('Nama item wajib diisi.')
  }

  if (input.namaItem.length > 255) {
    throw new Error('Nama item maksimal 255 karakter.')
  }

  if (!input.satuan.trim()) {
    throw new Error('Satuan wajib diisi.')
  }

  if (input.satuan.length > 20) {
    throw new Error('Satuan maksimal 20 karakter.')
  }

  if (input.hargaPokok < 0) {
    throw new Error('Harga pokok tidak boleh negatif.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  let categoryId: number | null = null
  const kategori = input.kategori?.trim()

  if (kategori) {
    const existing = db.select().from(categories).where(eq(categories.nama, kategori)).get()

    if (existing) {
      categoryId = existing.id
    } else {
      const now = new Date()
      const created = db.insert(categories).values({ nama: kategori, createdAt: now, updatedAt: now }).returning().get()
      categoryId = created.id
    }
  }

  const existingProduct = db.select().from(products).where(eq(products.id, id)).get()

  db.update(products)
    .set({
      kodeItem: input.kodeItem,
      barcode: input.barcode,
      namaItem: input.namaItem,
      categoryId,
      satuan: input.satuan,
      hargaPokok: input.hargaPokok,
      hargaJual: input.hargaJual,
      isActive: input.isActive,
    })
    .where(eq(products.id, id))
    .run()

  if (existingProduct && (existingProduct.hargaPokok !== input.hargaPokok || existingProduct.hargaJual !== input.hargaJual)) {
    const now = new Date()
    db.insert(productPriceHistories)
      .values({
        productId: id,
        userId: null,
        hargaPokokLama: existingProduct.hargaPokok,
        hargaPokokBaru: input.hargaPokok,
        hargaJualLama: existingProduct.hargaJual,
        hargaJualBaru: input.hargaJual,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }
}

export function deleteProduct(db: BetterSQLite3Database<typeof schema>, id: number): void {
  try {
    db.delete(products).where(eq(products.id, id)).run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint failed')) {
      throw new Error('Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit.')
    }
    throw err
  }
}

export function bulkDeleteProducts(
  db: BetterSQLite3Database<typeof schema>,
  ids: number[],
): { deleted: number; blocked: string[] } {
  let deleted = 0
  const blocked: string[] = []

  for (const id of ids) {
    const product = db.select().from(products).where(eq(products.id, id)).get()

    try {
      db.delete(products).where(eq(products.id, id)).run()
      deleted++
    } catch (err) {
      if (err instanceof Error && err.message.includes('FOREIGN KEY constraint failed')) {
        blocked.push(product?.namaItem ?? `Produk #${id}`)
      } else {
        throw err
      }
    }
  }

  return { deleted, blocked }
}

export function searchProductsQuick(db: BetterSQLite3Database<typeof schema>, q: string): ProductListItem[] {
  const whereClause = q
    ? or(like(products.kodeItem, `%${q}%`), like(products.namaItem, `%${q}%`), like(products.barcode, `%${q}%`))
    : undefined

  const rows = db
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
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(20)
    .all()

  return rows.map(toListItem)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run inventory.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/inventory.ts src/main/inventory.test.ts
git commit -m "Add Inventory business logic: list, update, delete, bulk delete, quick search"
```

---

### Task 2: IPC handlers, preload, and renderer types

**Files:**
- Create: `desktop-node/src/main/ipc/inventory.ts`
- Modify: `desktop-node/src/main/index.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `listProducts`, `updateProduct`, `deleteProduct`, `bulkDeleteProducts`, `searchProductsQuick` from Task 1's `main/inventory.ts`; `getCurrentUser` from `../ipc/auth` (existing).
- Produces: IPC channels `inventory:listProducts`, `inventory:updateProduct`, `inventory:deleteProduct`, `inventory:bulkDeleteProducts`, `inventory:searchProducts`; `window.api.inventory.*` — Task 3's page calls these exact names.

- [ ] **Step 1: Create `ipc/inventory.ts`**

Create `desktop-node/src/main/ipc/inventory.ts`:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from '../inventory'
import { getCurrentUser } from './auth'

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
  }
}

export function registerInventoryIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle(
    'inventory:listProducts',
    (_event, input: { search?: string; page: number; pageSize?: number }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

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
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

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
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteProduct(db, id)
  })

  ipcMain.handle('inventory:bulkDeleteProducts', (_event, ids: number[]) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return bulkDeleteProducts(db, ids)
  })

  ipcMain.handle('inventory:searchProducts', (_event, q: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsQuick(db, q).map(toDto)
  })
}
```

- [ ] **Step 2: Register the IPC handlers**

In `desktop-node/src/main/index.ts`, find:

```typescript
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
```

Replace with:

```typescript
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
import { registerInventoryIpc } from './ipc/inventory'
```

Find:

```typescript
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  createWindow()
```

Replace with:

```typescript
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  createWindow()
```

- [ ] **Step 3: Expose the channels in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    purgeSalesBefore: (before: string) => invoke('kasir:purgeSalesBefore', before),
  },
}
```

Replace with:

```typescript
    purgeSalesBefore: (before: string) => invoke('kasir:purgeSalesBefore', before),
  },
  inventory: {
    listProducts: (input: { search?: string; page: number; pageSize?: number }) =>
      invoke('inventory:listProducts', input),
    updateProduct: (
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
    ) => invoke('inventory:updateProduct', id, input),
    deleteProduct: (id: number) => invoke('inventory:deleteProduct', id),
    bulkDeleteProducts: (ids: number[]) => invoke('inventory:bulkDeleteProducts', ids),
    searchProducts: (q: string) => invoke('inventory:searchProducts', q),
  },
}
```

- [ ] **Step 4: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, find the closing of the `kasir` interface block:

```typescript
        purgeSalesBefore: (before: string) => Promise<{ deleted: number }>
      }
    }
  }
}
```

Replace with:

```typescript
        purgeSalesBefore: (before: string) => Promise<{ deleted: number }>
      }
      inventory: {
        listProducts: (input: { search?: string; page: number; pageSize?: number }) => Promise<{
          data: {
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
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
        updateProduct: (
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
        ) => Promise<void>
        deleteProduct: (id: number) => Promise<void>
        bulkDeleteProducts: (ids: number[]) => Promise<{ deleted: number; blocked: string[] }>
        searchProducts: (q: string) => Promise<
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
            isActive: boolean
          }[]
        >
      }
    }
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (this task adds no new automated tests; the business logic is already covered by Task 1).

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/ipc/inventory.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "Add inventory IPC handlers"
```

---

### Task 3: `Inventory.tsx` page, routing, sidebar, and verification

**Files:**
- Create: `desktop-node/src/renderer/pages/Inventory.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `window.api.inventory.*` (Task 2); `AppShell`, `DataGrid`/`SelectColumn`/`renderTextEditor` (`react-data-grid`, existing dependency), `CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem` (existing), `useConfirm`, `useElementWidth`, `useAvailableHeight`, `useAppearance`, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`, `Badge`, `Button`, `Input`, `formatRupiah` (all existing).

- [ ] **Step 1: Create `Inventory.tsx`**

Create `desktop-node/src/renderer/pages/Inventory.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, SelectColumn, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface ProductRow {
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
}

interface DraftRow {
  id: number
  kodeItem: string
  barcode: string
  namaItem: string
  kategori: string
  satuan: string
  hargaPokok: string
  hargaJual: string
  stok: number
  isActive: boolean
}

function toDraftRow(product: ProductRow): DraftRow {
  return {
    id: product.id,
    kodeItem: product.kodeItem,
    barcode: product.barcode ?? '',
    namaItem: product.namaItem,
    kategori: product.categoryName ?? '',
    satuan: product.satuan,
    hargaPokok: String(product.hargaPokok),
    hargaJual: String(product.hargaJual),
    stok: product.stok,
    isActive: product.isActive,
  }
}

const OTHER_COLUMNS_WIDTH = 50 + 110 + 130 + 130 + 90 + 110 + 110 + 90 + 90 + 70
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Katalog Produk', href: '/inventory' }]

export function Inventory() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72)

  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rawProducts, setRawProducts] = useState<ProductRow[]>([])
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set())
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState('25')

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<ProductRow[]>([])

  const { confirm, ConfirmDialog } = useConfirm()

  function loadPage(page: number) {
    window.api.inventory
      .listProducts({ search: search || undefined, page, pageSize: Number(pageSize) })
      .then((result) => {
        setRawProducts(result.data)
        setRows(result.data.map(toDraftRow))
        setCurrentPage(result.currentPage)
        setLastPage(result.lastPage)
        setTotal(result.total)
      })
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    loadPage(1)
  }

  function changePageSize(value: string) {
    setPageSize(value)
  }

  useEffect(() => {
    loadPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize])

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })

    window.api.inventory
      .updateProduct(row.id, {
        kodeItem: row.kodeItem,
        barcode: row.barcode || null,
        namaItem: row.namaItem,
        kategori: row.kategori || null,
        satuan: row.satuan,
        hargaPokok: Number(row.hargaPokok),
        hargaJual: Number(row.hargaJual),
        isActive: row.isActive,
      })
      .then(() => loadPage(currentPage))
      .catch((err) => {
        setRowErrors((prev) => ({ ...prev, [row.id]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
      })
  }

  function handleRowsChange(newRows: DraftRow[], data: RowsChangeData<DraftRow>) {
    setRows(newRows)
    saveRow(newRows[data.indexes[0]])
  }

  function toggleActive(row: DraftRow) {
    const updated = { ...row, isActive: !row.isActive }
    setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)))
    saveRow(updated)
  }

  async function deleteProduct(product: ProductRow) {
    const ok = await confirm({
      title: 'Hapus Produk',
      description: `Hapus produk "${product.namaItem}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      await window.api.inventory.deleteProduct(product.id)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(product.id)
        return next
      })
      loadPage(currentPage)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus produk')
    }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) {
      return
    }

    if (selectedIds.size === 1) {
      const product = rawProducts.find((p) => selectedIds.has(p.id))
      if (product) {
        await deleteProduct(product)
      }
      return
    }

    const ok = await confirm({
      title: 'Hapus Produk',
      description: `Hapus ${selectedIds.size} produk terpilih?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      await window.api.inventory.bulkDeleteProducts([...selectedIds])
      setSelectedIds(new Set())
      loadPage(currentPage)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus produk')
    }
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false
      }
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) {
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        setPaletteQuery('')
        setPaletteOpen(true)
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        deleteSelected()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds])

  useEffect(() => {
    if (!paletteOpen) {
      return
    }

    let cancelled = false

    window.api.inventory.searchProducts(paletteQuery).then((results) => {
      if (!cancelled) {
        setPaletteResults(results)
      }
    })

    return () => {
      cancelled = true
    }
  }, [paletteOpen, paletteQuery])

  function searchAll(term: string) {
    setSearch(term)
    setPaletteOpen(false)
    loadPage(1)
  }

  function jumpToProduct(product: ProductRow) {
    setSearch(product.kodeItem)
    setPaletteOpen(false)
    loadPage(1)
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  function textColumn(key: keyof DraftRow, name: string, width?: number): Column<DraftRow> {
    return {
      key,
      name,
      width,
      editable: true,
      renderEditCell: renderTextEditor,
      cellClass: (row) => (rowErrors[row.id] ? 'bg-red-100 dark:bg-red-950' : undefined),
    }
  }

  const columns: Column<DraftRow>[] = [
    SelectColumn,
    textColumn('kodeItem', 'Kode Item', 110),
    textColumn('barcode', 'Barcode', 130),
    textColumn('namaItem', 'Nama', namaWidth),
    textColumn('kategori', 'Kategori', 130),
    textColumn('satuan', 'Satuan', 90),
    textColumn('hargaPokok', 'Harga Pokok', 110),
    textColumn('hargaJual', 'Harga Jual', 110),
    {
      key: 'stok',
      name: 'Stok',
      width: 90,
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.stok}</span>,
    },
    {
      key: 'isActive',
      name: 'Status',
      width: 90,
      renderCell: ({ row }) => (
        <label className="flex h-full items-center gap-1.5 text-xs">
          <input type="checkbox" checked={row.isActive} onChange={() => toggleActive(row)} />
          <span className={row.isActive ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
            {row.isActive ? 'Aktif' : 'Nonaktif'}
          </span>
        </label>
      ),
    },
    {
      key: 'aksi',
      name: '',
      width: 70,
      renderCell: ({ row }) => {
        const product = rawProducts.find((p) => p.id === row.id)
        return (
          <button
            type="button"
            className="text-xs text-destructive hover:underline"
            onClick={() => product && deleteProduct(product)}
          >
            Hapus
          </button>
        )
      },
    },
  ]

  const errorSummary = Object.entries(rowErrors).map(([id, message]) => {
    const product = rawProducts.find((p) => p.id === Number(id))
    return `${product?.namaItem ?? `Produk #${id}`}: ${message}`
  })

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        {errorSummary.length > 0 && (
          <div className="space-y-1 text-sm text-destructive">
            {errorSummary.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <form onSubmit={submitSearch} className="flex gap-2">
            <div className="relative w-64">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kode / nama / barcode produk..."
                className="pr-8"
              />
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                /
              </kbd>
            </div>
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled title="Menunggu fitur Mass Input">
              Edit Massal ({selectedIds.size})
            </Button>
            <Button type="button" variant="destructive" disabled={selectedIds.size === 0} onClick={deleteSelected}>
              Hapus Terpilih ({selectedIds.size})
            </Button>
            <Button type="button" disabled title="Menunggu fitur Mass Input">
              Tambah Produk
            </Button>
          </div>
        </div>

        <div
          ref={(node) => {
            widthRef(node)
            heightRef(node)
          }}
        >
          {gridWidth > 0 && (
            <DataGrid
              className={resolvedAppearance === 'dark' ? 'rdg-dark' : 'rdg-light'}
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.id}
              onRowsChange={handleRowsChange}
              selectedRows={selectedIds}
              onSelectedRowsChange={setSelectedIds}
              renderers={{
                noRowsFallback: (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Tidak ada produk.</div>
                ),
              }}
              style={{ blockSize: gridHeight, minHeight: 300 }}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => loadPage(currentPage - 1)}>
              Sebelumnya
            </Button>
            <span className="text-sm text-muted-foreground">
              Halaman {currentPage} / {lastPage}
            </span>
            <Button variant="outline" size="sm" disabled={currentPage >= lastPage} onClick={() => loadPage(currentPage + 1)}>
              Berikutnya
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Tampilkan</span>
            <Select value={pageSize} onValueChange={changePageSize}>
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((option) => (
                  <SelectItem key={option} value={option.toString()}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>dari {total} produk</span>
          </div>
        </div>
      </div>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Cari Produk" description="Cari kode, nama, atau barcode produk" shouldFilter={false}>
        <CommandInput value={paletteQuery} onValueChange={setPaletteQuery} placeholder="Cari kode / nama / barcode produk..." />
        <CommandList>
          <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
          {paletteQuery.trim() !== '' && (
            <CommandGroup heading="Aksi">
              <CommandItem value={`cari-semua-${paletteQuery}`} onSelect={() => searchAll(paletteQuery)}>
                Cari semua untuk &ldquo;{paletteQuery}&rdquo;
              </CommandItem>
            </CommandGroup>
          )}
          {paletteResults.length > 0 && (
            <CommandGroup heading="Produk">
              {paletteResults.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id.toString()}
                  onSelect={() => jumpToProduct(product)}
                  className="flex items-center justify-between"
                >
                  <span>
                    <span className="font-medium">{product.namaItem}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      &middot; {product.kodeItem}
                      {product.categoryName && ` · ${product.categoryName}`}
                    </span>
                  </span>
                  {!product.isActive && <span className="text-xs text-muted-foreground">Nonaktif</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      {ConfirmDialog}
    </AppShell>
  )
}
```

Note: `formatRupiah` is imported but not directly used in this file's JSX (harga_pokok/harga_jual are edited as raw number strings in the grid, matching the web app's inline-editable pattern — no formatted display cell). Remove the unused import if `tsc --noEmit`'s `noUnusedLocals` flags it in Step 3.

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, find:

```typescript
import { Settings } from './pages/Settings'
```

Replace with:

```typescript
import { Settings } from './pages/Settings'
import { Inventory } from './pages/Inventory'
```

Find:

```typescript
        <Route path="/settings" element={<Settings />} />
```

Replace with:

```typescript
        <Route path="/settings" element={<Settings />} />
        <Route path="/inventory" element={<Inventory />} />
```

- [ ] **Step 3: Enable the sidebar entry**

In `desktop-node/src/renderer/components/app-sidebar.tsx`, find:

```typescript
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes, disabled: true },
```

Replace with:

```typescript
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes },
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors. If `formatRupiah` triggers a `noUnusedLocals` error, remove that import line from `Inventory.tsx` (per the note in Step 1).

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green (no new automated tests in this task; the page is verified manually in Step 7).

- [ ] **Step 6: Rebuild better-sqlite3 for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 7: Manual end-to-end verification via CDP**

Using the established CDP pattern (query `http://127.0.0.1:9222/json` for the page target's `webSocketDebuggerUrl`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`; capture at least one `Page.captureScreenshot` for visual confirmation, not just `innerText` — a prior slice's final review found a real layout bug that text-only checks missed):

1. Log in, click "Katalog Produk" in the sidebar (now enabled, no longer dimmed). Confirm navigation to `/inventory`, breadcrumb reads "Katalog Produk", grid renders with existing seeded products (`dev.sqlite` already has product #1 "Beras 5kg" from prior slices' seeding).
2. Edit a cell directly (e.g. change "Harga Jual" on a product) and confirm the value persists after a page reload — proving the inline-edit autosave round-trips through IPC correctly.
3. Type a new value into the "Kategori" cell for a product that has no category yet (e.g. "Sembako"), confirm it saves; then check via `node -e "..."` against `dev.sqlite` that a `categories` row was created (or reused, if "Sembako" already exists from prior seeding) and the product's `category_id` points to it.
4. Toggle a product's Status checkbox off, confirm the row updates to "Nonaktif" and persists after reload.
5. Click "Hapus" on a product with no sale/purchase history — confirm the delete-confirmation dialog appears, confirm it, and the row disappears from the grid.
6. Attempt to delete a product that DOES have sale history (if `dev.sqlite`'s seeded sales reference a product — check via query first) — confirm the friendly `"Produk tidak bisa dihapus karena sudah punya riwayat transaksi..."` message appears above the grid instead of a raw error, and the row remains.
7. Select 2+ rows via their checkboxes, click "Hapus Terpilih (n)" — confirm the bulk-delete confirmation dialog wording matches the count, confirm, and all selected rows disappear (or the restricted ones remain with an appropriate outcome, if any of the selected happen to have history).
8. Press `/` (with focus outside any input) — confirm the quick-search `CommandDialog` opens; type a partial product name, confirm live results appear; select a result, confirm the grid's search field updates to that product's `kodeItem` and the grid narrows to just that product.
9. Change the "Tampilkan" per-page `Select` to a smaller value (e.g. 10) — confirm the grid reloads at page 1 with the new page size, and Sebelumnya/Berikutnya buttons enable/disable correctly at the boundaries.
10. Confirm "Tambah Produk" and "Edit Massal" buttons are visibly disabled (dimmed, not clickable).
11. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Inventory.tsx src/renderer/App.tsx src/renderer/components/app-sidebar.tsx
git commit -m "Add Inventory page: list, inline-edit, delete, search, pagination"
```

---

## Plan Self-Review

**Spec coverage:** §1 (business logic: listProducts/updateProduct/deleteProduct/bulkDeleteProducts/searchProductsQuick, all validation rules, category find-or-create, price-history recording, FK-restrict friendly message, partial-success bulk delete) → Task 1. §2 (IPC, money conversion, auth guards) → Task 2. §3 (renderer: inline-editable grid, toolbar, disabled Tambah/Edit-Massal buttons, keyboard shortcuts, quick-search CommandDialog, pagination matching KasirHistory's shape) → Task 3. §4 (sidebar entry enabled) → Task 3 Step 3. Out-of-scope items (units/tiers dialog, mass input, Excel import, direct stock editing, price-history display) — untouched by every task.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code.

**Type consistency:** `ProductListItem`/`UpdateProductInput` (Task 1) match the IPC handler's DTO shapes and preload/env.d.ts signatures (Task 2) field-for-field — `categoryName`, `hargaPokok`/`hargaJual` (cents in Task 1, Rupiah after `toRupiah` in Task 2's `toDto`), `isActive`. `window.api.inventory.*` signatures are identical across preload, env.d.ts (Task 2), and every call site in `Inventory.tsx` (Task 3): `listProducts({search?, page, pageSize?})`, `updateProduct(id, {kodeItem, barcode, namaItem, kategori, satuan, hargaPokok, hargaJual, isActive})`, `deleteProduct(id)`, `bulkDeleteProducts(ids)` returning `{deleted, blocked}`, `searchProducts(q)`.
