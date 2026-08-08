# Stock Opname Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Stock Opname (physical stock count/correction) page in `desktop-node` — search or browse-by-category to find products, enter the counted stock per row with autosave, logging every correction to `stock_adjustments`.

**Architecture:** Same three-layer pattern as every prior slice — pure business-logic functions in a new `main/stock-opname.ts`, thin auth-guarded IPC handlers in a new `main/ipc/stock-opname.ts`, and a single-page renderer built on the already-proven inline-editable `react-data-grid` pattern (Mass Input/Supplier) with true per-row autosave (mirroring Supplier's `saveRow`/`handleRowsChange`, not Mass Input's batch-submit). The `stock_adjustments` table already exists in `schema.ts` — **no schema migration for this slice.**

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, Vitest. No new npm dependencies — the category multi-select uses the existing `DropdownMenuCheckboxItem` component (no `Popover` component exists in this codebase; `DropdownMenu` already supports exactly this multi-select-with-checkmarks UX).

## Global Constraints

- **No schema migration**: `stock_adjustments` already matches the required shape exactly (`productId` FK restrict, `userId` FK nullable set-null, `stokSebelum`, `stokSesudah`, `selisih`, `alasan` nullable, `tanggal`, timestamps).
- **Search behavior mirrors the web app exactly**: `is_active=true` always. Optional `categoryIds` filter (multi-select). Optional keyword match (only when `q` is non-empty) across `kodeItem`/`namaItem`/`barcode` plus the product's category name. **Cap of 20 results unless "browsing"** — browsing means `q` is empty AND at least one category is selected; in that case results are uncapped. Ordered by `namaItem`.
- **`selisih` can be negative, zero, or positive** — no clamping. A physical count coming up short is exactly what this feature is for.
- **`stokSesudah` validation**: must be a non-negative integer (`Number.isInteger(...) && >= 0`).
- **`alasan` is optional**: blank/whitespace-only becomes `null`.
- **Atomicity**: `recordStockAdjustment` reads the product's current `stok` as `stokSebelum` and updates `products.stok` inside the same `db.transaction`, mirroring every other stock-mutating write path in this app (Kasir, Pembelian).
- **Local date, not UTC**: `tanggal` uses the local-date construction pattern already fixed in Pembelian and established in `kasir.ts`'s bon-payment date default — `` `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` `` — never `toISOString()`.
- **No money involved** — no cents/Rupiah conversion needed anywhere in this feature.
- Every IPC handler is auth-guarded: `if (!getCurrentUser()) { throw new Error('Silakan login terlebih dahulu.') }`.
- **Per-row autosave, no batch submit** — every row saves independently on edit-commit, matching the web app's per-row POST and this codebase's established `Supplier.tsx` `saveRow`/`handleRowsChange` pattern (not `MassInput.tsx`'s single "Simpan Semua" button).
- **Idle state**: no grid renders until the user has searched or picked at least one category — matches the web app, and the renderer must never call the search IPC with both `q` empty and `categoryIds` empty.
- **Out of scope**: no adjustment history/log view, no bulk "recount entire category" workflow beyond category browsing, no undo/edit of a past adjustment, no barcode-scanner-triggered auto-add (barcode is just one of the searchable fields via the search box).

---

### Task 1: `listCategories`, `searchProductsForOpname`, `recordStockAdjustment` business logic

**Files:**
- Create: `desktop-node/src/main/stock-opname.ts`
- Test: `desktop-node/src/main/stock-opname.test.ts`

**Interfaces:**
- Consumes: `categories`, `products`, `stockAdjustments` from `./db/schema` (all pre-existing, unmodified).
- Produces:
  - `export interface CategoryOption { id: number; nama: string }`
  - `export function listCategories(db): CategoryOption[]`
  - `export interface ProductOpnameRow { id: number; kodeItem: string; barcode: string | null; namaItem: string; categoryName: string | null; satuan: string; stok: number }`
  - `export function searchProductsForOpname(db, input: { q: string; categoryIds: number[] }): ProductOpnameRow[]`
  - `export interface RecordStockAdjustmentInput { productId: number; stokSesudah: number; alasan: string | null; userId: number | null }`
  - `export interface RecordStockAdjustmentResult { id: number }`
  - `export function recordStockAdjustment(db, input: RecordStockAdjustmentInput): RecordStockAdjustmentResult`
  - Task 2's IPC layer calls all three with these exact signatures.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/stock-opname.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { categories, products, stockAdjustments, users } from './db/schema'
import {
  listCategories,
  searchProductsForOpname,
  recordStockAdjustment,
} from './stock-opname'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(users)
    .values({ id: 1, username: 'admin', passwordHash: 'hash', name: 'Admin', createdAt: now, updatedAt: now })
    .run()

  db.insert(categories)
    .values([
      { id: 1, nama: 'Sembako', createdAt: now, updatedAt: now },
      { id: 2, nama: 'Minuman', createdAt: now, updatedAt: now },
    ])
    .run()

  db.insert(products)
    .values([
      {
        id: 1,
        kodeItem: 'KOPI1',
        barcode: '8991234567890',
        namaItem: 'Kopi Kapal Api',
        categoryId: 1,
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
        categoryId: 1,
        satuan: 'KG',
        hargaPokok: 12000_00,
        hargaJual: 14000_00,
        stok: 50,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 3,
        kodeItem: 'TEHBOTOL1',
        barcode: null,
        namaItem: 'Teh Botol',
        categoryId: 2,
        satuan: 'PCS',
        hargaPokok: 3000_00,
        hargaJual: 4000_00,
        stok: 20,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 4,
        kodeItem: 'NONAKTIF1',
        barcode: null,
        namaItem: 'Produk Nonaktif',
        categoryId: 1,
        satuan: 'PCS',
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 5,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  return db
}

describe('listCategories', () => {
  it('returns categories ordered by nama', () => {
    const db = seedDb()
    const result = listCategories(db)
    expect(result).toEqual([
      { id: 2, nama: 'Minuman' },
      { id: 1, nama: 'Sembako' },
    ])
  })
})

describe('searchProductsForOpname', () => {
  it('matches on kodeItem, namaItem, or barcode', () => {
    const db = seedDb()
    expect(searchProductsForOpname(db, { q: 'kopi', categoryIds: [] })).toHaveLength(1)
    expect(searchProductsForOpname(db, { q: 'GULA1', categoryIds: [] })).toHaveLength(1)
    expect(searchProductsForOpname(db, { q: '8991234567890', categoryIds: [] })).toHaveLength(1)
  })

  it('matches on the product category name', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: 'minuman', categoryIds: [] })
    expect(result.map((r) => r.namaItem)).toEqual(['Teh Botol'])
  })

  it('filters by categoryIds', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [2] })
    expect(result.map((r) => r.namaItem)).toEqual(['Teh Botol'])
  })

  it('combines keyword and category filters', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: 'kopi', categoryIds: [2] })
    expect(result).toHaveLength(0)
  })

  it('excludes inactive products', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [1] })
    expect(result.map((r) => r.namaItem)).not.toContain('Produk Nonaktif')
  })

  it('caps keyword search at 20 results', () => {
    const db = seedDb()
    const now = new Date()
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      kodeItem: `BANYAK${i}`,
      barcode: null,
      namaItem: `Produk Banyak ${i}`,
      categoryId: 1,
      satuan: 'PCS',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(many).run()

    const result = searchProductsForOpname(db, { q: 'Produk Banyak', categoryIds: [] })
    expect(result).toHaveLength(20)
  })

  it('does not cap results when browsing by category with no keyword', () => {
    const db = seedDb()
    const now = new Date()
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      kodeItem: `BANYAK${i}`,
      barcode: null,
      namaItem: `Produk Banyak ${i}`,
      categoryId: 1,
      satuan: 'PCS',
      hargaPokok: 1000_00,
      hargaJual: 1500_00,
      stok: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(products).values(many).run()

    const result = searchProductsForOpname(db, { q: '', categoryIds: [1] })
    expect(result.length).toBeGreaterThan(20)
    expect(result).toHaveLength(27) // 25 new + Kopi Kapal Api + Gula Pasir, both category 1
  })

  it('returns a capped, non-throwing result when q and categoryIds are both empty', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [] })
    expect(result.length).toBeLessThanOrEqual(20)
  })

  it('orders results by namaItem', () => {
    const db = seedDb()
    const result = searchProductsForOpname(db, { q: '', categoryIds: [1] })
    const names = result.map((r) => r.namaItem)
    expect(names).toEqual([...names].sort())
  })
})

