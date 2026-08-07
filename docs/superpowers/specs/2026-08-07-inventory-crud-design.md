# Inventory Slice 1: CRUD Dasar — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. First slice of the Katalog Produk (Inventory) module — list, inline-edit, delete (single + bulk), search, pagination. Faithfully ports `resources/js/pages/inventory.tsx`'s core grid (minus the units/tiers dialog and mass-input/import flows, which are later slices). All underlying DB tables (`products`, `categories`, `product_units`, `product_price_tiers`, `product_price_histories`, `stock_adjustments`) already exist from the Fase 1 skeleton — this slice is pure frontend + IPC, no schema changes.

## Why

`desktop-node`'s sidebar has had a disabled "Katalog Produk" entry since the Login+Sidebar plan. Kasir and History already read from `products`, but there's no way to add, edit, or manage the catalog from inside `desktop-node` at all — every product currently in `dev.sqlite` was seeded manually. This slice makes the catalog manageable.

## Terminology and Scope Boundary

The web app has no single-product "Add" dialog — clicking "Tambah Produk" navigates to a separate Mass Input page (a blank editable grid). Every list-view field is directly inline-editable in the main grid (autosaves per cell on change), not via an edit dialog. This slice ports that exact pattern faithfully: **List + inline-edit + delete**, no add capability yet. "Tambah Produk" and "Edit Massal" render as disabled buttons (Slice 3 will enable them once Mass Input exists) — visible as a preview, not silently missing, matching the sidebar's existing pattern for unbuilt modules.

The "Satuan/Harga Bertingkat" badge column and its management dialog (`ProductUnitsManager`/`ProductPriceTiersManager`/`ProductPriceHistoryList`) are Slice 2 — omitted from this slice's grid entirely, not stubbed.

## 1. Business Logic — `main/inventory.ts` (new file)

Follows this project's established pattern (pure functions, unit-tested against a real in-memory SQLite db, no I/O beyond the passed-in `db` handle) — parallel to `main/kasir.ts`, split into its own file since `kasir.ts` is already 383 lines and this is a distinct domain.

- **`listProducts(db, {search, page, pageSize}): {data, currentPage, lastPage, total}`** — `search` matches `kodeItem`/`namaItem`/`barcode` via `LIKE %search%` (OR'd, matching the web app's `orWhere` chain), left-joined with `categories` for the display name, ordered by `namaItem`. `pageSize` defaults 25, matching `PER_PAGE_OPTIONS = [10, 25, 50, 100]` — invalid values fall back to 25.
- **`updateProduct(db, id, input)`** — validates exactly like `UpdateProductRequest`:
  - `kodeItem`: required, max 50, unique among `products` excluding this row → `"Kode item wajib diisi."` / `"Kode item maksimal 50 karakter."` / `"Kode item sudah digunakan."`
  - `barcode`: nullable, max 100, unique excluding this row (only checked when non-null/non-empty) → `"Barcode maksimal 100 karakter."` / `"Barcode sudah digunakan."`
  - `namaItem`: required, max 255 → `"Nama item wajib diisi."` / `"Nama item maksimal 255 karakter."`
  - `kategori`: nullable, max 255, free text — resolved server-side: empty/null → `categoryId = null`; non-empty → find-or-create a `categories` row by exact `nama` match (mirrors `Category::firstOrCreate`), then use its `id`.
  - `satuan`: required, max 20 → `"Satuan wajib diisi."` / `"Satuan maksimal 20 karakter."`
  - `hargaPokok`/`hargaJual`: required, integer cents ≥ 0 → `"Harga pokok tidak boleh negatif."` / `"Harga jual tidak boleh negatif."`
  - `isActive`: boolean, required.
  - On success, records a `product_price_histories` row if `hargaPokok`/`hargaJual` actually changed (mirrors `logPriceChange` — compares old vs. new, only inserts when different), matching the web app's audit-trail behavior exactly.
- **`deleteProduct(db, id)`** — attempts `DELETE FROM products WHERE id = ?`. `sale_items.product_id`/`purchase_items.product_id` are `onDelete: 'restrict'` in the schema, so SQLite raises `FOREIGN KEY constraint failed` when the product has transaction history. Catch that specific error and re-throw: `"Produk tidak bisa dihapus karena sudah punya riwayat transaksi. Nonaktifkan saja lewat tombol Edit."` — any other error propagates unchanged.
- **`bulkDeleteProducts(db, ids): {deleted: number, blocked: string[]}`** — loops `deleteProduct` per id, each attempt independent (deliberately NOT wrapped in a single all-or-nothing transaction, unlike `checkout`) — mirrors the web app's `bulkDestroy`, which is explicitly partial-success: restricted products are collected by name into `blocked`, everything else is deleted. Returns the count deleted and the list of blocked product names.
- **`searchProductsQuick(db, q): array`** — same 3-field LIKE as `listProducts`, capped at 20 results, ordered by `namaItem`, returns `{id, kodeItem, barcode, namaItem, categoryName, satuan, hargaJual, isActive}` — powers the command-palette quick search.

