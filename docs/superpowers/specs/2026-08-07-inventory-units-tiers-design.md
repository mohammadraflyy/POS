# Inventory Slice 2: Satuan Turunan & Harga Bertingkat — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Second slice of the Katalog Produk (Inventory) module — manage each product's derived selling units (satuan turunan) and quantity-tiered pricing (harga bertingkat), plus a read-only price-change history view. Triggered from the product grid built in Slice 1 (`docs/superpowers/specs/2026-08-07-inventory-crud-design.md`).

## Why

Slice 1 explicitly deferred "Satuan/Harga Bertingkat" management — the grid lists/edits core product fields only. This slice adds the missing piece: letting a cashier or admin define that, say, 1 DUS = 12 PCS at a different selling price, or that buying 6+ PCS unlocks a lower per-unit price. Both concepts already exist in the schema and are already consumed by the shipped Kasir cart (`main/kasir.ts`, `cart-logic.test.ts`) for `productPriceTiers`, and partially for `productUnits` — this slice is what lets someone actually populate that data through the UI instead of manual seeding.

## Departure From the Original Web App: Fixed-Level Unit Hierarchy

The original Laravel web app's `ProductUnitsManager` (`resources/js/pages/inventory/shared.tsx`) offers a flexible, unordered list: add any number of arbitrarily-named units, each with its own conversion-to-base-unit entered directly (e.g. "1 DUS = 120 PCS", computed by the user).

This slice replaces that with a **fixed 3-level hierarchy**, chosen deliberately (not a faithful port) to match how the target retail businesses actually think about packaging (e.g. rokok: Pcs → Renteng → Dus):

- **Level 1** is always the product's existing base unit (`products.satuan`, unchanged, not stored in `product_units`).
- **Level 2** and **Level 3** are each optional, single slots (not a repeatable list) with an editable label (`satuan`) and a quantity relative to the level directly below.
- **Level 3 requires Level 2 to exist first** — the UI disables/hides the Level 3 slot until Level 2 is filled. This keeps the "relative to previous level" input unambiguous (always relative to a populated level) and matches the natural real-world chain in the target use case.
- Deleting Level 2 while Level 3 exists **cascades** — both are removed together, since Level 3's stored value is only meaningful in terms of Level 2.

**Harga Bertingkat (quantity-tiered pricing) is unaffected by this change** — it remains a faithful port of the web app's flat, repeatable add/delete list (any number of qty breakpoints, each with its own price), since the user's redesign request was specific to the units structure.

## 1. Schema Change — `product_units` table

First schema change since the Fase 1 skeleton. New migration via `npm run db:generate`.

```typescript
export const productUnits = sqliteTable('product_units', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  level: integer('level').notNull(), // 2 or 3
  satuan: text('satuan').notNull(),
  jumlahKemasan: integer('jumlah_kemasan').notNull(), // qty relative to the level directly below (base unit, for level 2; level 2, for level 3)
  konversi: integer('konversi').notNull(), // absolute conversion to the base unit (level 1) — UNCHANGED semantics from Fase 1, still what Kasir's cart/checkout consumes
  hargaJual: integer('harga_jual').notNull(),
  ...timestamps(),
}, (table) => ({
  productLevelUnique: uniqueIndex('product_units_product_id_level_unique').on(table.productId, table.level),
}))
```

Changes from the current schema: adds `level` (new) and `jumlahKemasan` (new); the unique index moves from `(productId, satuan)` to `(productId, level)`, since at most one row per level per product is now allowed (previously, arbitrarily many differently-named units were allowed).

**Backward compatibility with Kasir:** confirmed by reading `main/kasir.ts` and `cart-logic.test.ts` — the cart's `pickUnitForBaseQty`/`resolveLineQty`/checkout logic reads only `satuan`, `konversi`, and `hargaJual` per `productUnits` row, with no assumption about row count, ordering, or naming. Zero changes needed to Kasir.

**Existing dev data:** `dev.sqlite` (gitignored, local-only) currently has exactly one `product_units` row from earlier Fase 1 manual testing (`DUS`, `konversi: 12`). The migration does not need a data-preserving backfill strategy beyond what Drizzle's migration naturally does when adding non-null columns — if a default is needed for the migration to apply cleanly to that pre-existing row, backfill `level = 2` and `jumlahKemasan = konversi` (the natural interpretation: an existing single-row "DUS = 12× base" becomes Level 2 with the same effective conversion). This is dev-only data with no production users yet, so this is a low-risk, no-drama step, not a migration requiring careful data preservation.

