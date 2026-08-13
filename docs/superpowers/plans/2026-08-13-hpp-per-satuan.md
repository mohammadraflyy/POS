# HPP per Satuan + Laba per Satuan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `product_units` row its own cost, driven by the unit a purchase was actually made in, so gross profit reflects what the sold unit really cost — and surface that per unit in the Rekap report and the product detail UI.

**Architecture:** One new column (`product_units.harga_pokok`, cents per one of that unit) plus one meaning change (`sale_items.harga_pokok` becomes cost per transacted unit, backfilled so no historical figure moves). Purchases propagate cost downward: buying in DUS re-averages DUS, PAK, and PCS; buying in PCS re-averages only PCS. One generalised helper `hitungHargaPokokSatuan` does the arithmetic for every unit; the existing `hitungHargaPokokRataRata` becomes a thin `konversi = 1` wrapper so its callers and tests are untouched.

**Tech Stack:** Electron + React 19 + Vite (`electron-vite`), Drizzle ORM over `better-sqlite3`, drizzle-kit migrations, Vitest, shadcn/ui + react-data-grid.

**Spec:** `docs/superpowers/specs/2026-08-13-hpp-per-satuan-design.md`

## Global Constraints

- Working directory for every command is `C:\Work\POS\desktop-node`. Work directly in the main checkout on `main` — no worktree.
- **better-sqlite3 ABI dance.** Vitest runs in Node, Electron runs its own ABI. Run `npm run rebuild:node` **before** the first `npm test` of a session, and `npm run rebuild:electron` **after** you are done testing and before anyone runs `npm run dev`. Skipping either produces a native-module load error, not a useful message.
- Money is stored in **integer cents** in every table. `toCents`/`toRupiah` conversion happens only at the IPC boundary (`src/main/ipc/*.ts`). Never convert inside `src/main/*.ts` business logic.
- The IPC surface is hand-mirrored across three files and nothing type-checks the mirror: `src/main/ipc/<x>.ts` (handler) → `src/preload/index.ts` (bridge) → `src/renderer/env.d.ts` (types). Always add a field on the **handler** side first, then the bridge, then the types — a field declared only in `env.d.ts` compiles fine and arrives `undefined` at runtime.
- `tsconfig.json` has `include: ["src"]` and `noUnusedLocals`, so a single `npx tsc --noEmit -p tsconfig.json` checks main + preload + renderer together. An unused import is a build failure.
- Migrations: `npm run db:generate` emits DDL only. Any data backfill is **hand-appended** to the generated `.sql` file, separated by `--> statement-breakpoint`, following `drizzle/0011_previous_shiva.sql`.
- Existing behaviour that must not change: `products.harga_pokok` stays the authoritative base-unit cost for stock valuation, the product form, and bulk import. The base `product_units` row always holds the same number as `products.harga_pokok` (it is the `conversion_factor = 1` case).

## File Structure

**Created:**
- `desktop-node/drizzle/0012_<generated-name>.sql` — add `product_units.harga_pokok`, backfill it and `sale_items.harga_pokok`.
- `desktop-node/drizzle/meta/0012_snapshot.json` — generated, do not hand-edit.

**Modified:**
- `src/main/db/schema.ts` — new column, new doc comment on `saleItems.hargaPokok`.
- `src/main/purchase.ts` — `hitungHargaPokokSatuan`, downward propagation in `recordPurchase`.
- `src/main/inventory-units.ts` — `syncUnitCostsFromBase`, cost seeding in `addProductUnit` / `updateProductUnit` / `syncBaseProductUnit`, `hargaPokok` on `ProductUnitRow`.
- `src/main/inventory.ts` — reset unit costs after a manual `hargaPokok` edit.
- `src/main/inventory-bulk.ts` — same reset on the Excel import path.
- `src/main/kasir.ts` — sale lines snapshot the transacted unit's cost.
- `src/main/rekap.ts` — profit formula, `labaPerSatuan`, Excel sheet.
- `src/main/ipc/rekap.ts`, `src/main/ipc/inventory.ts` — DTOs.
- `src/preload/index.ts`, `src/renderer/env.d.ts` — the mirror.
- `src/renderer/pages/Rekap.tsx` — Laba per Satuan table.
- `src/renderer/pages/inventory/ProductDetailDialog.tsx` — cost, margin, loss warnings.

**Tests modified:** `src/main/db/migrate.test.ts`, `src/main/purchase.test.ts`, `src/main/inventory-units.test.ts`, `src/main/inventory.test.ts`, `src/main/kasir.test.ts`, `src/main/rekap.test.ts`.

---

### Task 1: Schema column and migration

**Files:**
- Modify: `desktop-node/src/main/db/schema.ts:47-60` (`productUnits`), `desktop-node/src/main/db/schema.ts:131-147` (`saleItems`)
- Create: `desktop-node/drizzle/0012_<generated>.sql` (name comes from drizzle-kit)
- Test: `desktop-node/src/main/db/migrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `productUnits.hargaPokok` (Drizzle column, integer cents per one of that unit) and the redefined meaning of `saleItems.hargaPokok` (cents per one transacted unit). Every later task depends on both.

- [ ] **Step 1: Add the column to the schema**

In `src/main/db/schema.ts`, inside `productUnits`, directly after the `hargaJual` line:

```typescript
  hargaJual: integer('harga_jual').notNull(),
  /**
   * Cost of ONE of this unit, in cents - 500.000 for a DUS, 5.000 for a PCS.
   * Moved by purchases in this unit or any larger one (see hitungHargaPokokSatuan);
   * the base row always mirrors products.hargaPokok.
   */
  hargaPokok: integer('harga_pokok').notNull().default(0),
```

In the same file, replace the `saleItems.hargaPokok` line with a documented one:

```typescript
  /** cost of ONE of the unit that was sold, snapshotted at checkout - not the base-unit cost */
  hargaPokok: integer('harga_pokok').notNull(),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0012_*.sql` containing only `ALTER TABLE \`product_units\` ADD \`harga_pokok\` integer DEFAULT 0 NOT NULL;`, plus `drizzle/meta/0012_snapshot.json` and a new `_journal.json` entry.

- [ ] **Step 3: Hand-append the two backfills**

Append to the generated `drizzle/0012_*.sql` (keep the generated ALTER as the first statement):

