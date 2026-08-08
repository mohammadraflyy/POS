# Stock Opname — Design Spec

**Module:** Stock Opname (physical stock count / correction) for `desktop-node`, porting `StockAdjustmentController` + `resources/js/pages/stock-opname.tsx` from the Laravel web app.

**Why:** Lets the store owner reconcile system stock against a physical count, logging every correction (up or down) to `stock_adjustments`. This is distinct from Pembelian (which only ever increments stock via purchases) — Stock Opname can move stock in either direction.

## Source of Truth (Laravel web app)

- `StockAdjustmentController::search()` — searches active products by `q` (kode_item/nama_item/barcode/category name, all `LIKE %q%`) and/or `category_id[]` (multi-select filter). **Cap of 20 results applies unless "browsing"** — browsing means `q` is empty AND at least one category is selected, in which case all matching products are returned uncapped. Ordered by `nama_item`.
- `StockAdjustmentController::store()` — route-model-bound to a `Product`, wrapped in `DB::transaction`. Captures `stok_sebelum = $product->stok` before mutation, takes validated `stok_sesudah` from the request, computes `selisih = stok_sesudah - stok_sebelum` (can be negative, zero, or positive — no clamping). Inserts a `StockAdjustment` row (`user_id`, `tanggal = today()`, `alasan` nullable) and updates `products.stok = stok_sesudah`.
- Validation (`StoreStockAdjustmentRequest`): `stok_sesudah` — `required|integer|min:0`. `alasan` — `nullable|string|max:255`.
- `resources/js/pages/stock-opname.tsx` — idle state (search box + category multi-select, no grid) until the user types a query or picks a category. Active state shows a `react-data-grid` of results with an editable "Stok Fisik" cell per row; editing and blurring the cell auto-saves that row individually (not a batch submit) via a POST per row. `Selisih` is computed and shown live client-side.

`stock_adjustments` already exists in `desktop-node/src/main/db/schema.ts` with the exact matching shape (`productId` FK restrict, `userId` FK nullable set-null, `stokSebelum`, `stokSesudah`, `selisih`, `alasan` nullable, `tanggal`, timestamps) — **no schema migration needed for this slice.**

## Architecture

Same three-layer pattern as every prior slice this session:

```
main/stock-opname.ts       — pure business logic (searchProductsForOpname, recordStockAdjustment)
main/ipc/stock-opname.ts   — auth-guarded IPC handlers, thin wrappers
renderer/pages/StockOpname.tsx — idle-state search/browse → autosaving grid
```

## Business Logic (`main/stock-opname.ts`)

### `searchProductsForOpname(db, input: { q: string; categoryIds: number[] }): ProductOpnameRow[]`

- `ProductOpnameRow = { id: number; kodeItem: string; barcode: string | null; namaItem: string; categoryName: string | null; satuan: string; stok: number }`
- Filters: `products.isActive = true` always. If `categoryIds.length > 0`, `inArray(products.categoryId, categoryIds)`. If `q.trim() !== ''`, OR-match `kodeItem`/`namaItem`/`barcode` (`LIKE %q%`) plus the joined category's `nama` (`LIKE %q%`) — requires a `.leftJoin(categories, ...)`, which also keeps this query's Drizzle SQL generation safe from the join-less correlated-subquery bug found earlier this session (not directly relevant here since there's no correlated subquery, but the join is present regardless for the category-name match).
- `browsing = q.trim() === '' && categoryIds.length > 0`. Apply `.limit(20)` unless `browsing`.
- Ordered by `namaItem`.

### `recordStockAdjustment(db, input: { productId: number; stokSesudah: number; alasan: string | null; userId: number | null }): { id: number }`

- Validate: `Number.isInteger(stokSesudah) && stokSesudah >= 0`, else throw `'Stok fisik harus bilangan bulat, minimal 0.'`.
- `alasan`: trimmed; empty string becomes `null`.
- Wrapped in `db.transaction`: read the product's current `stok` (throw `'Produk tidak ditemukan.'` if missing) as `stokSebelum`; compute `selisih = stokSesudah - stokSebelum`; insert the `stock_adjustments` row (`tanggal` = today's local date, `YYYY-MM-DD`, using the established local-date pattern from `kasir.ts`/the Pembelian fix, not UTC); update `products.stok = stokSesudah`.
- Returns the new `stock_adjustments` row's `id`.

## IPC (`main/ipc/stock-opname.ts`)

- `stock-opname:searchProducts` — auth-guarded, forwards to `searchProductsForOpname`. No money conversion (no cents/rupiah fields in this feature).
- `stock-opname:recordAdjustment` — auth-guarded, captures `userId` from `getCurrentUser()`, forwards to `recordStockAdjustment`.

## Renderer (`renderer/pages/StockOpname.tsx`)

- **Idle state**: search input + category multi-select. No existing multi-select combobox component exists in this codebase (checked) — build a minimal one: `Popover` + `Command`, where each category renders as a `CommandItem` with a checkmark toggling its membership in a `categoryIds: number[]` state array (selecting doesn't close the popover, matching standard multi-select UX). No grid renders until `q` is non-empty or `categoryIds.length > 0`.
- **Active state**: `DataGrid` (react-data-grid, matching Mass Input/Supplier's established component) with columns: `Kode` (read-only), `Nama` (read-only), `Satuan` (read-only), `Stok Sistem` (read-only), `Stok Fisik` (editable number, defaults to `Stok Sistem` per row on load), `Selisih` (computed client-side as `stokFisik - stokSistem` on every render, not stored — colored green/red/gray for positive/negative/zero), `Alasan` (editable text, optional).
- **Autosave per row**: on committing an edit to `Stok Fisik` or `Alasan` (row change via `onRowsChange`, matching Mass Input's pattern), call `window.api.stockOpname.recordAdjustment({ productId, stokSesudah, alasan })`. Client-side guard blocks the call if `stokFisik` is blank, non-integer, or negative (same empty-string-coercion lesson applied in every prior slice). On success: update that row's `Stok Sistem` to the new value (so `Selisih` shows 0 immediately after save) and show a brief per-row "Tersimpan" indicator (matching the saved-state UI already used in Mass Input/Supplier). On failure: show a per-row error message, leave the row editable for retry.
- No page-level submit button — every row saves independently.

## Testing

Vitest against real in-memory SQLite (`createDb(':memory:', migrationsFolder)`), no mocks:

- `recordStockAdjustment`: count-up (`10→15`, `selisih +5`), count-down (`50→45`, `selisih -5`), zero-change (`selisih 0`, still logged), missing `alasan` stored as `null`, rejects negative `stokSesudah`, rejects non-integer `stokSesudah`, throws on nonexistent `productId`, updates `products.stok` to the new value.
- `searchProductsForOpname`: keyword match across kode/nama/barcode, keyword match on category name, category-only browsing returns unlimited results (test with >20 matching products), keyword search caps at 20, `is_active=false` products never appear, empty `q` + empty `categoryIds` returns nothing (or is never called by the renderer in that state — the function itself should still behave sanely, returning an empty/capped result rather than erroring).

## Out of Scope

- No adjustment history/log view for this slice (explicit decision — the web app doesn't have one either; can be its own follow-up slice later).
- No bulk "recount an entire category" workflow beyond what category browsing already provides.
- No undo/edit of a past adjustment — each save is a new permanent log row, matching the web app.
- No barcode-scanner-triggered auto-add-to-grid — barcode is just one of the searchable fields via the search box, same as the web app.
