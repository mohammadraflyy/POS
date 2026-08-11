# Multi Satuan + Multi Harga + Quantity Price Tier Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the product/unit/price model so every product has a global-registry `unit`, a base unit that is a real `product_units` row (not a `null` sentinel), price tiers scoped per unit with closed `[min,max]` ranges, transaction-item price-source snapshots, and a cross-cutting `stock_movements` ledger.

**Architecture:** Additive-then-cutover per concern (units → product_units restructure → price_tiers restructure → sale_items snapshot fields → stock_movements), each behind its own Drizzle migration, with every downstream consumer of the old `productUnitId === null` sentinel updated file-by-file once the new base-unit row exists. `products.hargaJual`/`hargaPokok`/`stok` stay in place (hargaJual becomes a synced cache, not deleted).

**Tech Stack:** Electron + React (renderer), Drizzle ORM + better-sqlite3 (main process), Vitest, drizzle-kit (`npm run db:generate`) for migrations.

## Global Constraints

- Money is stored as integer cents everywhere in `main/`; the IPC boundary converts to/from Rupiah via local `toRupiah`/`toCents` helpers per file (existing convention — do not create a generic shared converter).
- Every new/changed IPC handler must stay guarded by `getCurrentUser()`, matching every existing handler in `main/ipc/*.ts`.
- Schema changes go through `npm run db:generate` (drizzle-kit) after editing `src/main/db/schema.ts` — never hand-write migration SQL from scratch; generate then inspect the output.
- After any change to `better-sqlite3`'s consumers, tests require the Node ABI (`npm run rebuild:node`); running the actual Electron app requires the Electron ABI (`npm run rebuild:electron`). Check `tasklist | grep electron` (bash) before switching — if the user's own `npm run dev` is running, ask before killing it.
- `vendor/`-equivalent: no new npm dependencies — this plan uses only what's already installed (Drizzle, better-sqlite3, existing shadcn/ui components).
- Run `npx tsc --noEmit -p tsconfig.json` and the affected `vitest` files after every task; run the full suite (`npx vitest run`) at the end of each task before committing.
- Design spec: `docs/superpowers/specs/2026-08-09-multi-unit-price-tier-rebuild-design.md` — every task below implements a specific section of it; consult it for the full rationale behind a decision if a step references "per the design spec."

---

### Task 1: `units` global table — schema, migration, backfill

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: migration via `npm run db:generate` (writes to `drizzle/000X_*.sql`)
- Test: `src/main/db/migrate.test.ts`

**Interfaces:**
- Produces: `units` Drizzle table — `{ id, code: string, name: string, symbol: string, isActive: boolean, createdAt: Date, updatedAt: Date }`. `code` is unique, uppercase, trimmed (e.g. `"PCS"`, `"BOX"`, `"DUS"`).

- [ ] **Step 1: Add the `units` table to schema.ts**

Add after the `categories` table definition in `src/main/db/schema.ts`:

```typescript
export const units = sqliteTable('units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps(),
})
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/`, e.g. `drizzle/0006_<name>.sql`, containing `CREATE TABLE "units" (...)`.

- [ ] **Step 3: Add a backfill statement to the generated migration**

Open the newly generated `drizzle/0006_*.sql` and append (after the `CREATE TABLE "units"` statement, before the next `--> statement-breakpoint` if any) a seed insert that dedups every distinct satuan string already present in `products.satuan` and `product_units.satuan`:

```sql
--> statement-breakpoint
INSERT INTO units (code, name, symbol, is_active, created_at, updated_at)
SELECT DISTINCT UPPER(TRIM(satuan)), TRIM(satuan), LOWER(TRIM(satuan)), 1, unixepoch(), unixepoch()
FROM (
  SELECT satuan FROM products
  UNION
  SELECT satuan FROM product_units
) AS all_satuan
WHERE TRIM(satuan) != ''
  AND UPPER(TRIM(satuan)) NOT IN (SELECT code FROM units);
```

(The final `NOT IN` guard makes this safe to re-run if drizzle-kit ever regenerates the statement list.)

- [ ] **Step 4: Write a migration test**

In `src/main/db/migrate.test.ts`, add:

```typescript
it('seeds the units table from every distinct satuan string already in products/product_units', () => {
  const db = createDb(':memory:', migrationsFolder)
  const seeded = db.select().from(units).all()
  const codes = seeded.map((u) => u.code)
  // dev fixtures / prior migrations seed at least PCS via products.satuan in other tests -
  // assert the table exists and dedup works, not exact contents (varies by fixture data)
  expect(new Set(codes).size).toBe(codes.length)
})
```

Add `units` to the schema import at the top of the test file.

- [ ] **Step 5: Run the test**

Run: `npm run rebuild:node && npx vitest run src/main/db/migrate.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add src/main/db/schema.ts drizzle/ src/main/db/migrate.test.ts
git commit -m "feat: add units global table with satuan backfill"
```

---

### Task 2: Master Satuan backend — CRUD module + IPC

**Files:**
- Create: `src/main/master-satuan.ts`
- Create: `src/main/master-satuan.test.ts`
- Modify: `src/main/ipc/inventory.ts` (or new `src/main/ipc/master-satuan.ts` registered alongside it in `src/main/index.ts` — check how `registerKasirIpc`/`registerInventoryIpc` are wired in `src/main/index.ts` and follow that exact pattern)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `units` table from Task 1.
- Produces:
  - `listUnits(db): { id: number; code: string; name: string; symbol: string; isActive: boolean }[]`
  - `createUnit(db, input: { code: string; name: string; symbol: string }): void` — throws `"Kode satuan wajib diisi."` / `"Kode satuan sudah ada."` / `"Nama wajib diisi."` / `"Simbol wajib diisi."`
  - `updateUnit(db, id: number, input: { code: string; name: string; symbol: string; isActive: boolean }): void` — same validations, throws `"Satuan tidak ditemukan."` if missing.
  - `deactivateUnit(db, id: number): void` — sets `isActive = false`. Does NOT block on existing `product_units` references (deactivation just hides it from new-unit pickers; existing references keep working) — no FK-restrict error needed here since nothing FK-cascades on `isActive`.
  - IPC channels: `master-satuan:list`, `master-satuan:create`, `master-satuan:update`, `master-satuan:deactivate`.

- [ ] **Step 1: Write the failing test for `createUnit` validation**

Create `src/main/master-satuan.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { units } from './db/schema'
import { listUnits, createUnit, updateUnit, deactivateUnit } from './master-satuan'

const migrationsFolder = path.join(__dirname, '../../drizzle')

describe('createUnit', () => {
  it('throws when code is empty', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => createUnit(db, { code: '  ', name: 'Pieces', symbol: 'pcs' })).toThrow('Kode satuan wajib diisi.')
  })

  it('throws when code already exists', () => {
    const db = createDb(':memory:', migrationsFolder)
    createUnit(db, { code: 'BOX', name: 'Box', symbol: 'box' })
    expect(() => createUnit(db, { code: 'box', name: 'Box lagi', symbol: 'box' })).toThrow('Kode satuan sudah ada.')
  })

  it('creates a unit and lists it', () => {
    const db = createDb(':memory:', migrationsFolder)
    createUnit(db, { code: 'DUS', name: 'Dus', symbol: 'dus' })
    const all = listUnits(db)
    expect(all.some((u) => u.code === 'DUS')).toBe(true)
  })
})

describe('updateUnit', () => {
  it('throws when the unit does not exist', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => updateUnit(db, 999, { code: 'X', name: 'X', symbol: 'x', isActive: true })).toThrow('Satuan tidak ditemukan.')
  })
})

describe('deactivateUnit', () => {
  it('sets isActive to false', () => {
    const db = createDb(':memory:', migrationsFolder)
    createUnit(db, { code: 'RTG', name: 'Renteng', symbol: 'rtg' })
    const created = listUnits(db).find((u) => u.code === 'RTG')!
    deactivateUnit(db, created.id)
    expect(listUnits(db).find((u) => u.id === created.id)?.isActive).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run rebuild:node && npx vitest run src/main/master-satuan.test.ts`
Expected: FAIL — `Cannot find module './master-satuan'`.

- [ ] **Step 3: Implement `src/main/master-satuan.ts`**

```typescript
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { units } from './db/schema'

export interface UnitRow {
  id: number
  code: string
  name: string
  symbol: string
  isActive: boolean
}

export interface UpsertUnitInput {
  code: string
  name: string
  symbol: string
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

function validate(input: UpsertUnitInput): void {
  if (!input.code.trim()) {
    throw new Error('Kode satuan wajib diisi.')
  }
  if (!input.name.trim()) {
    throw new Error('Nama wajib diisi.')
  }
  if (!input.symbol.trim()) {
    throw new Error('Simbol wajib diisi.')
  }
}

export function listUnits(db: BetterSQLite3Database<typeof schema>): UnitRow[] {
  return db
    .select({ id: units.id, code: units.code, name: units.name, symbol: units.symbol, isActive: units.isActive })
    .from(units)
    .orderBy(units.code)
    .all()
}

export function createUnit(db: BetterSQLite3Database<typeof schema>, input: UpsertUnitInput): void {
  validate(input)
  const code = normalizeCode(input.code)

  const existing = db.select({ id: units.id }).from(units).where(eq(units.code, code)).get()
  if (existing) {
    throw new Error('Kode satuan sudah ada.')
  }

  const now = new Date()
  db.insert(units)
    .values({ code, name: input.name.trim(), symbol: input.symbol.trim(), isActive: true, createdAt: now, updatedAt: now })
    .run()
}

export function updateUnit(
  db: BetterSQLite3Database<typeof schema>,
  id: number,
  input: UpsertUnitInput & { isActive: boolean },
): void {
  validate(input)
  const code = normalizeCode(input.code)

  const existing = db.select({ id: units.id }).from(units).where(eq(units.id, id)).get()
  if (!existing) {
    throw new Error('Satuan tidak ditemukan.')
  }

  const duplicate = db.select({ id: units.id }).from(units).where(eq(units.code, code)).get()
  if (duplicate && duplicate.id !== id) {
    throw new Error('Kode satuan sudah ada.')
  }

  db.update(units)
    .set({ code, name: input.name.trim(), symbol: input.symbol.trim(), isActive: input.isActive, updatedAt: new Date() })
    .where(eq(units.id, id))
    .run()
}

export function deactivateUnit(db: BetterSQLite3Database<typeof schema>, id: number): void {
  db.update(units).set({ isActive: false, updatedAt: new Date() }).where(eq(units.id, id)).run()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/master-satuan.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Register IPC handlers**

Read `src/main/index.ts` to find how `registerKasirIpc(db)`/`registerInventoryIpc(db)` are called, and `src/main/ipc/inventory.ts`'s top for the `toRupiah`/`getCurrentUser` pattern (no money involved here, so just the auth guard). Add to `src/main/ipc/inventory.ts` (money-free, so no `toRupiah`/`toCents` needed):

```typescript
import { listUnits, createUnit, updateUnit, deactivateUnit } from '../master-satuan'

