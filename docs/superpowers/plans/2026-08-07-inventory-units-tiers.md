# Inventory Slice 2: Satuan Turunan & Harga Bertingkat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a product's derived selling units (satuan turunan, e.g. 1 Renteng = 12 Pcs, 1 Dus = 10 Renteng) and quantity-tiered pricing (harga bertingkat) be managed from a dialog on the Katalog Produk grid, plus a read-only price-change history view.

**Architecture:** Same three-layer pattern as Slice 1 — pure business-logic functions in a new `main/inventory-units.ts`, thin auth-guarded IPC handlers added to the existing `main/ipc/inventory.ts`, and a renderer dialog (`renderer/pages/inventory/ProductDetailDialog.tsx`) extracted into its own file since `Inventory.tsx` is already ~480 lines. A schema migration adds `level`/`jumlahKemasan` columns to the existing `product_units` table.

**Tech Stack:** Electron + React 19 + TypeScript, Drizzle ORM + better-sqlite3, Vitest. No new npm dependencies.

## Global Constraints

- **Fixed 3-level unit hierarchy** (a deliberate departure from the original web app's flexible list): Level 1 is always the product's existing base unit (`products.satuan`, untouched). Level 2 and Level 3 are each optional, single slots — not a repeatable list. **Level 3 requires Level 2 to already exist** — reject with `"Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3."` if not. Each level's quantity is entered relative to the level directly below it (Level 2 relative to base; Level 3 relative to Level 2), and the stored `konversi` is always the absolute conversion to the base unit — computed as `jumlahKemasan × (previous level's konversi, or 1 for Level 2)`.
- **Cascade delete:** deleting Level 2 while Level 3 exists deletes both (Level 3's value is only meaningful relative to Level 2).
- **Cascade recompute:** updating Level 2's quantity recomputes Level 3's stored `konversi` (using Level 3's own unchanged `jumlahKemasan` × the new Level 2 `konversi`), if Level 3 exists.
- **Harga Bertingkat is unchanged from the web app**: a flat, repeatable list of qty breakpoints (`minQty` ≥ 2, since qty 1 is just the base price) and their price, no hierarchy.
- **Friendly duplicate messages** (a deliberate addition beyond the web app, consistent with Slice 1's FK-restrict precedent): duplicate `minQty` for a product → `"Harga bertingkat untuk qty {minQty} sudah ada."` instead of a raw DB error.
- **Money validation**: every `hargaJual` input requires `Number.isFinite(...)` AND `>= 0` checks in business logic (mirrors Slice 1's fix), thrown as `"Harga jual wajib diisi."` / `"Harga jual tidak boleh negatif."`. Client-side forms must also reject empty/whitespace input before calling `Number(...)` and before the IPC call — this exact bug (`Number("") === 0`, finite and non-negative, silently saving a false price) was found and fixed in Slice 1's final review; this slice's new forms must not reintroduce it.
- Money crosses the IPC boundary as Rupiah `number`; stored/computed in integer cents in `main/inventory-units.ts`, using the same local `toRupiah`/`toCents` pattern already in `ipc/inventory.ts` (not shared — matches the established per-file convention).
- Every IPC handler is auth-guarded: `if (!getCurrentUser()) { throw new Error('Silakan login terlebih dahulu.') }`.
- `productUnits` remains fully backward-compatible with the shipped Kasir cart (`main/kasir.ts`, `cart-logic.test.ts`), which only ever reads `satuan`/`konversi`/`hargaJual` per row — confirmed by reading that code; it needs zero changes in this plan.
- No new npm dependencies.

---

### Task 1: Schema migration + Satuan Turunan business logic

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts`
- Create (via `drizzle-kit generate`): a new file in `desktop-node/drizzle/` (auto-named, e.g. `0002_<adjective>_<noun>.sql`) + matching `desktop-node/drizzle/meta/_journal.json` and `desktop-node/drizzle/meta/0002_snapshot.json` updates
- Create: `desktop-node/src/main/inventory-units.ts`
- Test: `desktop-node/src/main/inventory-units.test.ts`

**Interfaces:**
- Consumes: `products` from `./db/schema` (existing).
- Produces:
  - `export interface ProductUnitRow { id: number; level: number; satuan: string; jumlahKemasan: number; konversi: number; hargaJual: number }` (money in cents — IPC layer converts to Rupiah)
  - `export interface SetProductUnitInput { satuan: string; jumlahKemasan: number; hargaJual: number }` (money in cents)
  - `export function getProductUnits(db, productId: number): { level2: ProductUnitRow | null; level3: ProductUnitRow | null }`
  - `export function setProductUnit(db, productId: number, level: 2 | 3, input: SetProductUnitInput): void`
  - `export function deleteProductUnit(db, productId: number, level: 2 | 3): void`
  - Task 2 adds `addPriceTier`/`deletePriceTier`/`listPriceTiers`/`listPriceHistory`/`getProductDetail` to this same file. Task 3's IPC layer calls all of the above with these exact signatures.

- [ ] **Step 1: Edit the schema**

In `desktop-node/src/main/db/schema.ts`, find:

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  satuan: text('satuan').notNull(),
  konversi: integer('konversi').notNull(),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productSatuanUnique: uniqueIndex('product_units_product_id_satuan_unique').on(table.productId, table.satuan),
}))
```

Replace with:

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(2),
  satuan: text('satuan').notNull(),
  jumlahKemasan: integer('jumlah_kemasan').notNull().default(0),
  konversi: integer('konversi').notNull(),
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productLevelUnique: uniqueIndex('product_units_product_id_level_unique').on(table.productId, table.level),
}))
```

The `.default(2)`/`.default(0)` are a migration-mechanics necessity (SQLite requires a default for a `NOT NULL` column added via `ALTER TABLE ADD COLUMN`) — every insert path in this plan's business logic always sets both fields explicitly, so these defaults are otherwise inert. This mirrors the existing convention already in this file (e.g. `products.hargaPokok: integer('harga_pokok').notNull().default(0)`).

- [ ] **Step 2: Generate the migration**

Run: `cd desktop-node && npx drizzle-kit generate`

Expected: exits 0, no interactive prompt, and prints a line like `Your SQL migration file ➜ drizzle\0002_<name>.sql`. Verified in advance — this exact schema change produces:

```sql
DROP INDEX IF EXISTS `product_units_product_id_satuan_unique`;--> statement-breakpoint
ALTER TABLE `product_units` ADD `level` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `product_units` ADD `jumlah_kemasan` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_units_product_id_level_unique` ON `product_units` (`product_id`,`level`);
```

Open the generated `.sql` file and confirm it matches this shape (four statements: DROP INDEX, two ADD COLUMN, CREATE UNIQUE INDEX). If it doesn't match — stop and report DONE_WITH_CONCERNS rather than proceeding.

- [ ] **Step 3: Write the failing tests**

Create `desktop-node/src/main/inventory-units.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products } from './db/schema'
import { getProductUnits, setProductUnit, deleteProductUnit } from './inventory-units'

const migrationsFolder = path.resolve(__dirname, '../../drizzle')

function seedProduct() {
  const db = createDb(':memory:', migrationsFolder)
  const now = new Date()

  db.insert(products)
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

  return db
}

describe('getProductUnits', () => {
  it('returns null for both levels when none exist', () => {
    const db = seedProduct()
    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })
})

describe('setProductUnit', () => {
  const validInput = { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 }

  it('creates a level 2 unit with konversi equal to jumlahKemasan', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)

    const { level2, level3 } = getProductUnits(db, 1)
    expect(level2).toMatchObject({ level: 2, satuan: 'Renteng', jumlahKemasan: 12, konversi: 12, hargaJual: 15000_00 })
    expect(level3).toBeNull()
  })

  it('creates a level 3 unit with konversi = jumlahKemasan * level 2 konversi', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })

    const { level3 } = getProductUnits(db, 1)
    expect(level3).toMatchObject({ level: 3, satuan: 'Dus', jumlahKemasan: 10, konversi: 120 })
  })

  it('throws when level 3 is set before level 2 exists', () => {
    const db = seedProduct()

    expect(() => setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })).toThrow(
      'Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3.',
    )
  })

  it('updates an existing level 2 unit (upsert)', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput)
    setProductUnit(db, 1, 2, { satuan: 'Renteng Baru', jumlahKemasan: 20, hargaJual: 20000_00 })

    const { level2 } = getProductUnits(db, 1)
    expect(level2).toMatchObject({ satuan: 'Renteng Baru', jumlahKemasan: 20, konversi: 20, hargaJual: 20000_00 })
  })

  it('recomputes level 3 konversi when level 2 is updated, keeping level 3 jumlahKemasan unchanged', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, validInput) // konversi 12
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 }) // konversi 120
    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 24, hargaJual: 15000_00 }) // konversi 24

    const { level3 } = getProductUnits(db, 1)
    expect(level3?.konversi).toBe(240) // 10 * 24
    expect(level3?.jumlahKemasan).toBe(10) // unchanged relative quantity
  })

  it('throws when satuan is empty', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, satuan: '' })).toThrow('Satuan wajib diisi.')
  })

  it('throws when satuan exceeds 20 characters', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, satuan: 'a'.repeat(21) })).toThrow('Satuan maksimal 20 karakter.')
  })

  it('throws when jumlahKemasan is not finite', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: NaN })).toThrow('Jumlah kemasan wajib diisi.')
  })

  it('throws when jumlahKemasan is less than 1', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: 0 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when jumlahKemasan is not an integer', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, jumlahKemasan: 1.5 })).toThrow('Jumlah kemasan minimal 1.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => setProductUnit(db, 1, 2, { ...validInput, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })
})

