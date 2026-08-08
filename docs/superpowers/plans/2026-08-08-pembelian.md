# Pembelian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Pembelian (Purchasing) page in `desktop-node` — record purchases with unit selection, view paginated history — closing Slice 2 of the Pembelian module (Slice 1, Kelola Supplier, already shipped).

**Architecture:** Same three-layer pattern as every prior slice — pure business-logic functions in a new `main/purchase.ts`, thin auth-guarded IPC handlers in a new `main/ipc/purchase.ts`, and a single-page renderer (form + history) built on already-ported primitives (`CommandDialog` quick-search, `ReportTable`, `Select`, plain HTML `<table>` for line items matching the original web app's own choice). One schema migration adds unit-selection fields to `purchase_items`, mirroring `sale_items`'s already-shipped shape.

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, Vitest. No new npm dependencies.

## Global Constraints

- **Schema change**: `purchase_items` gains `productUnitId` (nullable, references `product_units.id`, `onDelete: 'set null'`), `konversi` (not null, default `1`), `satuan` (nullable text) — mirroring `sale_items`'s already-shipped shape exactly. This migration was already generated and verified to apply cleanly before this plan was written (see Task 1).
- **Unit selection, manual price**: the satuan picker only affects unit conversion for stock math — the store owner still enters `hargaBeli` manually per line. No automatic tiered/qty-based purchase pricing table.
- **Stock increment uses `qty * konversi`**, mirroring `main/kasir.ts`'s existing `checkout`/`cancelSale` pattern (`sql\`${products.stok} + ${qtyDasar}\`` for a direct UPDATE — this is a different, already-proven-safe SQL shape from the correlated-subquery pattern that had a real Drizzle bug in the Supplier slice; a straight `UPDATE ... SET col = col + X` has no join/subquery ambiguity).
- **No `harga_pokok` update, no `product_price_histories` row** from recording a purchase — confirmed explicitly out of scope. Cost-price changes still only happen via Katalog Produk's existing edit flow.
- **No purchase edit/cancel** — create-only + history view, matching the web app exactly.
- **Deliberate improvement over the web app**: the product quick-search always pre-fills "Harga Beli" from `hargaPokok` (cost price). The web app inconsistently pre-fills from `harga_jual` (selling price) when picked via search but from `harga_pokok` when adding a brand-new product in the same session — a bug this port does not carry over.
- **Money validation**: `hargaBeli` requires `Number.isFinite(...)` AND `>= 0`; `qty` requires `Number.isInteger(...)` AND `>= 1` — same lessons as every prior slice (`Number("") === 0` empty-string coercion must be guarded client-side before `Number(...)` and before any IPC call).
- Money crosses the IPC boundary as Rupiah `number`; stored/computed in integer cents in `main/purchase.ts` (local `toRupiah`/`toCents`, matching the established per-file convention).
- Every IPC handler is auth-guarded: `if (!getCurrentUser()) { throw new Error('Silakan login terlebih dahulu.') }`.
- Default page size 25, valid page sizes exactly `[10, 25, 50, 100]` for purchase history — a deliberate improvement over the web app's flat "last 20, no pagination", matching every other list in this app.
- Supplier picker fetches the supplier list ONCE (a single page, `pageSize: 100`) when the Pembelian page mounts and filters client-side via `CommandDialog`'s own built-in fuzzy matching — matching the web app's own approach exactly (no live per-keystroke IPC search for suppliers, unlike products). This assumes a small business has well under 100 suppliers; a reasonable, explicitly-scoped boundary, not an oversight.
- No changes to Kasir's checkout/stock-deduction logic — Purchase is a separate, additive write path to `products.stok` (increment vs. Kasir's decrement).

---