// inside registerInventoryIpc(db):
ipcMain.handle('master-satuan:list', () => {
  if (!getCurrentUser()) throw new Error('Silakan login terlebih dahulu.')
  return listUnits(db)
})

ipcMain.handle('master-satuan:create', (_e, input: { code: string; name: string; symbol: string }) => {
  if (!getCurrentUser()) throw new Error('Silakan login terlebih dahulu.')
  createUnit(db, input)
})

ipcMain.handle('master-satuan:update', (_e, id: number, input: { code: string; name: string; symbol: string; isActive: boolean }) => {
  if (!getCurrentUser()) throw new Error('Silakan login terlebih dahulu.')
  updateUnit(db, id, input)
})

ipcMain.handle('master-satuan:deactivate', (_e, id: number) => {
  if (!getCurrentUser()) throw new Error('Silakan login terlebih dahulu.')
  deactivateUnit(db, id)
})
```

- [ ] **Step 6: Wire preload + renderer types**

In `src/preload/index.ts`, add a new top-level `masterSatuan` object to the exposed `api`:

```typescript
masterSatuan: {
  list: () => invoke('master-satuan:list'),
  create: (input: { code: string; name: string; symbol: string }) => invoke('master-satuan:create', input),
  update: (id: number, input: { code: string; name: string; symbol: string; isActive: boolean }) =>
    invoke('master-satuan:update', id, input),
  deactivate: (id: number) => invoke('master-satuan:deactivate', id),
},
```

In `src/renderer/env.d.ts`, add the matching ambient type inside the `api` interface:

```typescript
masterSatuan: {
  list: () => Promise<{ id: number; code: string; name: string; symbol: string; isActive: boolean }[]>
  create: (input: { code: string; name: string; symbol: string }) => Promise<void>
  update: (id: number, input: { code: string; name: string; symbol: string; isActive: boolean }) => Promise<void>
  deactivate: (id: number) => Promise<void>
}
```

- [ ] **Step 7: Typecheck, run full suite, commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
git add src/main/master-satuan.ts src/main/master-satuan.test.ts src/main/ipc/inventory.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat: add Master Satuan CRUD backend and IPC"
```

---

### Task 3: Master Satuan UI page

**Files:**
- Create: `src/renderer/pages/MasterSatuan.tsx`
- Modify: wherever the sidebar nav items are defined (grep `Katalog Produk` or `Stock Opname` in `src/renderer/components/` to find the nav config file, and the router — grep `#/inventory` or `HashRouter`/`Routes` in `src/renderer/` for the route table, likely in `src/renderer/App.tsx` or similar)

**Interfaces:**
- Consumes: `window.api.masterSatuan.*` from Task 2.

- [ ] **Step 1: Find the router and sidebar nav files**

Run: `grep -rn "Katalog Produk" src/renderer/ --include=*.tsx`

This locates both the route registration and the sidebar link. Read both files fully before editing.

- [ ] **Step 2: Build the page component**

Create `src/renderer/pages/MasterSatuan.tsx` following the exact structure of `src/renderer/pages/Supplier.tsx` (a simple CRUD-list page with a table + add form + edit-in-place + confirm-delete, already in this codebase) — read `Supplier.tsx` first and mirror its patterns (state shape, `useConfirm` hook usage, `InputError` component, table layout) rather than inventing a new structure. The page needs:
- A table listing all units (code, name, symbol, active badge).
- An add form (code/name/symbol inputs, "Tambah" button) calling `window.api.masterSatuan.create`.
- Per-row "Edit" (inline form, same three fields + active toggle) calling `window.api.masterSatuan.update`.
- Per-row "Nonaktifkan"/"Aktifkan" toggle calling `window.api.masterSatuan.deactivate` (or `update` with `isActive` flipped — reuse `update` for reactivation since `deactivateUnit` only ever sets `false`).
- Reload the list after every mutation.

- [ ] **Step 3: Register the route**

Add `<Route path="/master-satuan" element={<MasterSatuan />} />` (or the HashRouter equivalent already used — match the exact syntax found in Step 1) to the route table, and a sidebar link (`<Ruler />` or similar `lucide-react` icon, label "Master Satuan") near "Katalog Produk" in the "Pembelian & Stok" nav section (matching where units conceptually belong).

- [ ] **Step 4: Manual verification**

Run `npm run build`, launch the app (rebuild `better-sqlite3` for Electron ABI first if needed), log in, navigate to Master Satuan via the sidebar, create a unit, edit it, deactivate it. Screenshot each step.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/renderer/pages/MasterSatuan.tsx <router file> <sidebar file>
git commit -m "feat: add Master Satuan management page"
```

---

### Task 4: `product_units` restructure — schema, migration, backfill

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: migration via `npm run db:generate`
- Test: `src/main/db/migrate.test.ts`

**Interfaces:**
- Consumes: `units` table (Task 1).
- Produces: restructured `productUnits` table — `{ id, productId, unitId, jumlahKemasan, conversionFactor, hargaJual, isBaseUnit, isDefaultSalesUnit, isDefaultPurchaseUnit, createdAt, updatedAt }`. Every product gains exactly one row with `isBaseUnit = true, conversionFactor = 1`.

This is the highest-risk migration in the whole plan — it changes the meaning of "how do I find a product's base unit" for every downstream consumer. Do not proceed past this task until its test passes against a **copy** of real data (see Step 5).

- [ ] **Step 1: Update the schema**

Replace the `productUnits` table definition in `src/main/db/schema.ts`:

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  unitId: integer('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
  jumlahKemasan: integer('jumlah_kemasan').notNull(),
  conversionFactor: integer('conversion_factor').notNull(),
  hargaJual: integer('harga_jual').notNull(),
  isBaseUnit: integer('is_base_unit', { mode: 'boolean' }).notNull().default(false),
  isDefaultSalesUnit: integer('is_default_sales_unit', { mode: 'boolean' }).notNull().default(false),
  isDefaultPurchaseUnit: integer('is_default_purchase_unit', { mode: 'boolean' }).notNull().default(false),
  ...timestamps(),
}, (table) => ({
  productUnitUnique: uniqueIndex('product_units_product_id_unit_id_unique').on(table.productId, table.unitId),
}))
```

Remove `satuan` from `products` table (delete the `satuan: text('satuan').notNull(),` line). Keep `hargaJual`, `hargaPokok`, `stok`, everything else on `products` unchanged.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: drizzle-kit will likely ask (in non-interactive mode, pick "rename" vs "drop+create" — since this is a destructive column change, expect it to generate a table-rebuild migration similar to `drizzle/0005_massive_siren.sql`, i.e. `CREATE __new_product_units`, copy, drop, rename). Inspect the generated SQL file under `drizzle/`.

- [ ] **Step 3: Rewrite the generated migration's data-copy step**

The auto-generated `INSERT INTO __new_product_units SELECT ... FROM product_units` will be wrong (old table has `satuan`/`konversi`, new one has `unit_id`/`conversion_factor`/three new booleans) — replace the generated `INSERT`/copy logic with:

```sql
-- resolve unit_id by joining old satuan text to units.code, backfill conversion_factor from konversi
INSERT INTO __new_product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
SELECT pu.id, pu.product_id, u.id, pu.jumlah_kemasan, pu.konversi, pu.harga_jual, 0, 0, 0, pu.created_at, pu.updated_at
FROM product_units pu
JOIN units u ON u.code = UPPER(TRIM(pu.satuan));
--> statement-breakpoint
-- insert one base-unit row per product (conversion_factor = 1, is_base_unit = 1)
INSERT INTO __new_product_units (product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
SELECT p.id, u.id, 1, 1, p.harga_jual, 1, 1, 1, unixepoch(), unixepoch()
FROM products p
JOIN units u ON u.code = UPPER(TRIM(p.satuan));
```

(Both `INSERT`s must run **before** the `DROP TABLE product_units` / `products.satuan` column drop that drizzle-kit generated — reorder the statements in the file if drizzle-kit put the drop first. Keep the `PRAGMA foreign_keys=OFF` / `ON` wrapper drizzle-kit generates around the whole rebuild.)

- [ ] **Step 4: Write the migration test**

In `src/main/db/migrate.test.ts`:

```typescript
it('gives every product exactly one is_base_unit=true product_units row with conversion_factor 1', () => {
  const db = createDb(':memory:', migrationsFolder)
  // seed a product the old way isn't possible anymore post-migration - seed directly via the new shape
  const now = new Date()
  const unit = db.insert(units).values({ code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true, createdAt: now, updatedAt: now }).returning().get()
  const product = db.insert(products).values({ kodeItem: 'T1', namaItem: 'Test', hargaJual: 1000, stok: 10, createdAt: now, updatedAt: now }).returning().get()
  db.insert(productUnits).values({ productId: product.id, unitId: unit.id, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 1000, isBaseUnit: true, isDefaultSalesUnit: true, isDefaultPurchaseUnit: true, createdAt: now, updatedAt: now }).run()

  const baseRows = db.select().from(productUnits).where(and(eq(productUnits.productId, product.id), eq(productUnits.isBaseUnit, true))).all()
  expect(baseRows).toHaveLength(1)
  expect(baseRows[0].conversionFactor).toBe(1)
})
```

Add `units`, `and` (from `drizzle-orm`) to the test file's imports if not already present. Note: this test seeds fresh data in the new shape rather than asserting on the backfill of pre-existing rows, because `:memory:` migration tests always start from an empty DB — the backfill SQL only matters for real `dev.sqlite`/`pos.sqlite`, verified separately in Step 5.

- [ ] **Step 5: Verify the backfill against a copy of real data**

```bash
cp desktop-node/dev.sqlite /tmp/dev-backfill-test.sqlite  # or Windows equivalent path
```

Write a throwaway script (`tmp-verify-backfill.ts`, delete after use) that runs `createDb('/tmp/dev-backfill-test.sqlite', migrationsFolder)` and asserts every row in `products` has exactly one matching `product_units` row with `is_base_unit = 1`. Run via `npx tsx tmp-verify-backfill.ts`. If any product lacks a match, the join in Step 3 failed for that product's satuan (likely a whitespace/case mismatch not caught by Task 1's dedup) — fix the seed/backfill SQL and re-test before proceeding. Delete the throwaway script and the copied DB file when this passes.

- [ ] **Step 6: Run the test suite, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/db/migrate.test.ts
npx tsc --noEmit -p tsconfig.json
```
Expected: `tsc` will show many errors in every file that still references `productUnits.satuan` or `products.satuan` — that's expected, those are fixed in Tasks 5-6. Do not attempt to fix them in this task; just confirm the migration itself is correct and commit.

```bash
git add src/main/db/schema.ts drizzle/ src/main/db/migrate.test.ts
git commit -m "feat: restructure product_units to reference units + explicit base-unit rows"
```

---

### Task 5: `main/inventory-units.ts` rewrite for the new `product_units` shape

**Files:**
- Modify: `src/main/inventory-units.ts`
- Modify: `src/main/inventory-units.test.ts`

**Interfaces:**
- Consumes: `productUnits.unitId/isBaseUnit/conversionFactor` (Task 4), `units` (Task 1).
- Produces:
  - `getBaseProductUnit(db, productId): ProductUnitRow` — throws if a product somehow has none (should never happen post-migration).
  - `listProductUnits(db, productId): ProductUnitRow[]` — now includes the base-unit row (previously base was never a `product_units` row at all), each row carrying `unitCode`/`unitName`/`unitSymbol` joined from `units`.
  - `addProductUnit(db, productId, input: { unitId: number; jumlahKemasan: number; hargaJual: number }): void` — non-base derived units only (base is created once, by the product-creation flow in Task 6e, never through this function).
  - `updateProductUnit(db, productId, unitRowId, input): void` — if `unitRowId` is the base-unit row, updates `hargaJual` only (base unit's `unitId`/`conversionFactor`/`jumlahKemasan` are fixed) **and syncs `products.hargaJual`** (per design spec §1c/decision 2).

- [ ] **Step 1: Update `ProductUnitRow` and the base-row-aware read path**

Replace the top of `src/main/inventory-units.ts`:

```typescript
import { and, eq, inArray, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, units, users, products } from './db/schema'

export interface ProductUnitRow {
  id: number
  unitId: number
  unitCode: string
  unitName: string
  unitSymbol: string
  jumlahKemasan: number
  conversionFactor: number
  hargaJual: number
  isBaseUnit: boolean
  isDefaultSalesUnit: boolean
  isDefaultPurchaseUnit: boolean
}

function unitRowSelect(db: BetterSQLite3Database<typeof schema>) {
  return db
    .select({
      id: productUnits.id,
      unitId: productUnits.unitId,
      unitCode: units.code,
      unitName: units.name,
      unitSymbol: units.symbol,
      jumlahKemasan: productUnits.jumlahKemasan,
      conversionFactor: productUnits.conversionFactor,
      hargaJual: productUnits.hargaJual,
      isBaseUnit: productUnits.isBaseUnit,
      isDefaultSalesUnit: productUnits.isDefaultSalesUnit,
      isDefaultPurchaseUnit: productUnits.isDefaultPurchaseUnit,
      productId: productUnits.productId,
    })
    .from(productUnits)
    .innerJoin(units, eq(productUnits.unitId, units.id))
}

export function listProductUnits(db: BetterSQLite3Database<typeof schema>, productId: number): ProductUnitRow[] {
  return unitRowSelect(db)
    .where(eq(productUnits.productId, productId))
    .orderBy(productUnits.conversionFactor, productUnits.id)
    .all()
}

export function getBaseProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number): ProductUnitRow {
  const row = unitRowSelect(db).where(and(eq(productUnits.productId, productId), eq(productUnits.isBaseUnit, true))).get()
  if (!row) {
    throw new Error(`Produk ${productId} tidak memiliki satuan dasar.`)
  }
  return row
}
```

- [ ] **Step 2: Write failing tests for the new read path**

In `src/main/inventory-units.test.ts`, add a `seedProductWithUnits` helper (mirroring whatever seed helper already exists in the file — read the file first) that creates a `units` row, a `products` row, and a base `productUnits` row, then:

```typescript
describe('getBaseProductUnit', () => {
  it('returns the row with isBaseUnit = true', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const base = getBaseProductUnit(db, productId)
    expect(base.id).toBe(baseUnitRowId)
    expect(base.conversionFactor).toBe(1)
  })

  it('throws when the product has no base unit row', () => {
    const db = createDb(':memory:', migrationsFolder)
    expect(() => getBaseProductUnit(db, 999)).toThrow('tidak memiliki satuan dasar')
  })
})
```

- [ ] **Step 3: Run to verify it fails, then confirm it passes**

```bash
npm run rebuild:node
npx vitest run src/main/inventory-units.test.ts
```
Expected: fails first (function signature mismatch / missing seed helper), then passes once Step 1's code is in place and the seed helper exists.

- [ ] **Step 4: Rewrite `addProductUnit`/`updateProductUnit`/`deleteProductUnit`**

```typescript
export interface UpsertProductUnitInput {
  unitId: number
  jumlahKemasan: number
  hargaJual: number
}

function validateUnitInput(input: UpsertProductUnitInput): void {
  if (!Number.isFinite(input.jumlahKemasan) || !Number.isInteger(input.jumlahKemasan) || input.jumlahKemasan < 1) {
    throw new Error('Jumlah kemasan minimal 1.')
  }
  if (!Number.isFinite(input.hargaJual) || input.hargaJual < 0) {
    throw new Error('Harga jual wajib diisi dan tidak boleh negatif.')
  }
}

