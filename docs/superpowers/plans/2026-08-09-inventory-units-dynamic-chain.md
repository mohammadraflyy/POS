# Satuan Turunan Dynamic Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 2-slot ("Level 2"/"Level 3") derived-unit hierarchy on products with an unbounded, ordered chain, so a product can have as many derived units as its real packaging needs (e.g. Pcs → Renteng → Dus → Pak), each still entered relative to the tier below it.

**Architecture:** Drop the `level` column from `product_units`; a product's chain is derived purely by sorting existing rows by `konversi` (total-to-base) ascending. Backend functions move from level-keyed (`setProductUnit(db, productId, level, input)`) to id-keyed (`addProductUnit`/`updateProductUnit(db, productId, unitId, input)`/`deleteProductUnit(db, productId, unitId)`), with edit/delete cascading upward through every unit above the touched one in the chain. The renderer's two fixed slots become one repeatable list component.

**Tech Stack:** Electron + React (renderer), better-sqlite3 + Drizzle ORM (main process), Vitest, TypeScript.

## Global Constraints

- Money crosses the IPC boundary as Rupiah via the existing `toRupiah`/`toCents` helpers in `main/ipc/inventory.ts` — never raw cents.
- All IPC handlers stay guarded by `getCurrentUser()`, matching every existing handler in `main/ipc/inventory.ts`.
- Validation error messages are user-facing Indonesian strings thrown as plain `Error`s (existing convention throughout `inventory-units.ts`) — do not introduce a different error shape.
- No change to Kasir's cart/checkout logic, `sale_items`/`purchase_items` schema, or Harga Bertingkat (qty-tiered pricing) — confirmed unaffected in the design spec.
- Spec: `docs/superpowers/specs/2026-08-09-inventory-units-dynamic-chain-design.md`. Prior spec being revised: `docs/superpowers/specs/2026-08-07-inventory-units-tiers-design.md`.

## Pre-flight: fix the native module before starting

`better-sqlite3`'s prebuilt binary in this checkout does not match the current Node version, which makes every main-process test (including the ones this plan's TDD steps depend on) fail immediately with `NODE_MODULE_VERSION` errors — unrelated to this feature. Before Task 2, confirm tests can run:

```bash
cd desktop-node
npm run rebuild:node
```

