# Satuan Turunan: Unbounded Dynamic Chain — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Revises the "Satuan Turunan" (derived units) piece of `docs/superpowers/specs/2026-08-07-inventory-units-tiers-design.md` — the fixed 2-slot (Level 2/Level 3) hierarchy it introduced is replaced with an unbounded, ordered chain. **Harga Bertingkat (qty-tiered pricing) and Riwayat Perubahan Harga are unaffected** — this spec only touches `product_units`.

## Why

The prior slice deliberately capped derived units at two fixed slots ("Level 2"/"Level 3", hardcoded labels in the UI) to match a specific packaging pattern (rokok: Pcs → Renteng → Dus). In practice, products vary more than that: some need a longer chain (Pcs → Renteng → Dus → Pak), others need units that don't fit a hardcoded box/carton mental model (Liter for oil, Kg/Ons for sugar). The base unit (`products.satuan`) was already free text and unaffected by this — only the *derived* units had a hardcoded cap. This spec removes that cap so any product can define as many (or as few) derived units as its packaging actually has, each still entered relative to the tier below it (the part of the original design that worked well and is kept).

## 1. Schema Change — `product_units` table

New migration via `npm run db:generate`.

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  satuan: text('satuan').notNull(),
  jumlahKemasan: integer('jumlah_kemasan').notNull(), // qty relative to the tier directly below (base unit, or the previous derived unit)
  konversi: integer('konversi').notNull(),             // absolute conversion to the base unit — unchanged semantics, still what Kasir's cart/checkout consumes
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productSatuanUnique: uniqueIndex('product_units_product_id_satuan_unique').on(table.productId, table.satuan),
}))
```

Changes from the current schema: `level` column dropped. Its unique index — previously `(productId, level)`, which allowed at most 2 rows per product — is replaced by `(productId, satuan)`, which allows unlimited rows per product but still prevents adding the same unit name twice.

**Ordering:** no explicit order column. A product's chain is always `ORDER BY konversi ASC` — valid because `konversi` (total-to-base) strictly increases up the chain by construction (each tier is defined as a positive multiple of the one below it).

**Existing data:** every current `product_units` row already has a correct `konversi` (total-to-base) value regardless of its old `level`. Dropping the `level` column requires no data migration/backfill — rows keep working and simply start sorting by `konversi` instead of `level`.

**Kasir/Purchase compatibility:** unchanged from the prior slice — `sale_items`/`purchase_items` reference `productUnitId` by id and snapshot `konversi`/`satuan` at time of transaction. Zero changes needed there, confirmed by the same reasoning as the original spec (cart/checkout logic reads `satuan`/`konversi`/`hargaJual` per row with no assumption about row count or a `level` field). Implementation should still grep `purchase.ts`/`purchase.test.ts`/`kasir` for incidental `level` references before considering this done, since those files were touched when `productUnitId` was wired in.

## 2. Business Logic — `main/inventory-units.ts`

Replaces the level-keyed functions with chain-keyed ones. Price-tier and price-history functions in this file are unchanged.

- **`listProductUnits(db, productId): ProductUnitRow[]`** — replaces `getProductUnits`. Returns all derived units for a product, ordered by `konversi` ascending (smallest/closest-to-base first).
- **`addProductUnit(db, productId, input: {satuan, jumlahKemasan, hargaJual})`** — appends a new unit as the largest tier in the chain.
  - Validation (unchanged rules from the prior slice): `satuan` required, ≤ 20 chars; `jumlahKemasan` required, integer ≥ 1; `hargaJual` required, finite, ≥ 0. New rule: `satuan` must not already exist for this product → `"Satuan \"{satuan}\" sudah ada."`.
  - `konversi = jumlahKemasan × (current largest unit's konversi, or 1 if the chain is empty)` — "1 if empty" is what makes the first added unit relative to the base unit, same as the old Level 2 behavior.
- **`updateProductUnit(db, productId, unitId, input: {satuan, jumlahKemasan, hargaJual})`** — edits one unit in place. Same validation as `addProductUnit` (satuan-uniqueness check excludes the unit being edited).
  - Recomputes `konversi` for the edited unit and cascades the recomputation upward through every unit above it in the chain (in `konversi` order), generalizing the prior slice's Level-2-edit-recomputes-Level-3 behavior to an arbitrary chain length.
- **`deleteProductUnit(db, productId, unitId)`** — deletes the given unit **and every unit above it** in the chain (their `konversi` values are only meaningful relative to a chain that includes the deleted unit), generalizing the prior slice's Level-2-delete-cascades-to-Level-3 behavior.
- **`getProductDetail`** — `units` field type changes from `{level2: ProductUnitRow | null, level3: ProductUnitRow | null}` to `ProductUnitRow[]` (via `listProductUnits`). `priceTiers`/`priceHistory` fields unchanged.

## 3. IPC — `main/ipc/inventory.ts`

Replaces the level-taking channels; other channels (price tiers, price history, product list) are unchanged.

- `inventory:addProductUnit(productId, input)` → `addProductUnit`
- `inventory:updateProductUnit(productId, unitId, input)` → `updateProductUnit`
- `inventory:deleteProductUnit(productId, unitId)` → `deleteProductUnit`

`inventory:getProductDetail` (existing channel) now returns `units: ProductUnitRow[]` instead of the old `{level2, level3}` shape.

## 4. Renderer — `ProductDetailDialog.tsx`

Replaces `UnitLevelsManager`/`UnitLevelSlot` with a single `UnitChainManager` component. Price-tier and price-history sections in this file are unchanged.

- Renders the chain as a scannable list (existing units, smallest to largest), each row showing:
  - The relative definition: `"1 {satuan} = {jumlahKemasan} {satuan of the tier below (or baseSatuan for the first unit)}"`.
  - A live absolute hint: `"(= {konversi} {baseSatuan})"` — so the user never has to compute the cumulative multiplication themselves. This is the main "more comfortable" improvement over the prior slice, which showed only the relative value.
  - The unit's `hargaJual` and edit (✎) / delete (🗑) actions.
- An "+ Tambah Satuan" button below the list opens an inline add-row, always phrased relative to the current largest unit (or the base unit if the chain is empty) — e.g. placeholder `"1 ___ = ___ Dus"` — instead of the prior slice's generic `'Renteng'`/`'Dus'` placeholders tied to a specific level.
- Edit (✎) turns that row into the same inline form, pre-filled, calling `updateProductUnit`.
- Delete (🗑) confirms with every unit that will cascade-delete named explicitly, e.g. `Hapus "Renteng"? Ini juga akan menghapus "Dus" dan "Pak".` (generalizes the prior slice's single-sibling message to N units).
- No disabled/greyed-out slot state — since the chain is unbounded and every new unit is always relative to whatever is currently largest, there's nothing to "unlock" by filling a prior slot first.
- Same client-side empty-string-before-`Number()` guard as the prior slice (lesson carried forward: `Number("")` is `0`, which passes finite/non-negative checks silently).

## 5. Testing

- `inventory-units.test.ts` rewritten around `listProductUnits`/`addProductUnit`/`updateProductUnit`/`deleteProductUnit`:
  - A 4-tier chain (Pcs → Renteng → Dus → Pak) computes correct cumulative `konversi` at each tier, proving there's no cap.
  - Editing a middle tier's `jumlahKemasan` recomputes every tier above it.
  - Deleting a middle tier cascades to delete every tier above it, leaving tiers below untouched.
  - Duplicate `satuan` for the same product is rejected on add; editing a unit to reuse another unit's `satuan` is rejected; editing a unit's own unchanged `satuan` is allowed.
  - Existing validation-message tests (required/max-length/integer/non-negative) carry over unchanged in substance, just called through the new function names.
- Price-tier and price-history tests in the same file are untouched.

## Out of Scope

- Mid-chain insertion (adding a unit between two existing tiers) — confirmed with the user as unnecessary; every new unit is always the largest.
- Any change to `products.satuan` (base unit) — already free text, already fully custom per product, not part of this change.
- Pembelian-side quantity/unit-based purchase cost tiers — separate future module, already tracked in its own memory/brainstorm note.
- Any change to Kasir's cart/checkout logic or Harga Bertingkat (qty-tiered pricing) — both confirmed unaffected.