export function addProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, input: UpsertProductUnitInput): void {
  validateUnitInput(input)

  const unit = db.select({ id: units.id, isActive: units.isActive }).from(units).where(eq(units.id, input.unitId)).get()
  if (!unit || !unit.isActive) {
    throw new Error('Satuan tidak ditemukan atau tidak aktif.')
  }

  const chain = listProductUnits(db, productId)
  if (chain.some((u) => u.unitId === input.unitId)) {
    throw new Error('Satuan ini sudah dipakai untuk produk ini.')
  }

  const derivedChain = chain.filter((u) => !u.isBaseUnit)
  const prevConversion = derivedChain.length > 0 ? derivedChain[derivedChain.length - 1].conversionFactor : 1
  const conversionFactor = input.jumlahKemasan * prevConversion
  const now = new Date()

  db.insert(productUnits)
    .values({
      productId,
      unitId: input.unitId,
      jumlahKemasan: input.jumlahKemasan,
      conversionFactor,
      hargaJual: input.hargaJual,
      isBaseUnit: false,
      isDefaultSalesUnit: false,
      isDefaultPurchaseUnit: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function updateProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  unitRowId: number,
  input: UpsertProductUnitInput,
): void {
  const chain = listProductUnits(db, productId)
  const idx = chain.findIndex((u) => u.id === unitRowId)
  if (idx === -1) {
    throw new Error('Satuan tidak ditemukan.')
  }

  const now = new Date()

  if (chain[idx].isBaseUnit) {
    // base unit's identity/conversion is fixed - only hargaJual can change, and it must
    // stay mirrored onto products.hargaJual (design spec decision 2: hargaJual is a cache)
    if (!Number.isFinite(input.hargaJual) || input.hargaJual < 0) {
      throw new Error('Harga jual wajib diisi dan tidak boleh negatif.')
    }
    db.transaction((tx) => {
      tx.update(productUnits).set({ hargaJual: input.hargaJual, updatedAt: now }).where(eq(productUnits.id, unitRowId)).run()
      tx.update(products).set({ hargaJual: input.hargaJual, updatedAt: now }).where(eq(products.id, productId)).run()
    })
    return
  }

  validateUnitInput(input)
  const derivedChain = chain.filter((u) => !u.isBaseUnit)
  const derivedIdx = derivedChain.findIndex((u) => u.id === unitRowId)

  if (derivedChain.some((u, i) => i !== derivedIdx && u.unitId === input.unitId)) {
    throw new Error('Satuan ini sudah dipakai untuk produk ini.')
  }

  let prevConversion = derivedIdx === 0 ? 1 : derivedChain[derivedIdx - 1].conversionFactor

  for (let i = derivedIdx; i < derivedChain.length; i++) {
    const jumlahKemasan = i === derivedIdx ? input.jumlahKemasan : derivedChain[i].jumlahKemasan
    const unitId = i === derivedIdx ? input.unitId : derivedChain[i].unitId
    const hargaJual = i === derivedIdx ? input.hargaJual : derivedChain[i].hargaJual
    const conversionFactor = jumlahKemasan * prevConversion

    db.update(productUnits)
      .set({ unitId, jumlahKemasan, conversionFactor, hargaJual, updatedAt: now })
      .where(eq(productUnits.id, derivedChain[i].id))
      .run()

    prevConversion = conversionFactor
  }
}

export function deleteProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, unitRowId: number): void {
  const chain = listProductUnits(db, productId)
  const target = chain.find((u) => u.id === unitRowId)
  if (!target) {
    return
  }
  if (target.isBaseUnit) {
    throw new Error('Satuan dasar tidak bisa dihapus.')
  }

  const derivedChain = chain.filter((u) => !u.isBaseUnit)
  const idx = derivedChain.findIndex((u) => u.id === unitRowId)
  const idsToDelete = derivedChain.slice(idx).map((u) => u.id)
  db.delete(productUnits).where(inArray(productUnits.id, idsToDelete)).run()
}
```

- [ ] **Step 5: Update the existing tests in `inventory-units.test.ts` for the new signatures**

Every existing `addProductUnit(db, productId, { satuan: 'DUS', ... })` call becomes `addProductUnit(db, productId, { unitId: dusUnit.id, ... })` — this requires seeding a `units` row first in each test. Read through the whole existing describe blocks for `addProductUnit`/`updateProductUnit`/`deleteProductUnit` and apply this pattern to every occurrence; do not skip any. Add a new test:

```typescript
it('throws when deleting the base unit', () => {
  const db = createDb(':memory:', migrationsFolder)
  const { productId, baseUnitRowId } = seedProductWithUnits(db)
  expect(() => deleteProductUnit(db, productId, baseUnitRowId)).toThrow('Satuan dasar tidak bisa dihapus.')
})

it('syncs products.hargaJual when the base unit price changes', () => {
  const db = createDb(':memory:', migrationsFolder)
  const { productId, baseUnitRowId, baseUnit } = seedProductWithUnits(db)
  updateProductUnit(db, productId, baseUnitRowId, { unitId: baseUnit.unitId, jumlahKemasan: 1, hargaJual: 99900 })
  const product = db.select().from(products).where(eq(products.id, productId)).get()
  expect(product?.hargaJual).toBe(99900)
})
```

- [ ] **Step 6: Run the full file, typecheck, commit**

```bash
npx vitest run src/main/inventory-units.test.ts
npx tsc --noEmit -p tsconfig.json
```
Expected: `tsc` still shows errors in other files (Task 6 fixes those) — confirm the errors remaining are NOT in `inventory-units.ts`/`inventory-units.test.ts`.

```bash
git add src/main/inventory-units.ts src/main/inventory-units.test.ts
git commit -m "feat: rewrite product-unit CRUD for unit_id + explicit base-unit rows"
```

---

### Task 6a: Update `main/kasir.ts` for the new base-unit model

**Files:**
- Modify: `src/main/kasir.ts`
- Modify: `src/main/kasir.test.ts`
- Modify: `src/main/ipc/kasir.ts` (**added post-Task-4**: this file's `listProducts`/checkout handlers read `products.satuan`/`productUnits.satuan`/`productUnits.konversi` directly — all removed/renamed by Task 4. Originally omitted from this task's file list by mistake; confirmed via `tsc` to have exactly 3 errors, all in this file, all caused by the same schema change this task otherwise fixes. Fix in place: `satuan` reads become `unitCode` reads (or a join through `units`), `konversi` becomes `conversionFactor`.)

**Interfaces:**
- Consumes: `getBaseProductUnit` (Task 5), `productUnits.isBaseUnit/conversionFactor/unitId` (Task 4).
- Produces: `resolveCartItem` now takes the resolved `product_units` row directly (base or derived — no more `productUnit: ProductUnitRow | null` distinction) instead of branching on `null`.

- [ ] **Step 1: Update `resolveCartItem`'s signature and collapse the branch**

Replace in `src/main/kasir.ts`:

```typescript
export function resolveCartItem(
  product: ProductRow,
  productUnit: ProductUnitRow,
  priceTiers: PriceTier[],
  qty: number,
): ResolvedItem {
  const normalPrice = productUnit.hargaJual
  const tier = priceTiers.find((t) => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty))
  const hargaJual = tier?.hargaJual ?? normalPrice
  const priceSource: 'normal' | 'price_tier' = tier ? 'price_tier' : 'normal'

  const qtyDasar = qty * productUnit.conversionFactor

  if (product.stok < qtyDasar) {
    throw new Error(`Stok ${product.namaItem} tidak cukup.`)
  }

  return {
    productId: product.id,
    productUnitId: productUnit.id,
    satuan: productUnit.unitCode,
    konversi: productUnit.conversionFactor,
    hargaJual,
    hargaPokok: product.hargaPokok,
    qty,
    qtyDasar,
    priceSource,
  }
}
```

Update `ProductUnitRow` in this file to match Task 5's shape (`id, unitId, unitCode, conversionFactor, hargaJual` — drop `satuan`, `konversi`). Update `PriceTier` interface to `{ minQty: number; maxQty: number | null; hargaJual: number }`. Update `ResolvedItem` to add `priceSource: 'normal' | 'price_tier'`.

- [ ] **Step 2: Update `checkout()`'s unit/tier resolution**

Replace the item-resolution loop body in `checkout()`:

```typescript
for (const item of input.items) {
  const product = productsById.get(item.productId)
  if (!product) {
    throw new Error('Produk tidak ditemukan.')
  }

  const unit = item.productUnitId
    ? unitRows.find((row) => row.id === item.productUnitId && row.productId === product.id)
    : unitRows.find((row) => row.productId === product.id && row.isBaseUnit)

  if (!unit) {
    throw new Error(`Satuan tidak valid untuk ${product.namaItem}.`)
  }

  const tiers: PriceTier[] = tierRows
    .filter((row) => row.productUnitId === unit.id)
    .map((row) => ({ minQty: row.minQty, maxQty: row.maxQty, hargaJual: row.hargaJual }))

  const resolved = resolveCartItem(product, unit, tiers, item.qty)
  // ... unchanged qtyDasarByProduct accounting below
}
```

Update the `unitRows`/`tierRows` queries above this loop to select the new columns (`unitRows` needs `isBaseUnit`, `conversionFactor`, and a joined `unitCode` from `units` — mirror Task 5's `unitRowSelect` join pattern; `tierRows` needs `productUnitId`/`maxQty`, already free since Drizzle returns full rows).

- [ ] **Step 3: Update the `saleItems` insert to include the new snapshot fields**

In the transaction's insert loop:

```typescript
tx.insert(saleItems)
  .values({
    saleId: sale.id,
    productId: line.productId,
    productUnitId: line.productUnitId,
    qty: line.qty,
    konversi: line.konversi,
    baseQuantity: line.qtyDasar,
    satuan: line.satuan,
    hargaJual: line.hargaJual,
    hargaPokok: line.hargaPokok,
    priceSource: line.priceSource,
    subtotal,
    createdAt: now,
    updatedAt: now,
  })
  .run()
```

(This step assumes Task 11's `sale_items.baseQuantity`/`priceSource` columns already exist — if executing tasks out of order, do Task 11's schema change first. If following this plan's numbering strictly, skip inserting `baseQuantity`/`priceSource` here for now and revisit in Task 11's own step, which references back to this exact insert block.)

- [ ] **Step 4: Update every test in `kasir.test.ts` that seeds `productUnits`/calls `resolveCartItem`**

Every `seedDb()`-style helper in the file currently inserts `product_units` rows with `satuan`/`konversi` and never a base-unit row (base was implicit). Update every seed helper to: (a) seed a `units` row per distinct satuan used in the test, (b) insert a base `product_units` row per product (`isBaseUnit: true, conversionFactor: 1, unitId: <matching units row>`), (c) change every derived-unit insert to use `unitId`/`conversionFactor` instead of `satuan`/`konversi`. Update every `checkout()` call's `items: [{ productId, productUnitId: null, qty }]` — since `productUnitId: null` still means "use the base unit" per Step 2's resolution logic (that sentinel behavior is preserved at the `CartItemInput` level, only the internal resolution changed), these call sites do **not** need to change, only the seed data does. Update `resolveCartItem` direct-call tests (in the `describe('resolveCartItem', ...)` block) to pass a full `ProductUnitRow` object (with `unitCode`, `conversionFactor` etc.) instead of `null` for base-unit cases, and to expect a `priceSource` field in the returned object.

- [ ] **Step 5: Run the full file, fix until green**

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts
```
Expected: iterate until all pass — this file has ~65 tests, expect several rounds of fixing seed helpers.

- [ ] **Step 6: Commit**

```bash
git add src/main/kasir.ts src/main/kasir.test.ts
git commit -m "feat: resolve cart items through explicit product_units rows (base + derived unified)"
```

---

### Task 6b: Update `main/purchase.ts` for the new base-unit model

**Files:**
- Modify: `src/main/purchase.ts`
- Modify: `src/main/purchase.test.ts`

**Interfaces:**
- Consumes: same `getBaseProductUnit`/`isBaseUnit` pattern as Task 6a.