describe('deleteProductUnit', () => {
  it('deletes a level 2 unit with no level 3', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    deleteProductUnit(db, 1, 2)

    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })

  it('deletes a level 3 unit without affecting level 2', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    deleteProductUnit(db, 1, 3)

    const { level2, level3 } = getProductUnits(db, 1)
    expect(level2).not.toBeNull()
    expect(level3).toBeNull()
  })

  it('cascades: deleting level 2 also deletes level 3', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    setProductUnit(db, 1, 3, { satuan: 'Dus', jumlahKemasan: 10, hargaJual: 140000_00 })
    deleteProductUnit(db, 1, 2)

    expect(getProductUnits(db, 1)).toEqual({ level2: null, level3: null })
  })

  it('is a no-op when the level does not exist', () => {
    const db = seedProduct()
    expect(() => deleteProductUnit(db, 1, 2)).not.toThrow()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run inventory-units.test.ts`
Expected: FAIL — `Cannot find module './inventory-units'` (the file doesn't exist yet).

- [ ] **Step 5: Implement `inventory-units.ts`**

Create `desktop-node/src/main/inventory-units.ts`:

```typescript
import { and, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits } from './db/schema'

export interface ProductUnitRow {
  id: number
  level: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}

function unitRowSelect(db: BetterSQLite3Database<typeof schema>) {
  return db.select({
    id: productUnits.id,
    level: productUnits.level,
    satuan: productUnits.satuan,
    jumlahKemasan: productUnits.jumlahKemasan,
    konversi: productUnits.konversi,
    hargaJual: productUnits.hargaJual,
  }).from(productUnits)
}

export function getProductUnits(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
): { level2: ProductUnitRow | null; level3: ProductUnitRow | null } {
  const rows = unitRowSelect(db).where(eq(productUnits.productId, productId)).all()

  return {
    level2: rows.find((r) => r.level === 2) ?? null,
    level3: rows.find((r) => r.level === 3) ?? null,
  }
}

export interface SetProductUnitInput {
  satuan: string
  jumlahKemasan: number
  hargaJual: number
}

export function setProductUnit(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  level: 2 | 3,
  input: SetProductUnitInput,
): void {
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

  let konversi: number

  if (level === 2) {
    konversi = input.jumlahKemasan
  } else {
    const level2 = db
      .select({ konversi: productUnits.konversi })
      .from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.level, 2)))
      .get()

    if (!level2) {
      throw new Error('Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3.')
    }

    konversi = input.jumlahKemasan * level2.konversi
  }

  const existing = db
    .select({ id: productUnits.id })
    .from(productUnits)
    .where(and(eq(productUnits.productId, productId), eq(productUnits.level, level)))
    .get()

  const now = new Date()

  if (existing) {
    db.update(productUnits)
      .set({ satuan: input.satuan, jumlahKemasan: input.jumlahKemasan, konversi, hargaJual: input.hargaJual, updatedAt: now })
      .where(eq(productUnits.id, existing.id))
      .run()
  } else {
    db.insert(productUnits)
      .values({
        productId,
        level,
        satuan: input.satuan,
        jumlahKemasan: input.jumlahKemasan,
        konversi,
        hargaJual: input.hargaJual,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  }

  if (level === 2) {
    const level3 = db
      .select({ id: productUnits.id, jumlahKemasan: productUnits.jumlahKemasan })
      .from(productUnits)
      .where(and(eq(productUnits.productId, productId), eq(productUnits.level, 3)))
      .get()

    if (level3) {
      db.update(productUnits)
        .set({ konversi: level3.jumlahKemasan * konversi, updatedAt: now })
        .where(eq(productUnits.id, level3.id))
        .run()
    }
  }
}

export function deleteProductUnit(db: BetterSQLite3Database<typeof schema>, productId: number, level: 2 | 3): void {
  if (level === 2) {
    db.delete(productUnits).where(and(eq(productUnits.productId, productId), eq(productUnits.level, 3))).run()
  }

  db.delete(productUnits).where(and(eq(productUnits.productId, productId), eq(productUnits.level, level))).run()
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run inventory-units.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 7: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (confirms the migration doesn't break any existing test, including `db/migrate.test.ts`'s table-count check and `kasir.test.ts`'s use of `productUnits`).

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/main/db/schema.ts drizzle/ src/main/inventory-units.ts src/main/inventory-units.test.ts
git status --short
```

Verify the output shows ONLY: `src/main/db/schema.ts`, the new migration `.sql` file under `drizzle/`, the updated `drizzle/meta/_journal.json`, the new `drizzle/meta/000X_snapshot.json`, `src/main/inventory-units.ts`, `src/main/inventory-units.test.ts`. If anything else appears, unstage it (`git restore --staged <path>`) before committing — never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add satuan turunan schema migration and business logic"
```

---

### Task 2: Harga Bertingkat + Price History business logic, list-count augmentation

**Files:**
- Modify: `desktop-node/src/main/inventory-units.ts` (adds tiers/history/detail functions)
- Modify: `desktop-node/src/main/inventory-units.test.ts` (adds tier/history/detail tests)
- Modify: `desktop-node/src/main/inventory.ts` (adds `unitsCount`/`priceTiersCount` to `ProductListItem`, `listProducts`, `searchProductsQuick`)
- Modify: `desktop-node/src/main/inventory.test.ts` (adds count-augmentation tests)

**Interfaces:**
- Consumes: `productUnits`/`ProductUnitRow`/`getProductUnits` from Task 1; `productPriceTiers`, `productPriceHistories`, `users` from `./db/schema` (existing).
- Produces:
  - `export interface PriceTierRow { id: number; minQty: number; hargaJual: number }` (money in cents)
  - `export interface AddPriceTierInput { minQty: number; hargaJual: number }` (money in cents)
  - `export function addPriceTier(db, productId: number, input: AddPriceTierInput): void`
  - `export function deletePriceTier(db, productId: number, tierId: number): void`
  - `export function listPriceTiers(db, productId: number): PriceTierRow[]`
  - `export interface PriceHistoryRow { id: number; hargaPokokLama: number; hargaPokokBaru: number; hargaJualLama: number; hargaJualBaru: number; createdAt: Date; userName: string | null }` (money in cents)
  - `export function listPriceHistory(db, productId: number): PriceHistoryRow[]`
  - `export interface ProductDetail { units: { level2: ProductUnitRow | null; level3: ProductUnitRow | null }; priceTiers: PriceTierRow[]; priceHistory: PriceHistoryRow[] }`
  - `export function getProductDetail(db, productId: number): ProductDetail`
  - `ProductListItem` (in `main/inventory.ts`) gains `unitsCount: number` and `priceTiersCount: number` — Task 3's IPC layer passes these through unconverted (they're plain counts, not money).

- [ ] **Step 1: Write the failing tests — tiers, history, detail**

Append to `desktop-node/src/main/inventory-units.test.ts`. First, update its imports at the top of the file:

Find:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products } from './db/schema'
import { getProductUnits, setProductUnit, deleteProductUnit } from './inventory-units'
```

Replace with:

```typescript
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { createDb } from './db/migrate'
import { products, productPriceHistories, users } from './db/schema'
import {
  getProductUnits,
  setProductUnit,
  deleteProductUnit,
  addPriceTier,
  deletePriceTier,
  listPriceTiers,
  listPriceHistory,
  getProductDetail,
} from './inventory-units'
```

Then append these `describe` blocks at the end of the file (after the existing `deleteProductUnit` block):

```typescript
describe('addPriceTier', () => {
  it('adds a price tier', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const tiers = listPriceTiers(db, 1)
    expect(tiers).toEqual([{ id: expect.any(Number), minQty: 6, hargaJual: 1400_00 }])
  })

  it('throws when minQty is not finite', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: NaN, hargaJual: 1400_00 })).toThrow('Qty minimal wajib diisi.')
  })

  it('throws when minQty is less than 2', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 1, hargaJual: 1400_00 })).toThrow('Qty minimal harus 2 atau lebih.')
  })

  it('throws when minQty is not an integer', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 2.5, hargaJual: 1400_00 })).toThrow('Qty minimal harus 2 atau lebih.')
  })

  it('throws when hargaJual is not finite', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 6, hargaJual: NaN })).toThrow('Harga jual wajib diisi.')
  })

  it('throws when hargaJual is negative', () => {
    const db = seedProduct()
    expect(() => addPriceTier(db, 1, { minQty: 6, hargaJual: -1 })).toThrow('Harga jual tidak boleh negatif.')
  })

  it('throws a friendly message when minQty already exists for the product', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    expect(() => addPriceTier(db, 1, { minQty: 6, hargaJual: 1300_00 })).toThrow('Harga bertingkat untuk qty 6 sudah ada.')
  })
})

describe('deletePriceTier', () => {
  it('deletes a tier belonging to the product', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })
    const [tier] = listPriceTiers(db, 1)
    deletePriceTier(db, 1, tier.id)

    expect(listPriceTiers(db, 1)).toEqual([])
  })

  it('throws when the tier does not belong to the product', () => {
    const db = seedProduct()
    const now = new Date()

    db.insert(products)
      .values({
        id: 2,
        kodeItem: 'RKK2',
        barcode: null,
        namaItem: 'Rokok B',
        categoryId: null,
        satuan: 'Pcs',
        hargaPokok: 1000_00,
        hargaJual: 1500_00,
        stok: 50,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    addPriceTier(db, 2, { minQty: 6, hargaJual: 1400_00 })
    const [tier] = listPriceTiers(db, 2)

    expect(() => deletePriceTier(db, 1, tier.id)).toThrow('Harga bertingkat tidak ditemukan.')
  })
})