### Task 1: Schema migration, `recordPurchase`, `listPurchases`, `searchProductsForPurchase` business logic

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts`
- Create (via `drizzle-kit generate`): a new file in `desktop-node/drizzle/` (auto-named) + matching `desktop-node/drizzle/meta/_journal.json` and a new `desktop-node/drizzle/meta/000X_snapshot.json`
- Create: `desktop-node/src/main/purchase.ts`
- Test: `desktop-node/src/main/purchase.test.ts`

**Interfaces:**
- Consumes: `purchases`, `purchaseItems`, `products`, `suppliers`, `productUnits` from `./db/schema`; `getProductUnits` from `./inventory-units` (existing, Slice 2 of Inventory).
- Produces:
  - `export interface PurchaseItemInput { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }` (money in cents)
  - `export interface RecordPurchaseInput { supplierId: number | null; tanggal: string; catatan: string | null; items: PurchaseItemInput[]; userId: number | null }`
  - `export interface RecordPurchaseResult { purchaseId: number }`
  - `export function recordPurchase(db, input: RecordPurchaseInput): RecordPurchaseResult`
  - `export interface PurchaseListItem { id: number; tanggal: string; total: number; catatan: string | null; supplierName: string | null; itemSummary: string }` (money in cents)
  - `export function listPurchases(db, input: { page: number; pageSize?: number }): { data: PurchaseListItem[]; currentPage: number; lastPage: number; total: number }`
  - `export interface PurchaseProductOption { id: number; kodeItem: string; namaItem: string; satuan: string; hargaPokok: number; units: { id: number; level: number; satuan: string; konversi: number }[] }` (money in cents)
  - `export function searchProductsForPurchase(db, q: string): PurchaseProductOption[]`
  - Task 2's IPC layer calls all of the above with these exact signatures.

- [ ] **Step 1: Edit the schema**

In `desktop-node/src/main/db/schema.ts`, find:

```typescript
export const purchaseItems = sqliteTable('purchase_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  purchaseId: integer('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),
  hargaBeli: integer('harga_beli').notNull(),
  subtotal: integer('subtotal').notNull(),
  ...timestamps(),
})
```

Replace with:

```typescript
export const purchaseItems = sqliteTable('purchase_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  purchaseId: integer('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productUnitId: integer('product_unit_id').references(() => productUnits.id, { onDelete: 'set null' }),
  qty: integer('qty').notNull(),
  konversi: integer('konversi').notNull().default(1),
  satuan: text('satuan'),
  hargaBeli: integer('harga_beli').notNull(),
  subtotal: integer('subtotal').notNull(),
  ...timestamps(),
})
```

- [ ] **Step 2: Generate the migration**

Run: `cd desktop-node && npx drizzle-kit generate`

Expected: exits 0, no interactive prompt, prints a line like `Your SQL migration file ➜ drizzle\000X_<name>.sql`. Verified in advance — this exact schema change produces:

```sql
ALTER TABLE `purchase_items` ADD `product_unit_id` integer REFERENCES product_units(id);--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `konversi` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `satuan` text;
```

Open the generated `.sql` file and confirm it matches this shape (three `ALTER TABLE ADD` statements). If it doesn't match — stop and report DONE_WITH_CONCERNS rather than proceeding.

- [ ] **Step 3: Write the failing tests**

Create `desktop-node/src/main/purchase.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { products, productUnits, purchases, purchaseItems, suppliers, users } from './db/schema'
import { recordPurchase, listPurchases, searchProductsForPurchase, type PurchaseItemInput } from './purchase'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  db.insert(suppliers)
    .values({ id: 1, nama: 'CV Sumber Makmur', telepon: null, alamat: null, keterangan: null, createdAt: now, updatedAt: now })
    .run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'KOPI1',
        barcode: null,
        namaItem: 'Kopi Kapal Api',
        categoryId: null,
        satuan: 'PCS',
        hargaPokok: 1500_00,
        hargaJual: 2000_00,
        stok: 10,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        kodeItem: 'GULA1',
        barcode: null,
        namaItem: 'Gula Pasir',
        categoryId: null,
        satuan: 'KG',
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 5,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  db.insert(productUnits)
    .values({
      id: 1,
      productId: 1,
      level: 2,
      satuan: 'Renteng',
      jumlahKemasan: 12,
      konversi: 12,
      hargaJual: 18000_00,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  return db
}

function baseItem(overrides: Partial<PurchaseItemInput> = {}): PurchaseItemInput {
  return {
    productId: 1,
    productUnitId: null,
    qty: 10,
    hargaBeli: 1400_00,
    ...overrides,
  }
}

describe('recordPurchase', () => {
  it('records a base-unit purchase and increments stock by qty', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ qty: 10, hargaBeli: 1400_00 })],
      userId: 1,
    })

    expect(result.purchaseId).toBeGreaterThan(0)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(20) // 10 existing + 10 purchased

    const purchase = db.select().from(purchases).where(eq(purchases.id, result.purchaseId)).get()
    expect(purchase).toMatchObject({ supplierId: 1, tanggal: '2026-08-08', total: 14000_00 })

    const items = db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, result.purchaseId)).all()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      productId: 1,
      productUnitId: null,
      qty: 10,
      konversi: 1,
      satuan: null,
      hargaBeli: 1400_00,
      subtotal: 14000_00,
    })
  })

  it('records a unit-based purchase and increments stock by qty * konversi', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ productUnitId: 1, qty: 2, hargaBeli: 15000_00 })],
      userId: 1,
    })

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(34) // 10 existing + (2 renteng * 12 konversi) = 10 + 24

    const items = db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, result.purchaseId)).all()
    expect(items[0]).toMatchObject({ productUnitId: 1, qty: 2, konversi: 12, satuan: 'Renteng', hargaBeli: 15000_00, subtotal: 30000_00 })
  })

  it('records multiple items in one purchase and sums the total', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: 1,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem({ productId: 1, qty: 10, hargaBeli: 1400_00 }), baseItem({ productId: 2, qty: 5, hargaBeli: 11000_00 })],
      userId: 1,
    })

    const purchase = db.select().from(purchases).where(eq(purchases.id, result.purchaseId)).get()
    expect(purchase?.total).toBe(14000_00 + 55000_00)

    const productA = db.select().from(products).where(eq(products.id, 1)).get()
    const productB = db.select().from(products).where(eq(products.id, 2)).get()
    expect(productA?.stok).toBe(20)
    expect(productB?.stok).toBe(10)
  })

  it('allows a null supplierId', () => {
    const db = seedDb()
    const result = recordPurchase(db, {
      supplierId: null,
      tanggal: '2026-08-08',
      catatan: null,
      items: [baseItem()],
      userId: 1,
    })

    const purchase = db.select().from(purchases).where(eq(purchases.id, result.purchaseId)).get()
    expect(purchase?.supplierId).toBeNull()
  })

  it('throws when tanggal is empty', () => {
    const db = seedDb()
    expect(() => recordPurchase(db, { supplierId: 1, tanggal: '', catatan: null, items: [baseItem()], userId: 1 })).toThrow(
      'Tanggal wajib diisi.',
    )
  })

  it('throws when items is empty', () => {
    const db = seedDb()
    expect(() => recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [], userId: 1 })).toThrow(
      'Item pembelian tidak boleh kosong.',
    )
  })

  it('throws when qty is not a positive integer', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ qty: 0 })], userId: 1 }),
    ).toThrow('Qty harus bilangan bulat minimal 1.')

    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ qty: 1.5 })], userId: 1 }),
    ).toThrow('Qty harus bilangan bulat minimal 1.')
  })

  it('throws when hargaBeli is not finite', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ hargaBeli: NaN })], userId: 1 }),
    ).toThrow('Harga beli wajib diisi.')
  })

  it('throws when hargaBeli is negative', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ hargaBeli: -1 })], userId: 1 }),
    ).toThrow('Harga beli tidak boleh negatif.')
  })

  it('throws when a productId does not exist', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ productId: 999 })], userId: 1 }),
    ).toThrow('Produk tidak ditemukan.')
  })

  it('throws when a productUnitId does not belong to the given product', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, {
        supplierId: 1,
        tanggal: '2026-08-08',
        catatan: null,
        items: [baseItem({ productId: 2, productUnitId: 1 })], // unit 1 belongs to product 1, not 2
        userId: 1,
      }),
    ).toThrow('Satuan tidak valid untuk Gula Pasir.')
  })

  it('writes nothing when validation fails partway through a multi-item batch', () => {
    const db = seedDb()
    expect(() =>
      recordPurchase(db, {
        supplierId: 1,
        tanggal: '2026-08-08',
        catatan: null,
        items: [baseItem({ productId: 1, qty: 10 }), baseItem({ productId: 2, qty: -1 })],
        userId: 1,
      }),
    ).toThrow()

    const allPurchases = db.select().from(purchases).all()
    expect(allPurchases).toHaveLength(0)

    const product1 = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product1?.stok).toBe(10) // untouched
  })
})

