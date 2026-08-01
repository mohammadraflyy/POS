# Product Mass Input (Excel-like Grid)

## Problem

Inventory currently has three separate one-item-at-a-time input paths:
`ProductFormDialog` (single create/edit), `BulkEntryDialog` (semicolon-delimited
textarea blob, no real editing/validation feedback), `StockInDialog` (repeatable
flex rows, not a real grid). Entering many products is slow and error-prone.

## Goal

Replace `BulkEntryDialog` with `ProductMassInputDialog`: a real editable grid
(react-data-grid) for creating many new products and bulk-editing existing ones
in one save, with Excel-like keyboard navigation (Tab/Enter/Arrows).

## Scope

- Product base fields only as grid columns: `kode_item`, `barcode`, `nama_item`,
  `category` (kategori name, free text, `firstOrCreate` like today's bulk entry),
  `satuan`, `harga_pokok`, `harga_jual`, `stok`.
- Units (`product_units`) and price tiers (`price_tiers`) are **not** grid
  columns. Each row gets an action that opens the existing
  `ProductUnitsManager` / `ProductPriceTiersManager` dialogs, unmodified,
  scoped to that row's product. These dialogs call the real per-product
  endpoints, so they only work once a row has a persisted `product_id`.
- Out of scope: clipboard paste from Excel/Sheets, stock-in mass input, stock
  opname frontend. (Noted as future follow-ups, not built now.)

## Entry points (`resources/js/pages/inventory.tsx`)

- **"Mass Add"** button — opens the grid with a few blank rows.
- **"Mass Edit"** button — enabled once the user checks rows via a new
  checkbox column on the existing product table; opens the grid pre-loaded
  with those products.
- Both share one dialog/grid. A row without an `id` creates; a row with an
  `id` updates. `Save All` submits every dirty row in one request.

## Stok column: create vs update

`UpdateProductRequest` today deliberately excludes `stok` — stock changes flow
through `Purchase`/`StockAdjustment` for audit trail (`stok_sebelum`/
`stok_sesudah`/`selisih`). The grid must not bypass that: `stok` is editable
only on rows without an `id` (new products, initial stock). For loaded
existing rows the `stok` cell is read-only display, matching current
single-edit behavior.

## Backend

Replace `ProductController::storeBulk` (and its route `inventory.bulk-store`,
`BulkStoreProductRequest`) with `ProductController::bulkSave` on the same
route, accepting:

```
rows: [
  { id?: int, kode_item, barcode?, nama_item, kategori?, satuan, harga_pokok, harga_jual, stok? }
]
```

New `BulkSaveProductRequest` validates `rows` as an array (`min:1`), with
per-row rules following the `items.*.field` pattern already used in
`StorePurchaseRequest`. Uniqueness for `kode_item`/`barcode` must account for:
other rows in the same payload (in-batch duplicates) and existing DB rows,
ignoring the row's own `id` when present (same as `UpdateProductRequest`).

`bulkSave` runs in a DB transaction: rows without `id` → `Product::create`
(`stok` required, defaults per current bulk behavior); rows with `id` →
`$product->update()` (excluding `stok`), category resolved via
`Category::firstOrCreate(['nama' => ...])` when a kategori string is given,
same as today. On any row failure, return per-row errors keyed by index
(`rows.{index}.field`) via Laravel's standard validation error bag — the
frontend maps these back to grid cells. Partial success is not allowed since
this is a review-then-save spreadsheet workflow, unlike the old line-skipping
bulk import: the whole request validates or the whole request fails, inside
one transaction.

## Frontend

- Add `react-data-grid` dependency (approved).
- `ProductMassInputDialog` component in `inventory.tsx`, replacing
  `BulkEntryDialog`. Grid rows kept in React state (draft rows), each with a
  client-side `_rowId` (crypto.randomUUID or index) distinct from the DB `id`.
- Client-side validation mirrors server rules for fast feedback (required
  fields, numeric checks, in-batch duplicate `kode_item`); server response
  errors are the authority and get merged into per-cell error state on save
  failure.
- "Edit units/tiers" row action: disabled with a tooltip ("simpan baris dulu")
  until the row has a real `id` (either loaded from an existing product, or
  returned after a successful save). Opens an inline panel reusing
  `ProductUnitsManager`/`ProductPriceTiersManager` as-is.
- Checkbox column added to the main inventory table for "Mass Edit" selection
  (`resources/js/pages/inventory.tsx` main table, currently plain `<table>`).

## Testing

- Backend: replace `tests/Feature/BulkProductEntryTest.php` scenarios
  (create + auto-category, in-batch/DB duplicate `kode_item` rejected, mixed
  create/update in one request) against the new `bulkSave` endpoint/route.
- `ProductFoundationTest.php` and other existing product tests stay as-is
  (single create/update paths unchanged).
- No frontend test framework is set up for this project beyond Pest
  browser tests where used elsewhere; manual verification via `npm run dev`
  is the check for the grid UX (per project convention: `/run` or asking the
  user to check `npm run build`/`dev` reflects UI changes).

## Self-review notes

- No placeholders left; scope explicitly excludes paste-from-Excel and
  stock-in/opname grids (deferred, not ambiguous).
- `stok`-on-update exclusion resolves a real conflict between "bulk-edit
  existing products" and the existing audit-trail invariant — documented
  above rather than left implicit.
