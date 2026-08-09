# Multi Satuan + Multi Harga + Quantity Price Tier Rebuild — Design Spec

**Status:** Approved for literal spec compliance (user explicitly chose "Ikuti spec literal sepenuhnya" over the incremental alternative).
**Scope:** `desktop-node/` only. Restructures the product/unit/price-tier data model to match the user-supplied spec exactly: a global `units` master table, base unit modeled as a `product_units` row (`is_base_unit`), per-unit ranged price tiers, transaction-item price-source snapshots, and a generic `stock_movements` ledger.

## Why this is a full rewrite, not an extension

The existing model (built across `2026-08-07-inventory-units-tiers-design.md` and superseded by `2026-08-09-inventory-units-dynamic-chain-design.md`) treats the base unit as an implicit sentinel (`productUnitId: null`) living directly on the `products` row (`products.satuan`/`hargaJual`/`stok`), and `satuan` as a free-text string with no shared registry. The user's spec requires:

1. A global `units` table, satuan referenced by FK, not free text.
2. Base unit represented as an actual `product_units` row (`is_base_unit = true`), not a `null` sentinel.
3. Price tiers scoped per `product_unit_id` with closed `[min_qty, max_qty]` ranges, not product-wide open-ended tiers.
4. `price_source` snapshot on transaction items.
5. A generic `stock_movements` ledger covering every stock-changing operation (sale, purchase, adjustment, cancellation).

Every one of (1)–(2) touches the single most load-bearing assumption in the codebase — `productUnitId === null` means "base unit, read price/satuan/stok off `products`" — which is threaded through `main/kasir.ts`, `main/inventory-units.ts`, `main/inventory.ts`, `main/inventory-bulk.ts`, `main/purchase.ts`, `main/stock-opname.ts`, `main/rekap.ts`, `main/escpos.ts`, every renderer page under `pages/kasir/` and `pages/inventory/`, and essentially every test file in `src/main/*.test.ts`. This was surfaced to the user as a large-rewrite risk; they confirmed they want it anyway. This doc plans that rewrite as a sequence of safe, individually-testable steps rather than one big-bang change.

## 1. Schema

### 1a. `units` (new, global)

```typescript
export const units = sqliteTable('units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),      // "PCS", "BOX", "DUS"
  name: text('name').notNull(),                // "Pieces", "Box", "Dus"
  symbol: text('symbol').notNull(),             // "pcs", "box", "dus"
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps(),
})
```

`code` is the stable identifier products reference; `name`/`symbol` are display-only. No product-scoping — global vocabulary, matching spec section 2.