## 2. IPC — `main/ipc/inventory.ts` (new file), registered in `main/index.ts`

All handlers auth-guarded (`getCurrentUser()` check, `'Silakan login terlebih dahulu.'`), following every existing handler's convention. Money crosses the boundary as Rupiah, converted via the existing `toRupiah`/`toCents` pattern (duplicated locally in this file, same as `ipc/kasir.ts` — no shared money-conversion module exists yet, not introduced here).

- `inventory:listProducts(filters)` → `listProducts`
- `inventory:updateProduct(id, input)` → `updateProduct`
- `inventory:deleteProduct(id)` → `deleteProduct`
- `inventory:bulkDeleteProducts(ids)` → `bulkDeleteProducts`
- `inventory:searchProducts(q)` → `searchProductsQuick`

## 3. Renderer — `pages/Inventory.tsx`

Wrapped in `AppShell`, breadcrumb `[{title: 'Katalog Produk', href: '/inventory'}]`.

**Grid** (`DataGrid`, mirroring `KasirHistory.tsx`'s sizing/theming pattern — `useElementWidth`/`useAvailableHeight`/`rdg-dark`/`rdg-light`):
- `SelectColumn` (row selection checkboxes).
- Kode Item / Barcode / Nama / Kategori / Satuan / Harga Pokok / Harga Jual — all `editable: true`, `renderEditCell: renderTextEditor`, autosave on `onRowsChange` (calls `updateProduct` for the edited row, matching the web app's `saveRow`-on-`handleRowsChange` pattern). A cell showing a field-level error (from the last save attempt) gets a red background class, matching the web app's `rowErrors`-driven `cellClass`.
- Stok — read-only display (no direct stock editing in this slice; stock changes flow through Purchase/Stock Opname in later phases, matching the web app's existing separation).
- Status — checkbox toggle (Aktif/Nonaktif), autosaves via the same `updateProduct` path.
- Aksi — "Hapus" button, opens `useConfirm()` before calling `deleteProduct`; on the FK-restrict error, the message renders above the grid (matching the web app's `deleteError`/`InputError` placement).

**Toolbar:**
- Search `Input` + Cari button (submits `listProducts` with the search term, resets to page 1).
- "Import Excel" — **not included this slice** (needs a Node Excel-parsing library, a separate dependency decision — deferred to its own future slice, not stubbed as a disabled button since it wasn't part of this slice's scope discussion).
- "Edit Massal (`n`)" and "Tambah Produk" — rendered `disabled`, `title="Menunggu fitur Mass Input"`.
- "Hapus Terpilih (`n`)" — enabled once ≥1 row selected, calls `bulkDeleteProducts` (or `deleteProduct` directly when exactly 1 is selected, matching the web app's `deleteSelected` single-vs-bulk branch) behind a `useConfirm()` dialog whose wording matches the count (`"Hapus produk \"{nama}\"?"` for 1, `"Hapus {n} produk terpilih?"` for more).

**Keyboard shortcuts** (window-level `keydown`, skipped when an editable target — input/textarea/select/contentEditable — is focused, matching the web app's `isEditableTarget` guard):
- `/` — opens the quick-search `CommandDialog`.
- `Delete`/`Backspace` — triggers the same delete-selected flow as the toolbar button, when ≥1 row is selected.

**Quick search** — `CommandDialog` (already ported, used by Kasir's `CommandPalette`), live-queries `searchProductsQuick` on each keystroke, shows matched products (name · kode_item · category, "Nonaktif" tag when inactive) plus a "Cari semua untuk …" action that runs the full grid search with that term. Selecting a product result jumps the grid search to that product's `kodeItem` (matching `jumpToProduct`'s behavior — narrows the list to that exact item via the search field, since there's no per-product detail page in this app).

**Pagination** — prev/next buttons + current/last page label + a "Tampilkan" per-page `Select` (10/25/50/100), matching the exact shape already established in `KasirHistory.tsx` (this app has no Laravel-style `links` array to render numbered page buttons from, so prev/next is the existing convention, not a divergence).

## 4. Sidebar

`app-sidebar.tsx`'s "Katalog Produk" entry changes from `disabled: true` to enabled, `href: '/inventory'`. New route added to `App.tsx`.

## Out of Scope (this slice)

- Satuan turunan / tiered pricing management (Slice 2).
- Mass Input grid, both blank-add and edit-selected modes (Slice 3) — "Tambah Produk"/"Edit Massal" stay disabled until then.
- Excel import (separate slice — needs a new Node dependency decision).
- Direct stock editing from this page (stock changes route through Purchase/Stock Opname, unchanged from the web app's design).
- Product price history display (`ProductPriceHistoryList`) — history is still recorded by `updateProduct` in this slice (so no data is lost), just not yet shown anywhere in the UI until Slice 2's dialog exists.
