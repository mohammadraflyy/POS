# Kelola Supplier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Supplier management page in `desktop-node` — list, inline-edit, add, delete — closing the first of two slices needed before Pembelian (Purchasing) can be built.

**Architecture:** Same three-layer pattern as every prior slice this project — pure business-logic functions in a new `main/supplier.ts`, thin auth-guarded IPC handlers in a new `main/ipc/supplier.ts`, and a renderer page built entirely on already-ported primitives (`DataGrid`, `renderTextEditor`, `useConfirm`, pagination shape from `Inventory.tsx`/`KasirHistory.tsx`).

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, `react-data-grid`, Vitest. No new npm dependencies.

## Global Constraints

- The `suppliers` table already exists (Fase 1 schema skeleton) — this plan is pure business logic + IPC + renderer, no schema changes, no migration.
- No uniqueness constraint on `nama` in the schema — validation only requires it non-empty, max 255 characters (matching the web app's `StoreSupplierRequest`).
- `telepon`/`alamat`/`keterangan` are all nullable free text, no length limit (matching the original app, which enforces none).
- `deleteSupplier` never fails on a foreign-key conflict: `purchases.supplierId` is `onDelete: 'set null'` in the schema (not `restrict`, unlike Product), so deleting a supplier always succeeds and any referencing purchases simply lose their supplier reference. No friendly-error-message handling is needed for delete, unlike Inventory's Product delete.
- Every list row includes a `purchaseCount: number` (correlated `COUNT(*)` subquery against `purchases.supplier_id`), matching the same subquery pattern already used for `unitsCount`/`priceTiersCount` in `main/inventory.ts`.
- Default page size is 25, valid page sizes are exactly `[10, 25, 50, 100]`, invalid values fall back to 25 — same convention as every paginated list in this app.
- No bulk-select/bulk-delete — per-row delete only (`useConfirm()` before each), matching the spec's explicit scope (Supplier lists are small; this app's bulk-operations pattern from Inventory is not needed here).
- "+ Tambah Supplier" adds one blank editable row directly into the grid (no separate page, no navigation) — the row autosaves on edit, calling `createSupplier` when unsaved (`id === null`) or `updateSupplier` when already persisted.
- Every IPC handler is auth-guarded: `if (!getCurrentUser()) { throw new Error('Silakan login terlebih dahulu.') }`.
- No money fields in this domain — no `toRupiah`/`toCents` conversion anywhere in this plan.
- Sidebar "Supplier" entry is enabled in this slice (not held back for the later Pembelian slice).

---

### Task 1: `listSuppliers`, `createSupplier`, `updateSupplier`, `deleteSupplier` business logic

**Files:**
- Create: `desktop-node/src/main/supplier.ts`
- Test: `desktop-node/src/main/supplier.test.ts`