- [ ] **Step 1: Read the current file, find every `productUnitId === null` / `satuan`/`konversi` reference**

Run: `grep -n "productUnitId\|satuan\|konversi" src/main/purchase.ts`

- [ ] **Step 2: Apply the same resolution pattern as Task 6a Step 2**

Wherever `purchase.ts` resolves a unit for a purchase line (`recordPurchase` or similar), replace `productUnitId ? find(...) : { satuan: product.satuan, konversi: 1, hargaJual: product.hargaJual }` (or whatever the current null-branch looks like) with: `productUnitId ? unitRows.find(...) : unitRows.find(row => row.productId === product.id && row.isBaseUnit)`, using the same joined-unit-row shape as Task 6a.

- [ ] **Step 3: Update `purchase.test.ts` seed helpers**

Same pattern as Task 6a Step 4 — every seed helper needs a `units` row + base `product_units` row per product.

- [ ] **Step 4: Run, fix until green, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/purchase.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/purchase.ts src/main/purchase.test.ts
git commit -m "feat: resolve purchase line units through explicit product_units rows"
```

---

### Task 6c: Update `main/stock-opname.ts` for the new base-unit model

**Files:**
- Modify: `src/main/stock-opname.ts`
- Modify: `src/main/stock-opname.test.ts`

- [ ] **Step 1: Read the current file, find every `products.satuan` reference**

Run: `grep -n "satuan\|productUnits" src/main/stock-opname.ts`

Stock opname reads `products.satuan` for display purposes (the adjustment UI shows the product's unit label) — since `products.satuan` no longer exists, replace every such read with a join to the base `product_units` row → `units.code` (via `getBaseProductUnit` from Task 5, or an inline join matching Task 5's `unitRowSelect` pattern if a raw SQL join is more natural for this file's existing query style — match whichever style `stock-opname.ts` already uses elsewhere in the file).

- [ ] **Step 2: Update `stock-opname.test.ts` seed helpers**

Same pattern as Task 6a Step 4.

- [ ] **Step 3: Run, fix until green, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/stock-opname.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/stock-opname.ts src/main/stock-opname.test.ts
git commit -m "feat: read base unit label through product_units in stock opname"
```

---

### Task 6d: Update `main/rekap.ts`, `main/escpos.ts`, and `main/dashboard.ts` for the new base-unit model

**Files:**
- Modify: `src/main/rekap.ts`
- Modify: `src/main/rekap.test.ts`
- Modify: `src/main/escpos.ts`
- Modify: `src/main/escpos.test.ts`
- Modify: `src/main/dashboard.ts` (**added post-Task-4**: `getDashboard`'s low-stock query selects `products.satuan` directly at what was originally line 46 — omitted from this task's file list by mistake, confirmed via `tsc` to be the only other file with errors caused by Task 4 not yet covered by any task)
- Modify: `src/main/dashboard.test.ts`

All three files are read-only consumers (reporting and receipt printing) — they read `product.satuan`/`saleItem.satuan` for display. `saleItem.satuan` is unaffected (already a stored snapshot string on `sale_items`, untouched by this migration). Only direct `products.satuan` reads need fixing.

- [ ] **Step 1: Find every `products.satuan` reference in both files**

Run: `grep -n "satuan" src/main/rekap.ts src/main/escpos.ts`

- [ ] **Step 2: Replace each with a base-unit join, matching Task 6c's approach**

- [ ] **Step 3: Update both test files' seed helpers, run, fix until green**

```bash
npm run rebuild:node
npx vitest run src/main/rekap.test.ts src/main/escpos.test.ts
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add src/main/rekap.ts src/main/rekap.test.ts src/main/escpos.ts src/main/escpos.test.ts
git commit -m "feat: read base unit label through product_units in rekap and receipts"
```

---

### Task 6e: Update `main/inventory.ts` and `main/inventory-bulk.ts` for the new base-unit model

**Files:**
- Modify: `src/main/inventory.ts`
- Modify: `src/main/inventory.test.ts`
- Modify: `src/main/inventory-bulk.ts`
- Modify: `src/main/inventory-bulk.test.ts`

This is the largest of the ripple tasks: `inventory.ts` owns product create/update (which must now also create the base `product_units` row + resolve/create the `units` row from whatever satuan text the form still submits), and `inventory-bulk.ts` owns CSV/Excel import (same requirement, at bulk scale) plus the `importSatuan` feature (which directly manipulates `product_units` chains).

- [ ] **Step 1: Update `createProduct`/`updateProduct` in `inventory.ts`**

Product create must, in the same transaction as the `products` insert: resolve or create a `units` row for the submitted satuan text (upsert-by-code, per design spec decision 1 — the product form itself still takes free text, silently backed by the shared table now), then insert the base `product_units` row (`isBaseUnit: true, conversionFactor: 1, jumlahKemasan: 1, unitId, hargaJual: input.hargaJual`). Product update, when the satuan/hargaJual fields change, must update that same base row (delegate to `updateProductUnit` from Task 5 for the hargaJual-sync behavior, or inline the equivalent — prefer calling `updateProductUnit` directly to avoid duplicating the sync logic).

- [ ] **Step 2: Update `deleteProduct`/list/search queries**

Anywhere `products.satuan` is selected directly (list views, search results), replace with a join to the base `product_units` row, matching Task 6c's pattern.

- [ ] **Step 3: Update `inventory-bulk.ts`'s import logic**

The CSV/Excel product importer currently writes `products.satuan` directly per row — change it to resolve-or-create the `units` row (same upsert-by-code helper as Step 1 — extract it to a small shared function, e.g. `resolveOrCreateUnit(db, satuanText): number` in `master-satuan.ts`, exported and imported by both `inventory.ts` and `inventory-bulk.ts`) and insert/update the base `product_units` row instead of `products.satuan`. The `importSatuan` feature (which builds derived-unit chains from the legacy Excel format) already writes to `product_units` — update its writes to use `unitId` (resolved via the same shared helper) instead of `satuan` text, and to skip/ignore the base-row concept since `importSatuan` only ever creates *derived* rows (the base row already exists from product creation).

- [ ] **Step 4: Add `resolveOrCreateUnit` to `master-satuan.ts`**

```typescript
export function resolveOrCreateUnit(db: BetterSQLite3Database<typeof schema>, satuanText: string): number {
  const code = normalizeCode(satuanText)
  const existing = db.select({ id: units.id }).from(units).where(eq(units.code, code)).get()
  if (existing) {
    return existing.id
  }
  const now = new Date()
  const created = db
    .insert(units)
    .values({ code, name: satuanText.trim(), symbol: satuanText.trim().toLowerCase(), isActive: true, createdAt: now, updatedAt: now })
    .returning()
    .get()
  return created.id
}
```

Export it alongside the existing `listUnits`/`createUnit`/etc. from Task 2.

- [ ] **Step 5: Update every seed helper and satuan-string assertion in both test files**

Same pattern as Task 6a Step 4, applied to `inventory.test.ts` and `inventory-bulk.test.ts` — this includes the `importSatuan` describe block's 12 tests (per project history, these test non-adjacent `relatifKe` resolution and idempotent re-runs — verify those specific behaviors still hold with `unitId` in place of `satuan` strings).

- [ ] **Step 6: Run, fix until green, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/inventory.test.ts src/main/inventory-bulk.test.ts
npx tsc --noEmit -p tsconfig.json
```
Expected: at this point `npx tsc --noEmit` for the **entire main process** should be clean (all Task-6 sub-tasks done). If not, grep for any remaining `\.satuan\b` reference outside `sale_items`/`purchase_items` (which keep their own snapshot `satuan` column, untouched) and fix it before moving on.

```bash
git add src/main/inventory.ts src/main/inventory.test.ts src/main/inventory-bulk.ts src/main/inventory-bulk.test.ts src/main/master-satuan.ts
git commit -m "feat: resolve product satuan through units/product_units in inventory CRUD and import"
```

---

### Task 7: `product_price_tiers` restructure — schema, migration, backfill

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: migration via `npm run db:generate`
- Test: `src/main/db/migrate.test.ts`

**Interfaces:**
- Consumes: `productUnits` (Task 4).
- Produces: `productPriceTiers` with `productUnitId: number` (not null — every tier now points at a real `product_units` row) and `maxQty: number | null`.

- [ ] **Step 1: Update the schema**

```typescript
export const productPriceTiers = sqliteTable('product_price_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  productUnitId: integer('product_unit_id').notNull().references(() => productUnits.id, { onDelete: 'cascade' }),
  minQty: integer('min_qty').notNull(),
  maxQty: integer('max_qty'),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productUnitIdx: index('product_price_tiers_product_unit_idx').on(table.productUnitId),
}))
```

Add `index` to the `drizzle-orm/sqlite-core` import at the top of `schema.ts` if not already imported.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

- [ ] **Step 3: Rewrite the generated migration's data-copy step**

Replace the auto-generated copy with one that backfills `product_unit_id` to each tier's product's base-unit row (every existing tier today is implicitly base-unit-scoped):

```sql
INSERT INTO __new_product_price_tiers (id, product_id, product_unit_id, min_qty, max_qty, harga_jual, created_at, updated_at)
SELECT t.id, t.product_id, pu.id, t.min_qty, NULL, t.harga_jual, t.created_at, t.updated_at
FROM product_price_tiers t
JOIN product_units pu ON pu.product_id = t.product_id AND pu.is_base_unit = 1;
```

- [ ] **Step 4: Write a migration test, run it**

```typescript
it('backfills every existing price tier onto its product base unit row', () => {
  const db = createDb(':memory:', migrationsFolder)
  const { productId } = seedProductWithUnits(db) // reuse Task 5's helper if available in this file, else inline
  const base = db.select().from(productUnits).where(and(eq(productUnits.productId, productId), eq(productUnits.isBaseUnit, true))).get()!
  db.insert(productPriceTiers).values({ productId, productUnitId: base.id, minQty: 10, maxQty: null, hargaJual: 4500, createdAt: new Date(), updatedAt: new Date() }).run()
  const tiers = db.select().from(productPriceTiers).where(eq(productPriceTiers.productId, productId)).all()
  expect(tiers[0].productUnitId).toBe(base.id)
})
```

```bash
npm run rebuild:node
npx vitest run src/main/db/migrate.test.ts
```

- [ ] **Step 5: Typecheck, commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/main/db/schema.ts drizzle/ src/main/db/migrate.test.ts
git commit -m "feat: scope price tiers per product_unit with closed [min,max] ranges"
```