describe('listPurchases', () => {
  it('returns purchases with supplier name and item summary, newest first', () => {
    const db = seedDb()
    recordPurchase(db, { supplierId: 1, tanggal: '2026-08-01', catatan: null, items: [baseItem({ qty: 3 })], userId: 1 })
    recordPurchase(db, { supplierId: null, tanggal: '2026-08-05', catatan: null, items: [baseItem({ productId: 2, qty: 2 })], userId: 1 })

    const result = listPurchases(db, { page: 1 })
    expect(result.total).toBe(2)
    expect(result.data[0].tanggal).toBe('2026-08-05')
    expect(result.data[0].supplierName).toBeNull()
    expect(result.data[0].itemSummary).toBe('Gula Pasir x2')
    expect(result.data[1].supplierName).toBe('CV Sumber Makmur')
    expect(result.data[1].itemSummary).toBe('Kopi Kapal Api x3')
  })

  it('paginates with the given pageSize', () => {
    const db = seedDb()
    for (let i = 0; i < 12; i++) {
      recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem({ qty: 1 })], userId: 1 })
    }

    const page1 = listPurchases(db, { page: 1, pageSize: 10 })
    expect(page1.data).toHaveLength(10)
    expect(page1.lastPage).toBe(2)
    expect(page1.total).toBe(12)
  })

  it('defaults to pageSize 25 and falls back on an invalid pageSize', () => {
    const db = seedDb()
    recordPurchase(db, { supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [baseItem()], userId: 1 })

    const result = listPurchases(db, { page: 1, pageSize: 999 })
    expect(result.lastPage).toBe(1)
  })
})