**Interfaces:**
- Consumes: `suppliers`, `purchases` from `./db/schema` (existing).
- Produces:
  - `export interface SupplierListItem { id: number; nama: string; telepon: string | null; alamat: string | null; keterangan: string | null; purchaseCount: number }`
  - `export function listSuppliers(db, input: { search?: string; page: number; pageSize?: number }): { data: SupplierListItem[]; currentPage: number; lastPage: number; total: number }`
  - `export interface SupplierInput { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null }`
  - `export function createSupplier(db, input: SupplierInput): number` (returns the new supplier's id)
  - `export function updateSupplier(db, id: number, input: SupplierInput): void`
  - `export function deleteSupplier(db, id: number): void`
  - Task 2's IPC handlers call all of the above with these exact signatures.

- [ ] **Step 1: Write the failing tests**

Create `desktop-node/src/main/supplier.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createDb } from './db/migrate'
import { suppliers, purchases } from './db/schema'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from './supplier'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedDb() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(suppliers)
    .values([
      {
        id: 1,
        nama: 'CV Sumber Makmur',
        telepon: '08123456789',
        alamat: 'Jl. Merdeka 1',
        keterangan: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        nama: 'Toko Aneka Jaya',
        telepon: null,
        alamat: null,
        keterangan: 'Grosir sembako',
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run()

  return db
}

describe('listSuppliers', () => {
  it('returns all suppliers ordered by nama', () => {
    const db = seedDb()
    const result = listSuppliers(db, { page: 1 })
    expect(result.total).toBe(2)
    expect(result.data.map((s) => s.nama)).toEqual(['CV Sumber Makmur', 'Toko Aneka Jaya'])
  })

  it('filters by search on nama', () => {
    const db = seedDb()
    const result = listSuppliers(db, { search: 'aneka', page: 1 })
    expect(result.data.map((s) => s.id)).toEqual([2])
  })

  it('includes purchaseCount, zero when no purchases exist', () => {
    const db = seedDb()
    const result = listSuppliers(db, { page: 1 })
    expect(result.data.every((s) => s.purchaseCount === 0)).toBe(true)
  })

  it('counts purchases referencing a supplier', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(purchases)
      .values([
        { id: 1, supplierId: 1, userId: null, tanggal: '2026-08-01', total: 10000, catatan: null, createdAt: now, updatedAt: now },
        { id: 2, supplierId: 1, userId: null, tanggal: '2026-08-02', total: 20000, catatan: null, createdAt: now, updatedAt: now },
      ])
      .run()

    const result = listSuppliers(db, { page: 1 })
    const supplier1 = result.data.find((s) => s.id === 1)
    expect(supplier1?.purchaseCount).toBe(2)
  })

  it('paginates with the given pageSize, computing lastPage and total', () => {
    const db = seedDb()
    const now = new Date()
    const extra = Array.from({ length: 10 }, (_, i) => ({
      nama: `Supplier Extra ${i}`,
      telepon: null,
      alamat: null,
      keterangan: null,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(suppliers).values(extra).run()
    // total = 2 seeded + 10 extra = 12

    const page1 = listSuppliers(db, { page: 1, pageSize: 10 })
    expect(page1.data).toHaveLength(10)
    expect(page1.currentPage).toBe(1)
    expect(page1.lastPage).toBe(2)
    expect(page1.total).toBe(12)

    const page2 = listSuppliers(db, { page: 2, pageSize: 10 })
    expect(page2.data).toHaveLength(2)
  })

  it('defaults to pageSize 25 when none is given', () => {
    const db = seedDb()
    const result = listSuppliers(db, { page: 1 })
    expect(result.lastPage).toBe(1)
  })

  it('falls back to pageSize 25 when given an invalid pageSize', () => {
    const db = seedDb()
    const now = new Date()
    const extra = Array.from({ length: 27 }, (_, i) => ({
      nama: `Supplier Invalid Pagesize ${i}`,
      telepon: null,
      alamat: null,
      keterangan: null,
      createdAt: now,
      updatedAt: now,
    }))
    db.insert(suppliers).values(extra).run()
    // total = 2 seeded + 27 extra = 29

    const result = listSuppliers(db, { page: 1, pageSize: 999 })
    expect(result.data).toHaveLength(25)
    expect(result.lastPage).toBe(2)
  })
})

describe('createSupplier', () => {
  it('creates a supplier and returns its id', () => {
    const db = seedDb()
    const id = createSupplier(db, { nama: 'Supplier Baru', telepon: '0811', alamat: null, keterangan: null })
    const created = db.select().from(suppliers).where(eq(suppliers.id, id)).get()
    expect(created).toMatchObject({ nama: 'Supplier Baru', telepon: '0811', alamat: null, keterangan: null })
  })

  it('throws when nama is empty', () => {
    const db = seedDb()
    expect(() => createSupplier(db, { nama: '', telepon: null, alamat: null, keterangan: null })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('throws when nama is only whitespace', () => {
    const db = seedDb()
    expect(() => createSupplier(db, { nama: '   ', telepon: null, alamat: null, keterangan: null })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('throws when nama exceeds 255 characters', () => {
    const db = seedDb()
    expect(() =>
      createSupplier(db, { nama: 'a'.repeat(256), telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Nama maksimal 255 karakter.')
  })
})

describe('updateSupplier', () => {
  it('updates supplier fields', () => {
    const db = seedDb()
    updateSupplier(db, 1, { nama: 'CV Sumber Makmur Baru', telepon: '0899', alamat: 'Jl. Baru', keterangan: 'catatan' })
    const updated = db.select().from(suppliers).where(eq(suppliers.id, 1)).get()
    expect(updated).toMatchObject({
      nama: 'CV Sumber Makmur Baru',
      telepon: '0899',
      alamat: 'Jl. Baru',
      keterangan: 'catatan',
    })
  })

  it('throws when nama is empty', () => {
    const db = seedDb()
    expect(() => updateSupplier(db, 1, { nama: '', telepon: null, alamat: null, keterangan: null })).toThrow(
      'Nama wajib diisi.',
    )
  })

  it('throws when nama exceeds 255 characters', () => {
    const db = seedDb()
    expect(() =>
      updateSupplier(db, 1, { nama: 'a'.repeat(256), telepon: null, alamat: null, keterangan: null }),
    ).toThrow('Nama maksimal 255 karakter.')
  })
})

describe('deleteSupplier', () => {
  it('deletes a supplier with no purchases', () => {
    const db = seedDb()
    deleteSupplier(db, 2)
    expect(db.select().from(suppliers).where(eq(suppliers.id, 2)).get()).toBeUndefined()
  })

  it('deletes a supplier even when purchases reference it, nulling their supplierId', () => {
    const db = seedDb()
    const now = new Date()
    db.insert(purchases)
      .values({ id: 1, supplierId: 1, userId: null, tanggal: '2026-08-01', total: 10000, catatan: null, createdAt: now, updatedAt: now })
      .run()

    deleteSupplier(db, 1)

    expect(db.select().from(suppliers).where(eq(suppliers.id, 1)).get()).toBeUndefined()
    const purchase = db.select().from(purchases).where(eq(purchases.id, 1)).get()
    expect(purchase?.supplierId).toBeNull()
  })

  it('is a no-op when the supplier does not exist', () => {
    const db = seedDb()
    expect(() => deleteSupplier(db, 999)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run supplier.test.ts`
Expected: FAIL — `Cannot find module './supplier'` (the file doesn't exist yet).

- [ ] **Step 3: Implement `supplier.ts`**

Create `desktop-node/src/main/supplier.ts`:

```typescript
import { eq, like, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { suppliers, purchases } from './db/schema'

export interface SupplierListItem {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  purchaseCount: number
}

const DEFAULT_PAGE_SIZE = 25
const VALID_PAGE_SIZES = [10, 25, 50, 100]

function supplierListSelect(db: BetterSQLite3Database<typeof schema>) {
  return db
    .select({
      id: suppliers.id,
      nama: suppliers.nama,
      telepon: suppliers.telepon,
      alamat: suppliers.alamat,
      keterangan: suppliers.keterangan,
      purchaseCount: sql<number>`(SELECT COUNT(*) FROM ${purchases} WHERE ${purchases.supplierId} = ${suppliers.id})`,
    })
    .from(suppliers)
}

export function listSuppliers(
  db: BetterSQLite3Database<typeof schema>,
  input: { search?: string; page: number; pageSize?: number },
): { data: SupplierListItem[]; currentPage: number; lastPage: number; total: number } {
  const pageSize = input.pageSize && VALID_PAGE_SIZES.includes(input.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const page = Math.max(1, input.page)

  const whereClause = input.search ? like(suppliers.nama, `%${input.search}%`) : undefined

  const totalRow = db.select({ count: sql<number>`count(*)` }).from(suppliers).where(whereClause).get()
  const total = totalRow?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  const rows = supplierListSelect(db)
    .where(whereClause)
    .orderBy(suppliers.nama)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { data: rows, currentPage: page, lastPage, total }
}

export interface SupplierInput {
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
}

function validateSupplierInput(input: SupplierInput): void {
  if (!input.nama.trim()) {
    throw new Error('Nama wajib diisi.')
  }

  if (input.nama.length > 255) {
    throw new Error('Nama maksimal 255 karakter.')
  }
}

export function createSupplier(db: BetterSQLite3Database<typeof schema>, input: SupplierInput): number {
  validateSupplierInput(input)

  const now = new Date()
  const created = db
    .insert(suppliers)
    .values({
      nama: input.nama,
      telepon: input.telepon,
      alamat: input.alamat,
      keterangan: input.keterangan,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  return created.id
}

export function updateSupplier(db: BetterSQLite3Database<typeof schema>, id: number, input: SupplierInput): void {
  validateSupplierInput(input)

  db.update(suppliers)
    .set({
      nama: input.nama,
      telepon: input.telepon,
      alamat: input.alamat,
      keterangan: input.keterangan,
    })
    .where(eq(suppliers.id, id))
    .run()
}

export function deleteSupplier(db: BetterSQLite3Database<typeof schema>, id: number): void {
  db.delete(suppliers).where(eq(suppliers.id, id)).run()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run supplier.test.ts`
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
git add src/main/supplier.ts src/main/supplier.test.ts
git status --short
```

Verify the output shows ONLY those two files — never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add Supplier business logic: list, create, update, delete"
```

---

### Task 2: Supplier IPC handlers, preload, renderer types

**Files:**
- Create: `desktop-node/src/main/ipc/supplier.ts`
- Modify: `desktop-node/src/main/index.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `listSuppliers`, `createSupplier`, `updateSupplier`, `deleteSupplier`, `SupplierInput` from Task 1's `main/supplier.ts`; `getCurrentUser` from `./auth` (existing).
- Produces: IPC channels `supplier:listSuppliers`, `supplier:createSupplier`, `supplier:updateSupplier`, `supplier:deleteSupplier`; `window.api.supplier.*` — Task 3's page calls these exact names.

- [ ] **Step 1: Create `ipc/supplier.ts`**

Create `desktop-node/src/main/ipc/supplier.ts`:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier, type SupplierInput } from '../supplier'
import { getCurrentUser } from './auth'

export function registerSupplierIpc(db: BetterSQLite3Database<typeof schema>) {
  ipcMain.handle('supplier:listSuppliers', (_event, input: { search?: string; page: number; pageSize?: number }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return listSuppliers(db, input)
  })

  ipcMain.handle('supplier:createSupplier', (_event, input: SupplierInput) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return createSupplier(db, input)
  })

  ipcMain.handle('supplier:updateSupplier', (_event, id: number, input: SupplierInput) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    updateSupplier(db, id, input)
  })

  ipcMain.handle('supplier:deleteSupplier', (_event, id: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteSupplier(db, id)
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
```

Replace with:

```typescript
import { createDb } from './db/migrate'
import { registerAuthIpc } from './ipc/auth'
import { registerKasirIpc } from './ipc/kasir'
import { registerInventoryIpc } from './ipc/inventory'
import { registerSupplierIpc } from './ipc/supplier'
```

Find:

```typescript
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  createWindow()
```

Replace with:

```typescript
  db = createDb(getDbPath(), getMigrationsFolder())
  registerAuthIpc(db)
  registerKasirIpc(db)
  registerInventoryIpc(db)
  registerSupplierIpc(db)
  createWindow()
```

- [ ] **Step 3: Expose the channels in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    importProducts: () => invoke('inventory:importProducts'),
  },
}
```

Replace with:

```typescript
    importProducts: () => invoke('inventory:importProducts'),
  },
  supplier: {
    listSuppliers: (input: { search?: string; page: number; pageSize?: number }) =>
      invoke('supplier:listSuppliers', input),
    createSupplier: (input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null }) =>
      invoke('supplier:createSupplier', input),
    updateSupplier: (
      id: number,
      input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null },
    ) => invoke('supplier:updateSupplier', id, input),
    deleteSupplier: (id: number) => invoke('supplier:deleteSupplier', id),
  },
}
```

- [ ] **Step 4: Add matching renderer types**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
        importProducts: () => Promise<{ created: number; updated: number; unchanged: number; skipped: number } | null>
      }
    }
  }
}
```