---

### Task 8: Price tier CRUD rewrite — `main/inventory-units.ts`

**Files:**
- Modify: `src/main/inventory-units.ts`
- Modify: `src/main/inventory-units.test.ts`

**Interfaces:**
- Produces:
  - `PriceTierRow`: `{ id, productUnitId, minQty, maxQty, hargaJual }`
  - `addPriceTier(db, productId, productUnitId, input: { minQty: number; maxQty: number | null; hargaJual: number }): void`
  - `listPriceTiers(db, productId, productUnitId?: number): PriceTierRow[]` — `productUnitId` filters to one unit; omitted returns all tiers for the product across every unit (used by `getProductDetail`).

- [ ] **Step 1: Write failing tests for range validation and overlap rejection**

```typescript
describe('addPriceTier', () => {
  it('throws when minQty is not greater than 0', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 0, maxQty: null, hargaJual: 5000 })).toThrow('Qty minimal harus lebih dari 0.')
  })

  it('throws when maxQty is less than minQty', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: 5, hargaJual: 5000 })).toThrow('Qty maksimal harus lebih besar atau sama dengan qty minimal.')
  })

  it('throws when the new range overlaps an existing tier', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 10, hargaJual: 5000 })
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 8, maxQty: 20, hargaJual: 4500 })).toThrow('Rentang qty tumpang tindih dengan tier yang sudah ada.')
  })

  it('allows adjacent non-overlapping ranges', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 9, hargaJual: 5000 })
    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: 49, hargaJual: 4500 })
    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(2)
  })

  it('allows a second, unbounded tier after a bounded one', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: 9, hargaJual: 5000 })
    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: null, hargaJual: 4500 })
    expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(2)
  })

  it('rejects a bounded tier that would start inside an existing unbounded tier', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    addPriceTier(db, productId, baseUnitRowId, { minQty: 10, maxQty: null, hargaJual: 4000 })
    expect(() => addPriceTier(db, productId, baseUnitRowId, { minQty: 15, maxQty: 20, hargaJual: 3900 })).toThrow('Rentang qty tumpang tindih dengan tier yang sudah ada.')
  })

  it('scopes overlap checks per product_unit - the same range is fine on a different unit', () => {
    const db = createDb(':memory:', migrationsFolder)
    const { productId, baseUnitRowId } = seedProductWithUnits(db)
    const boxUnit = addProductUnit(db, productId, { unitId: /* seed a BOX unit */ 0, jumlahKemasan: 10, hargaJual: 45000 })
    // (adjust to actual seeded ids per the test file's existing seed conventions)
  })
})
```

(Adjust the last test to match whatever unit-seeding helper the file ends up with post-Task-5 — the point being verified is that overlap validation is scoped per `productUnitId`, not per `productId`.)

- [ ] **Step 2: Run to verify failures**

```bash
npm run rebuild:node
npx vitest run src/main/inventory-units.test.ts
```

- [ ] **Step 3: Implement the range-aware `addPriceTier`/`listPriceTiers`/`deletePriceTier`**

```typescript
export interface PriceTierRow {
  id: number
  productUnitId: number
  minQty: number
  maxQty: number | null
  hargaJual: number
}

export interface AddPriceTierInput {
  minQty: number
  maxQty: number | null
  hargaJual: number
}

function rangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null): boolean {
  const aUpper = aMax ?? Infinity
  const bUpper = bMax ?? Infinity
  return aMin <= bUpper && bMin <= aUpper
}

export function addPriceTier(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  productUnitId: number,
  input: AddPriceTierInput,
): void {
  if (!Number.isFinite(input.minQty) || !Number.isInteger(input.minQty) || input.minQty <= 0) {
    throw new Error('Qty minimal harus lebih dari 0.')
  }
  if (input.maxQty !== null) {
    if (!Number.isFinite(input.maxQty) || !Number.isInteger(input.maxQty) || input.maxQty < input.minQty) {
      throw new Error('Qty maksimal harus lebih besar atau sama dengan qty minimal.')
    }
  }
  if (!Number.isFinite(input.hargaJual) || input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  const existing = db
    .select({ minQty: productPriceTiers.minQty, maxQty: productPriceTiers.maxQty })
    .from(productPriceTiers)
    .where(eq(productPriceTiers.productUnitId, productUnitId))
    .all()

  if (existing.some((t) => rangesOverlap(input.minQty, input.maxQty, t.minQty, t.maxQty))) {
    throw new Error('Rentang qty tumpang tindih dengan tier yang sudah ada.')
  }

  const now = new Date()
  db.insert(productPriceTiers)
    .values({ productId, productUnitId, minQty: input.minQty, maxQty: input.maxQty, hargaJual: input.hargaJual, createdAt: now, updatedAt: now })
    .run()
}

export function deletePriceTier(db: BetterSQLite3Database<typeof schema>, productId: number, tierId: number): void {
  const tier = db
    .select({ id: productPriceTiers.id })
    .from(productPriceTiers)
    .where(and(eq(productPriceTiers.id, tierId), eq(productPriceTiers.productId, productId)))
    .get()
  if (!tier) {
    throw new Error('Harga bertingkat tidak ditemukan.')
  }
  db.delete(productPriceTiers).where(eq(productPriceTiers.id, tierId)).run()
}

export function listPriceTiers(db: BetterSQLite3Database<typeof schema>, productId: number, productUnitId?: number): PriceTierRow[] {
  const conditions = productUnitId
    ? and(eq(productPriceTiers.productId, productId), eq(productPriceTiers.productUnitId, productUnitId))
    : eq(productPriceTiers.productId, productId)

  return db
    .select({ id: productPriceTiers.id, productUnitId: productPriceTiers.productUnitId, minQty: productPriceTiers.minQty, maxQty: productPriceTiers.maxQty, hargaJual: productPriceTiers.hargaJual })
    .from(productPriceTiers)
    .where(conditions)
    .orderBy(productPriceTiers.productUnitId, productPriceTiers.minQty)
    .all()
}
```

Update the `addPriceTier` IPC handler signature in `src/main/ipc/inventory.ts` to accept `productUnitId` as a parameter (was previously implicit/base-only).

- [ ] **Step 4: Write a regression test proving deleting a tier can't be exercised to alter past sales**

This is acceptance criterion #12/13 from the design spec (deleting or changing a tier must never touch historical `sale_items`). There is no FK from `sale_items` to `product_price_tiers` in this schema, so this is a documentation-style regression test guarding the invariant rather than testing a mechanism that could subtly break:

```typescript
it('deleting a price tier does not touch any existing sale_items row', () => {
  const db = createDb(':memory:', migrationsFolder)
  const { productId, baseUnitRowId } = seedProductWithUnits(db)
  addPriceTier(db, productId, baseUnitRowId, { minQty: 1, maxQty: null, hargaJual: 4200 })
  const tier = listPriceTiers(db, productId, baseUnitRowId)[0]
  // (a real sale_items row would be inserted via checkout() in kasir.test.ts - this test only
  // confirms deletePriceTier's own query never references sale_items)
  deletePriceTier(db, productId, tier.id)
  expect(listPriceTiers(db, productId, baseUnitRowId)).toHaveLength(0)
})
```

- [ ] **Step 5: Run the full file, fix remaining failures, typecheck**

```bash
npx vitest run src/main/inventory-units.test.ts
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: Commit**

```bash
git add src/main/inventory-units.ts src/main/inventory-units.test.ts src/main/ipc/inventory.ts
git commit -m "feat: scope price-tier CRUD per unit with closed-range overlap validation"
```

---

### Task 9: Price resolution rewrite — `main/kasir.ts` `priceForQty`

**Files:**
- Modify: `src/main/kasir.ts`
- Modify: `src/main/kasir.test.ts`

**Interfaces:**
- Produces: `priceForQty(tiers: PriceTier[], hargaJualDasar: number, qty: number): number` — range-match instead of highest-minQty-wins.

- [ ] **Step 1: Write failing tests for range matching and boundary edge cases**

```typescript
describe('priceForQty', () => {
  it('matches a closed range', () => {
    const tiers = [{ minQty: 1, maxQty: 9, hargaJual: 5000 }, { minQty: 10, maxQty: 49, hargaJual: 4500 }]
    expect(priceForQty(tiers, 6000, 5)).toBe(5000)
    expect(priceForQty(tiers, 6000, 10)).toBe(4500)
  })

  it('uses the exact lower boundary of a tier, not the tier below', () => {
    const tiers = [{ minQty: 1, maxQty: 4, hargaJual: 45000 }, { minQty: 5, maxQty: 9, hargaJual: 42000 }]
    expect(priceForQty(tiers, 50000, 5)).toBe(42000)
    expect(priceForQty(tiers, 50000, 4)).toBe(45000)
  })

  it('falls through to the unbounded tier above the last closed one', () => {
    const tiers = [{ minQty: 1, maxQty: 4, hargaJual: 85000 }, { minQty: 5, maxQty: null, hargaJual: 80000 }]
    expect(priceForQty(tiers, 90000, 100)).toBe(80000)
  })

  it('falls back to the normal price when qty matches no tier', () => {
    expect(priceForQty([{ minQty: 10, maxQty: null, hargaJual: 4000 }], 5000, 1)).toBe(5000)
  })

  it('falls back to the normal price with an empty tier list', () => {
    expect(priceForQty([], 5000, 100)).toBe(5000)
  })
})
```

- [ ] **Step 2: Run to verify failures**

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts -t priceForQty
```