## 2. Business Logic — `main/inventory-units.ts` (new file)

Parallel to `main/inventory.ts` (Slice 1's core product CRUD) — kept separate since this is a distinct sub-domain (managing a product's units/tiers/history, not the product record itself).

### Satuan Turunan (units)

- **`setProductUnit(db, productId, level, input: {satuan, jumlahKemasan, hargaJual})`** — upsert (create-or-replace) the row for the given `level` (2 or 3) on this product.
  - Validates: `satuan` required, max 20 chars → `"Satuan wajib diisi."` / `"Satuan maksimal 20 karakter."`; `jumlahKemasan` required, integer ≥ 1 → `"Jumlah kemasan wajib diisi."` / `"Jumlah kemasan minimal 1."`; `hargaJual` required, finite, ≥ 0 (matching Slice 1's `Number.isFinite` fix) → `"Harga jual wajib diisi."` / `"Harga jual tidak boleh negatif."`.
  - If `level === 3`, requires Level 2 to already exist for this product → `"Isi Level 2 (satuan turunan pertama) dulu sebelum Level 3."`.
  - Computes `konversi`: for Level 2, `konversi = jumlahKemasan` (relative to base = level 1). For Level 3, `konversi = jumlahKemasan × (Level 2's konversi)`.
  - If Level 2 is being updated (not first-created) and Level 3 already exists, Level 3's `konversi` is recomputed from its stored `jumlahKemasan` × the new Level 2 `konversi`, keeping the cascade consistent.
- **`deleteProductUnit(db, productId, level)`** — deletes the row for that level. If `level === 2` and a Level 3 row exists for the same product, both are deleted together (cascade, single operation — not two separate calls from the renderer).
- **`getProductUnits(db, productId): {level2: ProductUnitRow | null, level3: ProductUnitRow | null}`** — read helper used by `getProductDetail` below.

### Harga Bertingkat (unchanged faithful port)

- **`addPriceTier(db, productId, input: {minQty, hargaJual})`** — validates `minQty` required, integer ≥ 2 (matching Laravel's `min:2` — tier 1 is just the base price, not a tier) → `"Qty minimal wajib diisi."` / `"Qty minimal harus 2 atau lebih."`; `hargaJual` required, finite, ≥ 0 → same messages as above. Duplicate `minQty` for the same product → `"Harga bertingkat untuk qty {minQty} sudah ada."` (friendly message; the web app leaves this as a raw DB error, per this slice's explicit decision to add friendly messages consistent with Slice 1's FK-restrict precedent).
- **`deletePriceTier(db, productId, tierId)`** — validates the tier belongs to the given product before deleting → `"Harga bertingkat tidak ditemukan."` if not.
- **`listPriceTiers(db, productId)`** — sorted by `minQty` ascending, matching the web app's display order.

### Price History (read-only)

- **`listPriceHistory(db, productId)`** — returns `product_price_histories` rows (already written by Slice 1's `updateProduct`) left-joined with `users` for the editor's display name (`null` → `"Sistem"`, matching the web app's `entry.user?.name ?? 'Sistem'` fallback), ordered newest-first.

### Combined Fetch

- **`getProductDetail(db, productId): {units: {level2: ProductUnitRow | null, level3: ProductUnitRow | null}, priceTiers: PriceTierRow[], priceHistory: PriceHistoryRow[]}`** — single function bundling the three read paths above. Called once when the detail dialog opens; the renderer re-calls it after any mutation to refresh the dialog's contents (matching the web app's Inertia `back()`-triggers-a-full-reload pattern, minus the whole-page reload).

## 3. `listProducts` / `searchProductsQuick` Extension (Slice 1 files)

`main/inventory.ts`'s `ProductListItem` interface gains two fields: `unitsCount: number` (0, 1, or 2 — how many of Level 2/Level 3 are populated) and `priceTiersCount: number`. Both `listProducts` and `searchProductsQuick` compute these via a `COUNT`-based subquery/join per product, so the grid's badge column shows live counts without a separate round trip per row. This is a small, additive change to an existing interface — no other Slice 1 consumer breaks, since it only adds fields.

## 4. IPC — additions to `main/ipc/inventory.ts` (Slice 1 file)

All handlers auth-guarded via `getCurrentUser()`, matching every existing handler. Money crosses the boundary as Rupiah (`toRupiah`/`toCents`, same local-per-file pattern as Slice 1).

- `inventory:getProductDetail(productId)` → `getProductDetail`
- `inventory:setProductUnit(productId, level, input)` → `setProductUnit`
- `inventory:deleteProductUnit(productId, level)` → `deleteProductUnit`
- `inventory:addPriceTier(productId, input)` → `addPriceTier`
- `inventory:deletePriceTier(productId, tierId)` → `deletePriceTier`

`inventory:listProducts` and `inventory:searchProducts` (existing channels) extend their DTO to include `unitsCount`/`priceTiersCount`, passed through unconverted (plain counts, not money).

## 5. Renderer — `pages/inventory/ProductDetailDialog.tsx` (new file)

Mirrors the web app's own file-structure decision (`pages/inventory/shared.tsx`) — extracted out of `Inventory.tsx` rather than inlined, since `Inventory.tsx` is already ~480 lines after Slice 1.

**Grid column** (`Inventory.tsx`, new column "Satuan/Harga Bertingkat", positioned between Status and Aksi, matching the web app's column order): a button showing two `Badge`s — `"{unitsCount} unit"` and `"{priceTiersCount} tingkat"` (secondary variant when > 0, outline when 0, matching the web app) — that opens the dialog for that product.

**Dialog content** (opens via `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`, already-ported shadcn components):

- **Satuan Turunan section:** two fixed slots, not a repeatable list.
  - Level 2 slot: if populated, shows `"1 {satuan} = {jumlahKemasan} {product.satuan}"` + a price `Badge` + "Hapus" button (confirm: `"Hapus satuan \"{satuan}\"?"`, or `"Hapus satuan \"{satuan}\"? Ini juga akan menghapus satuan Level 3 (\"{level3.satuan}\")."` when Level 3 exists). If empty, shows an inline add-form (satuan / jumlah / harga jual, mirroring the web app's `ProductUnitsManager` form fields and `InputError` usage).
  - Level 3 slot: same shape, but disabled/hidden with a note (`"Isi Level 2 dulu"`) when Level 2 is empty. Confirm wording: `"Hapus satuan \"{satuan}\"?"`.
- **Harga Bertingkat section:** unchanged faithful port of `ProductPriceTiersManager` — repeatable list + add-form + delete-with-confirm (`"Hapus harga bertingkat untuk pembelian {minQty}+ {satuan}?"`).
- **Riwayat Perubahan Harga section:** unchanged faithful port of `ProductPriceHistoryList` — read-only, no actions.

All mutations (`setProductUnit`, `deleteProductUnit`, `addPriceTier`, `deletePriceTier`) refetch `getProductDetail` on success to refresh the dialog. Closing the dialog (or any successful mutation) also triggers the main grid's existing `loadPage(currentPage)` so the badge counts on the underlying row update without a full remount.

**Client-side numeric validation (lesson carried from Slice 1's final review):** Slice 1 shipped with a real bug where an empty text input's `Number("")` evaluates to `0` — finite and non-negative — silently passing every check on both sides and saving a false value. This slice's add-forms (unit `jumlahKemasan`/`hargaJual`, tier `minQty`/`hargaJual`) must reject empty/whitespace-only input client-side, before calling `Number(...)` and before the IPC call — showing an inline `InputError` (`"... wajib diisi."`) instead of silently sending a false `0`, matching the fix already applied to Slice 1's grid.

## Out of Scope

- Mass Input's own units/tiers data entry (Slice 3 — the bulk-add grid doesn't touch this dialog).
- Pembelian-side quantity/unit-based purchase cost tiers (separate future module; already noted for that module's own brainstorm).
- Any change to Kasir's cart/checkout logic — confirmed it needs none.
- Arbitrary/unlimited unit levels beyond 3 (deliberately fixed at 3 per this slice's design decision).
- Editing an existing Level 2/3's `satuan` name without also being able to change its quantity in the same action — `setProductUnit` is a full upsert per level, so editing is just re-submitting the same form with new values, no separate "rename" concept needed.