Replace with:

```typescript
        importProducts: () => Promise<{ created: number; updated: number; unchanged: number; skipped: number } | null>
      }
      supplier: {
        listSuppliers: (input: { search?: string; page: number; pageSize?: number }) => Promise<{
          data: {
            id: number
            nama: string
            telepon: string | null
            alamat: string | null
            keterangan: string | null
            purchaseCount: number
          }[]
          currentPage: number
          lastPage: number
          total: number
        }>
        createSupplier: (input: {
          nama: string
          telepon: string | null
          alamat: string | null
          keterangan: string | null
        }) => Promise<number>
        updateSupplier: (
          id: number,
          input: { nama: string; telepon: string | null; alamat: string | null; keterangan: string | null },
        ) => Promise<void>
        deleteSupplier: (id: number) => Promise<void>
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
git add src/main/ipc/supplier.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts
git status --short
```

Verify the output shows ONLY those four files.

```bash
git commit -m "Add Supplier IPC handlers"
```

---

### Task 3: `Supplier.tsx` page, routing, sidebar, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/Supplier.tsx`
- Modify: `desktop-node/src/renderer/App.tsx`
- Modify: `desktop-node/src/renderer/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `window.api.supplier.*` (Task 2); `AppShell`, `DataGrid`/`renderTextEditor` (existing), `useConfirm`, `useElementWidth`, `useAvailableHeight`, `useAppearance`, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`, `Button`, `Input` (all existing).
- Produces: `export function Supplier()` — a full page component; `App.tsx` renders it at `/supplier`.