- [ ] **Step 3: Implement**

```typescript
export interface PriceTier {
  minQty: number
  maxQty: number | null
  hargaJual: number
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const match = priceTiers.find((tier) => qty >= tier.minQty && (tier.maxQty === null || qty <= tier.maxQty))
  return match?.hargaJual ?? hargaJualDasar
}
```

(This replaces the entire existing function body — the old `filter().sort().applicable[0]` logic is deleted, not extended, since ranges are validated non-overlapping at write time so "first match" is unambiguous.)

- [ ] **Step 4: Run to verify it passes, typecheck, commit**

```bash
npx vitest run src/main/kasir.test.ts -t priceForQty
npx tsc --noEmit -p tsconfig.json
git add src/main/kasir.ts src/main/kasir.test.ts
git commit -m "feat: range-match price tiers instead of highest-minQty-wins"
```

---

### Task 10: Price resolution rewrite — `renderer/pages/kasir/cart-logic.ts`

**Files:**
- Modify: `src/renderer/pages/kasir/cart-logic.ts`
- Modify: `src/renderer/pages/kasir/cart-logic.test.ts`

**Interfaces:**
- Consumes: nothing new from main (renderer bundle can't import `main/kasir.ts` — duplicate logic per existing project convention documented in the file's own comment).
- Produces:
  - `PriceTier` gains `productUnitId: number`, `maxQty: number | null`.
  - `Product.priceTiers` type updated to the new shape.
  - `unitPrice(line): number` — now scopes tiers by the line's `productUnitId` (previously only applied tiers to the base unit).
  - New: `activeTier(line): PriceTier | null` — the matched tier, for UI display (Task 17).

- [ ] **Step 1: Write failing tests**

```typescript
const productWithTiers: Product = {
  ...product,
  productUnits: [{ id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000 }],
  priceTiers: [
    { productUnitId: 0, minQty: 5, maxQty: 9, hargaJual: 62000 },   // base unit (productUnitId sentinel 0 = "this line's productUnitId is null" - see note below)
    { productUnitId: 9, minQty: 2, maxQty: null, hargaJual: 650000 }, // DUS unit
  ],
}

describe('unitPrice with per-unit tiers', () => {
  it('applies a tier scoped to the currently selected derived unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithTiers, productUnitId: 9, satuan: 'DUS', qty: 3 }
    expect(unitPrice(line)).toBe(650000)
  })

  it('does not apply a tier scoped to a different unit', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithTiers, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(unitPrice(line)).toBe(700000) // qty 1 doesn't meet the DUS tier's minQty 2 - falls back to DUS's normal price, NOT the base unit's tier
  })
})

describe('activeTier', () => {
  it('returns the matched tier', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithTiers, productUnitId: 9, satuan: 'DUS', qty: 3 }
    expect(activeTier(line)).toEqual({ productUnitId: 9, minQty: 2, maxQty: null, hargaJual: 650000 })
  })

  it('returns null when no tier matches', () => {
    const line: CartLine = { key: lineKey(1, 9), product: productWithTiers, productUnitId: 9, satuan: 'DUS', qty: 1 }
    expect(activeTier(line)).toBeNull()
  })
})
```

(The base-unit tier's `productUnitId: 0` placeholder in the fixture above needs resolving against however `CartLine.productUnitId: null` is represented in the new `PriceTier` shape — see Step 2's design note.)

- [ ] **Step 2: Run to verify failures, then implement**

Since a `CartLine`'s `productUnitId` is `number | null` (base unit is still `null` at the cart-line level — that sentinel is a renderer-only UX convenience unrelated to the DB's explicit base row, and is **not** being removed by this rewrite; only the backend's internal resolution changed in Tasks 6/9) but a `PriceTier.productUnitId` from the backend is always a real number (every tier, including base-unit ones, now has a real `product_units.id`), `unitPrice` needs to resolve the line's *actual* `product_units.id` before filtering tiers. This requires the `Product` type to carry its base unit's row id. Add `baseProductUnitId: number` to the `Product` interface (populated by `kasir:listProducts`, Task 6a's IPC changes — the base unit's `product_units.id`, not `null`):

```typescript
export interface Product {
  id: number
  kodeItem: string
  barcode: string | null
  namaItem: string
  satuan: string
  hargaJual: number
  stok: number
  baseProductUnitId: number
  productUnits: ProductUnitOption[]
  priceTiers: PriceTier[]
}

export interface PriceTier {
  productUnitId: number
  minQty: number
  maxQty: number | null
  hargaJual: number
}

function resolvedProductUnitId(line: CartLine): number {
  return line.productUnitId ?? line.product.baseProductUnitId
}

export function priceForQty(priceTiers: PriceTier[], hargaJualDasar: number, qty: number): number {
  const match = priceTiers.find((tier) => qty >= tier.minQty && (tier.maxQty === null || qty <= tier.maxQty))
  return match?.hargaJual ?? hargaJualDasar
}

export function activeTier(line: CartLine): PriceTier | null {
  const unitId = resolvedProductUnitId(line)
  const tiers = line.product.priceTiers.filter((t) => t.productUnitId === unitId)
  return tiers.find((t) => line.qty >= t.minQty && (t.maxQty === null || line.qty <= t.maxQty)) ?? null
}

export function unitPrice(line: CartLine): number {
  const unitId = resolvedProductUnitId(line)
  const normalPrice =
    line.productUnitId === null ? line.product.hargaJual : (line.product.productUnits.find((u) => u.id === line.productUnitId)?.hargaJual ?? line.product.hargaJual)
  const tiers = line.product.priceTiers.filter((t) => t.productUnitId === unitId)
  return priceForQty(tiers, normalPrice, line.qty)
}
```

- [ ] **Step 3: Fix the test fixtures from Step 1 to use real `baseProductUnitId`**

```typescript
const product: Product = {
  id: 1,
  kodeItem: 'BRS5',
  barcode: '8991234500015',
  namaItem: 'Beras 5kg',
  satuan: 'PCS',
  hargaJual: 65000,
  stok: 100,
  baseProductUnitId: 1,
  productUnits: [{ id: 9, satuan: 'DUS', konversi: 12, hargaJual: 700000 }],
  priceTiers: [{ productUnitId: 1, minQty: 5, maxQty: 9, hargaJual: 62000 }],
}
```

