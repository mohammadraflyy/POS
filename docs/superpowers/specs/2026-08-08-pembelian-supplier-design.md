# Pembelian & Supplier — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Two-slice module closing the "Pembelian" (Purchasing) sidebar entry, currently disabled since Fase 1. Decomposed the same way Katalog Produk was: **Slice 1 (Kelola Supplier)** first, since **Slice 2 (Pembelian)** depends on it.

## Why

`Pembelian` has sat disabled in the sidebar since the Fase 1 schema skeleton shipped. Recording stock coming into the store — currently only possible via manual DB edits or the disabled-forever web-app-parity form — is the last major gap before this app can fully replace day-to-day store operations. The user separately requested (2026-08-07, see project memory `pos-pembelian-tiered-pricing-request`) that purchasing support unit/quantity-based pricing the way Kasir already does for sales — "the more you buy, the cheaper it gets." Brainstorming this resolved that request to: add a satuan (unit) picker to the purchase line-item form, reusing the existing Satuan Turunan (Slice 2 of Inventory) conversion data — not a new automatic tiered-pricing table. The store owner still enters the negotiated price manually per line; the system only handles unit conversion for stock math.

## Slice Decomposition

- **Slice 1 — Kelola Supplier**: standalone supplier list/add/edit/delete. No schema changes (`suppliers` table already exists from Fase 1). Foundational for Slice 2, and self-contained enough to ship and use on its own.
- **Slice 2 — Pembelian**: purchase-entry form + history. One schema change (`purchase_items` gains unit-snapshot fields, mirroring `sale_items`'s already-shipped shape). Depends on Slice 1 for the supplier picker.

Both slices add their own sidebar entries as they ship — "Supplier" is enabled in Slice 1 (not held back for Slice 2), matching how each Inventory slice enabled its own affected UI incrementally rather than batching reveals.

## Slice 1: Kelola Supplier

### Business logic — `main/supplier.ts` (new file)

Mirrors the established Inventory pattern (pure functions, unit-tested against real in-memory SQLite):

- **`listSuppliers(db, {search, page, pageSize}): {data, currentPage, lastPage, total}`** — `search` matches `nama` via `LIKE %search%`, ordered by `nama`. `pageSize` defaults 25, whitelist `[10, 25, 50, 100]` (invalid falls back to 25) — identical convention to `listProducts`. Each row includes `purchaseCount: number`, computed via a correlated `COUNT(*)` subquery against `purchases.supplier_id` (same subquery pattern already established for `unitsCount`/`priceTiersCount` in `main/inventory.ts`).
- **`createSupplier(db, input: {nama, telepon, alamat, keterangan})`** — validates `nama` required, max 255 (matching the web app's `StoreSupplierRequest`); `telepon`/`alamat`/`keterangan` nullable free text, no length limit specified in the original (none enforced here either, matching faithfully).
- **`updateSupplier(db, id, input)`** — same validation, updates in place, no "unchanged" tracking needed (this is simple CRUD, not a batch-save context).
- **`deleteSupplier(db, id)`** — no FK-restrict handling needed: `purchases.supplierId` is `onDelete: 'set null'` (confirmed in schema), so deleting a supplier always succeeds and any existing purchases simply lose their supplier reference (become "Tanpa supplier" historically). Unlike Product delete, no friendly-error-message porting is needed here since there's no failure mode to catch.

### IPC — `main/ipc/supplier.ts` (new file), registered in `main/index.ts`

Auth-guarded (`getCurrentUser()`), matching every existing handler. No money fields in this domain — no `toRupiah`/`toCents` conversion needed.

- `supplier:listSuppliers(filters)` → `listSuppliers`
- `supplier:createSupplier(input)` → `createSupplier`
- `supplier:updateSupplier(id, input)` → `updateSupplier`
- `supplier:deleteSupplier(id)` → `deleteSupplier`

### Renderer — `pages/Supplier.tsx` (new file), route `/supplier`

Wrapped in `AppShell`, breadcrumb `[{title: 'Supplier', href: '/supplier'}]`. Follows Inventory's inline-editable grid pattern (`DataGrid`, autosave per cell on change) since every field here is simple text with no cross-field validation or units/tiers complexity:

- Columns: Nama, Telepon, Alamat, Keterangan (all `editable: true`, `renderTextEditor`, red-cell on save error) — plus a read-only "Jumlah Pembelian" (`purchaseCount`) column, and Aksi (Hapus, behind `useConfirm()` — no FK-restrict wording needed here, unlike Product's delete confirm).
- Toolbar: search input + "Cari" button, pagination matching the established shape (prev/next + page label + per-page `Select`), "+ Tambah Supplier" button that appends one blank editable row directly into the grid (simpler than Mass Input's separate page, since Supplier has no unit/tier sub-entity and no all-or-nothing batch-validation need — each row saves independently on edit, same as Inventory's own grid).

### Sidebar

New "Supplier" entry added under the same "Pembelian & Stok" section as Katalog Produk, enabled immediately in this slice (not held back for Slice 2).

## Slice 2: Pembelian

### Schema change — `purchase_items` (new migration)

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

`productUnitId`/`konversi`/`satuan` mirror `sale_items`'s already-shipped shape exactly (same nullable-unit-reference + snapshot-conversion-and-label pattern, same `onDelete: 'set null'` so a later-deleted Satuan Turunan entry doesn't retroactively break historical purchase records). `konversi` defaults `1` (base unit) for the pre-existing column-add migration mechanics, same reasoning as Inventory Slice 2's `product_units.level`/`jumlah_kemasan` defaults — every insert path in this slice's business logic always sets it explicitly regardless.

### Business logic — `main/purchase.ts` (new file)

- **`recordPurchase(db, input: {supplierId: number | null, tanggal: string, catatan: string | null, items: [{productId, productUnitId: number | null, qty, hargaBeli}], userId: number | null}): {purchaseId: number}`** — validates: `tanggal` required (date string); `items` required, min 1; each item's `qty` required integer ≥ 1, `hargaBeli` required finite ≥ 0 (the empty-string-guard lesson from every prior slice applies here too). For each item, resolves `konversi`/`satuan`: `productUnitId === null` → `konversi: 1, satuan: null` (base unit, matching `sale_items`'s own convention for base-unit lines); otherwise looks up the `productUnits` row for `konversi`/`satuan`. Computes `subtotal = qty * hargaBeli`. Wrapped in `db.transaction(...)`: creates the `purchases` row, creates each `purchase_items` row, and increments `products.stok` by `qty * konversi` per item (mirroring Kasir's `qtyDasar` stock-deduction math from `main/kasir.ts`, addition instead of subtraction). No `harga_pokok` update, no `product_price_histories` row — confirmed explicitly out of scope.
- **`listPurchases(db, {page, pageSize}): {data, currentPage, lastPage, total}`** — recent purchases with resolved supplier name (left join, null-safe for "Tanpa supplier") and an item-summary string (product names + qty), paginated with the same `[10,25,50,100]`/default-25 convention as every other list in this app. This is a deliberate improvement over the web app's flat "last 20, no pagination" — consistency with every other history view already shipped (KasirHistory, Inventory).
- **`searchProductsForPurchase(db, q): array`** — a new, purchase-specific quick-search (distinct from Inventory's existing `searchProductsQuick`, which lacks `hargaPokok`), capped 20 results, returns `{id, kodeItem, namaItem, satuan, hargaPokok, units: {id, level, satuan, konversi}[]}[]` — the `units` array powers the per-row satuan `<Select>`, `hargaPokok` powers the pre-fill fix described below.

### IPC — `main/ipc/purchase.ts` (new file), registered in `main/index.ts`

Auth-guarded, money converted at the boundary (`hargaBeli`/`hargaPokok` cents↔Rupiah via the established local `toRupiah`/`toCents` pattern).

- `purchase:recordPurchase(input)` → `recordPurchase`
- `purchase:listPurchases(filters)` → `listPurchases`
- `purchase:searchProducts(q)` → `searchProductsForPurchase`

### Renderer — `pages/Purchase.tsx` (new file), route `/purchase`, enables the sidebar entry

Wrapped in `AppShell`, breadcrumb `[{title: 'Pembelian', href: '/purchase'}]`. Single page: form + history, following the web app's overall layout.

- **Header fields**: Supplier picker (`CommandDialog` quick-search reusing the established quick-search-palette pattern, plus a "Supplier Baru" inline quick-add dialog calling `createSupplier` directly — mirrors the web app's inline quick-add, now backed by Slice 1's real CRUD function instead of a one-off endpoint), Tanggal (date input, defaults to today), Catatan (optional text).
- **Item entry**: "Cari Produk" button opens a `CommandDialog` (same established pattern) querying `searchProductsForPurchase`; selecting a result adds a draft row with:
  - **Pre-filled Harga Beli from `hargaPokok`** — a deliberate fix versus the web app, which inconsistently pre-fills from `harga_jual` (selling price) when picked via search but from `harga_pokok` (cost price) when adding a brand-new product in the same session — an inconsistency that looks like an unintentional bug in the original. This port always uses `hargaPokok`, the correct default for a cost-entry field.
  - A satuan `<Select>` populated from that product's `units` array (base unit + any Level 2/3 Satuan Turunan entries), defaulting to the base unit.
  - Qty input, computed subtotal (`qty × hargaBeli`), remove button.
  - Plain HTML `<table>` for the item rows (matching the web app's own choice) — purchase line counts are small (a handful to a few dozen items per purchase), not the hundreds/thousands-row scale that justifies `DataGrid` elsewhere in this app.
- **Submit**: "Simpan Pembelian" → `recordPurchase`; on success, clears the form and refreshes history; on failure, shows validation errors inline (`InputError` pattern, matching every other form in this app).
- **History**: `ReportTable` (the shared component already used for this exact purpose in the web-app-parity port), paginated per the established shape, columns: Tanggal / Supplier / Item summary / Total.

## Out of Scope (both slices)

- Automatic harga_beli calculation or a dedicated purchase-side tiered-pricing table — satuan selection only; price stays a manual per-line entry, per the user's explicit confirmed decision.
- Updating `products.harga_pokok` or logging `product_price_histories` from a purchase — confirmed explicitly out of scope; cost-price changes still only happen via Katalog Produk's existing edit flow.
- Editing or canceling a recorded purchase — create-only + history view, matching the web app exactly (no existing precedent to port; Kasir's cancel-sale flow is not mirrored here since nothing in the current app or user request asked for it).
- Any change to Kasir's checkout/stock-deduction logic — Purchase is a separate, additive write path to `products.stok` (increment vs. Kasir's decrement), sharing no code beyond the `konversi`-based unit-math pattern already proven in `main/kasir.ts`.
- Supplier delete confirmation wording does not need FK-restrict handling — the schema's `set null` behavior means delete never fails.