describe('recordStockAdjustment', () => {
  it('records a count-up and increments products.stok', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 15, alasan: 'Hitung fisik bulanan', userId: 1 })

    expect(result.id).toBeGreaterThan(0)

    const product = db.select().from(products).where(eq(products.id, 1)).get()
    expect(product?.stok).toBe(15)

    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment).toMatchObject({
      productId: 1,
      userId: 1,
      stokSebelum: 10,
      stokSesudah: 15,
      selisih: 5,
      alasan: 'Hitung fisik bulanan',
    })
  })

  it('records a count-down with a negative selisih', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 2, stokSesudah: 45, alasan: null, userId: 1 })

    const product = db.select().from(products).where(eq(products.id, 2)).get()
    expect(product?.stok).toBe(45)

    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.selisih).toBe(-5)
  })

  it('records a zero-change adjustment', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 10, alasan: null, userId: 1 })

    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment).toMatchObject({ stokSebelum: 10, stokSesudah: 10, selisih: 0 })
  })

  it('stores a missing alasan as null', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 12, alasan: null, userId: 1 })
    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.alasan).toBeNull()
  })

  it('trims alasan and stores whitespace-only as null', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 12, alasan: '   ', userId: 1 })
    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.alasan).toBeNull()
  })

  it('allows a null userId', () => {
    const db = seedDb()
    const result = recordStockAdjustment(db, { productId: 1, stokSesudah: 12, alasan: null, userId: null })
    const adjustment = db.select().from(stockAdjustments).where(eq(stockAdjustments.id, result.id)).get()
    expect(adjustment?.userId).toBeNull()
  })

  it('throws when stokSesudah is negative', () => {
    const db = seedDb()
    expect(() => recordStockAdjustment(db, { productId: 1, stokSesudah: -1, alasan: null, userId: 1 })).toThrow(
      'Stok fisik harus bilangan bulat, minimal 0.',
    )
  })

  it('throws when stokSesudah is not an integer', () => {
    const db = seedDb()
    expect(() => recordStockAdjustment(db, { productId: 1, stokSesudah: 1.5, alasan: null, userId: 1 })).toThrow(
      'Stok fisik harus bilangan bulat, minimal 0.',
    )
  })

  it('throws when the product does not exist', () => {
    const db = seedDb()
    expect(() => recordStockAdjustment(db, { productId: 999, stokSesudah: 5, alasan: null, userId: 1 })).toThrow(
      'Produk tidak ditemukan.',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run stock-opname.test.ts`
Expected: FAIL — `Cannot find module './stock-opname'`.

- [ ] **Step 3: Implement `stock-opname.ts`**

Create `desktop-node/src/main/stock-opname.ts`:

```typescript
import { and, eq, inArray, like, or } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, stockAdjustments } from './db/schema'

export interface CategoryOption {
  id: number
  nama: string
}

export function listCategories(db: BetterSQLite3Database<typeof schema>): CategoryOption[] {
  return db.select({ id: categories.id, nama: categories.nama }).from(categories).orderBy(categories.nama).all()
}

export interface ProductOpnameRow {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  stok: number
}

export function searchProductsForOpname(
  db: BetterSQLite3Database<typeof schema>,
  input: { q: string; categoryIds: number[] },
): ProductOpnameRow[] {
  const q = input.q.trim()
  const browsing = q === '' && input.categoryIds.length > 0

  const conditions = [eq(products.isActive, true)]

  if (input.categoryIds.length > 0) {
    conditions.push(inArray(products.categoryId, input.categoryIds))
  }

  if (q !== '') {
    const keywordMatch = or(
      like(products.kodeItem, `%${q}%`),
      like(products.namaItem, `%${q}%`),
      like(products.barcode, `%${q}%`),
      like(categories.nama, `%${q}%`),
    )
    if (keywordMatch) {
      conditions.push(keywordMatch)
    }
  }

  const baseQuery = db
    .select({
      id: products.id,
      kodeItem: products.kodeItem,
      barcode: products.barcode,
      namaItem: products.namaItem,
      categoryName: categories.nama,
      satuan: products.satuan,
      stok: products.stok,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(products.namaItem)

  return browsing ? baseQuery.all() : baseQuery.limit(20).all()
}

export interface RecordStockAdjustmentInput {
  productId: number
  stokSesudah: number
  alasan: string | null
  userId: number | null
}

export interface RecordStockAdjustmentResult {
  id: number
}

export function recordStockAdjustment(
  db: BetterSQLite3Database<typeof schema>,
  input: RecordStockAdjustmentInput,
): RecordStockAdjustmentResult {
  if (!Number.isInteger(input.stokSesudah) || input.stokSesudah < 0) {
    throw new Error('Stok fisik harus bilangan bulat, minimal 0.')
  }

  const alasan = input.alasan?.trim() || null

  return db.transaction((tx) => {
    const product = tx.select().from(products).where(eq(products.id, input.productId)).get()

    if (!product) {
      throw new Error('Produk tidak ditemukan.')
    }

    const stokSebelum = product.stok
    const selisih = input.stokSesudah - stokSebelum
    const now = new Date()
    const tanggal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    const adjustment = tx
      .insert(stockAdjustments)
      .values({
        productId: input.productId,
        userId: input.userId,
        stokSebelum,
        stokSesudah: input.stokSesudah,
        selisih,
        alasan,
        tanggal,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()

    tx.update(products).set({ stok: input.stokSesudah }).where(eq(products.id, input.productId)).run()

    return { id: adjustment.id }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run stock-opname.test.ts`
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
git add src/main/stock-opname.ts src/main/stock-opname.test.ts
git status --short
```

Verify the output shows ONLY those two files. Never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add Stock Opname business logic"
```

---

### Task 2: Stock Opname IPC handlers, preload, renderer types

**Files:**
- Create: `desktop-node/src/main/ipc/stock-opname.ts`
- Modify: `desktop-node/src/main/index.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `listCategories`, `searchProductsForOpname`, `recordStockAdjustment`, `CategoryOption`, `ProductOpnameRow`, `RecordStockAdjustmentInput`, `RecordStockAdjustmentResult` from Task 1's `main/stock-opname.ts`; `getCurrentUser` from `./auth` (existing).
- Produces: IPC channels `stock-opname:listCategories`, `stock-opname:searchProducts`, `stock-opname:recordAdjustment`; `window.api.stockOpname.*` — Task 3's page calls these exact names.

- [ ] **Step 1: Create `ipc/stock-opname.ts`**

Create `desktop-node/src/main/ipc/stock-opname.ts`:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listCategories, searchProductsForOpname, recordStockAdjustment } from '../stock-opname'
import { getCurrentUser } from './auth'

export function registerStockOpnameIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('stock-opname:listCategories', () => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return listCategories(db)
  })

  ipcMain.handle('stock-opname:searchProducts', (_event, input: { q: string; categoryIds: number[] }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsForOpname(db, input)
  })

  ipcMain.handle(
    'stock-opname:recordAdjustment',
    (_event, input: { productId: number; stokSesudah: number; alasan: string | null }) => {
      const user = getCurrentUser()
      if (!user) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      return recordStockAdjustment(db, {
        productId: input.productId,
        stokSesudah: input.stokSesudah,
        alasan: input.alasan,
        userId: user.id,
      })
    },
  )
}
```

- [ ] **Step 2: Register the IPC handlers**

In `desktop-node/src/main/index.ts`, find:

```typescript
import { registerPurchaseIpc } from './ipc/purchase'
```

Replace with:

```typescript
import { registerPurchaseIpc } from './ipc/purchase'
import { registerStockOpnameIpc } from './ipc/stock-opname'
```

Find:

```typescript
  registerPurchaseIpc(db)
  createWindow()
```

Replace with:

```typescript
  registerPurchaseIpc(db)
  registerStockOpnameIpc(db)
  createWindow()
```

- [ ] **Step 3: Expose the channels in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    listPurchases: (input: { page: number; pageSize?: number }) => invoke('purchase:listPurchases', input),
    searchProducts: (q: string) => invoke('purchase:searchProducts', q),
  },
}
```

Replace with:

```typescript
    listPurchases: (input: { page: number; pageSize?: number }) => invoke('purchase:listPurchases', input),
    searchProducts: (q: string) => invoke('purchase:searchProducts', q),
  },
  stockOpname: {
    listCategories: () => invoke('stock-opname:listCategories'),
    searchProducts: (input: { q: string; categoryIds: number[] }) => invoke('stock-opname:searchProducts', input),
    recordAdjustment: (input: { productId: number; stokSesudah: number; alasan: string | null }) =>
      invoke('stock-opname:recordAdjustment', input),
  },
}
```

- [ ] **Step 4: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
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

Replace with:

```typescript
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
      stockOpname: {
        listCategories: () => Promise<{ id: number; nama: string }[]>
        searchProducts: (input: { q: string; categoryIds: number[] }) => Promise<
          {
            id: number
            kodeItem: string
            barcode: string | null
            namaItem: string
            categoryName: string | null
            satuan: string
            stok: number
          }[]
        >
        recordAdjustment: (input: { productId: number; stokSesudah: number; alasan: string | null }) => Promise<{ id: number }>
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
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
cd desktop-node
git add src/main/ipc/stock-opname.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git status --short
```

Verify the output shows ONLY those four files.

```bash
git commit -m "Add Stock Opname IPC handlers"
```

---

### Task 3: `StockOpname.tsx` page, routing, sidebar, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/StockOpname.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `window.api.stockOpname.*` (Task 2); `AppShell`, `DataGrid`/`renderTextEditor` from `react-data-grid`, `Column`/`RowsChangeData` types, `Button`, `Input`, `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuCheckboxItem`, `useAppearance`, `useAvailableHeight`, `useElementWidth` (all existing, same imports as `Supplier.tsx`).
- Produces: `export function StockOpname()` — a full page component; `App.tsx` renders it at `/stock-opname`.

- [ ] **Step 1: Create `StockOpname.tsx`**

Create `desktop-node/src/renderer/pages/StockOpname.tsx`:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useElementWidth } from '@/hooks/use-element-width'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface ProductOpnameRowDTO {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  categoryName: string | null
  satuan: string
  stok: number
}

interface DraftRow {
  key: string
  productId: number
  kodeItem: string
  namaItem: string
  categoryName: string
  satuan: string
  stokSistem: number
  stokFisik: string
  alasan: string
}

function toDraftRow(p: ProductOpnameRowDTO): DraftRow {
  return {
    key: `product-${p.id}`,
    productId: p.id,
    kodeItem: p.kodeItem,
    namaItem: p.namaItem,
    categoryName: p.categoryName ?? '-',
    satuan: p.satuan,
    stokSistem: p.stok,
    stokFisik: String(p.stok),
    alasan: '',
  }
}

const OTHER_COLUMNS_WIDTH = 110 + 130 + 80 + 100 + 100 + 90 + 200
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Stock Opname', href: '/stock-opname' }]

export function StockOpname() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72)

  const [search, setSearch] = useState('')
  const [categories, setCategories] = useState<{ id: number; nama: string }[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [hasSearched, setHasSearched] = useState(false)

  useEffect(() => {
    window.api.stockOpname.listCategories().then(setCategories)
  }, [])

  function runSearch(q: string, categoryIds: number[]) {
    if (q.trim() === '' && categoryIds.length === 0) {
      setRows([])
      setHasSearched(false)
      return
    }

    setHasSearched(true)
    window.api.stockOpname.searchProducts({ q, categoryIds }).then((results) => {
      setRows(results.map(toDraftRow))
    })
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    runSearch(search, selectedCategoryIds)
  }

  function toggleCategory(id: number) {
    const next = selectedCategoryIds.includes(id)
      ? selectedCategoryIds.filter((c) => c !== id)
      : [...selectedCategoryIds, id]
    setSelectedCategoryIds(next)
    runSearch(search, next)
  }

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })

    const stokFisikNum = Number(row.stokFisik)

    if (row.stokFisik.trim() === '' || !Number.isInteger(stokFisikNum) || stokFisikNum < 0) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Stok fisik harus bilangan bulat, minimal 0.' }))
      return
    }

    window.api.stockOpname
      .recordAdjustment({ productId: row.productId, stokSesudah: stokFisikNum, alasan: row.alasan || null })
      .then(() => {
        runSearch(search, selectedCategoryIds)
      })
      .catch((err) => {
        setRowErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
      })
  }

  function handleRowsChange(newRows: DraftRow[], data: RowsChangeData<DraftRow>) {
    setRows(newRows)
    saveRow(newRows[data.indexes[0]])
  }

  const namaWidth = Math.max(MIN_NAMA_WIDTH, gridWidth - OTHER_COLUMNS_WIDTH - 2)

  function textColumn(key: keyof DraftRow, name: string, width?: number): Column<DraftRow> {
    return {
      key,
      name,
      width,
      editable: true,
      renderEditCell: renderTextEditor,
      cellClass: (row) => (rowErrors[row.key] ? 'bg-red-100 dark:bg-red-950' : undefined),
    }
  }

  const columns: Column<DraftRow>[] = [
    { key: 'kodeItem', name: 'Kode', width: 110 },
    { key: 'namaItem', name: 'Nama', width: namaWidth },
    { key: 'categoryName', name: 'Kategori', width: 130 },
    { key: 'satuan', name: 'Satuan', width: 80 },
    {
      key: 'stokSistem',
      name: 'Stok Sistem',
      width: 100,
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.stokSistem}</span>,
    },
    textColumn('stokFisik', 'Stok Fisik', 100),
    {
      key: 'selisih',
      name: 'Selisih',
      width: 90,
      renderCell: ({ row }) => {
        const stokFisikNum = Number(row.stokFisik)
        if (row.stokFisik.trim() === '' || !Number.isFinite(stokFisikNum)) {
          return <span className="text-muted-foreground">-</span>
        }
        const selisih = stokFisikNum - row.stokSistem
        const colorClass = selisih > 0 ? 'text-green-600' : selisih < 0 ? 'text-destructive' : 'text-muted-foreground'
        return <span className={colorClass}>{selisih > 0 ? `+${selisih}` : selisih}</span>
      },
    },
    textColumn('alasan', 'Alasan', 200),
  ]

  const errorSummary = Object.entries(rowErrors).map(([key, message]) => {
    const row = rows.find((r) => r.key === key)
    return `${row?.namaItem ?? 'Baris'}: ${message}`
  })

  return (
    <AppShell breadcrumbs={BREADCRUMBS}>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">Stok Opname</h1>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={submitSearch} className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari kode / nama / barcode..."
              className="w-64"
            />
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                Kategori {selectedCategoryIds.length > 0 && `(${selectedCategoryIds.length})`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {categories.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={selectedCategoryIds.includes(c.id)}
                  onSelect={(e) => {
                    e.preventDefault()
                    toggleCategory(c.id)
                  }}
                >
                  {c.nama}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {errorSummary.length > 0 && (
          <div className="space-y-1 text-sm text-destructive">
            {errorSummary.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        )}

        {!hasSearched && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Cari produk atau pilih kategori untuk mulai stok opname.
          </div>
        )}

        {hasSearched && (
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
                onRowsChange={handleRowsChange}
                style={{ blockSize: gridHeight, minHeight: 300 }}
              />
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, find:

```typescript
import { Purchase } from './pages/Purchase'
```

Replace with:

```typescript
import { Purchase } from './pages/Purchase'
import { StockOpname } from './pages/StockOpname'
```

Find:

```typescript
        <Route path="/purchase" element={<Purchase />} />
```

Replace with:

```typescript
        <Route path="/purchase" element={<Purchase />} />
        <Route path="/stock-opname" element={<StockOpname />} />
```

- [ ] **Step 3: Enable the sidebar entry**

In `desktop-node/src/renderer/components/app-sidebar.tsx`, find:

```typescript
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck, disabled: true },
```

Replace with:

```typescript
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck },
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

(Run in background/detached. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 7: Manual end-to-end verification via CDP**

Log in as `admin`/`password`. Using the established CDP pattern (query `http://127.0.0.1:9222/json`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`, at least one real `Page.captureScreenshot` inspected visually — not just innerText checks):

1. Confirm "Stock Opname" is enabled in the sidebar (not dimmed). Click it, confirm navigation to `/stock-opname`, breadcrumb reads "Stock Opname".
2. Confirm the idle state: a centered "Cari produk atau pilih kategori untuk mulai stok opname." message, no grid visible.
3. Type a keyword matching a real product in the search box, submit — confirm the grid appears with a matching row, `Stok Sistem` shows the product's current stock, `Stok Fisik` defaults to the same value, `Selisih` shows 0 (or "-" if not yet computed — confirm actual rendered value).
4. Edit that row's `Stok Fisik` to a higher number, commit the edit (Tab/Enter/blur) — confirm the row autosaves without a page-level submit button, `Selisih` shows the positive difference in green before save completes, and after save `Stok Sistem` updates to match (grid refreshes via the re-run search).
5. Verify in Katalog Produk (or via the grid's own `Stok Sistem` column after refresh) that the product's stock actually changed to the new value.
6. Repeat with a lower number to confirm a negative `Selisih` (shown in red/destructive color) saves correctly and decrements stock.
7. Open the category dropdown, select a category with no keyword typed — confirm the grid shows results for that category, and if the category has products, confirm more than one row can appear without needing to type anything (browsing, uncapped).
8. Clear the search field and deselect all categories — confirm the view returns to the idle state (no lingering grid).
9. Try committing an edit with `Stok Fisik` cleared to empty — confirm the client-side error blocks the save (row highlighted red, error message shown) and no stock actually changes (re-check via Katalog Produk or a fresh search).
10. Enter a value in `Alasan` for one row, edit `Stok Fisik` on the same row, confirm save succeeds and no error blocks it (alasan is optional, this exercises the field end-to-end).
11. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/StockOpname.tsx src/renderer/App.tsx src/renderer/components/app-sidebar.tsx
git status --short
```

Verify the output shows ONLY those three files.

```bash
git commit -m "Add Stock Opname page, enable Stock Opname sidebar entry"
```

---

## Plan Self-Review

**Spec coverage:** No schema migration needed (`stock_adjustments` already correct) — confirmed, Task 1 doesn't touch `schema.ts`. Search behavior (cap-unless-browsing, category filter, keyword-across-kode/nama/barcode/category-name, active-only) → Task 1. `recordStockAdjustment` (atomicity, negative/zero/positive selisih, validation, optional alasan, local-date `tanggal`) → Task 1. IPC (auth guards, no money conversion) → Task 2. Renderer (idle state, per-row autosave via `saveRow`/`handleRowsChange` mirroring `Supplier.tsx`, category multi-select via `DropdownMenuCheckboxItem`, live-computed colored `Selisih`) → Task 3. Out-of-scope items (no history view, no bulk recount, no undo, no barcode auto-add) — untouched by every task.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code, including the exact search-cap logic and its test coverage for both the capped and uncapped branches.

**Type consistency:** `CategoryOption`/`ProductOpnameRow`/`RecordStockAdjustmentInput`/`RecordStockAdjustmentResult` (Task 1) match Task 2's IPC handler request/response shapes and `env.d.ts` types field-for-field. `window.api.stockOpname.listCategories`/`searchProducts`/`recordAdjustment` signatures are identical across preload, `env.d.ts` (Task 2), and every call site in `StockOpname.tsx` (Task 3).