describe('listPriceTiers', () => {
  it('returns tiers sorted by minQty ascending', () => {
    const db = seedProduct()

    addPriceTier(db, 1, { minQty: 12, hargaJual: 1300_00 })
    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const tiers = listPriceTiers(db, 1)
    expect(tiers.map((t) => t.minQty)).toEqual([6, 12])
  })
})

describe('listPriceHistory', () => {
  it('returns price history rows with the editor name, newest first', () => {
    const db = seedProduct()
    const now = new Date()

    db.insert(users)
      .values({ id: 1, username: 'admin', passwordHash: 'x', name: 'Admin', createdAt: now, updatedAt: now })
      .run()

    db.insert(productPriceHistories)
      .values([
        {
          productId: 1,
          userId: 1,
          hargaPokokLama: 1000_00,
          hargaPokokBaru: 1100_00,
          hargaJualLama: 1500_00,
          hargaJualBaru: 1600_00,
          createdAt: new Date(now.getTime() - 1000),
          updatedAt: now,
        },
        {
          productId: 1,
          userId: null,
          hargaPokokLama: 1100_00,
          hargaPokokBaru: 1200_00,
          hargaJualLama: 1600_00,
          hargaJualBaru: 1700_00,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run()

    const history = listPriceHistory(db, 1)
    expect(history).toHaveLength(2)
    expect(history[0].userName).toBeNull()
    expect(history[1].userName).toBe('Admin')
  })
})

describe('getProductDetail', () => {
  it('bundles units, price tiers, and price history', () => {
    const db = seedProduct()

    setProductUnit(db, 1, 2, { satuan: 'Renteng', jumlahKemasan: 12, hargaJual: 15000_00 })
    addPriceTier(db, 1, { minQty: 6, hargaJual: 1400_00 })

    const detail = getProductDetail(db, 1)
    expect(detail.units.level2).not.toBeNull()
    expect(detail.units.level3).toBeNull()
    expect(detail.priceTiers).toHaveLength(1)
    expect(detail.priceHistory).toEqual([])
  })
})
```

- [ ] **Step 2: Write the failing tests — count augmentation**

In `desktop-node/src/main/inventory.test.ts`, find:

```typescript
import { categories, products, productPriceHistories, saleItems, sales, purchaseItems, purchases, users } from './db/schema'
```

Replace with:

```typescript
import {
  categories,
  products,
  productPriceHistories,
  saleItems,
  sales,
  purchaseItems,
  purchases,
  users,
  productUnits,
  productPriceTiers,
} from './db/schema'
```

Then append this at the end of the file:

```typescript
describe('listProducts unit/tier counts', () => {
  it('returns unitsCount and priceTiersCount for each product', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(productUnits)
      .values({
        productId: 1,
        level: 2,
        satuan: 'Renteng',
        jumlahKemasan: 12,
        konversi: 12,
        hargaJual: 15000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    db.insert(productPriceTiers)
      .values([
        { productId: 1, minQty: 6, hargaJual: 63000_00, createdAt: now, updatedAt: now },
        { productId: 1, minQty: 12, hargaJual: 60000_00, createdAt: now, updatedAt: now },
      ])
      .run()

    const result = listProducts(db, { page: 1 })
    const beras = result.data.find((p) => p.id === 1)
    const mie = result.data.find((p) => p.id === 2)

    expect(beras?.unitsCount).toBe(1)
    expect(beras?.priceTiersCount).toBe(2)
    expect(mie?.unitsCount).toBe(0)
    expect(mie?.priceTiersCount).toBe(0)
  })
})

describe('searchProductsQuick unit/tier counts', () => {
  it('returns unitsCount and priceTiersCount', () => {
    const db = seedProducts()
    const now = new Date()

    db.insert(productUnits)
      .values({
        productId: 1,
        level: 2,
        satuan: 'Renteng',
        jumlahKemasan: 12,
        konversi: 12,
        hargaJual: 15000_00,
        createdAt: now,
        updatedAt: now,
      })
      .run()

    const results = searchProductsQuick(db, 'beras')
    expect(results[0].unitsCount).toBe(1)
    expect(results[0].priceTiersCount).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd desktop-node && npx vitest run inventory-units.test.ts inventory.test.ts`
Expected: FAIL — `addPriceTier`/`deletePriceTier`/`listPriceTiers`/`listPriceHistory`/`getProductDetail` not exported yet; `unitsCount`/`priceTiersCount` undefined on `ProductListItem`.

- [ ] **Step 4: Implement the tiers/history/detail functions**

Append to `desktop-node/src/main/inventory-units.ts`. First, update its imports at the top:

Find:

```typescript
import { and, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits } from './db/schema'
```

Replace with:

```typescript
import { and, desc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { productUnits, productPriceTiers, productPriceHistories, users } from './db/schema'
```

Then append at the end of the file:

```typescript
export interface PriceTierRow {
  id: number
  minQty: number
  hargaJual: number
}

export interface AddPriceTierInput {
  minQty: number
  hargaJual: number
}

export function addPriceTier(db: BetterSQLite3Database<typeof schema>, productId: number, input: AddPriceTierInput): void {
  if (!Number.isFinite(input.minQty)) {
    throw new Error('Qty minimal wajib diisi.')
  }

  if (!Number.isInteger(input.minQty) || input.minQty < 2) {
    throw new Error('Qty minimal harus 2 atau lebih.')
  }

  if (!Number.isFinite(input.hargaJual)) {
    throw new Error('Harga jual wajib diisi.')
  }

  if (input.hargaJual < 0) {
    throw new Error('Harga jual tidak boleh negatif.')
  }

  const existing = db
    .select({ id: productPriceTiers.id })
    .from(productPriceTiers)
    .where(and(eq(productPriceTiers.productId, productId), eq(productPriceTiers.minQty, input.minQty)))
    .get()

  if (existing) {
    throw new Error(`Harga bertingkat untuk qty ${input.minQty} sudah ada.`)
  }

  const now = new Date()

  db.insert(productPriceTiers)
    .values({ productId, minQty: input.minQty, hargaJual: input.hargaJual, createdAt: now, updatedAt: now })
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

export function listPriceTiers(db: BetterSQLite3Database<typeof schema>, productId: number): PriceTierRow[] {
  return db
    .select({ id: productPriceTiers.id, minQty: productPriceTiers.minQty, hargaJual: productPriceTiers.hargaJual })
    .from(productPriceTiers)
    .where(eq(productPriceTiers.productId, productId))
    .orderBy(productPriceTiers.minQty)
    .all()
}

export interface PriceHistoryRow {
  id: number
  hargaPokokLama: number
  hargaPokokBaru: number
  hargaJualLama: number
  hargaJualBaru: number
  createdAt: Date
  userName: string | null
}

export function listPriceHistory(db: BetterSQLite3Database<typeof schema>, productId: number): PriceHistoryRow[] {
  return db
    .select({
      id: productPriceHistories.id,
      hargaPokokLama: productPriceHistories.hargaPokokLama,
      hargaPokokBaru: productPriceHistories.hargaPokokBaru,
      hargaJualLama: productPriceHistories.hargaJualLama,
      hargaJualBaru: productPriceHistories.hargaJualBaru,
      createdAt: productPriceHistories.createdAt,
      userName: users.name,
    })
    .from(productPriceHistories)
    .leftJoin(users, eq(productPriceHistories.userId, users.id))
    .where(eq(productPriceHistories.productId, productId))
    .orderBy(desc(productPriceHistories.createdAt))
    .all()
}

export interface ProductDetail {
  units: { level2: ProductUnitRow | null; level3: ProductUnitRow | null }
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

export function getProductDetail(db: BetterSQLite3Database<typeof schema>, productId: number): ProductDetail {
  return {
    units: getProductUnits(db, productId),
    priceTiers: listPriceTiers(db, productId),
    priceHistory: listPriceHistory(db, productId),
  }
}
```

- [ ] **Step 5: Implement the count augmentation in `inventory.ts`**

In `desktop-node/src/main/inventory.ts`, find:

```typescript
import { and, eq, like, ne, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productPriceHistories } from './db/schema'
```

Replace with:

```typescript
import { and, eq, like, ne, or, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { categories, products, productPriceHistories, productUnits, productPriceTiers } from './db/schema'
```

Find:

```typescript
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
```

Replace with:

```typescript
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
  unitsCount: number
  priceTiersCount: number
}
```

Find:

```typescript
function productListSelect(db: BetterSQLite3Database<typeof schema>) {
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
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
}
```

Replace with:

```typescript
function productListSelect(db: BetterSQLite3Database<typeof schema>) {
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
      isActive: products.isActive,
      unitsCount: sql<number>`(SELECT COUNT(*) FROM ${productUnits} WHERE ${productUnits.productId} = ${products.id})`,
      priceTiersCount: sql<number>`(SELECT COUNT(*) FROM ${productPriceTiers} WHERE ${productPriceTiers.productId} = ${products.id})`,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
}
```

Find:

```typescript
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
```

Replace with:

```typescript
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
  unitsCount: number
  priceTiersCount: number
}): ProductListItem {
  return row
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd desktop-node && npx vitest run inventory-units.test.ts inventory.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 7: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 9: Commit**

```bash
cd desktop-node
git add src/main/inventory-units.ts src/main/inventory-units.test.ts src/main/inventory.ts src/main/inventory.test.ts
git status --short
```

Verify the output shows ONLY those four files — never `git add .`/`-A`/`--all`.

```bash
git commit -m "Add harga bertingkat and price history logic, list-count augmentation"
```

---

### Task 3: IPC handlers, preload, renderer types

**Files:**
- Modify: `desktop-node/src/main/ipc/inventory.ts`
- Modify: `desktop-node/src/preload/index.ts`
- Modify: `desktop-node/src/renderer/env.d.ts`

**Interfaces:**
- Consumes: `getProductDetail`, `setProductUnit`, `deleteProductUnit`, `addPriceTier`, `deletePriceTier`, `ProductUnitRow` from Task 1/2's `main/inventory-units.ts`; the extended `ProductListItem` (with `unitsCount`/`priceTiersCount`) from Task 2's `main/inventory.ts`.
- Produces: IPC channels `inventory:getProductDetail`, `inventory:setProductUnit`, `inventory:deleteProductUnit`, `inventory:addPriceTier`, `inventory:deletePriceTier`; extended `inventory:listProducts`/`inventory:searchProducts` DTOs; `window.api.inventory.getProductDetail`/`setProductUnit`/`deleteProductUnit`/`addPriceTier`/`deletePriceTier` — Task 4's renderer calls these exact names.

- [ ] **Step 1: Extend the IPC handlers**

In `desktop-node/src/main/ipc/inventory.ts`, find:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from '../inventory'
import { getCurrentUser } from './auth'
```

Replace with:

```typescript
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { listProducts, updateProduct, deleteProduct, bulkDeleteProducts, searchProductsQuick } from '../inventory'
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

Find:

```typescript
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
```

Replace with:

```typescript
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
  unitsCount: number
  priceTiersCount: number
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
    unitsCount: item.unitsCount,
    priceTiersCount: item.priceTiersCount,
  }
}

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

Find the closing `}` of `registerInventoryIpc` (the line immediately after the existing `inventory:searchProducts` handler):

```typescript
  ipcMain.handle('inventory:searchProducts', (_event, q: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsQuick(db, q).map(toDto)
  })
}
```

Replace with:

```typescript
  ipcMain.handle('inventory:searchProducts', (_event, q: string) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    return searchProductsQuick(db, q).map(toDto)
  })

  ipcMain.handle('inventory:getProductDetail', (_event, productId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    const detail = getProductDetail(db, productId)

    return {
      units: {
        level2: detail.units.level2 ? toUnitDto(detail.units.level2) : null,
        level3: detail.units.level3 ? toUnitDto(detail.units.level3) : null,
      },
      priceTiers: detail.priceTiers.map((tier) => ({ id: tier.id, minQty: tier.minQty, hargaJual: toRupiah(tier.hargaJual) })),
      priceHistory: detail.priceHistory.map((entry) => ({
        id: entry.id,
        hargaPokokLama: toRupiah(entry.hargaPokokLama),
        hargaPokokBaru: toRupiah(entry.hargaPokokBaru),
        hargaJualLama: toRupiah(entry.hargaJualLama),
        hargaJualBaru: toRupiah(entry.hargaJualBaru),
        createdAt: entry.createdAt.toISOString(),
        userName: entry.userName,
      })),
    }
  })

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

  ipcMain.handle('inventory:addPriceTier', (_event, productId: number, input: { minQty: number; hargaJual: number }) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    addPriceTier(db, productId, { minQty: input.minQty, hargaJual: toCents(input.hargaJual) })
  })

  ipcMain.handle('inventory:deletePriceTier', (_event, productId: number, tierId: number) => {
    if (!getCurrentUser()) {
      throw new Error('Silakan login terlebih dahulu.')
    }

    deletePriceTier(db, productId, tierId)
  })
}
```

- [ ] **Step 2: Expose the new channels in preload**

In `desktop-node/src/preload/index.ts`, find:

```typescript
    deleteProduct: (id: number) => invoke('inventory:deleteProduct', id),
    bulkDeleteProducts: (ids: number[]) => invoke('inventory:bulkDeleteProducts', ids),
    searchProducts: (q: string) => invoke('inventory:searchProducts', q),
  },
}
```

Replace with:

```typescript
    deleteProduct: (id: number) => invoke('inventory:deleteProduct', id),
    bulkDeleteProducts: (ids: number[]) => invoke('inventory:bulkDeleteProducts', ids),
    searchProducts: (q: string) => invoke('inventory:searchProducts', q),
    getProductDetail: (productId: number) => invoke('inventory:getProductDetail', productId),
    setProductUnit: (productId: number, level: 2 | 3, input: { satuan: string; jumlahKemasan: number; hargaJual: number }) =>
      invoke('inventory:setProductUnit', productId, level, input),
    deleteProductUnit: (productId: number, level: 2 | 3) => invoke('inventory:deleteProductUnit', productId, level),
    addPriceTier: (productId: number, input: { minQty: number; hargaJual: number }) =>
      invoke('inventory:addPriceTier', productId, input),
    deletePriceTier: (productId: number, tierId: number) => invoke('inventory:deletePriceTier', productId, tierId),
  },
}
```

- [ ] **Step 3: Update renderer types**

In `desktop-node/src/renderer/env.d.ts`, find:

```typescript
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
```

Replace with:

```typescript
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
            unitsCount: number
            priceTiersCount: number
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
            unitsCount: number
            priceTiersCount: number
          }[]
        >
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
        addPriceTier: (productId: number, input: { minQty: number; hargaJual: number }) => Promise<void>
        deletePriceTier: (productId: number, tierId: number) => Promise<void>
      }