describe('searchProductsForPurchase', () => {
  it('matches on kodeItem, namaItem, or barcode, capped at 20', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'kopi')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: 1, kodeItem: 'KOPI1', namaItem: 'Kopi Kapal Api', satuan: 'PCS', hargaPokok: 1500_00 })
  })

  it('includes each product\'s available units', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'kopi')
    expect(results[0].units).toEqual([{ id: 1, level: 2, satuan: 'Renteng', konversi: 12 }])
  })

  it('returns an empty units array for a product with no satuan turunan', () => {
    const db = seedDb()
    const results = searchProductsForPurchase(db, 'gula')
    expect(results[0].units).toEqual([])
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run purchase.test.ts`
Expected: FAIL — `Cannot find module './purchase'`.

- [ ] **Step 5: Implement `purchase.ts`**

Create `desktop-node/src/main/purchase.ts`:

```typescript
import { desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { purchases, purchaseItems, products, suppliers, productUnits } from './db/schema'
import { getProductUnits } from './inventory-units'

export interface PurchaseItemInput {
  productId: number
  productUnitId: number | null
  qty: number
  hargaBeli: number
}

export interface RecordPurchaseInput {
  supplierId: number | null
  tanggal: string
  catatan: string | null
  items: PurchaseItemInput[]
  userId: number | null
}

export interface RecordPurchaseResult {
  purchaseId: number
}

interface ResolvedPurchaseItem {
  productId: number
  productUnitId: number | null
  qty: number
  konversi: number
  satuan: string | null
  hargaBeli: number
  subtotal: number
}

export function recordPurchase(db: BetterSQLite3Database<typeof schema>, input: RecordPurchaseInput): RecordPurchaseResult {
  if (!input.tanggal.trim()) {
    throw new Error('Tanggal wajib diisi.')
  }

  if (input.items.length < 1) {
    throw new Error('Item pembelian tidak boleh kosong.')
  }

  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      throw new Error('Qty harus bilangan bulat minimal 1.')
    }

    if (!Number.isFinite(item.hargaBeli)) {
      throw new Error('Harga beli wajib diisi.')
    }

    if (item.hargaBeli < 0) {
      throw new Error('Harga beli tidak boleh negatif.')
    }
  }

  const productIds = input.items.map((item) => item.productId)
  const productRows = db.select().from(products).where(inArray(products.id, productIds)).all()
  const productsById = new Map(productRows.map((p) => [p.id, p]))

  const unitRows = db.select().from(productUnits).where(inArray(productUnits.productId, productIds)).all()

  const resolvedItems: ResolvedPurchaseItem[] = []

  for (const item of input.items) {
    const product = productsById.get(item.productId)

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    let konversi = 1
    let satuan: string | null = null

    if (item.productUnitId !== null) {
      const unit = unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)

      if (!unit) {
        throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
      }

      konversi = unit.konversi
      satuan = unit.satuan
    }

    const subtotal = item.qty * item.hargaBeli

    resolvedItems.push({
      productId: item.productId,
      productUnitId: item.productUnitId,
      qty: item.qty,
      konversi,
      satuan,
      hargaBeli: item.hargaBeli,
      subtotal,
    })
  }

  return db.transaction((tx) => {
    const now = new Date()

    const purchase = tx
      .insert(purchases)
      .values({
        supplierId: input.supplierId,
        userId: input.userId,
        tanggal: input.tanggal,
        total: 0,
        catatan: input.catatan,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    let total = 0

    for (const item of resolvedItems) {
      total += item.subtotal

      tx.insert(purchaseItems)
        .values({
          purchaseId: purchase.id,
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: item.qty,
          konversi: item.konversi,
          satuan: item.satuan,
          hargaBeli: item.hargaBeli,
          subtotal: item.subtotal,
          createdAt: now,
          updatedAt: now,
        })
        .run()

      tx.update(products)
        .set({ stok: sql`${products.stok} + ${item.qty * item.konversi}` })
        .where(eq(products.id, item.productId))
        .run()
    }

    tx.update(purchases).set({ total }).where(eq(purchases.id, purchase.id)).run()

    return { purchaseId: purchase.id }
  })
}

export interface PurchaseListItem {
  id: number
  tanggal: string
  total: number
  catatan: string | null
  supplierName: string | null
  itemSummary: string
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

export function listPurchases(
  db: BetterSQLite3Database<typeof schema>,
  input: { page: number; pageSize?: number },
): { data: PurchaseListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(purchases).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const purchaseRows = db
    .select({
      id: purchases.id,
      tanggal: purchases.tanggal,
      total: purchases.total,
      catatan: purchases.catatan,
      supplierName: suppliers.nama,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .orderBy(desc(purchases.tanggal), desc(purchases.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  const purchaseIds = purchaseRows.map((p) => p.id)

  const itemRows =
    purchaseIds.length > 0
      ? db
          .select({
            purchaseId: purchaseItems.purchaseId,
            qty: purchaseItems.qty,
            namaItem: products.namaItem,
          })
          .from(purchaseItems)
          .innerJoin(products, eq(purchaseItems.productId, products.id))
          .where(inArray(purchaseItems.purchaseId, purchaseIds))
          .all()
      : []

  const data: PurchaseListItem[] = purchaseRows.map((purchase) => {
    const items = itemRows.filter((item) => item.purchaseId === purchase.id)
    const itemSummary = items.map((item) => `${item.namaItem} x${item.qty}`).join(', ')

    return {
      id: purchase.id,
      tanggal: purchase.tanggal,
      total: purchase.total,
      catatan: purchase.catatan,
      supplierName: purchase.supplierName,
      itemSummary,
    }
  })

  return { data, currentPage: page, lastPage, total }
}

export interface PurchaseProductOption {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; level: number; satuan: string; konversi: number }[]
}

export function searchProductsForPurchase(db: BetterSQLite3Database<typeof schema>, q: string): PurchaseProductOption[] {
  const whereClause = q
    ? or(like(products.kodeItem, `%${q}%`), like(products.namaItem, `%${q}%`), like(products.barcode, `%${q}%`))
    : undefined

  const rows = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      namaItem: products.namaItem,
      satuan: products.satuan,
      hargaPokok: products.hargaPokok,
    })
    .from(products)
    .where(whereClause)
    .orderBy(products.namaItem)
    .limit(20)
    .all()

  return rows.map((row) => {
    const { level2, level3 } = getProductUnits(db, row.id)
    const units = [level2, level3]
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({ id: u.id, level: u.level, satuan: u.satuan, konversi: u.konversi }))

    return { ...row, units }
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run purchase.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 7: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (confirms the migration doesn't break `db/migrate.test.ts`'s table-count-independent checks or any existing test touching `purchase_items`/`sale_items`).

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/main/db/schema.ts drizzle/ src/main/purchase.ts src/main/purchase.test.ts
git status --short
```

Verify the output shows ONLY: `src/main/db/schema.ts`, the new migration `.sql` file under `drizzle/`, the updated `drizzle/meta/_journal.json`, the new `drizzle/meta/000X_snapshot.json`, `src/main/purchase.ts`, `src/main/purchase.test.ts`. Never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add Pembelian schema migration and business logic"
```

---

### Task 2: Pembelian IPC handlers, preload, renderer types

**Files:**
- Create: `desktop-node/src/main/ipc/purchase.ts`
- Modify: `desktop-node/src/main/index.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `recordPurchase`, `listPurchases`, `searchProductsForPurchase`, `RecordPurchaseInput`, `PurchaseItemInput` from Task 1's `main/purchase.ts`; `getCurrentUser` from `./auth` (existing).
- Produces: IPC channels `purchase:recordPurchase`, `purchase:listPurchases`, `purchase:searchProducts`; `window.api.purchase.*` — Task 3's page calls these exact names.

- [ ] **Step 1: Create `ipc/purchase.ts`**

Create `desktop-node/src/main/ipc/purchase.ts`:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { recordPurchase, listPurchases, searchProductsForPurchase, type PurchaseItemInput } from '../purchase'
import { getCurrentUser } from './auth'

function toRupiah(cents: number): number {
  return cents / 100
}

function toCents(rupiah: number): number {
  return Math.round(rupiah * 100)
}

export function registerPurchaseIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle(
    'purchase:recordPurchase',
    (
      _event,
      input: {
        supplierId: number | null
        tanggal: string
        catatan: string | null
        items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
      },
    ) => {
      const user = getCurrentUser()
      if (!user) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      const items: PurchaseItemInput[] = input.items.map((item) => ({
        productId: item.productId,
        productUnitId: item.productUnitId,
        qty: item.qty,
        hargaBeli: toCents(item.hargaBeli),
      }))

      return recordPurchase(db, {
        supplierId: input.supplierId,
        tanggal: input.tanggal,
        catatan: input.catatan,
        items,
        userId: user.id,
      })
    },
  )

  ipcMain.handle('purchase:listPurchases', (_event, input: { page: number; pageSize?: number }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const result = listPurchases(db, input)

    return {
      data: result.data.map((purchase) => ({
        id: purchase.id,
        tanggal: purchase.tanggal,
        total: toRupiah(purchase.total),
        catatan: purchase.catatan,
        supplierName: purchase.supplierName,
        itemSummary: purchase.itemSummary,
      })),
      currentPage: result.currentPage,
      lastPage: result.lastPage,
      total: result.total,
    }
  })

  ipcMain.handle('purchase:searchProducts', (_event, q: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsForPurchase(db, q).map((product) => ({
      id: product.id,
      kodeItem: product.kodeItem,
      namaItem: product.namaItem,
      satuan: product.satuan,
      hargaPokok: toRupiah(product.hargaPokok),
      units: product.units,
    }))
  })
}
```

- [ ] **Step 2: Register the IPC handlers**

In `desktop-node/src/main/index.ts`, find:

```typescript
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
import { registerInventoryIpc } from './ipc/inventory'
import { registerSupplierIpc } from './ipc/supplier'
```

Replace with:

```typescript
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
import { registerInventoryIpc } from './ipc/inventory'
import { registerSupplierIpc } from './ipc/supplier'
import { registerPurchaseIpc } from './ipc/purchase'
```

Find:

```typescript
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  registerSupplierIpc(db)
  createWindow()
```

Replace with:

```typescript
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  registerSupplierIpc(db)
  registerPurchaseIpc(db)
  createWindow()
```

- [ ] **Step 3: Expose the channels in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    deleteSupplier: (id: number) => invoke('supplier:deleteSupplier', id),
  },
}
```

Replace with:

```typescript
    deleteSupplier: (id: number) => invoke('supplier:deleteSupplier', id),
  },
  purchase: {
    recordPurchase: (input: {
      supplierId: number | null
      tanggal: string
      catatan: string | null
      items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
    }) => invoke('purchase:recordPurchase', input),
    listPurchases: (input: { page: number; pageSize?: number }) => invoke('purchase:listPurchases', input),
    searchProducts: (q: string) => invoke('purchase:searchProducts', q),
  },
}
```

- [ ] **Step 4: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
        deleteSupplier: (id: number) => Promise<void>
      }
    }
  }
}
```

Replace with:

```typescript
        deleteSupplier: (id: number) => Promise<void>
      }
      purchase: {
        recordPurchase: (input: {
          supplierId: number | null
          tanggal: string
          catatan: string | null
          items: { productId: number; productUnitId: number | null; qty: number; hargaBeli: number }[]
        }) => Promise<{ purchaseId: number }>
        listPurchases: (input: { page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            tanggal: string
            total: number
            catatan: string | null
            supplierName: string | null
            itemSummary: string
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
        searchProducts: (q: string) => Promise<
          {
            id: number
            kodeItem: string
            namaItem: string
            satuan: string
            hargaPokok: number
            units: { id: number; level: number; satuan: string; konversi: number }[]
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
Expected: PASS — no regressions (no new automated tests in this task; the business logic is already covered by Task 1).

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/ipc/purchase.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git status --short
```

Verify the output shows ONLY those four files.

```bash
git commit -m "Add Pembelian IPC handlers"
```

---

### Task 3: `Purchase.tsx` page, routing, sidebar, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/Purchase.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `window.api.purchase.*` (Task 2); `window.api.supplier.listSuppliers`/`createSupplier` (existing, Slice 1); `AppShell`, `ReportTable`, `CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem`, `Dialog`/`DialogContent`/`DialogFooter`/`DialogHeader`/`DialogTitle`, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`, `Button`, `Input`, `Label`, `InputError`, `formatRupiah` (all existing).
- Produces: `export function Purchase()` — a full page component; `App.tsx` renders it at `/purchase`.

- [ ] **Step 1: Create `Purchase.tsx`**

Create `desktop-node/src/renderer/pages/Purchase.tsx`:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { ReportTable } from '@/components/report-table'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/input-error'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatRupiah } from '@/lib/utils'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SupplierOption {
  id: number
  nama: string
}

interface SearchResult {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; level: number; satuan: string; konversi: number }[]
}