```sql
--> statement-breakpoint
-- day one every unit costs exactly base cost x conversion, which is what the app
-- computed implicitly before this column existed - no historical figure moves
UPDATE `product_units`
SET `harga_pokok` = (SELECT `harga_pokok` FROM `products` WHERE `products`.`id` = `product_units`.`product_id`) * `conversion_factor`;--> statement-breakpoint
-- harga_pokok changes meaning here: it used to be the cost of one BASE unit and was
-- multiplied by konversi at read time in rekap.ts. Baking that multiplication in keeps
-- every past sale's profit identical while letting new rows carry a real per-unit cost.
UPDATE `sale_items` SET `harga_pokok` = `harga_pokok` * `konversi`;
```

- [ ] **Step 4: Write the failing migration test**

Append inside the `describe('createDb', ...)` block in `src/main/db/migrate.test.ts`, replacing `0012_<generated>` with the real tag:

```typescript
  it('backfills product_units.harga_pokok from base cost x conversion and bakes konversi into sale_items.harga_pokok', () => {
    const { partialFolder, dbFile, cleanup } = partialMigrationsBefore('0012_<generated>')

    const partialDb = createDb(dbFile, partialFolder)
    partialDb.run(sql`INSERT INTO products (id, kode_item, nama_item, harga_pokok, harga_jual, stok, is_active, created_at, updated_at)
      VALUES (1, 'P1', 'Kopi ABC', 500000, 700000, 300, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (1, 'PCS', 'Pieces', 'pcs', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO units (id, code, name, symbol, is_active, created_at, updated_at)
      VALUES (2, 'DUS', 'Dus', 'dus', 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (10, 1, 1, 1, 1, 700000, 1, 1, 1, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, is_base_unit, is_default_sales_unit, is_default_purchase_unit, created_at, updated_at)
      VALUES (11, 1, 2, 100, 100, 68000000, 0, 0, 0, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sales (id, metode_pembayaran, status, total, dibayar, created_at, updated_at)
      VALUES (1, 'tunai', 'selesai', 68700000, 68700000, unixepoch(), unixepoch())`)
    // one base-unit line (konversi 1) and one DUS line (konversi 100)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, product_unit_id, qty, konversi, base_quantity, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (1, 1, 1, 10, 1, 1, 1, 'PCS', 700000, 500000, 700000, unixepoch(), unixepoch())`)
    partialDb.run(sql`INSERT INTO sale_items (id, sale_id, product_id, product_unit_id, qty, konversi, base_quantity, satuan, harga_jual, harga_pokok, subtotal, created_at, updated_at)
      VALUES (2, 1, 1, 11, 1, 100, 100, 'DUS', 68000000, 500000, 68000000, unixepoch(), unixepoch())`)
    partialDb.$client.close()

    const fullDb = createDb(dbFile, migrationsFolder)
    const unitCosts = fullDb.all<{ id: number; harga_pokok: number }>(
      sql`SELECT id, harga_pokok FROM product_units ORDER BY id`,
    )
    const saleCosts = fullDb.all<{ id: number; harga_pokok: number }>(
      sql`SELECT id, harga_pokok FROM sale_items ORDER BY id`,
    )
    fullDb.$client.close()
    cleanup()

    expect(unitCosts).toEqual([
      { id: 10, harga_pokok: 500000 },
      { id: 11, harga_pokok: 50000000 },
    ])
    // profit is unchanged: it used to be subtotal - qty * konversi * harga_pokok,
    // and is now subtotal - qty * harga_pokok against these baked-in values
    expect(saleCosts).toEqual([
      { id: 1, harga_pokok: 500000 },
      { id: 2, harga_pokok: 50000000 },
    ])
  })
```

- [ ] **Step 5: Run the test**

Run: `npm run rebuild:node && npx vitest run src/main/db/migrate.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/schema.ts drizzle/ src/main/db/migrate.test.ts
git commit -m "feat(db): per-unit cost column and per-unit sale cost snapshot"
```

---

### Task 2: `hitungHargaPokokSatuan`

**Files:**
- Modify: `desktop-node/src/main/purchase.ts:16-37`
- Test: `desktop-node/src/main/purchase.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hitungHargaPokokSatuan(stokDasarLama: number, hargaPokokSatuanLama: number, konversi: number, qtyDasarMasuk: number, nilaiBeli: number): number`, exported from `src/main/purchase.ts`. `hitungHargaPokokRataRata(stokLama, hargaPokokLama, qtyDasar, nilaiBeli)` keeps its exact current signature and return value.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/purchase.test.ts` (put them in the existing `describe('hitungHargaPokokRataRata', ...)` block if there is one, otherwise a new `describe`):

```typescript
describe('hitungHargaPokokSatuan', () => {
  it('reproduces hitungHargaPokokRataRata exactly when konversi is 1', () => {
    expect(hitungHargaPokokSatuan(100, 5000, 1, 200, 1000000)).toBe(hitungHargaPokokRataRata(100, 5000, 200, 1000000))
  })

  it('scales the average by konversi so a DUS costs 100x what a PCS costs on the same purchase', () => {
    // empty stock, receiving 200 base units for 1.000.000
    expect(hitungHargaPokokSatuan(0, 0, 1, 200, 1000000)).toBe(5000)
    expect(hitungHargaPokokSatuan(0, 0, 10, 200, 1000000)).toBe(50000)
    expect(hitungHargaPokokSatuan(0, 0, 100, 200, 1000000)).toBe(500000)
  })

  it('weights the existing stock at the unit-scaled old cost', () => {
    // 200 base units already on hand at 5.000/pcs, receiving 20 more for 120.000
    expect(hitungHargaPokokSatuan(200, 5000, 1, 20, 120000)).toBe(5091)
  })

  it('keeps the old cost when there is nothing to average against', () => {
    expect(hitungHargaPokokSatuan(0, 7000, 10, 0, 0)).toBe(7000)
  })

  it('ignores negative stock as an averaging basis', () => {
    // a manual adjustment can drive stock negative; that carries no inventory value
    expect(hitungHargaPokokSatuan(-50, 9000, 1, 100, 400000)).toBe(4000)
  })
})
```

Add `hitungHargaPokokSatuan` to the existing import from `./purchase` at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/purchase.test.ts`
Expected: FAIL — `hitungHargaPokokSatuan is not a function` / TypeScript cannot find the export.

- [ ] **Step 3: Implement**

Replace the whole `hitungHargaPokokRataRata` block at `src/main/purchase.ts:16-37` with:

```typescript
/**
 * Weighted-average cost of one `konversi`-sized unit after receiving `qtyDasarMasuk`
 * base units for `nilaiBeli` rupiah. The stock basis stays in base units for every
 * unit, so no fractional stock is ever materialised: averaging in unit V wants
 * `(stokDasar/K * lama + nilaiBeli) / (stokDasar/K + qtyDasar/K)`, and multiplying
 * through by K clears both divisions into the integer form below.
 */
export function hitungHargaPokokSatuan(
  stokDasarLama: number,
  hargaPokokSatuanLama: number,
  konversi: number,
  qtyDasarMasuk: number,
  nilaiBeli: number,
): number {
  // negative stock (possible after a manual adjustment) carries no value to average against
  const basisStok = Math.max(0, stokDasarLama)
  const totalQty = basisStok + qtyDasarMasuk

  if (totalQty <= 0) {
    return hargaPokokSatuanLama
  }

  return Math.round((basisStok * hargaPokokSatuanLama + nilaiBeli * konversi) / totalQty)
}

/** the base-unit case of {@link hitungHargaPokokSatuan}, kept for products.hargaPokok */
export function hitungHargaPokokRataRata(
  stokLama: number,
  hargaPokokLama: number,
  qtyDasar: number,
  nilaiBeli: number,
): number {
  return hitungHargaPokokSatuan(stokLama, hargaPokokLama, 1, qtyDasar, nilaiBeli)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/purchase.test.ts`
Expected: PASS, including every pre-existing `hitungHargaPokokRataRata` test.

- [ ] **Step 5: Commit**

```bash
git add src/main/purchase.ts src/main/purchase.test.ts
git commit -m "feat(purchase): generalise moving average to any unit size"
```

---

### Task 3: Purchases propagate cost downward

**Files:**
- Modify: `desktop-node/src/main/purchase.ts:97-108` (unit query), `desktop-node/src/main/purchase.ts:161-231` (transaction loop)
- Test: `desktop-node/src/main/purchase.test.ts`

**Interfaces:**
- Consumes: `hitungHargaPokokSatuan` from Task 2; `productUnits.hargaPokok` from Task 1.
- Produces: after `recordPurchase`, every `product_units` row of the purchased product whose `conversion_factor <=` the purchased unit's holds a refreshed cost. `products.hargaPokok` keeps its current behaviour. No signature changes.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/purchase.test.ts`. Follow the file's existing seeding helpers; if it has none, seed inline exactly like this:

```typescript
describe('recordPurchase per-unit cost', () => {
  function seedKopi(db: ReturnType<typeof createTestDb>) {
    const now = new Date()
    const pcs = db.insert(units).values({ code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true, createdAt: now, updatedAt: now }).returning().get()
    const pak = db.insert(units).values({ code: 'PAK', name: 'Pak', symbol: 'pak', isActive: true, createdAt: now, updatedAt: now }).returning().get()
    const dus = db.insert(units).values({ code: 'DUS', name: 'Dus', symbol: 'dus', isActive: true, createdAt: now, updatedAt: now }).returning().get()
    const product = db.insert(products).values({ kodeItem: 'K1', namaItem: 'Kopi ABC', hargaPokok: 0, hargaJual: 700000, stok: 0, createdAt: now, updatedAt: now }).returning().get()
    const baseUnit = db.insert(productUnits).values({ productId: product.id, unitId: pcs.id, jumlahKemasan: 1, conversionFactor: 1, hargaJual: 700000, hargaPokok: 0, isBaseUnit: true, createdAt: now, updatedAt: now }).returning().get()
    const pakUnit = db.insert(productUnits).values({ productId: product.id, unitId: pak.id, jumlahKemasan: 10, conversionFactor: 10, hargaJual: 6800000, hargaPokok: 0, isBaseUnit: false, createdAt: now, updatedAt: now }).returning().get()
    const dusUnit = db.insert(productUnits).values({ productId: product.id, unitId: dus.id, jumlahKemasan: 10, conversionFactor: 100, hargaJual: 68000000, hargaPokok: 0, isBaseUnit: false, createdAt: now, updatedAt: now }).returning().get()
    return { product, baseUnit, pakUnit, dusUnit }
  }

  function costs(db: ReturnType<typeof createTestDb>, productId: number) {
    return Object.fromEntries(
      db.select().from(productUnits).where(eq(productUnits.productId, productId)).all().map((u) => [u.conversionFactor, u.hargaPokok]),
    )
  }

  it('moves the cost of the purchased unit and every smaller one', () => {
    const db = createTestDb()
    const { product, dusUnit } = seedKopi(db)

    // 2 DUS at 500.000 each = 1.000.000 for 200 base units
    recordPurchase(db, {
      supplierId: null,
      tanggal: '2026-08-13',
      catatan: null,
      userId: null,
      items: [{ productId: product.id, productUnitId: dusUnit.id, qty: 2, hargaBeli: 500000 }],
    })

    expect(costs(db, product.id)).toEqual({ 1: 5000, 10: 50000, 100: 500000 })
    expect(db.select().from(products).where(eq(products.id, product.id)).get()?.hargaPokok).toBe(5000)
  })

  it('leaves larger units alone when buying in the base unit', () => {
    const db = createTestDb()
    const { product, baseUnit, dusUnit } = seedKopi(db)

    recordPurchase(db, {
      supplierId: null, tanggal: '2026-08-13', catatan: null, userId: null,
      items: [{ productId: product.id, productUnitId: dusUnit.id, qty: 2, hargaBeli: 500000 }],
    })
    // then 20 PCS at 6.000 each
    recordPurchase(db, {
      supplierId: null, tanggal: '2026-08-13', catatan: null, userId: null,
      items: [{ productId: product.id, productUnitId: baseUnit.id, qty: 20, hargaBeli: 6000 }],
    })

    // (200 * 5000 + 120000 * 1) / 220 = 5090.9 -> 5091; PAK and DUS untouched
    expect(costs(db, product.id)).toEqual({ 1: 5091, 10: 50000, 100: 500000 })
  })

  it('compounds two lines for the same product within one purchase', () => {
    const db = createTestDb()
    const { product, baseUnit, dusUnit } = seedKopi(db)

    recordPurchase(db, {
      supplierId: null, tanggal: '2026-08-13', catatan: null, userId: null,
      items: [
        { productId: product.id, productUnitId: dusUnit.id, qty: 2, hargaBeli: 500000 },
        { productId: product.id, productUnitId: baseUnit.id, qty: 20, hargaBeli: 6000 },
      ],
    })

    expect(costs(db, product.id)).toEqual({ 1: 5091, 10: 50000, 100: 500000 })
  })

  it('treats a null productUnitId as the base unit', () => {
    const db = createTestDb()
    const { product } = seedKopi(db)

    recordPurchase(db, {
      supplierId: null, tanggal: '2026-08-13', catatan: null, userId: null,
      items: [{ productId: product.id, productUnitId: null, qty: 100, hargaBeli: 4000 }],
    })

    expect(costs(db, product.id)).toEqual({ 1: 4000, 10: 0, 100: 0 })
  })
})
```

Make sure `units`, `products`, `productUnits`, `eq`, and the file's own test-db factory are imported at the top of the file — copy whatever the existing tests in this file already use rather than inventing a new helper name.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/purchase.test.ts -t 'per-unit cost'`
Expected: FAIL — the derived units' `harga_pokok` stays `0`.

- [ ] **Step 3: Add `hargaPokok` to the unit query**

In `src/main/purchase.ts:97-108`, add one field to the select:

```typescript
  const unitRows = db
    .select({
      id: productUnits.id,
      productId: productUnits.productId,
      satuan: units.code,
      konversi: productUnits.conversionFactor,
      hargaPokok: productUnits.hargaPokok,
      isBaseUnit: productUnits.isBaseUnit,
    })
```

- [ ] **Step 4: Seed the running per-unit cost map**

In `src/main/purchase.ts`, next to the existing `hargaPokokBerjalan` line (currently line 167), add:

```typescript
    const hargaPokokBerjalan = new Map(productRows.map((p) => [p.id, p.hargaPokok]))
    // same compounding as above, but keyed by product_units.id: a purchase with two
    // lines for one product must average the second line against the first line's result
    const hargaPokokUnitBerjalan = new Map(unitRows.map((u) => [u.id, u.hargaPokok]))
```

- [ ] **Step 5: Propagate inside the item loop**

In `src/main/purchase.ts`, immediately after the existing `tx.update(products).set({ stok: ..., hargaPokok: hargaPokokBaru, ... })` call (currently lines 195-198), insert:

```typescript
      // Cost travels down the chain, never up: the stock physically arrived inside the
      // purchased packaging, so every smaller unit's cost follows this purchase. Buying
      // loose pieces says nothing about what a dus costs, so larger units are left alone.
      for (const unitRow of unitRows) {
        if (unitRow.productId !== item.productId || unitRow.konversi > item.konversi) {
          continue
        }

        const hargaPokokUnitLama = hargaPokokUnitBerjalan.get(unitRow.id) ?? 0
        const hargaPokokUnitBaru = hitungHargaPokokSatuan(
          stokLama,
          hargaPokokUnitLama,
          unitRow.konversi,
          qtyDasar,
          item.subtotal,
        )

        hargaPokokUnitBerjalan.set(unitRow.id, hargaPokokUnitBaru)
        tx.update(productUnits).set({ hargaPokok: hargaPokokUnitBaru, updatedAt: now }).where(eq(productUnits.id, unitRow.id)).run()
      }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/purchase.test.ts`
Expected: PASS, including every pre-existing purchase test.

- [ ] **Step 7: Commit**

```bash
git add src/main/purchase.ts src/main/purchase.test.ts
git commit -m "feat(purchase): drive per-unit cost from the purchased unit downward"
```

---

### Task 4: Unit cost outside purchases

**Files:**
- Modify: `desktop-node/src/main/inventory-units.ts:1-19` (imports + `ProductUnitRow`), `:21-39` (`unitRowSelect`), `:71-104` (`syncBaseProductUnit`), `:121-153` (`addProductUnit`), `:182-205` (`updateProductUnit` chain loop)
- Modify: `desktop-node/src/main/inventory.ts:196-212`
- Modify: `desktop-node/src/main/inventory-bulk.ts:233-246` and `:280-301`
- Test: `desktop-node/src/main/inventory-units.test.ts`, `desktop-node/src/main/inventory.test.ts`

**Interfaces:**
- Consumes: `productUnits.hargaPokok` from Task 1.
- Produces: `syncUnitCostsFromBase(db: BetterSQLite3Database<typeof schema>, productId: number, hargaPokokBase: number): void`, exported from `src/main/inventory-units.ts`. `ProductUnitRow` gains `hargaPokok: number` — Task 7 reads it for the IPC DTO.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/inventory-units.test.ts`:

```typescript
describe('per-unit cost outside purchases', () => {
  it('seeds a newly added unit from the base cost times its conversion', () => {
    const db = createTestDb()
    const { productId } = seedProductWithBaseUnit(db, { hargaPokok: 5000 })
    const pak = createUnit(db, 'PAK')

    addProductUnit(db, productId, { unitId: pak.id, jumlahKemasan: 10, hargaJual: 6800000 })

    const pakRow = listProductUnits(db, productId).find((u) => u.unitCode === 'PAK')
    expect(pakRow?.hargaPokok).toBe(50000)
  })

  it('re-derives cost for every unit whose conversion is recomputed', () => {
    const db = createTestDb()
    const { productId } = seedProductWithBaseUnit(db, { hargaPokok: 5000 })
    const pak = createUnit(db, 'PAK')
    const dus = createUnit(db, 'DUS')
    addProductUnit(db, productId, { unitId: pak.id, jumlahKemasan: 10, hargaJual: 6800000 })
    addProductUnit(db, productId, { unitId: dus.id, jumlahKemasan: 10, hargaJual: 68000000 })

    const pakRow = listProductUnits(db, productId).find((u) => u.unitCode === 'PAK')!
    // PAK grows from 10 to 20 base units, so DUS grows from 100 to 200 - both costs follow
    updateProductUnit(db, productId, pakRow.id, { unitId: pak.id, jumlahKemasan: 20, hargaJual: 6800000 })

    const after = listProductUnits(db, productId)
    expect(after.find((u) => u.unitCode === 'PAK')?.hargaPokok).toBe(100000)
    expect(after.find((u) => u.unitCode === 'DUS')?.hargaPokok).toBe(1000000)
  })

  it('resets every unit cost when the product cost is edited by hand', () => {
    const db = createTestDb()
    const { productId } = seedProductWithBaseUnit(db, { hargaPokok: 5000 })
    const pak = createUnit(db, 'PAK')
    addProductUnit(db, productId, { unitId: pak.id, jumlahKemasan: 10, hargaJual: 6800000 })

    syncUnitCostsFromBase(db, productId, 6000)

    const after = listProductUnits(db, productId)
    expect(after.find((u) => u.isBaseUnit)?.hargaPokok).toBe(6000)
    expect(after.find((u) => u.unitCode === 'PAK')?.hargaPokok).toBe(60000)
  })
})
```

Reuse this file's existing seeding helpers. If `seedProductWithBaseUnit` or `createUnit` do not exist under those names, use whatever the file already defines and adjust the calls — do not add a second set of helpers.

Append to `src/main/inventory.test.ts`:

```typescript
it('resets derived unit costs when updateProduct changes harga pokok', () => {
  const db = createTestDb()
  const { productId } = seedProductWithBaseUnit(db, { hargaPokok: 5000, satuan: 'PCS' })
  const pak = createUnit(db, 'PAK')
  addProductUnit(db, productId, { unitId: pak.id, jumlahKemasan: 10, hargaJual: 6800000 })

  updateProduct(db, productId, {
    kodeItem: 'K1',
    barcode: null,
    namaItem: 'Kopi ABC',
    kategori: null,
    satuan: 'PCS',
    hargaPokok: 6000,
    hargaJual: 700000,
    isActive: true,
  })

  const after = listProductUnits(db, productId)
  expect(after.find((u) => u.isBaseUnit)?.hargaPokok).toBe(6000)
  expect(after.find((u) => u.unitCode === 'PAK')?.hargaPokok).toBe(60000)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/inventory-units.test.ts src/main/inventory.test.ts`
Expected: FAIL — `syncUnitCostsFromBase` is not exported, and the seeded costs stay `0`.

- [ ] **Step 3: Expose cost on `ProductUnitRow` and add the helper**

In `src/main/inventory-units.ts`, change the import on line 1 to include `sql`:

```typescript
import { and, eq, inArray, desc, sql } from 'drizzle-orm'
```

Add `hargaPokok: number` to the `ProductUnitRow` interface (after `hargaJual`), and `hargaPokok: productUnits.hargaPokok,` to the select inside `unitRowSelect` (after the `hargaJual` line).

Add this exported function directly below `getBaseUnitCode`:

```typescript
/**
 * Re-derives every unit's cost from the product's base cost. A human typing a new harga
 * pokok - in the product form or an Excel import - is stating the truth for the whole
 * product, so per-unit costs left over from earlier purchases must not survive it.
 */
export function syncUnitCostsFromBase(
  db: BetterSQLite3Database<typeof schema>,
  productId: number,
  hargaPokokBase: number,
): void {
  db.update(productUnits)
    .set({ hargaPokok: sql`${hargaPokokBase} * ${productUnits.conversionFactor}`, updatedAt: new Date() })
    .where(eq(productUnits.productId, productId))
    .run()
}
```

- [ ] **Step 4: Seed cost when a unit is created or resized**

In `syncBaseProductUnit`, the insert branch that heals a missing base row must carry a cost. Read it from the product and add the field:

```typescript
  // pre-migration data, or a product created before base rows existed - heal it
  const product = db.select({ hargaPokok: products.hargaPokok }).from(products).where(eq(products.id, productId)).get()

  db.insert(productUnits)
    .values({
      productId,
      unitId,
      jumlahKemasan: 1,
      conversionFactor: 1,
      hargaJual,
      hargaPokok: product?.hargaPokok ?? 0,
      isBaseUnit: true,
      createdAt: now,
      updatedAt: now,
    })
    .run()
```

In `addProductUnit`, after `const conversionFactor = input.jumlahKemasan * prevConversion`, read the base cost and store the scaled value:

```typescript
  const conversionFactor = input.jumlahKemasan * prevConversion
  const product = db.select({ hargaPokok: products.hargaPokok }).from(products).where(eq(products.id, productId)).get()
  const now = new Date()

  db.insert(productUnits)
    .values({
      productId,
      unitId: input.unitId,
      jumlahKemasan: input.jumlahKemasan,
      conversionFactor,
      hargaJual: input.hargaJual,
      // a brand new unit has no purchase history of its own, so it starts at the
      // product's base cost scaled to its size
      hargaPokok: (product?.hargaPokok ?? 0) * conversionFactor,
      isBaseUnit: false,
      isDefaultSalesUnit: false,
      isDefaultPurchaseUnit: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
```

In `updateProductUnit`, the chain-recompute loop rewrites `conversionFactor` for the edited row and every row above it. A unit whose size changed no longer has a meaningful cost at its old size, so re-derive it. Read the base cost once before the loop and add the field to the `set`:

```typescript
  const product = db.select({ hargaPokok: products.hargaPokok }).from(products).where(eq(products.id, productId)).get()
  const hargaPokokBase = product?.hargaPokok ?? 0
  let prevConversion = derivedIdx === 0 ? 1 : derivedChain[derivedIdx - 1].conversionFactor

  for (let i = derivedIdx; i < derivedChain.length; i++) {
    const jumlahKemasan = i === derivedIdx ? input.jumlahKemasan : derivedChain[i].jumlahKemasan
    const unitId = i === derivedIdx ? input.unitId : derivedChain[i].unitId
    const hargaJual = i === derivedIdx ? input.hargaJual : derivedChain[i].hargaJual
    const conversionFactor = jumlahKemasan * prevConversion

    db.update(productUnits)
      // the unit changed size, so its old per-unit cost describes a package that no
      // longer exists - re-derive from the base cost instead of scaling the stale value
      .set({ unitId, jumlahKemasan, conversionFactor, hargaJual, hargaPokok: hargaPokokBase * conversionFactor, updatedAt: now })
      .where(eq(productUnits.id, derivedChain[i].id))
      .run()

    prevConversion = conversionFactor
  }
```

- [ ] **Step 5: Call the reset from both manual-edit paths**

In `src/main/inventory.ts`, directly after the existing `syncBaseProductUnit(db, id, input.satuan, input.hargaJual)` call (currently line 212):

```typescript
  syncBaseProductUnit(db, id, input.satuan, input.hargaJual)
  // a hand-typed harga pokok overrides whatever the purchase history had averaged out
  syncUnitCostsFromBase(db, id, input.hargaPokok)
```

Add `syncUnitCostsFromBase` to the existing import from `./inventory-units` at the top of the file.

In `src/main/inventory-bulk.ts`, after each of the two `syncBaseProductUnit(...)` calls (the update branch at line 246 and the create branch at line 300):

```typescript
      syncBaseProductUnit(db, row.id, row.satuan, row.hargaJual)
      syncUnitCostsFromBase(db, row.id, row.hargaPokok)
```

```typescript
      syncBaseProductUnit(db, createdProduct.id, row.satuan, row.hargaJual)
      syncUnitCostsFromBase(db, createdProduct.id, row.hargaPokok)
```

Add `syncUnitCostsFromBase` to the existing import from `./inventory-units`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/main/inventory-units.test.ts src/main/inventory.test.ts src/main/inventory-bulk.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/inventory-units.ts src/main/inventory.ts src/main/inventory-bulk.ts src/main/inventory-units.test.ts src/main/inventory.test.ts
git commit -m "feat(inventory): seed and reset per-unit cost outside purchases"
```

---

### Task 5: Sales snapshot the sold unit's cost

**Files:**
- Modify: `desktop-node/src/main/kasir.ts:36-44` (`ProductUnitRow`), `:58-86` (`resolveCartItem`), `:144-157` (unit query)
- Modify: `desktop-node/src/main/rekap.ts:100-116` (query) and `:124` (formula)
- Test: `desktop-node/src/main/kasir.test.ts`, `desktop-node/src/main/rekap.test.ts`

**Interfaces:**
- Consumes: `productUnits.hargaPokok` (Task 1), the new `sale_items.harga_pokok` meaning (Task 1).
- Produces: `sale_items.harga_pokok` rows written as cost-per-transacted-unit. Task 6 sums profit off this.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/kasir.test.ts`:

```typescript
it('snapshots the sold unit cost, not the base cost', () => {
  const db = createTestDb()
  // base PCS at 5.000, DUS of 100 at 500.000
  const { product, dusUnit } = seedKopiWithUnits(db)

  checkout(db, {
    metodePembayaran: 'tunai',
    namaPelanggan: null,
    dibayar: 56000000,
    userId: 1,
    items: [{ productId: product.id, productUnitId: dusUnit.id, qty: 1 }],
  })

  const line = db.select().from(saleItems).all()[0]
  expect(line.hargaPokok).toBe(500000)
  expect(line.konversi).toBe(100)
})
```

Seed the product so the base unit costs `5000` and the DUS unit costs `500000`; reuse this file's existing unit-seeding helper and add `hargaPokok` values to it rather than writing a new one.

Append to `src/main/rekap.test.ts`:

```typescript
it('computes profit from the sold unit cost without re-applying konversi', () => {
  const db = createTestDb()
  // one DUS sold at 560.000 against a DUS cost of 500.000
  seedSaleItem(db, { qty: 1, konversi: 100, hargaPokok: 500000, subtotal: 560000 })

  const rekap = getRekap(db, { from: '2026-08-01', to: '2026-08-31' })

  expect(rekap.summary.labaKotor).toBe(60000)
})
```

Adjust `seedSaleItem` to whatever this file already uses to insert a sale line; the point of the test is the arithmetic, not the helper name.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/kasir.test.ts src/main/rekap.test.ts`
Expected: FAIL — the sale line stores the base cost (`5000`), and the rekap profit comes out as `560000 - 1 * 100 * 500000`, a large negative number.

- [ ] **Step 3: Carry the unit cost through checkout**

In `src/main/kasir.ts`, add `hargaPokok: number` to the local `ProductUnitRow` interface (after `hargaJual`), and add `hargaPokok: productUnits.hargaPokok,` to the `unitRows` select (after the `hargaJual` line).

In `resolveCartItem`, change the snapshot to read from the unit:

```typescript
    hargaJual,
    // the cost of the unit actually being sold - a DUS line carries the DUS cost, so
    // rekap never has to multiply back up through konversi
    hargaPokok: productUnit.hargaPokok,
```

- [ ] **Step 4: Drop the konversi multiplication from the profit formula**

In `src/main/rekap.ts:124`:

```typescript
    const laba = row.subtotal - row.qty * row.hargaPokok
```

`row.konversi` now has no reader in that loop, and Task 6 does not need it either. Remove `konversi: saleItems.konversi,` from the `saleItemRows` select (currently line 108) so the query does not carry a dead field.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/main/kasir.test.ts src/main/rekap.test.ts src/main/dashboard.test.ts`
Expected: PASS. `dashboard.test.ts` reads its summary from `getRekap`, so it must stay green too — if a dashboard test seeds a sale line by hand with a base cost, update that fixture to a per-unit cost.

- [ ] **Step 6: Commit**

```bash
git add src/main/kasir.ts src/main/rekap.ts src/main/kasir.test.ts src/main/rekap.test.ts src/main/dashboard.test.ts
git commit -m "feat(kasir): compute profit from the sold unit's own cost"
```

---

### Task 6: Laba per Satuan in the rekap

**Files:**
- Modify: `desktop-node/src/main/rekap.ts:14-24` (row interfaces), `:61-69` (`RekapResult`), `:100-116` (query), `:118-152` (aggregation), `:174-187` (return), `:267-284` (workbook sheets)
- Test: `desktop-node/src/main/rekap.test.ts`

**Interfaces:**
- Consumes: the per-line profit from Task 5.
- Produces: `LabaPerSatuanRow { satuan: string; qtyTerjual: number; omzet: number; laba: number; marginPersen: number }` exported from `src/main/rekap.ts`, and `RekapResult.labaPerSatuan: LabaPerSatuanRow[]`. Task 7 maps it to the IPC DTO; Task 8 renders it.

- [ ] **Step 1: Write the failing test**

Append to `src/main/rekap.test.ts`:

```typescript
it('breaks profit down per satuan, sorted by laba descending', () => {
  const db = createTestDb()
  // 1 DUS sold at 560.000 against 500.000 cost, and 3 PCS at 7.000 against 5.000
  seedSaleItemWithUnit(db, { satuan: 'DUS', qty: 1, hargaPokok: 500000, subtotal: 560000 })
  seedSaleItemWithUnit(db, { satuan: 'PCS', qty: 3, hargaPokok: 5000, subtotal: 21000 })

  const rekap = getRekap(db, { from: '2026-08-01', to: '2026-08-31' })

  expect(rekap.labaPerSatuan).toEqual([
    { satuan: 'DUS', qtyTerjual: 1, omzet: 560000, laba: 60000, marginPersen: expect.closeTo(10.71, 2) },
    { satuan: 'PCS', qtyTerjual: 3, omzet: 21000, laba: 6000, marginPersen: expect.closeTo(28.57, 2) },
  ])
})

it('falls back to the sale_items satuan snapshot when the unit row is gone', () => {
  const db = createTestDb()
  seedSaleItemWithUnit(db, { satuan: 'SAK', qty: 1, hargaPokok: 48000, subtotal: 45000, productUnitId: null })

  const rekap = getRekap(db, { from: '2026-08-01', to: '2026-08-31' })

  expect(rekap.labaPerSatuan).toEqual([
    { satuan: 'SAK', qtyTerjual: 1, omzet: 45000, laba: -3000, marginPersen: expect.closeTo(-6.67, 2) },
  ])
})
```

`seedSaleItemWithUnit` must insert a `units` row, a `product_units` row pointing at it, and a `sale_items` row whose `product_unit_id` is that row (or `null` when the test passes `productUnitId: null`) with `satuan` set to the label. Build it on top of the seeding helpers this file already has.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/rekap.test.ts -t 'per satuan'`
Expected: FAIL — `rekap.labaPerSatuan` is `undefined`.

- [ ] **Step 3: Add the row type and result field**

In `src/main/rekap.ts`, after the `LabaPerHariRow` interface:

```typescript
export interface LabaPerSatuanRow {
  satuan: string
  qtyTerjual: number
  omzet: number
  laba: number
  /** laba as a percentage of omzet, 0 when nothing was sold in this unit */
  marginPersen: number
}
```

Add `labaPerSatuan: LabaPerSatuanRow[]` to `RekapResult`, directly after `labaPerHari`.

- [ ] **Step 4: Join the unit onto the sale-item query**

In `src/main/rekap.ts`, extend the `saleItemRows` select and joins:

```typescript
  const saleItemRows = db
    .select({
      createdAt: sales.createdAt,
      categoryName: categories.nama,
      productId: products.id,
      namaItem: products.namaItem,
      subtotal: saleItems.subtotal,
      qty: saleItems.qty,
      hargaPokok: saleItems.hargaPokok,
      // the live unit label, falling back to the snapshot for lines whose unit row was deleted
      unitCode: units.code,
      satuanSnapshot: saleItems.satuan,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(productUnits, eq(saleItems.productUnitId, productUnits.id))
    .leftJoin(units, eq(productUnits.unitId, units.id))
    .where(and(eq(sales.status, 'selesai'), gte(sales.createdAt, rangeStart), lte(sales.createdAt, rangeEnd)))
    .all()
```

`productUnits` and `units` are already imported at the top of this file.

- [ ] **Step 5: Aggregate and return**

Add the map next to the other three (after `labaPerHariMap`):

```typescript
  const labaPerSatuanMap = new Map<string, { qtyTerjual: number; omzet: number; laba: number }>()
```

Inside the `for (const row of saleItemRows)` loop, after the `labaPerHariMap.set(...)` line:

```typescript
    const satuan = row.unitCode ?? row.satuanSnapshot ?? 'Tanpa Satuan'
    const satuanEntry = labaPerSatuanMap.get(satuan) ?? { qtyTerjual: 0, omzet: 0, laba: 0 }
    satuanEntry.qtyTerjual += row.qty
    satuanEntry.omzet += row.subtotal
    satuanEntry.laba += laba
    labaPerSatuanMap.set(satuan, satuanEntry)
```

After the `labaPerHari` array is built:

```typescript
  const labaPerSatuan: LabaPerSatuanRow[] = Array.from(labaPerSatuanMap.entries())
    .map(([satuan, v]) => ({ satuan, ...v, marginPersen: v.omzet === 0 ? 0 : (v.laba / v.omzet) * 100 }))
    .sort((a, b) => b.laba - a.laba)
```

Add `labaPerSatuan,` to the returned object, after `labaPerHari,`.

- [ ] **Step 6: Add the Excel sheet**

In `buildRekapWorkbook`, after the `'Laba per Hari'` sheet object:

```typescript
    {
      name: 'Laba per Satuan',
      headers: ['Satuan', 'Qty Terjual', 'Omzet', 'Laba', 'Margin %'],
      rows: rekap.labaPerSatuan.map((row) => ({
        Satuan: row.satuan,
        'Qty Terjual': row.qtyTerjual,
        Omzet: toRupiahExport(row.omzet),
        Laba: toRupiahExport(row.laba),
        'Margin %': Number(row.marginPersen.toFixed(2)),
      })),
    },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/main/rekap.test.ts`
Expected: PASS, including the existing export test that asserts the sheet names — add `'Laba per Satuan'` to its expected list if it enumerates them.

- [ ] **Step 8: Commit**

```bash
git add src/main/rekap.ts src/main/rekap.test.ts
git commit -m "feat(rekap): break gross profit down per satuan"
```

---

### Task 7: IPC mirror

**Files:**
- Modify: `desktop-node/src/main/ipc/rekap.ts:31-35`, `desktop-node/src/main/ipc/inventory.ts:60-70`
- Modify: `desktop-node/src/preload/index.ts`, `desktop-node/src/renderer/env.d.ts:316-331`

**Interfaces:**
- Consumes: `RekapResult.labaPerSatuan` (Task 6), `ProductUnitRow.hargaPokok` (Task 4).
- Produces: `window.api.rekap.getRekap()` returns `labaPerSatuan: { satuan: string; qtyTerjual: number; omzet: number; laba: number; marginPersen: number }[]` with money in **rupiah**; `window.api.inventory.getProductDetail()` unit DTO gains `hargaPokok: number` in rupiah. Task 8 consumes both.

- [ ] **Step 1: Map the new rekap section in the handler**

In `src/main/ipc/rekap.ts`, after the `labaPerHari` mapping:

```typescript
      labaPerSatuan: result.labaPerSatuan.map((row) => ({
        satuan: row.satuan,
        qtyTerjual: row.qtyTerjual,
        omzet: toRupiah(row.omzet),
        laba: toRupiah(row.laba),
        // a percentage, not money - it must not go through toRupiah
        marginPersen: row.marginPersen,
      })),
```

- [ ] **Step 2: Add cost to the unit DTO**

In `src/main/ipc/inventory.ts`, in `toUnitDto`:

```typescript
function toUnitDto(unit: ProductUnitRow) {
  return {
    id: unit.id,
    unitId: unit.unitId,
    satuan: unit.unitCode,
    jumlahKemasan: unit.jumlahKemasan,
    konversi: unit.conversionFactor,
    hargaJual: toRupiah(unit.hargaJual),
    hargaPokok: toRupiah(unit.hargaPokok),
    isBaseUnit: unit.isBaseUnit,
  }
}
```

- [ ] **Step 3: Update the preload bridge and the renderer types**

`src/preload/index.ts` forwards these calls without reshaping their payloads, so check whether it declares explicit return types for `rekap.getRekap` and `inventory.getProductDetail`. If it does, add the same fields there. If it forwards `ipcRenderer.invoke(...)` untyped, no change is needed — do not add one.

In `src/renderer/env.d.ts`, inside the `rekap.getRekap` return type, after the `labaPerHari` line:

```typescript
          labaPerSatuan: { satuan: string; qtyTerjual: number; omzet: number; laba: number; marginPersen: number }[]
```

And in the `inventory.getProductDetail` return type, add `hargaPokok: number` to the `units` element type, next to its `hargaJual`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean. A mismatch here is the whole point of the step — the mirror is not otherwise checked.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/rekap.ts src/main/ipc/inventory.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(ipc): expose per-unit cost and per-satuan profit"
```

---

### Task 8: Renderer — Laba per Satuan table, margin and loss warnings

**Files:**
- Modify: `desktop-node/src/renderer/pages/Rekap.tsx:21-30` (row types), `:79-98` (state + load), `:127-139` (columns), `:321-336` (layout)
- Modify: `desktop-node/src/renderer/pages/inventory/ProductDetailDialog.tsx:14-22` (`UnitRow`), `:306-323` (unit row render), `:545-560` (tier row render)

**Interfaces:**
- Consumes: the DTOs from Task 7.
- Produces: user-visible UI. Nothing downstream depends on it.

- [ ] **Step 1: Add the Laba per Satuan table**

In `src/renderer/pages/Rekap.tsx`, after the `LabaPerHariRow` interface:

```typescript
interface LabaPerSatuanRow {
  satuan: string
  qtyTerjual: number
  omzet: number
  laba: number
  marginPersen: number
}
```

Add state next to the others:

```typescript
  const [labaPerSatuan, setLabaPerSatuan] = useState<LabaPerSatuanRow[]>([])
```

Set it in `load`, after `setLabaPerHari(result.labaPerHari)`:

```typescript
      setLabaPerSatuan(result.labaPerSatuan)
```

Add columns after `labaPerHariColumns`:

```typescript
  const labaPerSatuanColumns: Column<LabaPerSatuanRow>[] = [
    { key: 'satuan', name: 'Satuan', width: 120 },
    {
      key: 'qtyTerjual',
      name: 'Qty Terjual',
      renderCell: ({ row }) => <span className="w-full text-right">{row.qtyTerjual}</span>,
    },
    {
      key: 'omzet',
      name: 'Omzet',
      renderCell: ({ row }) => <span className="w-full text-right">{formatRupiah(row.omzet)}</span>,
    },
    {
      key: 'laba',
      name: 'Laba',
      renderCell: ({ row }) => (
        <span className={`w-full text-right${row.laba < 0 ? ' text-destructive' : ''}`}>{formatRupiah(row.laba)}</span>
      ),
    },
    {
      key: 'marginPersen',
      name: 'Margin',
      renderCell: ({ row }) => (
        <span className={`w-full text-right${row.laba < 0 ? ' text-destructive' : ''}`}>
          {row.marginPersen.toFixed(1)}%
        </span>
      ),
    },
  ]
```

Render it in the same grid that holds Laba per Kategori and Laba per Hari — add a third `ReportTable` after the Laba per Hari one, inside that `<div className="grid gap-4 lg:grid-cols-2">`:

```tsx
          <ReportTable<LabaPerSatuanRow>
            title="Laba per Satuan"
            columns={labaPerSatuanColumns}
            rows={labaPerSatuan}
            rowKey={(row) => row.satuan}
            emptyMessage="Belum ada penjualan."
          />
```

- [ ] **Step 2: Show cost and margin on each unit row**

In `src/renderer/pages/inventory/ProductDetailDialog.tsx`, add `hargaPokok: number` to the `UnitRow` interface (after `hargaJual`).

Add these at module scope, next to the existing helpers:

```tsx
/** margin as a percentage of cost, or null when there is no cost to compare against */
function marginPersen(hargaJual: number, hargaPokok: number): number | null {
  return hargaPokok > 0 ? ((hargaJual - hargaPokok) / hargaPokok) * 100 : null
}

function PriceWithMargin({ hargaJual, hargaPokok }: { hargaJual: number; hargaPokok: number }) {
  const margin = marginPersen(hargaJual, hargaPokok)
  const rugi = hargaPokok > 0 && hargaJual < hargaPokok

  return (
    <div className="flex flex-col items-end">
      <Badge variant={rugi ? 'destructive' : 'secondary'}>{formatRupiah(hargaJual)}</Badge>
      <span className={`text-[10px] ${rugi ? 'text-destructive' : 'text-muted-foreground'}`}>
        modal {formatRupiah(hargaPokok)}
        {margin !== null && ` \u00b7 ${margin.toFixed(1)}%`}
        {rugi && ' \u00b7 di bawah modal'}
      </span>
    </div>
  )
}
```

Replace the unit row's price badge (currently `<Badge variant="secondary">{formatRupiah(unit.hargaJual)}</Badge>`) with:

```tsx
        <PriceWithMargin hargaJual={unit.hargaJual} hargaPokok={unit.hargaPokok} />
```

- [ ] **Step 3: Flag price tiers below their unit's cost**

In `PriceTiersManager`, `selectedUnit` is already the unit whose tiers are listed, so its `hargaPokok` is the right comparison. Replace the tier price line (currently `{formatRupiah(tier.hargaJual)} / {unitLabel}`) with:

```tsx
                <span className={selectedUnit && tier.hargaJual < selectedUnit.hargaPokok ? 'text-destructive' : undefined}>
                  {formatRupiah(tier.hargaJual)} / {unitLabel}
                  {selectedUnit && tier.hargaJual < selectedUnit.hargaPokok && ' \u00b7 di bawah modal'}
                </span>
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: both clean.

- [ ] **Step 5: Run the whole suite and restore the Electron ABI**

Run: `npm test`
Expected: every test green.

Run: `npm run rebuild:electron`
Expected: completes without error, so `npm run dev` works again.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/Rekap.tsx src/renderer/pages/inventory/ProductDetailDialog.tsx
git commit -m "feat(ui): show per-unit cost, margin, and per-satuan profit"
```

---

## Manual verification

Run `npm run dev` and walk the worked example on a scratch product:

1. Create a product with base unit PCS, cost 0. Add PAK = 10 PCS and DUS = 10 PAK.
2. Record a purchase of 2 DUS at Rp 500.000 each. Open the product detail: DUS should read modal 500.000, PAK 50.000, PCS 5.000.
3. Record a purchase of 20 PCS at Rp 6.000 each. PCS becomes 5.091; PAK and DUS must not move.
4. Set the DUS selling price below 500.000 and confirm it renders in red with "di bawah modal".
5. Sell 1 DUS and 3 PCS, then open Rekap for today: "Laba per Satuan" should list DUS and PCS separately with the profits computed from their own costs, and the Excel export should contain the matching sheet.