```

- [ ] **Step 4: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions (no new automated tests in this task; the business logic is already covered by Tasks 1-2).

- [ ] **Step 6: Commit**

```bash
cd desktop-node
git add src/main/ipc/inventory.ts src/preload/index.ts src/renderer/env.d.ts
git status --short
```

Verify the output shows ONLY those three files.

```bash
git commit -m "Add satuan turunan and harga bertingkat IPC handlers"
```

---

### Task 4: `ProductDetailDialog.tsx`, grid column, manual verification

**Files:**
- Create: `desktop-node/src/renderer/pages/inventory/ProductDetailDialog.tsx`
- Modify: `desktop-node/src/renderer/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `window.api.inventory.getProductDetail`/`setProductUnit`/`deleteProductUnit`/`addPriceTier`/`deletePriceTier` (Task 3); `Badge`, `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`, `Button`, `Input`, `Label`, `InputError`, `useConfirm`, `formatRupiah` (all existing).
- Produces: `export function ProductDetailDialog(props: { productId: number | null; productNama: string | null; baseSatuan: string; onOpenChange: (open: boolean) => void; onChanged: () => void })` — `Inventory.tsx` renders this once, passing the currently-selected product's id/name/base satuan.

- [ ] **Step 1: Create `ProductDetailDialog.tsx`**