- [ ] **Step 1: Create `Supplier.tsx`**

Create `desktop-node/src/renderer/pages/Supplier.tsx`:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Column, RowsChangeData } from 'react-data-grid'
import { DataGrid, renderTextEditor } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppearance } from '@/hooks/use-appearance'
import { useAvailableHeight } from '@/hooks/use-available-height'
import { useConfirm } from '@/hooks/use-confirm'
import { useElementWidth } from '@/hooks/use-element-width'
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'

interface SupplierRow {
  id: number
  nama: string
  telepon: string | null
  alamat: string | null
  keterangan: string | null
  purchaseCount: number
}

interface DraftRow {
  key: string
  id: number | null
  nama: string
  telepon: string
  alamat: string
  keterangan: string
  purchaseCount: number
}

function toDraftRow(supplier: SupplierRow): DraftRow {
  return {
    key: `supplier-${supplier.id}`,
    id: supplier.id,
    nama: supplier.nama,
    telepon: supplier.telepon ?? '',
    alamat: supplier.alamat ?? '',
    keterangan: supplier.keterangan ?? '',
    purchaseCount: supplier.purchaseCount,
  }
}

function emptyRow(): DraftRow {
  return {
    key: crypto.randomUUID(),
    id: null,
    nama: '',
    telepon: '',
    alamat: '',
    keterangan: '',
    purchaseCount: 0,
  }
}