If this fails with `EPERM: operation not permitted, unlink ... better_sqlite3.node`, something (a running `npm run dev`, a stuck vitest watcher, an editor's TS server, antivirus) has the file locked — close any running desktop-node dev/test processes and retry. Confirm the fix worked:

```bash
npx vitest run src/main/inventory-units.test.ts
```

Expected: the existing (pre-change) tests pass, not the native-module error. Do not proceed to Task 2 until this passes.

---

### Task 1: Schema — drop the `level` column

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts:38-49`
- Create: new migration file under `desktop-node/drizzle/` (generated, not hand-written)

**Interfaces:**
- Produces: `productUnits` table with columns `id, productId, satuan, jumlahKemasan, konversi, hargaJual, createdAt, updatedAt` and a unique index on `(productId, satuan)`. No `level` column, no `(productId, level)` index.

- [ ] **Step 1: Edit the schema**

Replace the `productUnits` table definition in `desktop-node/src/main/db/schema.ts`:

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  satuan: text('satuan').notNull(),
  jumlahKemasan: integer('jumlah_kemasan').notNull(),
  konversi: integer('konversi').notNull(),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productSatuanUnique: uniqueIndex('product_units_product_id_satuan_unique').on(table.productId, table.satuan),
}))
```

This removes the `level` field and the old `productLevelUnique` index.

- [ ] **Step 2: Generate the migration**

```bash
cd desktop-node
npm run db:generate
```

Expected: a new file appears under `drizzle/` (drizzle-kit names it automatically, e.g. `0005_<random-name>.sql`). Open it and confirm it drops the `level` column and the old unique index, and creates the new `(product_id, satuan)` unique index — drizzle-kit for SQLite typically does this by rebuilding the table (create new table, copy data, drop old, rename). If the generated SQL instead tries an unsupported `ALTER TABLE ... DROP COLUMN` on a column referenced by an index, or drops data, stop and report — do not hand-edit destructive SQL without checking it copies existing rows across.

- [ ] **Step 3: Verify the migration applies cleanly**

```bash
npx vitest run src/main/db/migrate.test.ts
```

Expected: PASS (this test only checks table names exist, not columns, so it should be unaffected — this run just confirms the new migration doesn't break `createDb`).

- [ ] **Step 4: Commit**

```bash
git add desktop-node/src/main/db/schema.ts desktop-node/drizzle/
git commit -m "feat: drop level column from product_units, key derived units by satuan"
```

---

### Task 2: Backend — rewrite `inventory-units.ts` unit functions (TDD)

**Files:**
- Modify: `desktop-node/src/main/inventory-units.ts:1-142` (the `ProductUnitRow`/`getProductUnits`/`SetProductUnitInput`/`setProductUnit`/`deleteProductUnit` section; everything from `PriceTierRow` onward is untouched)
- Test: `desktop-node/src/main/inventory-units.test.ts:1-174` (the `getProductUnits`/`setProductUnit`/`deleteProductUnit` describe blocks; the `addPriceTier`/`deletePriceTier`/`listPriceTiers`/`listPriceHistory` blocks from line 176 onward are untouched except the `getProductDetail` block at the end)

**Interfaces:**
- Consumes: `productUnits` table from Task 1 (no `level` column).
- Produces: `ProductUnitRow { id, satuan, jumlahKemasan, konversi, hargaJual }`, `listProductUnits(db, productId): ProductUnitRow[]`, `UpsertProductUnitInput { satuan, jumlahKemasan, hargaJual }`, `addProductUnit(db, productId, input: UpsertProductUnitInput): void`, `updateProductUnit(db, productId, unitId, input: UpsertProductUnitInput): void`, `deleteProductUnit(db, productId, unitId): void`, `getProductDetail(db, productId): { units: ProductUnitRow[], priceTiers: PriceTierRow[], priceHistory: PriceHistoryRow[] }`. These names/signatures are what Task 3 (IPC) imports.

- [ ] **Step 1: Replace the test file's imports and units-related describe blocks**

In `desktop-node/src/main/inventory-units.test.ts`, replace the import block (lines 1-14):

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, productPriceHistories, users } from './db/schema'
import {
  listProductUnits,
  addProductUnit,
  updateProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  listPriceTiers,
  listPriceHistory,
  getProductDetail,
} from './inventory-units'
```

Replace everything from `describe('getProductUnits', ...)` (line 42) through the end of the `describe('deleteProductUnit', ...)` block (line 174) with:

```typescript
describe('listProductUnits', () => {
  it('returns an empty array when no derived units exist', () => {
    const db = seedProduct()
    expect(listProductUnits(db, 1)).toEqual([])
  })
})

describe('addProductUnit', () => {
  const validInput = { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }

  it('appends the first unit with konversi equal to jumlahKemasan', () => {
    const db = seedProduct()

    addProductUnit(db, 1, validInput)

    const units = listProductUnits(db, 1)
    expect(units).toEqual([
      { id: expect.any(Number), satuan: 'Renteng', jumlahKemasan: 12, konversi: 12, hargaJual: 15000_00 },
    ])
  })

  it('supports a chain longer than 2 derived units, each konversi cumulative from the one below it', () => {
    const db = seedProduct()

    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }) // 12
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // 10 * 12 = 120
    addProductUnit(db, 1, { satuan: 'Pak', jumlahKemasan: 5, hargaJual: 650000_00 }) // 5 * 120 = 600

    const units = listProductUnits(db, 1)
    expect(units.map((u) => ({ satuan: u.satuan, konversi: u.konversi }))).toEqual([
      { satuan: 'Renteng', konversi: 12 },
      { satuan: 'Dus', konversi: 120 },
      { satuan: 'Pak', konversi: 600 },
    ])
  })

  it('throws when satuan already exists for the product', () => {
    const db = seedProduct()
    addProductUnit(db, 1, validInput)

    expect(() => addProductUnit(db, 1, { ...validInput, hargaJual: 16000_00 })).toThrow('Satuan "Renteng" sudah ada.')
  })

  it('throws when satuan is empty', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, satuan: 'a'.repeat(21) })).toThrow('Satuan maksimal 20 karakter.')
  })

  it('throws when jumlahKemasan is not finite', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, jumlahKemasan: NaN })).toThrow('Jumlah kemasan wajib diisi.')
  })

  it('throws when jumlahKemasan is less than 1', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, jumlahKemasan: 0 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when jumlahKemasan is not an integer', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, jumlahKemasan: 1.5 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => addProductUnit(db, 1, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })
})

describe('updateProductUnit', () => {
  it('recomputes konversi for the edited unit and every unit above it, leaving units below untouched', () => {
    const db = seedProduct()

    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }) // 12
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // 120
    addProductUnit(db, 1, { satuan: 'Pak', jumlahKemasan: 5, hargaJual: 650000_00 }) // 600

    const [renteng, dus] = listProductUnits(db, 1)
    updateProductUnit(db, 1, renteng.id, { satuan: 'Renteng', jumlahKemasan: 24, hargaJual: 15000_00 })

    const units = listProductUnits(db, 1)
    expect(units.map((u) => u.konversi)).toEqual([24, 240, 1200])
    expect(units[1].id).toBe(dus.id)
    expect(units[1].jumlahKemasan).toBe(10) // unchanged relative quantity
  })

  it('throws when the unit does not belong to the product', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })

    expect(() => updateProductUnit(db, 1, 999, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan tidak ditemukan.',
    )
  })

  it('throws when renaming to a satuan already used by another unit of the same product', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })

    const [renteng] = listProductUnits(db, 1)
    expect(() => updateProductUnit(db, 1, renteng.id, { satuan: 'Dus', jumlahKemasan: 12, hargaJual: 15000_00 })).toThrow(
      'Satuan "Dus" sudah ada.',
    )
  })

  it('allows re-saving a unit with its own unchanged satuan', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, 1)
    expect(() => updateProductUnit(db, 1, renteng.id, { satuan: 'Renteng', jumlahKemasan: 20, hargaJual: 16000_00 })).not.toThrow()
    expect(listProductUnits(db, 1)[0]).toMatchObject({ jumlahKemasan: 20, konversi: 20, hargaJual: 16000_00 })
  })
})