Create `desktop-node/src/renderer/pages/inventory/ProductDetailDialog.tsx`:

```typescript
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { History, Layers, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputError } from '@/components/input-error'
import { useConfirm } from '@/hooks/use-confirm'
import { formatRupiah } from '@/lib/utils'

interface UnitRow {
  id: number
  level: number
  satuan: string
  jumlahKemasan: number
  konversi: number
  hargaJual: number
}

interface PriceTierRow {
  id: number
  minQty: number
  hargaJual: number
}

interface PriceHistoryRow {
  id: number
  hargaPokokLama: number
  hargaPokokBaru: number
  hargaJualLama: number
  hargaJualBaru: number
  createdAt: string
  userName: string | null
}

interface ProductDetail {
  units: { level2: UnitRow | null; level3: UnitRow | null }
  priceTiers: PriceTierRow[]
  priceHistory: PriceHistoryRow[]
}

interface ProductDetailDialogProps {
  productId: number | null
  productNama: string | null
  baseSatuan: string
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ProductDetailDialog({ productId, productNama, baseSatuan, onOpenChange, onChanged }: ProductDetailDialogProps) {
  const [detail, setDetail] = useState<ProductDetail | null>(null)

  function reload(id: number) {
    window.api.inventory.getProductDetail(id).then(setDetail)
  }

  useEffect(() => {
    if (productId === null) {
      setDetail(null)
      return
    }
    reload(productId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  function refresh() {
    if (productId !== null) {
      reload(productId)
    }
    onChanged()
  }

  return (
    <Dialog open={productId !== null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{productNama} &mdash; Satuan, Harga Bertingkat & Riwayat Harga</DialogTitle>
        </DialogHeader>
        {productId !== null && detail && (
          <>
            <UnitLevelsManager productId={productId} baseSatuan={baseSatuan} units={detail.units} onChanged={refresh} />
            <PriceTiersManager productId={productId} baseSatuan={baseSatuan} tiers={detail.priceTiers} onChanged={refresh} />
            <PriceHistoryList history={detail.priceHistory} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function UnitLevelsManager({
  productId,
  baseSatuan,
  units,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  units: { level2: UnitRow | null; level3: UnitRow | null }
  onChanged: () => void
}) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Satuan Turunan</Label>
        <span className="text-xs text-muted-foreground">mis. 1 Renteng = 12 {baseSatuan}, 1 Dus = 10 Renteng</span>
      </div>
      <UnitLevelSlot
        productId={productId}
        level={2}
        relativeToLabel={baseSatuan}
        unit={units.level2}
        siblingLevel3={units.level3}
        disabled={false}
        onChanged={onChanged}
      />
      <UnitLevelSlot
        productId={productId}
        level={3}
        relativeToLabel={units.level2?.satuan ?? baseSatuan}
        unit={units.level3}
        siblingLevel3={null}
        disabled={units.level2 === null}
        onChanged={onChanged}
      />
    </div>
  )
}

function UnitLevelSlot({
  productId,
  level,
  relativeToLabel,
  unit,
  siblingLevel3,
  disabled,
  onChanged,
}: {
  productId: number
  level: 2 | 3
  relativeToLabel: string
  unit: UnitRow | null
  siblingLevel3: UnitRow | null
  disabled: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [satuan, setSatuan] = useState('')
  const [jumlahKemasan, setJumlahKemasan] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function startEdit() {
    setSatuan(unit?.satuan ?? '')
    setJumlahKemasan(unit ? String(unit.jumlahKemasan) : '')
    setHargaJual(unit ? String(unit.hargaJual) : '')
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
      .setProductUnit(productId, level, { satuan, jumlahKemasan: jumlahNum, hargaJual: hargaNum })
      .then(() => {
        setEditing(false)
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function remove() {
    const ok = await confirm({
      title: `Hapus Level ${level}`,
      description:
        level === 2 && siblingLevel3
          ? `Hapus satuan "${unit?.satuan}"? Ini juga akan menghapus satuan Level 3 ("${siblingLevel3.satuan}").`
          : `Hapus satuan "${unit?.satuan}"?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.inventory.deleteProductUnit(productId, level).then(onChanged)
  }

  if (disabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Level {level}: isi Level {level - 1} dulu.
      </p>
    )
  }

  if (unit && !editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50">
        <span className="text-sm font-medium">
          1 {unit.satuan} = {unit.jumlahKemasan} {relativeToLabel}
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
        {ConfirmDialog}
      </div>
    )
  }

  if (!unit && !editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
        <span className="text-sm text-muted-foreground">Level {level} belum diisi.</span>
        <Button type="button" size="sm" onClick={startEdit}>
          Tambah
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1">
          <Label className="text-xs">Satuan</Label>
          <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} placeholder={level === 2 ? 'Renteng' : 'Dus'} />
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