interface PurchaseRow {
  id: number
  tanggal: string
  total: number
  catatan: string | null
  supplierName: string | null
  itemSummary: string
}

interface DraftItem {
  key: string
  productId: number
  namaItem: string
  kodeItem: string
  baseSatuan: string
  units: { id: number; satuan: string; konversi: number }[]
  productUnitId: number | null
  qty: string
  hargaBeli: string
}

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Pembelian', href: '/purchase' }]

export function Purchase() {
  const [supplierList, setSupplierList] = useState<SupplierOption[]>([])
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierPaletteOpen, setSupplierPaletteOpen] = useState(false)
  const selectedSupplier = supplierList.find((s) => s.id === supplierId)

  const [tanggal, setTanggal] = useState(() => new Date().toISOString().slice(0, 10))
  const [catatan, setCatatan] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<SearchResult[]>([])

  const [newSupplierOpen, setNewSupplierOpen] = useState(false)
  const [newSupplierNama, setNewSupplierNama] = useState('')
  const [newSupplierTelepon, setNewSupplierTelepon] = useState('')
  const [newSupplierAlamat, setNewSupplierAlamat] = useState('')
  const [newSupplierKeterangan, setNewSupplierKeterangan] = useState('')
  const [newSupplierProcessing, setNewSupplierProcessing] = useState(false)
  const [newSupplierError, setNewSupplierError] = useState<string | null>(null)

  const [purchases, setPurchases] = useState<PurchaseRow[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)

  function loadSuppliers() {
    window.api.supplier.listSuppliers({ page: 1, pageSize: 100 }).then((result) => {
      setSupplierList(result.data.map((s) => ({ id: s.id, nama: s.nama })))
    })
  }

  function loadPurchases(page: number) {
    window.api.purchase.listPurchases({ page }).then((result) => {
      setPurchases(result.data)
      setCurrentPage(result.currentPage)
      setLastPage(result.lastPage)
      setTotal(result.total)
    })
  }

  useEffect(() => {
    loadSuppliers()
    loadPurchases(1)
  }, [])

  useEffect(() => {
    if (!paletteOpen) {
      return
    }

    let cancelled = false

    window.api.purchase.searchProducts(paletteQuery).then((results) => {
      if (!cancelled) {
        setPaletteResults(results)
      }
    })

    return () => {
      cancelled = true
    }
  }, [paletteOpen, paletteQuery])

  function addItem(product: SearchResult) {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.productUnitId === null)

      if (existing) {
        return prev.map((i) => (i.key === existing.key ? { ...i, qty: String(Number(i.qty || 0) + 1) } : i))
      }

      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          productId: product.id,
          namaItem: product.namaItem,
          kodeItem: product.kodeItem,
          baseSatuan: product.satuan,
          units: product.units,
          productUnitId: null,
          qty: '1',
          hargaBeli: String(product.hargaPokok),
        },
      ]
    })
    setPaletteOpen(false)
    setPaletteQuery('')
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key))
  }

  function updateItem(key: string, field: 'qty' | 'hargaBeli' | 'productUnitId', value: string) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) {
          return i
        }
        if (field === 'productUnitId') {
          return { ...i, productUnitId: value === 'base' ? null : Number(value) }
        }
        return { ...i, [field]: value }
      }),
    )
  }

  const grandTotal = items.reduce((sum, i) => sum + Number(i.qty || 0) * Number(i.hargaBeli || 0), 0)

  function submitNewSupplier(e: FormEvent) {
    e.preventDefault()

    if (!newSupplierNama.trim()) {
      setNewSupplierError('Nama wajib diisi.')
      return
    }

    setNewSupplierProcessing(true)
    setNewSupplierError(null)

    window.api.supplier
      .createSupplier({
        nama: newSupplierNama,
        telepon: newSupplierTelepon || null,
        alamat: newSupplierAlamat || null,
        keterangan: newSupplierKeterangan || null,
      })
      .then((id) => {
        setSupplierList((prev) => [...prev, { id, nama: newSupplierNama }])
        setSupplierId(id)
        setNewSupplierNama('')
        setNewSupplierTelepon('')
        setNewSupplierAlamat('')
        setNewSupplierKeterangan('')
        setNewSupplierOpen(false)
      })
      .catch((err) => {
        setNewSupplierError(err instanceof Error ? err.message : 'Gagal menyimpan supplier')
      })
      .finally(() => setNewSupplierProcessing(false))
  }

  function submit(e: FormEvent) {
    e.preventDefault()

    if (items.length === 0) {
      setFormError('Item pembelian tidak boleh kosong.')
      return
    }

    for (const item of items) {
      const qtyNum = Number(item.qty)
      const hargaNum = Number(item.hargaBeli)

      if (item.qty.trim() === '' || !Number.isFinite(qtyNum) || qtyNum < 1) {
        setFormError(`Qty untuk "${item.namaItem}" harus diisi minimal 1.`)
        return
      }

      if (item.hargaBeli.trim() === '' || !Number.isFinite(hargaNum)) {
        setFormError(`Harga beli untuk "${item.namaItem}" wajib diisi.`)
        return
      }
    }

    setProcessing(true)
    setFormError(null)

    window.api.purchase
      .recordPurchase({
        supplierId,
        tanggal,
        catatan: catatan || null,
        items: items.map((item) => ({
          productId: item.productId,
          productUnitId: item.productUnitId,
          qty: Number(item.qty),
          hargaBeli: Number(item.hargaBeli),
        })),
      })
      .then(() => {
        setItems([])
        setCatatan('')
        setSupplierId(null)
        loadPurchases(1)
      })
      .catch((err) => {
        setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pembelian')
      })
      .finally(() => setProcessing(false))
  }

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Pembelian</h1>

        <form onSubmit={submit} className="space-y-4 rounded-xl border p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label>Supplier</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 justify-start font-normal"
                  onClick={() => setSupplierPaletteOpen(true)}
                >
                  <Search className="size-4" />
                  {selectedSupplier?.nama ?? 'Tanpa supplier'}
                </Button>
                <Button type="button" variant="outline" size="icon" title="Supplier Baru" onClick={() => setNewSupplierOpen(true)}>
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Tanggal</Label>
              <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Catatan (opsional)</Label>
              <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </div>
          </div>

          <Button type="button" variant="outline" onClick={() => setPaletteOpen(true)}>
            <Search className="size-4" />
            Cari Produk
          </Button>

          {items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Produk</th>
                    <th className="w-32 p-2">Satuan</th>
                    <th className="w-24 p-2">Qty</th>
                    <th className="w-40 p-2">Harga Beli</th>
                    <th className="w-32 p-2 text-right">Subtotal</th>
                    <th className="w-10 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key} className="border-t">
                      <td className="p-2">
                        {item.namaItem} <span className="text-muted-foreground">&middot; {item.kodeItem}</span>
                      </td>
                      <td className="p-2">
                        <Select
                          value={item.productUnitId === null ? 'base' : String(item.productUnitId)}
                          onValueChange={(v) => updateItem(item.key, 'productUnitId', v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="base">{item.baseSatuan}</SelectItem>
                            {item.units.map((unit) => (
                              <SelectItem key={unit.id} value={String(unit.id)}>
                                {unit.satuan}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={1}
                          value={item.qty}
                          onChange={(e) => updateItem(item.key, 'qty', e.target.value)}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={item.hargaBeli}
                          onChange={(e) => updateItem(item.key, 'hargaBeli', e.target.value)}
                        />
                      </td>
                      <td className="p-2 text-right">{formatRupiah(Number(item.qty || 0) * Number(item.hargaBeli || 0))}</td>
                      <td className="p-2">
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(item.key)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <InputError message={formError ?? undefined} />

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-lg font-semibold">{formatRupiah(grandTotal)}</span>
          </div>

          <Button type="submit" disabled={processing || items.length === 0}>
            Simpan Pembelian
          </Button>
        </form>

        <ReportTable<PurchaseRow>
          title="Riwayat Pembelian"
          rows={purchases}
          rowKey={(row) => row.id}
          emptyMessage="Belum ada pembelian."
          columns={[
            { key: 'tanggal', name: 'Tanggal', width: 130 },
            { key: 'supplierName', name: 'Supplier', width: 180, renderCell: ({ row }) => row.supplierName ?? '-' },
            { key: 'itemSummary', name: 'Item' },
            {
              key: 'total',
              name: 'Total',
              width: 140,
              renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.total)}</span>,
            },
          ]}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => loadPurchases(currentPage - 1)}>
              Sebelumnya
            </Button>
            <span className="text-sm text-muted-foreground">
              Halaman {currentPage} / {lastPage}
            </span>
            <Button variant="outline" size="sm" disabled={currentPage >= lastPage} onClick={() => loadPurchases(currentPage + 1)}>
              Berikutnya
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">dari {total} pembelian</span>
        </div>
      </div>

      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Cari Produk"
        description="Cari produk untuk ditambahkan ke pembelian"
        shouldFilter={false}
      >
        <CommandInput value={paletteQuery} onValueChange={setPaletteQuery} placeholder="Cari nama / kode / barcode..." />
        <CommandList>
          <CommandEmpty>{paletteQuery.trim() === '' ? 'Ketik untuk mencari produk.' : 'Produk tidak ditemukan.'}</CommandEmpty>
          {paletteResults.length > 0 && (
            <CommandGroup heading="Produk">
              {paletteResults.map((product) => (
                <CommandItem key={product.id} value={product.id.toString()} onSelect={() => addItem(product)}>
                  {product.namaItem} <span className="text-muted-foreground">&middot; {product.kodeItem}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>

      <CommandDialog open={supplierPaletteOpen} onOpenChange={setSupplierPaletteOpen} title="Pilih Supplier" description="Cari supplier untuk pembelian ini">
        <CommandInput placeholder="Cari supplier..." />
        <CommandList>
          <CommandEmpty>Supplier tidak ditemukan.</CommandEmpty>
          <CommandGroup>
            <CommandItem
              value="Tanpa supplier"
              onSelect={() => {
                setSupplierId(null)
                setSupplierPaletteOpen(false)
              }}
            >
              Tanpa supplier
            </CommandItem>
            {supplierList.map((s) => (
              <CommandItem
                key={s.id}
                value={s.nama}
                onSelect={() => {
                  setSupplierId(s.id)
                  setSupplierPaletteOpen(false)
                }}
              >
                {s.nama}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <Dialog open={newSupplierOpen} onOpenChange={setNewSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supplier Baru</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitNewSupplier} className="space-y-3">
            <div className="grid gap-1">
              <Label>Nama</Label>
              <Input value={newSupplierNama} onChange={(e) => setNewSupplierNama(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Telepon (opsional)</Label>
              <Input value={newSupplierTelepon} onChange={(e) => setNewSupplierTelepon(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Alamat (opsional)</Label>
              <Input value={newSupplierAlamat} onChange={(e) => setNewSupplierAlamat(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>Keterangan (opsional)</Label>
              <Input value={newSupplierKeterangan} onChange={(e) => setNewSupplierKeterangan(e.target.value)} />
            </div>
            <InputError message={newSupplierError ?? undefined} />
            <DialogFooter>
              <Button type="submit" disabled={newSupplierProcessing}>
                Tambahkan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
```

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, find:

```typescript
import { Supplier } from './pages/Supplier'
```

Replace with:

```typescript
import { Supplier } from './pages/Supplier'
import { Purchase } from './pages/Purchase'
```

Find:

```typescript
        <Route path="/supplier" element={<Supplier />} />
```

Replace with:

```typescript
        <Route path="/supplier" element={<Supplier />} />
        <Route path="/purchase" element={<Purchase />} />
```

- [ ] **Step 3: Enable the sidebar entry**

In `desktop-node/src/renderer/components/app-sidebar.tsx`, find:

```typescript
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus, disabled: true },
```

Replace with:

```typescript
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus },
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — all tests green.

- [ ] **Step 6: Rebuild for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 7: Manual end-to-end verification via CDP**

Log in as `admin`/`password`. Using the established CDP pattern (query `http://127.0.0.1:9222/json`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`, at least one `Page.captureScreenshot` for real visual confirmation, not just `innerText`):

1. Confirm "Pembelian" is enabled in the sidebar (not dimmed). Click it, confirm navigation to `/purchase`, breadcrumb reads "Pembelian".
2. Click "Cari Produk", search for a real product (e.g. one seeded from prior manual testing), select it — confirm a draft row appears with Harga Beli pre-filled from the product's Harga Pokok (NOT Harga Jual — this is the explicit bug fix versus the web app), satuan dropdown defaulting to the base unit, qty defaulting to 1.
3. If the selected product has any Satuan Turunan units (check via the Katalog Produk page first, or add one via Inventory's ProductDetailDialog if none exist), change the row's satuan dropdown to a derived unit — confirm the dropdown shows the unit label correctly.
4. Set Tanggal to today (should already default to today), leave Catatan blank, click "Simpan Pembelian" with the one item — confirm it succeeds (form clears, item list empties) and the new purchase appears at the top of "Riwayat Pembelian" with the correct item summary and total.
5. Verify the stock increment: check the product's Stok on the Katalog Produk page before and after this purchase — confirm it increased by `qty * konversi` (base unit: just qty; derived unit: qty times the unit's konversi).
6. Click "+" next to Supplier to open "Supplier Baru", fill in a new supplier name, submit — confirm it's created (via Slice 1's `createSupplier`) and automatically selected as the current purchase's supplier (button label updates to the new supplier's name).
7. Add 2 items to a new purchase, submit successfully — confirm "Riwayat Pembelian"'s item summary shows both items (e.g. "Kopi Kapal Api x3, Gula Pasir x2").
8. Try submitting with an empty item list (no items added) — confirm the inline error "Item pembelian tidak boleh kosong." appears and no IPC call is made.
9. Add an item, clear its Qty field to empty, try to submit — confirm the client-side error blocks submission before any IPC call (empty-string-guard lesson from every prior slice).
10. If purchase history has more than 25 records (unlikely on a fresh dev DB, but check), confirm pagination controls work; otherwise confirm "Sebelumnya"/"Berikutnya" are both correctly disabled at 1 page.
11. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Purchase.tsx src/renderer/App.tsx src/renderer/components/app-sidebar.tsx
git status --short
```

Verify the output shows ONLY those three files.

```bash
git commit -m "Add Pembelian page, enable Pembelian sidebar entry"
```

---

## Plan Self-Review

**Spec coverage:** Schema change (`purchase_items` unit-snapshot fields, mirroring `sale_items`) → Task 1 Steps 1-2. Business logic (`recordPurchase` with validation/stock-increment/transaction atomicity, `listPurchases` with pagination and item summaries, `searchProductsForPurchase` with units) → Task 1. IPC (auth guards, money conversion boundary) → Task 2. Renderer (form with supplier picker + inline quick-add, product quick-search with the harga_pokok pre-fill fix, satuan picker per line, plain-table item entry matching the web app's own choice, paginated ReportTable history) → Task 3. Out-of-scope items (no harga_pokok update, no purchase edit/cancel, no automatic tiered purchase pricing, no Kasir changes) — untouched by every task, confirmed via direct code reads before this plan was written (no shared code paths with `main/kasir.ts` beyond the proven-safe `sql\`col + X\`` stock-increment pattern).

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code, including the exact migration SQL (verified in advance via a live `drizzle-kit generate` run, not guessed).

**Type consistency:** `PurchaseItemInput`/`RecordPurchaseInput`/`RecordPurchaseResult`/`PurchaseListItem`/`PurchaseProductOption` (Task 1) match Task 2's IPC handler request/response shapes and `env.d.ts` types field-for-field. `window.api.purchase.recordPurchase`/`listPurchases`/`searchProducts` signatures are identical across preload, `env.d.ts` (Task 2), and every call site in `Purchase.tsx` (Task 3). `window.api.supplier.listSuppliers`/`createSupplier` (Task 3's calls into the already-shipped Slice 1) match that slice's actual shipped signatures, confirmed by reading the current `preload/index.ts`/`env.d.ts` before writing this plan.