### 1b. `product_units` (restructured)

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  unitId: integer('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
  jumlahKemasan: integer('jumlah_kemasan').notNull(),      // kept: qty relative to the tier directly below, drives the chain-editing UX
  conversionFactor: integer('conversion_factor').notNull(), // renamed from `konversi` to match spec vocabulary; absolute ratio to base unit
  hargaJual: integer('harga_jual').notNull(),
  isBaseUnit: integer('is_base_unit', { mode: 'boolean' }).notNull().default(false),
  isDefaultSalesUnit: integer('is_default_sales_unit', { mode: 'boolean' }).notNull().default(false),
  isDefaultPurchaseUnit: integer('is_default_purchase_unit', { mode: 'boolean' }).notNull().default(false),
  ...timestamps(),
}, (table) => ({
  productUnitUnique: uniqueIndex('product_units_product_id_unit_id_unique').on(table.productId, table.unitId),
}))
```

`jumlahKemasan` is kept (not in the literal spec) because it's what the existing chain-editing UI is built on ("1 Dus = X Renteng") and it's needed to *recompute* `conversionFactor` when a lower link in the chain changes — dropping it would regress that UX for no spec benefit. Every other literal field is added as named.

**Invariant enforced in application code (not a DB constraint SQLite can express cleanly):** exactly one `is_base_unit = true` row per product, with `conversion_factor = 1`.

### 1c. `products` (base unit fields become a mirrored cache, not the source of truth)

`products.satuan` is dropped — satuan is now only ever read via the product's base `product_units` row (joined through `units`). `products.hargaJual` stays, but its role changes: it becomes a denormalized read-through cache of the base unit's `product_units.hargaJual`, kept in sync by application code whenever the base unit's price is edited. This avoids rewriting the (large) surface of reporting/receipt code that reads `products.hargaJual` directly, while `product_units` (with `is_base_unit = true`) remains the authoritative row per the spec's own data model. `products.hargaPokok` (cost) and `products.stok` are untouched — cost isn't a per-unit concept in this spec, and stock is explicitly product-level ("Product → Stock (BASE UNIT)" in the spec's own relation diagram).

### 1d. `product_price_tiers` (ranged, per-unit)

```typescript
export const productPriceTiers = sqliteTable('product_price_tiers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  productUnitId: integer('product_unit_id').notNull().references(() => productUnits.id, { onDelete: 'cascade' }),
  minQty: integer('min_qty').notNull(),
  maxQty: integer('max_qty'),  // NULL = unbounded
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productUnitIdx: index('product_price_tiers_product_unit_idx').on(table.productUnitId),
}))
```

`productUnitId` is **not nullable** here (unlike the incremental plan I originally proposed) because the base unit is now always a real `product_units` row — there's no `null` sentinel left anywhere in this rewrite. Overlap/gap validation (spec section 17) is range-comparison logic that cannot be expressed as a SQL `UNIQUE` constraint regardless of nullability, so it's enforced in `main/inventory-units.ts` application code (see §3).

### 1e. `sale_items` (snapshot additions)

Add:
```typescript
baseQuantity: integer('base_quantity').notNull().default(0),
priceSource: text('price_source', { enum: ['normal', 'price_tier', 'manual'] }).notNull().default('normal'),
```
`'manual'` is defined for spec fidelity but never written by any current code path (no manual-price-override feature exists) — same treatment as any unused-but-spec-mandated enum value.

### 1f. `stock_movements` (new)

```typescript
export const stockMovements = sqliteTable('stock_movements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  productUnitId: integer('product_unit_id').references(() => productUnits.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull(),             // signed, in the transaction's own unit
  conversionFactor: integer('conversion_factor').notNull(),
  baseQuantity: integer('base_quantity').notNull(),     // signed, in base unit — this is what's actually applied to products.stok
  movementType: text('movement_type', { enum: ['sale', 'sale_cancel', 'purchase', 'stock_adjustment'] }).notNull(),
  referenceId: integer('reference_id').notNull(),        // saleId / purchaseId / stockAdjustment id, meaning depends on movementType
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})
```

Every existing stock-mutating call site gets one new insert alongside its existing `UPDATE products SET stok = ...`, inside the same transaction. `stock_adjustments` (existing table) is untouched — it stays as the opname-specific detail record (`stokSebelum`/`stokSesudah`/`alasan`); `stock_movements` becomes the cross-cutting ledger and `movementType = 'stock_adjustment'` rows carry `referenceId = stockAdjustments.id` to link back to it.

## 2. Migration & backfill strategy

Generated via `npm run db:generate` after each schema.ts edit, applied automatically by `createDb()`'s `migrate()` call — same as every prior schema change in this project. Given the scale, this ships as **multiple sequential migrations**, each independently safe to apply and roll forward from:

1. **Create `units`, seed it** from every distinct `satuan` string currently in `products.satuan` and `product_units.satuan` (dedup by trimmed uppercase code). Real data exists in both `dev.sqlite` and the packaged `pos.sqlite` (per this project's history — 1497+ imported products) — the seed step is a data migration, not just a schema migration, and runs as part of the same drizzle migration file via raw SQL `INSERT INTO units SELECT DISTINCT ...`.
2. **Add `unit_id`/`is_base_unit`/`is_default_sales_unit`/`is_default_purchase_unit`/`conversion_factor` to `product_units`**, backfill `unit_id` by joining the old `satuan` text to the new `units.code`, backfill `conversion_factor = konversi`. Then **insert one new `product_units` row per product** representing its current base unit (`unitId` resolved from `products.satuan`, `conversionFactor = 1`, `hargaJual = products.hargaJual`, `isBaseUnit = true`), before dropping `product_units.satuan` and `products.satuan`.
3. **Restructure `product_price_tiers`**: add `product_unit_id` (backfilled to each product's new base-unit row, since every existing tier today is implicitly base-unit-only), add `max_qty` (left `NULL` for all existing rows — they stay open-ended until an admin edits them), drop the old `(productId, minQty)` unique index.
4. **Add `sale_items.base_quantity`** (backfilled as `qty * konversi` from the existing snapshotted columns) **and `sale_items.price_source`** (backfilled to `'normal'` for all historical rows — there is no way to know retroactively whether a past sale used a tier, and that's fine: it only matters going forward).
5. **Create `stock_movements`** (empty on creation — historical stock changes are not backfilled into it; the ledger starts recording from this migration forward, exactly like `product_price_histories` did when it was introduced).

Each step is its own migration file so a failure partway through is easy to isolate and re-run, and each is independently testable against a copy of real `dev.sqlite`/`pos.sqlite` before being trusted.

## 3. `main/inventory-units.ts` — validation & resolution logic

- `addProductUnit`/`updateProductUnit`: `satuan` text input is replaced by `unitId` (selected from the Master Satuan list via the new picker — see §6). The function signature changes from `{satuan, jumlahKemasan, hargaJual}` to `{unitId, jumlahKemasan, hargaJual}`; validation drops the satuan length/emptiness checks (now enforced by Master Satuan CRUD instead) and adds "unit must exist and be active" + "unit not already used by this product" (replacing the old satuan-string duplicate check).
- `addPriceTier(db, productId, productUnitId, input: {minQty, maxQty, hargaJual})`:
  - `minQty > 0` (relaxed from the current `>= 2` floor — the spec's own examples start tiers at 1).
  - `maxQty === null || maxQty >= minQty`.
  - `hargaJual >= 0`.
  - **Overlap check**: fetch all existing tiers for `(productId, productUnitId)`, reject if `[minQty, maxQty ?? Infinity]` intersects any existing tier's range.
  - Wrapped in a transaction (single-user desktop app, low race risk, but correctness-cheap to guard anyway).
- `listPriceTiers`: scoped by `(productId, productUnitId)`, ordered by `minQty`.
- No `updatePriceTier` — delete + re-add stays the mutation path, matching the existing (pre-rewrite) API surface and the current UI's delete-only editing model for tiers.

## 4. Price resolution — `main/kasir.ts` + `renderer/pages/kasir/cart-logic.ts`

Both copies of `priceForQty` (main and renderer — intentionally duplicated today because the renderer bundle can't pull in `drizzle-orm/better-sqlite3`) change their match predicate from "highest `minQty <= qty` wins" to a closed-range match:

```typescript
tiers.find((t) => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty))
```

`resolveCartItem` (main) currently only calls `priceForQty` when `productUnit` is `null` (base-unit sentinel). Once base unit is a real `product_units` row, this branch disappears entirely — **every** line resolves through the same path: look up the product's chosen `product_units` row (base or derived, no distinction), find tiers scoped to that row's id, range-match against `qty`, fall back to that row's flat `hargaJual` if no tier matches. This is a simplification, not just an extension — the `if (productUnit) {...} else {...}` branch collapses to one path.

`resolveCartItem`'s return gains `priceSource: 'normal' | 'price_tier'` (whichever branch actually produced the price), threaded into `checkout()`'s `saleItems` insert alongside the already-existing `qty * konversi` (which becomes the new `baseQuantity` column — free, since it's already computed as `qtyDasar`).

## 5. Stock movements — write sites

Every existing `UPDATE products SET stok = ...` gets a sibling `INSERT INTO stock_movements`, in the same DB transaction:

- `main/kasir.ts` `checkout()` — one row per sale item, `movementType: 'sale'`, negative `baseQuantity`.
- `main/kasir.ts` `cancelSale()`/`restoreStockForItems()` — `movementType: 'sale_cancel'`, positive `baseQuantity` (reversal).
- `main/purchase.ts` `recordPurchase()` — `movementType: 'purchase'`, positive `baseQuantity`.
- `main/stock-opname.ts` `recordAdjustment()` — `movementType: 'stock_adjustment'`, signed `baseQuantity` (the delta), `referenceId` = the new `stock_adjustments.id`.

## 6. UI changes

- **New page: Master Satuan** (`pages/MasterSatuan.tsx`, new sidebar entry under a suitable section, own IPC channels `master-satuan:list/create/update/deactivate`). Simple CRUD table: code, name, symbol, active toggle. Deactivating (not hard-deleting) a unit already referenced by any `product_units` row is blocked with a friendly error, matching this app's existing FK-restrict-with-friendly-message convention (`main/inventory.ts`).
- **`ProductDetailDialog.tsx`**: `UnitChainManager`'s free-text satuan input becomes a `<select>`/combobox populated from active `units` rows (same "picked from a list" pattern as the Kasir satuan dropdown already shipped in `CartGrid.tsx`). `PriceTiersManager` gains a unit selector (base unit + every derived unit, each a real `product_units` row now — no more special-casing "base" as a sentinel string), a Max Qty field (blank = unbounded), and displays each tier as a `Min – Max` range scoped to the selected unit.
- **`CartGrid.tsx` / `Kasir.tsx`**: small subtext under the Harga cell showing the matched tier's range when a tier (not the normal price) is active, e.g. "tier 5–9 Box → Rp42.000".

## Decisions (confirmed)

1. **Unit picker UX — dedicated Master Satuan page.** A new standalone screen (`pages/MasterSatuan.tsx` or similar, added to the sidebar) provides full CRUD over the global `units` table (code/name/symbol/isActive), independent of any product. Product-unit forms (`UnitChainManager` in `ProductDetailDialog.tsx`, and wherever a satuan is picked for sales/purchase) switch from a free-text input to a **select/autocomplete sourced from `units`** — no more ad hoc unit names typed per product. This is new UI surface, not a reuse of the existing free-text input.
2. **`products.hargaJual` stays as a denormalized cache** of the base unit's `product_units.hargaJual`, synced by application code on every base-unit price edit. Reporting/receipt code (`rekap.ts`, `escpos.ts`, etc.) keeps reading `products.hargaJual` unchanged.
3. **Execution mode: `superpowers:subagent-driven-development`.** This doc is followed by a `superpowers:writing-plans` pass producing a task-by-task implementation plan, executed in an isolated git worktree with a fresh implementer subagent + review per task. Expected to span many dispatch rounds, possibly across sessions.

## Out of scope (unchanged from the incremental proposal)

- Retroactively backfilling historical `stock_movements` rows for stock changes that happened before this migration.
- Any change to `purchaseItems`' pricing model (purchases aren't priced via sell-side tiers).