function PriceTiersManager({
  productId,
  baseSatuan,
  tiers,
  onChanged,
}: {
  productId: number
  baseSatuan: string
  tiers: PriceTierRow[]
  onChanged: () => void
}) {
  const [minQty, setMinQty] = useState('')
  const [hargaJual, setHargaJual] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const { confirm, ConfirmDialog } = useConfirm()

  function addTier(e: FormEvent) {
    e.preventDefault()

    const minQtyNum = Number(minQty)
    if (minQty.trim() === '' || !Number.isFinite(minQtyNum)) {
      setError('Qty minimal wajib diisi.')
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
      .addPriceTier(productId, { minQty: minQtyNum, hargaJual: hargaNum })
      .then(() => {
        setMinQty('')
        setHargaJual('')
        onChanged()
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Gagal menyimpan'))
      .finally(() => setProcessing(false))
  }

  async function removeTier(tier: PriceTierRow) {
    const ok = await confirm({
      title: 'Hapus Harga Bertingkat',
      description: `Hapus harga bertingkat untuk pembelian ${tier.minQty}+ ${baseSatuan}?`,
      confirmLabel: 'Hapus',
      destructive: true,
    })

    if (!ok) {
      return
    }

    window.api.inventory.deletePriceTier(productId, tier.id).then(onChanged)
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Harga Bertingkat</Label>
        <span className="text-xs text-muted-foreground">berdasarkan jumlah beli, satuan {baseSatuan}</span>
      </div>
      {tiers.length > 0 ? (
        <div className="space-y-1.5">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2 transition-colors hover:bg-accent/50"
            >
              <span className="text-sm font-medium">
                Beli {tier.minQty}+ {baseSatuan}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {formatRupiah(tier.hargaJual)} / {baseSatuan}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeTier(tier)}
                >
                  Hapus
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada harga bertingkat.</p>
      )}
      <form onSubmit={addTier} className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-end gap-2">
          <div className="grid w-32 gap-1">
            <Label className="text-xs">Min. Qty</Label>
            <Input type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="6" />
          </div>
          <div className="grid w-40 gap-1">
            <Label className="text-xs">Harga Jual per {baseSatuan}</Label>
            <Input type="number" value={hargaJual} onChange={(e) => setHargaJual(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={processing}>
            Tambah
          </Button>
        </div>
        <InputError message={error ?? undefined} />
      </form>
      {ConfirmDialog}
    </div>
  )
}

function PriceHistoryList({ history }: { history: PriceHistoryRow[] }) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Riwayat Perubahan Harga</Label>
      </div>
      {history.length > 0 ? (
        <div className="space-y-1.5">
          {history.map((entry) => (
            <div key={entry.id} className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(entry.createdAt).toLocaleString('id-ID')}</span>
                <span>{entry.userName ?? 'Sistem'}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4">
                <span>
                  Harga Pokok: {formatRupiah(entry.hargaPokokLama)} &rarr;{' '}
                  <span className="font-medium">{formatRupiah(entry.hargaPokokBaru)}</span>
                </span>
                <span>
                  Harga Jual: {formatRupiah(entry.hargaJualLama)} &rarr;{' '}
                  <span className="font-medium">{formatRupiah(entry.hargaJualBaru)}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Belum ada perubahan harga.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire the dialog and grid column into `Inventory.tsx`**

In `desktop-node/src/renderer/pages/Inventory.tsx`, find:

```typescript
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useAppearance } from '@/hooks/use-appearance'
```

Replace with:

```typescript
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { useAppearance } from '@/hooks/use-appearance'
```

Find:

```typescript
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
```

Replace with:

```typescript
import { AppShell } from '../layouts/AppShell'
import type { BreadcrumbItem } from '../types'
import { ProductDetailDialog } from './inventory/ProductDetailDialog'
```

Find:

```typescript
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
```

Replace with:

```typescript
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
  unitsCount: number
  priceTiersCount: number
}
```

Find:

```typescript
const OTHER_COLUMNS_WIDTH = 50 + 110 + 130 + 130 + 90 + 110 + 110 + 90 + 90 + 70
```

Replace with:

```typescript
const OTHER_COLUMNS_WIDTH = 50 + 110 + 130 + 130 + 90 + 110 + 110 + 90 + 90 + 170 + 70
```

Find:

```typescript
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<ProductRow[]>([])
```

Replace with:

```typescript
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteResults, setPaletteResults] = useState<ProductRow[]>([])

  const [detailProductId, setDetailProductId] = useState<number | null>(null)
```

Find:

```typescript
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
```

Replace with:

```typescript
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
      key: 'unitsTiers',
      name: 'Satuan/Harga Bertingkat',
      width: 170,
      renderCell: ({ row }) => {
        const product = rawProducts.find((p) => p.id === row.id)
        if (!product) {
          return null
        }
        return (
          <button
            type="button"
            className="flex h-full items-center gap-1"
            onClick={() => setDetailProductId(row.id)}
          >
            <Badge variant={product.unitsCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {product.unitsCount} unit
            </Badge>
            <Badge variant={product.priceTiersCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
              {product.priceTiersCount} tingkat
            </Badge>
          </button>
        )
      },
    },
    {
      key: 'aksi',
```

Find:

```typescript
      {ConfirmDialog}
    </AppShell>
  )
}
```

Replace with:

```typescript
      <ProductDetailDialog
        productId={detailProductId}
        productNama={rawProducts.find((p) => p.id === detailProductId)?.namaItem ?? null}
        baseSatuan={rawProducts.find((p) => p.id === detailProductId)?.satuan ?? ''}
        onOpenChange={(open) => !open && setDetailProductId(null)}
        onChanged={() => loadPage(currentPage)}
      />

      {ConfirmDialog}
    </AppShell>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `cd desktop-node && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `cd desktop-node && npx vitest run`
Expected: PASS — no regressions.

- [ ] **Step 5: Rebuild for Electron and launch the app**

```bash
cd desktop-node
npm run rebuild:electron
npm run dev -- --remote-debugging-port=9222
```

(Run in background. Confirm via log output: `DevTools listening on ws://127.0.0.1:9222/...`.)

- [ ] **Step 6: Manual end-to-end verification via CDP**

Log in as `admin`/`password`. Navigate to `/inventory`. Using the established CDP pattern (query `http://127.0.0.1:9222/json`, `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`, and at least one `Page.captureScreenshot` for real visual confirmation, not just `innerText`):

1. Confirm the new "Satuan/Harga Bertingkat" column renders with "0 unit"/"0 tingkat" badges (outline variant, since a fresh product has neither) for a product with no units/tiers yet.
2. Click the badges — confirm the dialog opens with the product's name in the title, an empty-state "Level 2 belum diisi." row, a disabled "Level 3: isi Level 2 dulu." note, an empty-state "Belum ada harga bertingkat." message, and "Belum ada perubahan harga." for history.
3. Click "Tambah" on Level 2, fill in Satuan="Renteng", jumlah=12, harga=15000, submit. Confirm it saves (form closes, row shows "1 Renteng = 12 {satuan dasar}" with a price badge), and the Level 3 slot's disabled note is gone (replaced by its own "Tambah" button).
4. Add Level 3: Satuan="Dus", jumlah=10, harga=140000. Confirm it saves and shows "1 Dus = 10 Renteng".
5. Close the dialog. Confirm the grid's badges for that product now read "2 unit" (secondary/filled variant).
6. Reopen the dialog, edit Level 2's jumlah from 12 to 24, save. Confirm it saves without error (this is the cascade-recompute path — verify indirectly: no error surfaces, and Level 3 still displays "1 Dus = 10 Renteng" unchanged, since jumlahKemasan display is relative, not the recomputed absolute konversi).
7. Delete Level 2 (confirm dialog should mention it will also delete Level 3, since Level 3 exists) — confirm it, then confirm BOTH Level 2 and Level 3 slots return to their empty/disabled states, and the grid's badge reverts to "0 unit".
8. Add a price tier: minQty=6, harga=63000. Confirm it appears in the list as "Beli 6+ {satuan}" with the price badge. Add a second tier with minQty=6 again — confirm the friendly error "Harga bertingkat untuk qty 6 sudah ada." appears instead of a raw error.
9. Delete the price tier — confirm it disappears and the grid badge reverts to "0 tingkat".
10. Edit the product's Harga Pokok/Harga Jual from the main grid (not this dialog) to trigger a price-history row, then reopen this product's detail dialog — confirm the "Riwayat Perubahan Harga" section now shows that change with old→new prices and a timestamp.
11. Try submitting the Level 2 add-form with an empty "= jumlah" field — confirm a client-side "Jumlah kemasan wajib diisi." error appears WITHOUT any network round trip (this is the empty-string-validation requirement from Global Constraints — verify by confirming no IPC call fires, e.g. via not seeing a loading state or via checking the value doesn't get saved as some default).
12. If a real bug is found, fix it and re-verify the affected step before proceeding — do not defer known bugs.

- [ ] **Step 7: Switch back to plain-Node ABI**

```bash
cd desktop-node
npm run rebuild:node
```

- [ ] **Step 8: Commit**

```bash
cd desktop-node
git add src/renderer/pages/inventory/ProductDetailDialog.tsx src/renderer/pages/Inventory.tsx
git status --short
```

Verify the output shows ONLY those two files.

```bash
git commit -m "Add Satuan Turunan and Harga Bertingkat dialog to the product grid"
```

---

## Plan Self-Review

**Spec coverage:** Schema change (§1) → Task 1 Steps 1-2. Satuan Turunan business logic (§1: `setProductUnit`, `deleteProductUnit`, `getProductUnits`, including the level-3-requires-level-2 rule and cascade delete/recompute) → Task 1. Harga Bertingkat + Price History (§3: `addPriceTier`, `deletePriceTier`, `listPriceTiers`, `listPriceHistory`, friendly duplicate message) → Task 2. `getProductDetail` combined fetch → Task 2. `listProducts`/`searchProductsQuick` count augmentation (§3) → Task 2. IPC (§4, auth guards, money conversion) → Task 3. Renderer (§5: badge column, fixed-slot Level 2/3 UI, cascade-aware confirm wording, tier manager, history list, client-side empty-price validation) → Task 4. Out-of-scope items (Mass Input, Pembelian tiers, Kasir changes) — untouched by every task, confirmed Kasir needs zero changes via direct code read before this plan was written.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code, including the exact migration SQL (verified in advance via a live `drizzle-kit generate` run, not guessed).

**Type consistency:** `ProductUnitRow`/`SetProductUnitInput` (Task 1) match Task 2's `getProductDetail` return shape, Task 3's `toUnitDto`/IPC handler signatures, and Task 4's `UnitRow` interface field-for-field (`id`, `level`, `satuan`, `jumlahKemasan`, `konversi`, `hargaJual`). `PriceTierRow`/`AddPriceTierInput`/`PriceHistoryRow`/`ProductDetail` (Task 2) match Task 3's IPC DTOs and Task 4's `PriceTierRow`/`PriceHistoryRow`/`ProductDetail` interfaces. `window.api.inventory.getProductDetail`/`setProductUnit`/`deleteProductUnit`/`addPriceTier`/`deletePriceTier` signatures are identical across preload, env.d.ts (Task 3), and every call site in `ProductDetailDialog.tsx` (Task 4). `ProductListItem`'s new `unitsCount`/`priceTiersCount` fields are threaded consistently through `main/inventory.ts` (Task 2) → IPC DTO (Task 3) → `env.d.ts` (Task 3) → `ProductRow` (Task 4).