describe('deleteProductUnit', () => {
  it('deletes a unit with nothing above it', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })

    const [renteng] = listProductUnits(db, 1)
    deleteProductUnit(db, 1, renteng.id)

    expect(listProductUnits(db, 1)).toEqual([])
  })

  it('cascades: deleting a middle unit also deletes every unit above it, leaving units below untouched', () => {
    const db = seedProduct()
    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addProductUnit(db, 1, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    addProductUnit(db, 1, { satuan: 'Pak', jumlahKemasan: 5, hargaJual: 650000_00 })

    const [renteng, dus] = listProductUnits(db, 1)
    deleteProductUnit(db, 1, dus.id)

    const remaining = listProductUnits(db, 1)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(renteng.id)
  })

  it('is a no-op when the unit does not exist', () => {
    const db = seedProduct()
    expect(() => deleteProductUnit(db, 1, 999)).not.toThrow()
  })
})
```

Finally, replace the `getProductDetail` test block at the end of the file:

```typescript
describe('getProductDetail', () => {
  it('bundles units, price tiers, and price history', () => {
    const db = seedProduct()

    addProductUnit(db, 1, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const detail = getProductDetail(db, 1)
    expect(detail.units).toHaveLength(1)
    expect(detail.units[0]).toMatchObject({ satuan: 'Renteng', konversi: 12 })
    expect(detail.priceTiers).toHaveLength(1)
    expect(detail.priceHistory).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
cd desktop-node
npx vitest run src/main/inventory-units.test.ts
```

Expected: FAIL — `listProductUnits`/`addProductUnit`/`updateProductUnit` are not exported from `./inventory-units` yet (TypeScript/import error or `undefined is not a function`).

- [ ] **Step 3: Replace the implementation in `inventory-units.ts`**

Replace the file's content from the top through the end of the old `deleteProductUnit` function (everything before `export interface PriceTierRow`) with:

```typescript
import { and, eq, inArray, desc } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, users } from './db/schema'

export interface ProductUnitRow {
  id: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}

function unitRowSelect(db: BetterSQLite3Database<typeof schema>) {
  return db.select({
    id: productUnits.id,
    satuan: productUnits.satuan,
    jumlahKemasan: productUnits.jumlahKemasan,
    konversi: productUnits.konversi,
    hargaJual: productUnits.hargaJual,
  }).from(productUnits)
}

export function listProductUnits(db: BetterSQLite3Database<typeof schema>, productId: number): ProductUnitRow[] {
  return unitRowSelect(db).where(eq(productUnits.productId, productId)).orderBy(productUnits.konversi).all()
}

export interface UpsertProductUnitInput {
  satuan: string
  jumlahKemasan: number
  hargaJual: number
}

function validateUnitInput(input: UpsertProductUnitInput): void {
  if (!input.satuan.trim()) {
    throw new Error('Satuan wajib diisi.')
  }

  if (input.satuan.length > 20) {
    throw new Error('Satuan maksimal 20 karakter.')
  }

  if (!Number.isFinite(input.jumlahKemasan)) {
    throw new Error('Jumlah kemasan wajib diisi.')
  }

  if (!Number.isInteger(input.jumlahKemasan) || input.jumlahKemasan < 1) {
    throw new Error('Jumlah kemasan minimal 1.')
  }

  if (!Number.isFinite(input.hargaJual)) {
    throw new Error('Harga jual wajib diisi.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }
}

export function addProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, input: UpsertProductUnitInput): void {
  validateUnitInput(input)

  const chain = listProductUnits(db, productId)

  if (chain.some((u) => u.satuan === input.satuan)) {
    throw new Error(`Satuan "${input.satuan}" sudah ada.`)
  }

  const prevKonversi = chain.length > 0 ? chain[chain.length - 1].konversi : 1
  const konversi = input.jumlahKemasan * prevKonversi
  const now = new Date()

  db.insert(productUnits)
    .values({
      productId,
      satuan: input.satuan,
      jumlahKemasan: input.jumlahKemasan,
      konversi,
      hargaJual: input.hargaJual,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

export function updateProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  unitId: number,
  input: UpsertProductUnitInput,
): void {
  validateUnitInput(input)

  const chain = listProductUnits(db, productId)
  const idx = chain.findIndex((u) => u.id === unitId)

  if (idx === -1) {
    throw new Error('Satuan tidak ditemukan.')
  }

  if (chain.some((u) => u.id !== unitId && u.satuan === input.satuan)) {
    throw new Error(`Satuan "${input.satuan}" sudah ada.`)
  }

  const now = new Date()
  let prevKonversi = idx === 0 ? 1 : chain[idx - 1].konversi

  for (let i = idx; i < chain.length; i++) {
    const jumlahKemasan = i === idx ? input.jumlahKemasan : chain[i].jumlahKemasan
    const satuan = i === idx ? input.satuan : chain[i].satuan
    const hargaJual = i === idx ? input.hargaJual : chain[i].hargaJual
    const konversi = jumlahKemasan * prevKonversi

    db.update(productUnits)
      .set({ satuan, jumlahKemasan, konversi, hargaJual, updatedAt: now })
      .where(eq(productUnits.id, chain[i].id))
      .run()

    prevKonversi = konversi
  }
}

export function deleteProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, unitId: number): void {
  const chain = listProductUnits(db, productId)
  const idx = chain.findIndex((u) => u.id === unitId)

  if (idx === -1) {
    return
  }

  const idsToDelete = chain.slice(idx).map((u) => u.id)
  db.delete(productUnits).where(inArray(productUnits.id, idsToDelete)).run()
}
```

Then, further down the file, replace the `ProductDetail` interface and `getProductDetail` function:

```typescript
export interface ProductDetail {
  units: ProductUnitRow[]
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

export function getProductDetail(db: BetterSQLite3Database<typeof schema>, productId: number): ProductDetail {
  return {
    units: listProductUnits(db, productId),
    priceTiers: listPriceTiers(db, productId),
    priceHistory: listPriceHistory(db, productId),
  }
}
```

Leave `PriceTierRow`, `AddPriceTierInput`, `addPriceTier`, `deletePriceTier`, `listPriceTiers`, `PriceHistoryRow`, `listPriceHistory` exactly as they are — unchanged by this task.

- [ ] **Step 4: Run the tests to see them pass**

```bash
npx vitest run src/main/inventory-units.test.ts
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add desktop-node/src/main/inventory-units.ts desktop-node/src/main/inventory-units.test.ts
git commit -m "feat: replace level-keyed product units with an unbounded konversi-ordered chain"
```

---

### Task 3: IPC — update `main/ipc/inventory.ts`

**Files:**
- Modify: `desktop-node/src/main/ipc/inventory.ts`

**Interfaces:**
- Consumes: `listProductUnits`, `addProductUnit`, `updateProductUnit`, `deleteProductUnit`, `getProductDetail` from Task 2.
- Produces: IPC channels `inventory:addProductUnit`, `inventory:updateProductUnit`, `inventory:deleteProductUnit` (new signature), `inventory:getProductDetail` (new response shape) — consumed by Task 4 (preload) and Task 7 (renderer dialog).

- [ ] **Step 1: Update the import block**

In `desktop-node/src/main/ipc/inventory.ts`, replace:

```typescript
import {
  getProductDetail,
  setProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  type ProductUnitRow,
} from '../inventory-units'
```

with:

```typescript
import {
  getProductDetail,
  addProductUnit,
  updateProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  type ProductUnitRow,
} from '../inventory-units'
```

- [ ] **Step 2: Update `toUnitDto`**

Replace:

```typescript
function toUnitDto(unit: ProductUnitRow) {
  return {
    id: unit.id,
    level: unit.level,
    satuan: unit.satuan,
    jumlahKemasan: unit.jumlahKemasan,
    konversi: unit.konversi,
    hargaJual: toRupiah(unit.hargaJual),
  }
}
```

with:

```typescript
function toUnitDto(unit: ProductUnitRow) {
  return {
    id: unit.id,
    satuan: unit.satuan,
    jumlahKemasan: unit.jumlahKemasan,
    konversi: unit.konversi,
    hargaJual: toRupiah(unit.hargaJual),
  }
}
```

- [ ] **Step 3: Update the `inventory:getProductDetail` handler**

Replace:

```typescript
    return {
      units: {
        level2: detail.units.level2 ? toUnitDto(detail.units.level2) : null,
        level3: detail.units.level3 ? toUnitDto(detail.units.level3) : null,
      },
      priceTiers: detail.priceTiers.map((tier) => ({ id: tier.id, minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
```

with:

```typescript
    return {
      units: detail.units.map(toUnitDto),
      priceTiers: detail.priceTiers.map((tier) => ({ id: tier.id, minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
```

(the `priceHistory` mapping below it is unchanged)

- [ ] **Step 4: Replace the `inventory:setProductUnit` handler with add/update handlers**

Replace:

```typescript
  ipcMain.handle(
    'inventory:setProductUnit',
    (_event, productId: number, level: 2 | 3, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      setProductUnit(db, productId, level, {
        satuan: input.satuan,
        jumlahKemasan: input.jumlahKemasan,
        hargaJual: toCents(input.hargaJual),
      })
    },
  )

  ipcMain.handle('inventory:deleteProductUnit', (_event, productId: number, level: 2 | 3) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteProductUnit(db, productId, level)
  })
```

with:

```typescript
  ipcMain.handle(
    'inventory:addProductUnit',
    (_event, productId: number, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      addProductUnit(db, productId, {
        satuan: input.satuan,
        jumlahKemasan: input.jumlahKemasan,
        hargaJual: toCents(input.hargaJual),
      })
    },
  )

  ipcMain.handle(
    'inventory:updateProductUnit',
    (_event, productId: number, unitId: number, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) => {
      if (!getCurrentUser()) {
        throw new Error('Silakan login terlebih dahulu.')
      }

      updateProductUnit(db, productId, unitId, {
        satuan: input.satuan,
        jumlahKemasan: input.jumlahKemasan,
        hargaJual: toCents(input.hargaJual),
      })
    },
  )

  ipcMain.handle('inventory:deleteProductUnit', (_event, productId: number, unitId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deleteProductUnit(db, productId, unitId)
  })
```

- [ ] **Step 5: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: errors in `preload/index.ts`, `env.d.ts`, `purchase.ts`, `Purchase.tsx`, and `ProductDetailDialog.tsx` (not yet updated — that's Tasks 4-7). No errors should point at `main/ipc/inventory.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add desktop-node/src/main/ipc/inventory.ts
git commit -m "feat: expose addProductUnit/updateProductUnit IPC channels, drop level from deleteProductUnit"
```

---

### Task 4: Preload + renderer ambient types

**Files:**
- Modify: `desktop-node/src/preload/index.ts:71-73`
- Modify: `desktop-node/src/renderer/env.d.ts:160-181`

**Interfaces:**
- Consumes: IPC channels from Task 3.
- Produces: `window.api.inventory.getProductDetail(productId): Promise<{ units: ProductUnitDto[], priceTiers: ..., priceHistory: ... }>`, `window.api.inventory.addProductUnit(productId, input): Promise<void>`, `window.api.inventory.updateProductUnit(productId, unitId, input): Promise<void>`, `window.api.inventory.deleteProductUnit(productId, unitId): Promise<void>` — consumed by Task 7 (`ProductDetailDialog.tsx`).

- [ ] **Step 1: Update `preload/index.ts`**

Replace:

```typescript
    setProductUnit: (productId: number, level: 2 | 3, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) =>
      invoke('inventory:setProductUnit', productId, level, input),
    deleteProductUnit: (productId: number, level: 2 | 3) => invoke('inventory:deleteProductUnit', productId, level),
```

with:

```typescript
    addProductUnit: (productId: number, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) =>
      invoke('inventory:addProductUnit', productId, input),
    updateProductUnit: (productId: number, unitId: number, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) =>
      invoke('inventory:updateProductUnit', productId, unitId, input),
    deleteProductUnit: (productId: number, unitId: number) => invoke('inventory:deleteProductUnit', productId, unitId),
```

- [ ] **Step 2: Update `env.d.ts`**

Replace:

```typescript
        getProductDetail: (productId: number) => Promise<{
          units: {
            level2: { id: number; level: number; satuan: string; jumlahKemasan: number; konversi: number; hargaJual: number } | null
            level3: { id: number; level: number; satuan: string; jumlahKemasan: number; konversi: number; hargaJual: number } | null
          }
          priceTiers: { id: number; minQty: number; hargaJual: number }[]
          priceHistory: {
            id: number
            hargaPokokLama: number
            hargaPokokBaru: number
            hargaJualLama: number
            hargaJualBaru: number
            createdAt: string
            userName: string | null
          }[]
        }>
        setProductUnit: (
          productId: number,
          level: 2 | 3,
          input: { satuan: string; jumlahKemasan: number; hargaJual: number },
        ) => Promise<void>
        deleteProductUnit: (productId: number, level: 2 | 3) => Promise<void>
```

with:

```typescript
        getProductDetail: (productId: number) => Promise<{
          units: { id: number; satuan: string; jumlahKemasan: number; konversi: number; hargaJual: number }[]
          priceTiers: { id: number; minQty: number; hargaJual: number }[]
          priceHistory: {
            id: number
            hargaPokokLama: number
            hargaPokokBaru: number
            hargaJualLama: number
            hargaJualBaru: number
            createdAt: string
            userName: string | null
          }[]
        }>
        addProductUnit: (productId: number, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) => Promise<void>
        updateProductUnit: (
          productId: number,
          unitId: number,
          input: { satuan: string; jumlahKemasan: number; hargaJual: number },
        ) => Promise<void>
        deleteProductUnit: (productId: number, unitId: number) => Promise<void>
```

- [ ] **Step 3: Commit**

```bash
git add desktop-node/src/preload/index.ts desktop-node/src/renderer/env.d.ts
git commit -m "feat: update preload/env types for add/update/delete product unit API"
```

---

### Task 5: Purchase backend — drop `level` from `searchProductsForPurchase`

**Files:**
- Modify: `desktop-node/src/main/purchase.ts:1-10,221-257`
- Test: `desktop-node/src/main/purchase.test.ts`

**Interfaces:**
- Consumes: `listProductUnits` from Task 2.
- Produces: `PurchaseProductOption.units: { id: number, satuan: string, konversi: number }[]` (no `level`) — consumed by Task 6 (`Purchase.tsx` type).

- [ ] **Step 1: Update the test seed and assertions**

In `desktop-node/src/main/purchase.test.ts`, in the `productUnits` insert inside the seed function, remove the `level: 2,` line:

```typescript
  db.insert(productUnits)
    .values({
      id: 1,
      productId: 1,
      satuan: 'Renteng',
      jumlahKemasan: 12,
      konversi: 12,
      hargaJual: 18000_00,
      createdAt: now,
      updatedAt: now,
    })
    .run()
```

Replace the assertion:

```typescript
    expect(results[0].units).toEqual([{ id: 1, level: 2, satuan: 'Renteng', konversi: 12 }])
```

with:

```typescript
    expect(results[0].units).toEqual([{ id: 1, satuan: 'Renteng', konversi: 12 }])
```

- [ ] **Step 2: Run the purchase tests to see the assertion fail**

```bash
cd desktop-node
npx vitest run src/main/purchase.test.ts
```

Expected: FAIL — the seed insert no longer matches the (still level-based) schema call in `purchase.ts`, or the assertion mismatches `level` still present in the actual result. (If Task 1 already dropped the column, the seed insert change alone may make this fail differently — either way, confirm it's RED before Step 3.)

- [ ] **Step 3: Update `purchase.ts`**

Update the import at the top of `desktop-node/src/main/purchase.ts`:

```typescript
import { getProductUnits } from './inventory-units'
```

becomes:

```typescript
import { listProductUnits } from './inventory-units'
```

Update the `PurchaseProductOption` interface:

```typescript
export interface PurchaseProductOption {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; satuan: string; konversi: number }[]
}
```

Update the body of `searchProductsForPurchase`:

```typescript
  return rows.map((row) => {
    const units = listProductUnits(db, row.id).map((u) => ({ id: u.id, satuan: u.satuan, konversi: u.konversi }))

    return { ...row, units }
  })
```

- [ ] **Step 4: Run the purchase tests to see them pass**

```bash
npx vitest run src/main/purchase.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop-node/src/main/purchase.ts desktop-node/src/main/purchase.test.ts
git commit -m "feat: use listProductUnits in purchase product search, drop level field"
```

---

### Task 6: Purchase renderer type

**Files:**
- Modify: `desktop-node/src/renderer/pages/Purchase.tsx:28-35`

**Interfaces:**
- Consumes: `PurchaseProductOption.units` shape from Task 5.

- [ ] **Step 1: Update the `SearchResult` type**

Replace:

```typescript
interface SearchResult {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; level: number; satuan: string; konversi: number }[]
}
```

with:

```typescript
interface SearchResult {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string
  hargaPokok: number
  units: { id: number; satuan: string; konversi: number }[]
}
```

No other change needed in this file — the rendering code (around line 328) only reads `unit.id` and `unit.satuan`, never `unit.level`.

- [ ] **Step 2: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: remaining errors should only be in `ProductDetailDialog.tsx` (Task 7, not yet done).

- [ ] **Step 3: Commit**

```bash
git add desktop-node/src/renderer/pages/Purchase.tsx
git commit -m "chore: drop unused level field from Purchase.tsx unit search type"
```

---

### Task 7: Renderer UI — `ProductDetailDialog.tsx` unit chain manager

**Files:**
- Modify: `desktop-node/src/renderer/pages/inventory/ProductDetailDialog.tsx:1-293` (the `UnitRow`/`ProductDetail`/`UnitLevelsManager`/`UnitLevelSlot` section; `PriceTiersManager` and `PriceHistoryList` from line 295 onward are untouched)

**Interfaces:**
- Consumes: `window.api.inventory.getProductDetail/addProductUnit/updateProductUnit/deleteProductUnit` from Task 4.

- [ ] **Step 1: Replace the type declarations**

Replace:

```typescript
interface UnitRow {
  id: number
  level: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}
```

with:

```typescript
interface UnitRow {
  id: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}
```

Replace:

```typescript
interface ProductDetail {
  units: { level2: UnitRow | null; level3: UnitRow | null }
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}
```

with:

```typescript
interface ProductDetail {
  units: UnitRow[]
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}
```

Update the call site in `ProductDetailDialog`:

```typescript
            <UnitLevelsManager productId={productId} baseSatuan={baseSatuan} units={detail.units} onChanged={refresh} />
```

becomes:

```typescript
            <UnitChainManager productId={productId} baseSatuan={baseSatuan} units={detail.units} onChanged={refresh} />
```

- [ ] **Step 2: Replace `UnitLevelsManager`/`UnitLevelSlot` with `UnitChainManager`**

Replace the entire `UnitLevelsManager` and `UnitLevelSlot` functions (from `function UnitLevelsManager({` through the closing brace of `UnitLevelSlot`, i.e. everything between the `ProductDetailDialog` function and `function PriceTiersManager`) with:

```typescript
function UnitChainManager({
  productId,
  baseSatuan,
  units,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  units: UnitRow[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)

  const largest = units.length > 0 ? units[units.length - 1] : null

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Satuan Turunan</Label>
        <span className="text-xs text-muted-foreground">mis. 1 Renteng = 12 {baseSatuan}, 1 Dus = 10 Renteng</span>
      </div>

      {units.length > 0 ? (
        <div className="space-y-1.5">
          {units.map((unit, idx) => (
            <UnitChainRow
              key={unit.id}
              productId={productId}
              unit={unit}
              relativeToLabel={idx === 0 ? baseSatuan : units[idx - 1].satuan}
              baseSatuan={baseSatuan}
              unitsAbove={units.slice(idx + 1)}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada satuan turunan.</p>
      )}

      {adding ? (
        <UnitChainAddForm
          productId={productId}
          relativeToLabel={largest?.satuan ?? baseSatuan}
          onDone={() => setAdding(false)}
          onChanged={onChanged}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          + Tambah Satuan
        </Button>
      )}
    </div>
  )
}

function UnitChainRow({
  productId,
  unit,
  relativeToLabel,
  baseSatuan,
  unitsAbove,
  onChanged,
}: {
  productId: number
  unit: UnitRow
  relativeToLabel: string
  baseSatuan: string
  unitsAbove: UnitRow[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [satuan, setSatuan] = useState(unit.satuan)
  const [jumlahKemasan, setJumlahKemasan] = useState(String(unit.jumlahKemasan))
  const [hargaJual, setHargaJual] = useState(String(unit.hargaJual))
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function startEdit() {
    setSatuan(unit.satuan)
    setJumlahKemasan(String(unit.jumlahKemasan))
    setHargaJual(String(unit.hargaJual))
    setError(null)
    setEditing(true)
  }

  function submit(e: FormEvent) {
    e.preventDefault()

    if (!satuan.trim()) {
      setError('Satuan wajib diisi.')
      return
    }

    const jumlahNum = Number(jumlahKemasan)
    if (jumlahKemasan.trim() === '' || !Number.isFinite(jumlahNum)) {
      setError('Jumlah kemasan wajib diisi.')
      return
    }

    const hargaNum = Number(hargaJual)
    if (hargaJual.trim() === '' || !Number.isFinite(hargaNum)) {
      setError('Harga jual wajib diisi.')
      return
    }

    setProcessing(true)
    setError(null)

    window.api.inventory
      .updateProductUnit(productId, unit.id, { satuan, jumlahKemasan: jumlahNum, hargaJual: hargaNum })
      .then(() => {
        setEditing(false)
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function remove() {
    const ok = await confirm({
      title: 'Hapus Satuan',
      description:
        unitsAbove.length > 0
          ? `Hapus satuan "${unit.satuan}"? Ini juga akan menghapus ${unitsAbove.map((u) => `"${u.satuan}"`).join(', ')}.`
          : `Hapus satuan "${unit.satuan}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.inventory
      .deleteProductUnit(productId, unit.id)
      .then(onChanged)
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menghapus'))
  }

  if (editing) {
    return (
      <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1">
            <Label className="text-xs">Satuan</Label>
            <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} />
          </div>
          <div className="grid w-32 gap-1">
            <Label className="text-xs">= jumlah {relativeToLabel}</Label>
            <Input type="number" value={jumlahKemasan} onChange={(e) => setJumlahKemasan(e.target.value)} />
          </div>
          <div className="grid w-32 gap-1">
            <Label className="text-xs">Harga Jual</Label>
            <Input type="number" value={hargaJual} onChange={(e) => setHargaJual(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={processing}>
            Simpan
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
            Batal
          </Button>
        </div>
        <InputError message={error ?? undefined} />
      </form>
    )
  }

  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50">
      <span className="text-sm font-medium">
        1 {unit.satuan} = {unit.jumlahKemasan} {relativeToLabel}{' '}
        <span className="font-normal text-muted-foreground">
          (= {unit.konversi} {baseSatuan})
        </span>
      </span>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{formatRupiah(unit.hargaJual)}</Badge>
        <Button type="button" variant="ghost" size="sm" onClick={startEdit}>
          Edit
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={remove}>
          Hapus
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {ConfirmDialog}
    </div>
  )
}

function UnitChainAddForm({
  productId,
  relativeToLabel,
  onDone,
  onChanged,
}: {
  productId: number
  relativeToLabel: string
  onDone: () => void
  onChanged: () => void
}) {
  const [satuan, setSatuan] = useState('')
  const [jumlahKemasan, setJumlahKemasan] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()

    if (!satuan.trim()) {
      setError('Satuan wajib diisi.')
      return
    }

    const jumlahNum = Number(jumlahKemasan)
    if (jumlahKemasan.trim() === '' || !Number.isFinite(jumlahNum)) {
      setError('Jumlah kemasan wajib diisi.')
      return
    }

    const hargaNum = Number(hargaJual)
    if (hargaJual.trim() === '' || !Number.isFinite(hargaNum)) {
      setError('Harga jual wajib diisi.')
      return
    }

    setProcessing(true)
    setError(null)

    window.api.inventory
      .addProductUnit(productId, { satuan, jumlahKemasan: jumlahNum, hargaJual: hargaNum })
      .then(() => {
        onDone()
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1">
          <Label className="text-xs">Satuan</Label>
          <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder="Dus" autoFocus />
        </div>
        <div className="grid w-32 gap-1">
          <Label className="text-xs">= jumlah {relativeToLabel}</Label>
          <Input type="number" value={jumlahKemasan} onChange={(e) => setJumlahKemasan(e.target.value)} />
        </div>
        <div className="grid w-32 gap-1">
          <Label className="text-xs">Harga Jual</Label>
          <Input type="number" value={hargaJual} onChange={(e) => setHargaJual(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={processing}>
          Simpan
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Batal
        </Button>
      </div>
      <InputError message={error ?? undefined} />
    </form>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: no errors anywhere in the project.

- [ ] **Step 4: Manually verify in the running app**

```bash
cd desktop-node
npm run dev
```

Log in, open Katalog Produk (Inventory), open the units/tiers dialog for any product, and:
1. Add 3 derived units in sequence (e.g. Renteng = 12 Pcs, Dus = 10 Renteng, Pak = 5 Dus) and confirm each row shows both the relative definition and the `(= N Pcs)` total hint, and that the add form's "= jumlah ___" label always follows the current largest unit.
2. Edit the middle unit's jumlah and confirm the unit above it updates its `(= N Pcs)` hint accordingly after save.
3. Delete the middle unit and confirm the confirmation dialog names the unit above it, and both are removed while the bottom unit remains.
4. Close and reopen the dialog (or trigger `refresh`) and confirm the grid's "Satuan/Harga Bertingkat" badge count on the product row still updates.

Report any visual issue found — do not silently patch around it without noting it in the task's completion notes.

- [ ] **Step 5: Run the full test suite**

```bash
cd desktop-node
npm test
```

Expected: all tests pass (main-process tests now runnable per the Pre-flight step; renderer tests were already passing and are unaffected by this task).

- [ ] **Step 6: Commit**

```bash
git add desktop-node/src/renderer/pages/inventory/ProductDetailDialog.tsx
git commit -m "feat: replace fixed 2-slot unit UI with an unbounded chain list"
```

---

### Task 8: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

```bash
cd desktop-node
npx tsc --noEmit
```

Expected: clean, no output.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all test files pass, including `inventory-units.test.ts`, `purchase.test.ts`, `migrate.test.ts`, and every previously-passing renderer test (`cart-logic.test.ts`, `use-appearance.test.ts`, `utils.test.ts`).

- [ ] **Step 3: Grep for any leftover `level` reference tied to `product_units`**

```bash
grep -rn "level2\|level3\|productLevelUnique" desktop-node/src desktop-node/drizzle/*.sql
```

Expected: no matches (old migration files that already shipped and were previously applied are fine to keep historically — only check `src/` and confirm the *new* migration from Task 1 doesn't reintroduce the old index name).

- [ ] **Step 4: Update the superseded spec's status note**

In `docs/superpowers/specs/2026-08-07-inventory-units-tiers-design.md`, change the `**Status:** Approved` line at the top to:

```markdown
**Status:** Superseded by `docs/superpowers/specs/2026-08-09-inventory-units-dynamic-chain-design.md` (fixed-level cap removed).
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-inventory-units-tiers-design.md
git commit -m "docs: mark fixed-level units spec as superseded"
```