const OTHER_COLUMNS_WIDTH = 150 + 150 + 150 + 130 + 70
const MIN_NAMA_WIDTH = 200

const BREADCRUMBS: BreadcrumbItem[] = [{ title: 'Supplier', href: '/supplier' }]

export function Supplier() {
  const { resolvedAppearance } = useAppearance()
  const [widthRef, gridWidth] = useElementWidth<HTMLDivElement>()
  const [heightRef, gridHeight] = useAvailableHeight<HTMLDivElement>(72)

  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState('25')

  const { confirm, ConfirmDialog } = useConfirm()

  function loadPage(page: number, opts?: { search?: string; pageSize?: string }) {
    const term = opts?.search ?? search
    const size = opts?.pageSize ?? pageSize

    window.api.supplier
      .listSuppliers({ search: term || undefined, page, pageSize: Number(size) })
      .then((result) => {
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

  function addRow() {
    setRows((prev) => [emptyRow(), ...prev])
  }

  function saveRow(row: DraftRow) {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })

    if (!row.nama.trim()) {
      setRowErrors((prev) => ({ ...prev, [row.key]: 'Nama wajib diisi.' }))
      return
    }

    const input = {
      nama: row.nama,
      telepon: row.telepon || null,
      alamat: row.alamat || null,
      keterangan: row.keterangan || null,
    }

    const request = row.id === null ? window.api.supplier.createSupplier(input) : window.api.supplier.updateSupplier(row.id, input)

    request
      .then(() => loadPage(currentPage))
      .catch((err) => {
        setRowErrors((prev) => ({ ...prev, [row.key]: err instanceof Error ? err.message : 'Gagal menyimpan' }))
      })
  }

  function handleRowsChange(newRows: DraftRow[], data: RowsChangeData<DraftRow>) {
    setRows(newRows)
    saveRow(newRows[data.indexes[0]])
  }

  async function deleteRow(row: DraftRow) {
    if (row.id === null) {
      setRows((prev) => prev.filter((r) => r.key !== row.key))
      return
    }

    const ok = await confirm({
      title: 'Hapus Supplier',
      description: `Hapus supplier "${row.nama}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    setDeleteError(null)

    try {
      await window.api.supplier.deleteSupplier(row.id)
      loadPage(currentPage)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Gagal menghapus supplier')
    }
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
    textColumn('nama', 'Nama', namaWidth),
    textColumn('telepon', 'Telepon', 150),
    textColumn('alamat', 'Alamat', 150),
    textColumn('keterangan', 'Keterangan', 150),
    {
      key: 'purchaseCount',
      name: 'Jumlah Pembelian',
      width: 130,
      renderCell: ({ row }) => <span className="text-muted-foreground">{row.id === null ? '-' : row.purchaseCount}</span>,
    },
    {
      key: 'aksi',
      name: '',
      width: 70,
      renderCell: ({ row }) => (
        <button type="button" className="text-xs text-destructive hover:underline" onClick={() => deleteRow(row)}>
          Hapus
        </button>
      ),
    },
  ]

  const errorSummary = Object.entries(rowErrors).map(([key, message]) => {
    const row = rows.find((r) => r.key === key)
    return `${row?.nama || 'Baris baru'}: ${message}`
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
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama supplier..."
              className="w-64"
            />
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>
          <Button type="button" onClick={addRow}>
            + Tambah Supplier
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
              onRowsChange={handleRowsChange}
              renderers={{
                noRowsFallback: (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">Belum ada supplier.</div>
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
            <span>dari {total} supplier</span>
          </div>
        </div>
      </div>

      {ConfirmDialog}
    </AppShell>
  )
}
```

- [ ] **Step 2: Add the route**

In `desktop-node/src/renderer/App.tsx`, find:

```typescript
import { Inventory } from './pages/Inventory'
import { MassInput } from './pages/inventory/MassInput'
```

Replace with:

```typescript
import { Inventory } from './pages/Inventory'
import { MassInput } from './pages/inventory/MassInput'
import { Supplier } from './pages/Supplier'
```

Find:

```typescript
        <Route path="/inventory/mass-input" element={<MassInput />} />
```

Replace with:

```typescript
        <Route path="/inventory/mass-input" element={<MassInput />} />
        <Route path="/supplier" element={<Supplier />} />
```

- [ ] **Step 3: Enable the sidebar entry**

In `desktop-node/src/renderer/components/app-sidebar.tsx`, find:

```typescript
import { Boxes, ClipboardCheck, ClipboardList, History, LayoutGrid, PackagePlus, ShoppingCart } from 'lucide-react'
```

Replace with:

```typescript
import { Boxes, Building2, ClipboardCheck, ClipboardList, History, LayoutGrid, PackagePlus, ShoppingCart } from 'lucide-react'
```

Find:

```typescript
const pembelianNavItems: NavItem[] = [
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus, disabled: true },
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes },
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck, disabled: true },
]
```

Replace with:

```typescript
const pembelianNavItems: NavItem[] = [
  { title: 'Pembelian', href: '/purchase', icon: PackagePlus, disabled: true },
  { title: 'Supplier', href: '/supplier', icon: Building2 },
  { title: 'Katalog Produk', href: '/inventory', icon: Boxes },
  { title: 'Stock Opname', href: '/stock-opname', icon: ClipboardCheck, disabled: true },
]
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

1. Confirm "Supplier" is present and enabled in the sidebar under "Pembelian & Stok" (not dimmed, unlike the still-disabled "Pembelian"/"Stock Opname" siblings). Click it, confirm navigation to `/supplier`, breadcrumb reads "Supplier".
2. Confirm the grid shows "Belum ada supplier." (empty state) if `dev.sqlite` has no suppliers yet, or existing seeded rows if any.
3. Click "+ Tambah Supplier" — confirm a new blank row appears at the top of the grid. Fill in Nama="Toko Sumber Rejeki", Telepon="081234567890", leave Alamat/Keterangan blank. Confirm it autosaves (no explicit save button) and the row's "Jumlah Pembelian" column shows "0" after the grid reloads.
4. Add a second row with Nama left blank — confirm a client-visible error ("Nama wajib diisi.") appears in the error summary above the grid, and the row is NOT saved (reload the page and confirm only 1 supplier exists, not 2).
5. Edit an existing saved supplier's Alamat field — confirm it saves (reload and verify the new value persists).
6. Click "Hapus" on a supplier with 0 purchases — confirm the `useConfirm()` dialog appears with the exact supplier name, confirm it, and the row disappears from the grid.
7. Click "Hapus" on the still-unsaved blank row from step 4 (if still present) — confirm it's removed from the grid immediately with NO confirm dialog (since nothing was ever persisted).
8. Search for a supplier by partial name — confirm the grid filters correctly.
9. Change the "Tampilkan" per-page Select — confirm the grid reloads with the new page size.
10. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 8: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/renderer/pages/Supplier.tsx src/renderer/App.tsx src/renderer/components/app-sidebar.tsx
git status --short
```

Verify the output shows ONLY those three files.

```bash
git commit -m "Add Supplier page, enable Supplier sidebar entry"
```

---

## Plan Self-Review

**Spec coverage:** Slice 1's business logic (list with search/pagination/purchaseCount, create/update with nama validation, delete with no FK-restrict handling needed) → Task 1. IPC (auth guards, no money conversion) → Task 2. Renderer (inline-editable grid, per-row add/delete, no bulk operations, pagination matching the established shape) → Task 3. Sidebar entry enabled immediately (not held back for Pembelian) → Task 3 Step 3. Out-of-scope items from the spec (Pembelian itself, the schema change to `purchase_items`, unit-picker/satuan-turunan integration) — untouched by every task in this plan, correctly deferred to the separate Pembelian plan.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code.

**Type consistency:** `SupplierListItem`/`SupplierInput` (Task 1) match Task 2's IPC handler signatures and `env.d.ts` types field-for-field. `window.api.supplier.listSuppliers`/`createSupplier`/`updateSupplier`/`deleteSupplier` signatures are identical across preload, `env.d.ts` (Task 2), and every call site in `Supplier.tsx` (Task 3).