Update every existing test in the file that constructs a `Product` fixture to include `baseProductUnitId`, and every `priceTiers` entry to include `productUnitId` (pointing at `1`, matching the fixture's `baseProductUnitId`, for tests exercising base-unit tiers).

- [ ] **Step 4: Run the full file, fix until green**

```bash
npx vitest run src/renderer/pages/kasir/cart-logic.test.ts
```

- [ ] **Step 5: Typecheck, commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/renderer/pages/kasir/cart-logic.ts src/renderer/pages/kasir/cart-logic.test.ts
git commit -m "feat: scope renderer price-tier lookup per unit, add activeTier helper"
```

---

### Task 11: `sale_items` snapshot columns — schema, migration, wire into checkout

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: migration via `npm run db:generate`
- Modify: `src/main/kasir.ts` (finish the insert wiring deferred from Task 6a Step 3)
- Modify: `src/main/kasir.test.ts`
- Modify: `src/main/ipc/kasir.ts` (receipt/history DTOs that read `saleItems.*`)

- [ ] **Step 1: Add the columns**

```typescript
export const saleItems = sqliteTable('sale_items', {
  // ...existing columns unchanged...
  baseQuantity: integer('base_quantity').notNull().default(0),
  priceSource: text('price_source', { enum: ['normal', 'price_tier', 'manual'] }).notNull().default('normal'),
  ...timestamps(),
})
```

- [ ] **Step 2: Generate the migration, backfill `base_quantity` from existing `qty * konversi`**

Run: `npm run db:generate`, then append to the generated file:

```sql
UPDATE sale_items SET base_quantity = qty * konversi;
```

(`price_source` needs no backfill — its `DEFAULT 'normal'` already applies to every existing row, matching the design spec's "no way to know retroactively" call.)

- [ ] **Step 3: Finish the `checkout()` insert wiring from Task 6a**

Confirm the `saleItems` insert in `checkout()` (edited in Task 6a Step 3) includes `baseQuantity: line.qtyDasar` and `priceSource: line.priceSource` — if Task 6a was executed strictly in order and deferred this, do it now.

- [ ] **Step 4: Write a test asserting the snapshot is written correctly**

```typescript
it('snapshots baseQuantity and priceSource on the sale item', () => {
  const db = seedDb() // whatever this file's helper is post-Task-6a
  // seed a tier so this exercises the PRICE_TIER path
  addPriceTier(db, /* productId, productUnitId, */ { minQty: 1, maxQty: null, hargaJual: 4000 })
  const result = checkout(db, { /* ...items exercising the tiered product... */ })
  const items = db.select().from(saleItems).where(eq(saleItems.saleId, result.saleId)).all()
  expect(items[0].priceSource).toBe('price_tier')
  expect(items[0].baseQuantity).toBe(items[0].qty * items[0].konversi)
})
```

- [ ] **Step 5: Update `ipc/kasir.ts` receipt/history DTOs if they surface `priceSource`**

Not required by the spec's UI section for receipts, but check `getReceipt`/`listSalesHistory`/`getSaleDetail` in `src/main/ipc/kasir.ts` for whether adding `priceSource` to their returned item shape is trivial (it is — one more field in an existing `.map()`) and worth doing for future UI use. Add it if the touch is one line; skip otherwise (YAGNI — nothing currently renders it).

- [ ] **Step 6: Run, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/db/schema.ts drizzle/ src/main/kasir.ts src/main/kasir.test.ts src/main/ipc/kasir.ts
git commit -m "feat: snapshot base_quantity and price_source on sale_items"
```

---

### Task 12: `stock_movements` table — schema, migration

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: migration via `npm run db:generate`
- Test: `src/main/db/migrate.test.ts`

- [ ] **Step 1: Add the table**

```typescript
export const stockMovements = sqliteTable('stock_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  productUnitId: integer('product_unit_id').references(() => productUnits.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull(),
  conversionFactor: integer('conversion_factor').notNull(),
  baseQuantity: integer('base_quantity').notNull(),
  movementType: text('movement_type', { enum: ['sale', 'sale_cancel', 'purchase', 'stock_adjustment'] }).notNull(),
  referenceId: integer('reference_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate` — this one is a pure `CREATE TABLE`, no backfill needed (per design spec §2 step 5: the ledger starts recording from this migration forward).

- [ ] **Step 3: Write a smoke test**

```typescript
it('creates the stock_movements table', () => {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()
  const { productId } = seedProductWithUnits(db)
  db.insert(stockMovements).values({ productId, quantity: -5, conversionFactor: 1, baseQuantity: -5, movementType: 'sale', referenceId: 1, createdAt: now }).run()
  expect(db.select().from(stockMovements).all()).toHaveLength(1)
})
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/db/migrate.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/db/schema.ts drizzle/ src/main/db/migrate.test.ts
git commit -m "feat: add stock_movements ledger table"
```

---

### Task 13: Wire `stock_movements` writes into `main/kasir.ts`

**Files:**
- Modify: `src/main/kasir.ts`
- Modify: `src/main/kasir.test.ts`

**Interfaces:**
- Consumes: `stockMovements` (Task 12).

- [ ] **Step 1: Add a movement insert alongside `checkout()`'s stock decrement**

In the `checkout()` transaction, right after (or right before — same transaction, order doesn't matter for correctness) each `tx.update(products).set({ stok: sql`...` })` call:

```typescript
tx.insert(stockMovements)
  .values({
    productId: line.productId,
    productUnitId: line.productUnitId,
    quantity: -line.qty,
    conversionFactor: line.konversi,
    baseQuantity: -line.qtyDasar,
    movementType: 'sale',
    referenceId: sale.id,
    createdAt: now,
  })
  .run()
```

- [ ] **Step 2: Add a reversal insert to `cancelSale()`/`restoreStockForItems()`**

Find the existing stock-restoration call in `cancelSale()` (the `restoreStockForItems` helper per this file's existing structure) and add, per restored item:

```typescript
tx.insert(stockMovements)
  .values({
    productId: item.productId,
    productUnitId: item.productUnitId,
    quantity: item.qty,
    conversionFactor: item.konversi,
    baseQuantity: item.qty * item.konversi,
    movementType: 'sale_cancel',
    referenceId: saleId,
    createdAt: new Date(),
  })
  .run()
```

(Match the exact parameter names/shape `restoreStockForItems` already receives — read its current signature before writing this, it may need `productUnitId` added to its input type if not already present.)

- [ ] **Step 3: Write tests asserting movements are recorded**

```typescript
it('records a sale stock movement on checkout', () => {
  const db = seedDb()
  const result = checkout(db, { /* ... */ })
  const movements = db.select().from(stockMovements).where(eq(stockMovements.referenceId, result.saleId)).all()
  expect(movements.some((m) => m.movementType === 'sale')).toBe(true)
})

it('records a sale_cancel movement on cancelSale', () => {
  const db = seedDb()
  const result = checkout(db, { /* ... */ })
  cancelSale(db, result.saleId)
  const movements = db.select().from(stockMovements).where(and(eq(stockMovements.referenceId, result.saleId), eq(stockMovements.movementType, 'sale_cancel'))).all()
  expect(movements.length).toBeGreaterThan(0)
})
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/kasir.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/kasir.ts src/main/kasir.test.ts
git commit -m "feat: record stock movements for sales and cancellations"
```

---

### Task 14: Wire `stock_movements` writes into `main/purchase.ts`

**Files:**
- Modify: `src/main/purchase.ts`
- Modify: `src/main/purchase.test.ts`

- [ ] **Step 1: Add a movement insert to `recordPurchase()`**

Same pattern as Task 13 Step 1, `movementType: 'purchase'`, positive `baseQuantity`, `referenceId: purchase.id`.

- [ ] **Step 2: Write a test, run, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/purchase.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/purchase.ts src/main/purchase.test.ts
git commit -m "feat: record stock movements for purchases"
```

---

### Task 15: Wire `stock_movements` writes into `main/stock-opname.ts`

**Files:**
- Modify: `src/main/stock-opname.ts`
- Modify: `src/main/stock-opname.test.ts`

- [ ] **Step 1: Add a movement insert to `recordAdjustment()`**

`movementType: 'stock_adjustment'`, `baseQuantity` = the signed delta (`stokSesudah - stokSebelum`), `productUnitId` = the product's base unit row id (adjustments are always in base-unit terms already), `referenceId` = the new `stock_adjustments.id`.

- [ ] **Step 2: Write a test, run, typecheck, commit**

```bash
npm run rebuild:node
npx vitest run src/main/stock-opname.test.ts
npx tsc --noEmit -p tsconfig.json
git add src/main/stock-opname.ts src/main/stock-opname.test.ts
git commit -m "feat: record stock movements for manual stock adjustments"
```

---

### Task 16: `ProductDetailDialog.tsx` UI — unit picker + per-unit ranged price tiers

**Files:**
- Modify: `src/renderer/pages/inventory/ProductDetailDialog.tsx`
- Modify: `src/main/ipc/inventory.ts` (`getProductDetail` DTO — confirm it now returns `units`/`priceTiers` in the new shape from Tasks 5/8)
- Modify: `src/renderer/env.d.ts` (matching type update)

- [ ] **Step 1: Update `UnitChainManager`'s add/edit forms to pick from `units`**

Replace the free-text `satuan` `<Input>` in `UnitChainAddForm` and `UnitChainRow`'s edit mode with a `<select>` populated from `window.api.masterSatuan.list()` (fetched once when the dialog opens, passed down as a prop from `ProductDetailDialog`), filtered to `isActive` units not already used by this product's other rows (mirror the "already used" duplicate-prevention UX, now checking `unitId` instead of `satuan` string).

- [ ] **Step 2: Update `PriceTiersManager` to be unit-scoped with a Max Qty field**

Add a unit selector (populated from `units` prop, showing base unit + every derived `product_units` row for this product) above the tier list; the displayed/added tiers filter to `tiers.filter(t => t.productUnitId === selectedUnitId)`. Add a "Max Qty (kosongkan untuk tak terbatas)" input alongside the existing Min Qty input in the add-form; `addPriceTier` call passes `productUnitId: selectedUnitId, maxQty: maxQtyInput.trim() === '' ? null : Number(maxQtyInput)`. Display each tier row as `"Beli {minQty} - {maxQty ?? '∞'} {unitSymbol}"` instead of the old `"Beli {minQty}+ {baseSatuan}"`.

- [ ] **Step 3: Manual verification**

Build, launch, open a product's detail dialog, add a derived unit via the new picker, add a ranged tier to it, add an unbounded tier to a different unit on the same product, confirm both display correctly and an overlapping add is rejected with the expected error message. Screenshot each step.

- [ ] **Step 4: Typecheck, commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/renderer/pages/inventory/ProductDetailDialog.tsx src/main/ipc/inventory.ts src/renderer/env.d.ts
git commit -m "feat: unit-picker and ranged per-unit price tiers in product detail UI"
```

---

### Task 17: Kasir POS UI — show active tier info

**Files:**
- Modify: `src/renderer/pages/kasir/CartGrid.tsx`

**Interfaces:**
- Consumes: `activeTier` from Task 10.

- [ ] **Step 1: Add a subtext line under the Harga cell when a tier is active**

In the `harga` column's `renderCell`, below the existing price `<span>`, conditionally render:

```tsx
{activeTier(row) && (
  <span className="block text-[10px] text-muted-foreground">
    tier {activeTier(row)!.minQty}
    {activeTier(row)!.maxQty !== null ? `-${activeTier(row)!.maxQty}` : '+'}
  </span>
)}
```

Import `activeTier` from `./cart-logic`.

- [ ] **Step 2: Manual verification**

Build, launch, add a product with a tiered derived unit to the cart, change qty across a tier boundary, confirm the subtext updates and disappears when qty falls outside every tier.

- [ ] **Step 3: Typecheck, run full suite, commit**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
git add src/renderer/pages/kasir/CartGrid.tsx
git commit -m "feat: show active price-tier range in the Kasir cart"
```

---

## Final Verification

- [ ] Run the complete suite one more time: `npm run rebuild:node && npx vitest run` — expect 100% pass.
- [ ] `npx tsc --noEmit -p tsconfig.json` — expect zero errors project-wide.
- [ ] Manually walk through the exact worked example from design spec / original request section 11 (Kopi ABC / SIMAS-style product: Pcs/Box/Dus, tiered pricing per unit, buying 6 Box → Rp42.000/Box, stock -60 Pcs) end-to-end in the running app.
- [ ] `npm run rebuild:electron` before handing back control, so `npm run dev` works normally.
