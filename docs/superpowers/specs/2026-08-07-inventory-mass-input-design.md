# Inventory Slice 3: Mass Input & Import Excel — Design Spec

**Status:** Approved
**Scope:** `desktop-node/` only. Third slice of the Katalog Produk (Inventory) module. Two related features: **Mass Input** (a full-page editable grid for adding/editing many products at once, faithfully porting `resources/js/pages/inventory/mass-input.tsx`) and **Import Excel** (bulk import from a spreadsheet, porting `ProductController::import`/`parseImportFile`). Both were left as disabled/absent buttons in Slice 1 pending this work.

## Why

Slice 1's grid has no way to add a product at all — "Tambah Produk" and "Edit Massal" have sat disabled since that slice shipped, with `title="Menunggu fitur Mass Input"`. Slice 1 also explicitly deferred Import Excel pending a dependency decision. This slice closes both gaps, completing the Inventory module's core CRUD story.

## 1. Scope & File Structure

- `main/inventory-bulk.ts` (new) — batch create/update business logic, kept separate from `main/inventory.ts` (single-product CRUD, 268 lines) as its own sub-domain, mirroring the `inventory-units.ts` split from Slice 2.
- `main/ipc/inventory.ts` (extended) — new channels appended to the existing file.
- `renderer/pages/inventory/MassInput.tsx` (new) — the full-page grid, its own route (`/inventory/mass-input`), matching this app's existing page-per-feature pattern (KasirHistory, Settings, BonPayment are all separate routes, not dialogs).
- `renderer/pages/Inventory.tsx` (extended) — enable "Tambah Produk"/"Edit Massal", add "Import Excel".
- `App.tsx` (extended) — new route registration.

**New dependency:** `xlsx` (SheetJS) — pure JavaScript, zero native bindings, parses `.xlsx`/`.xls`/`.csv` with one library. Chosen specifically to avoid native-module risk: this project's ESC/POS printing work discovered a "simple" native printer package was a broken, unmaintained 2013-era dependency, and the entire custom-PowerShell printing approach exists to avoid exactly that class of risk. A pure-JS parser sidesteps native compilation and this project's existing dual-ABI (Node/Electron) rebuild friction entirely.

## 2. Mass Input

### Route and entry points

`/inventory/mass-input`, reading an optional `?ids=1,2,3` query string via `useSearchParams` (a new hook usage for this app, but a standard part of the already-installed `react-router-dom`).

- **"Tambah Produk"** (`Inventory.tsx`, currently disabled) → navigates with no `ids` → grid starts with 3 blank rows.
- **"Edit Massal (`n`)"** (`Inventory.tsx`, currently disabled, enabled once ≥1 row selected) → navigates with `ids` = the selected product ids joined by comma → grid starts pre-filled with those products (via a new `getProductsByIds(db, ids)` business-logic read, ordered by `namaItem`).

### Grid

`DataGrid`, same sizing/theming pattern as `Inventory.tsx` (`useElementWidth`/`useAvailableHeight`/`rdg-dark`/`rdg-light`). Draft row shape mirrors the web app's `DraftRow`: `key` (client-side uuid, stable across edits), `id` (`number | null` — null means unsaved/new), `kodeItem`, `barcode`, `namaItem`, `kategori`, `satuan`, `hargaPokok`, `hargaJual`, `stok` (all strings for free editing, converted at save time).

Columns:
- Kode Item / Barcode / Nama Item / Kategori / Satuan / Harga Pokok / Harga Jual — all `editable: true`, `renderTextEditor`, red-cell on validation error (matching `Inventory.tsx`'s `rowErrors`-driven `cellClass` pattern).
- Stok — `editable: (row) => row.id === null` (only new/unsaved rows can set stock directly; existing rows show it read-only). This matches Slice 1's decision that stock changes on existing products route through Purchase/Stock Opname, not direct edits.
- Satuan/Harga Bertingkat — reuses Slice 2's `ProductDetailDialog` component for rows with `id !== null` (2 badges, click opens the dialog); rows with `id === null` show "Simpan baris dulu" (matching the web app), since the dialog needs a real product id.
- Hapus — removes the row from the client-side grid only (no IPC call; this un-adds it from the batch being composed, it does not delete anything from the database).

### Toolbar

"+ Tambah Baris" (append a blank row), "Simpan Semua" (submit), "Batal" (`navigate('/inventory')`, discarding unsaved changes with no confirmation — matches the web app, which also has no unsaved-changes guard on this button).

### Validation

**Client-side** (fast feedback before any IPC round trip, mirrors `validateRows`): per row — `kodeItem`/`namaItem`/`satuan` required (non-empty after trim); `hargaPokok`/`hargaJual` required and must parse as a finite number (the empty-string-coerces-to-zero lesson from Slices 1–2: check `trim() === ''` before `Number(...)`, never let an empty field silently become `0`); **within-batch duplicate `kodeItem`** flagged on all colliding rows (not just the second one), matching the web app's `validateRows` behavior of marking every row sharing a duplicate code. Failing rows get red-cell highlighting; a summary list of `Baris {n}: {message}` renders above the grid, matching `Inventory.tsx`'s existing error-summary pattern.

**Server-side** (main process, defense in depth — never trust the renderer): the same per-field rules, plus DB-level uniqueness (`kodeItem`/`barcode` not already used by a *different* product — `id`-excluding check, same pattern as `updateProduct`). **All rows are validated before any write happens; if any row fails, nothing is saved** and a per-row error map returns to the grid — mirroring Laravel's `FormRequest`-then-`DB::transaction` sequencing, where validation completes fully before the transactional write ever begins. Implemented as: validate every row into an error map first; if the map is non-empty, return it immediately without touching the DB; otherwise wrap all writes in one `db.transaction(...)` (this codebase's established atomic-write pattern, already used by `kasir.ts`'s checkout/cancelSale/recordBonPayment).

### Save (`bulkSaveProducts`, calls the shared `saveProductRows`)

For each row: resolve `kategori` via find-or-create against `categories.nama` (same as `updateProduct`). If `id` is set, update the existing product; if `id` differs from stored values, log a `product_price_histories` row only when `hargaPokok`/`hargaJual` actually changed (same "only if changed" rule as Slice 1's `updateProduct`) — stock is **never** touched on update in this path (`updateStok: false`, see §4). If `id` is null, create a new product with `isActive: true` and the row's `stok` value. Returns `{created, updated, unchanged}` — a row counts as `unchanged` when an update path runs but nothing actually differs from the stored values (same detection as Slice 1: compare fetched-before vs. submitted values).

## 3. Import Excel

### Flow

New "Import Excel" toolbar button in `Inventory.tsx` (not previously present, even disabled — Slice 1 explicitly deferred this feature entirely). Click → a single IPC call opens Electron's native `dialog.showOpenDialog` (filtered to `.xlsx`/`.xls`/`.csv`) **in the main process** (not the renderer — avoids any renderer-side filesystem access questions) → if a file is chosen, the main process reads, parses, and saves it in the same call → returns a result summary, or `null` if the user cancelled. The button shows "Mengimpor..." (disabled) while the promise is pending, matching the web app's `importing` state. On completion, the result (`{created, updated, unchanged, skipped}` or a "dibatalkan" no-op) renders in the existing status-message area (`Inventory.tsx`'s `role="alert"` pattern — this app has no toast system), and the grid reloads via `loadPage(currentPage)`.

### Column detection (`resolveImportColumns` port)

Scan the sheet's rows top-to-bottom for the first row containing all 5 required header labels, case-insensitive, Indonesian: "kode item" → `kodeItem`; "nama item" → `namaItem`; "satuan" → `satuan`; "harga beli" or "harga pokok" → `hargaPokok`; "harga jual" → `hargaJual`. Optional labels, mapped if present: "kode barcode" or "barcode" → `barcode`; "jenis" or "kategori" → `kategori`; "stok" → `stok`. Column order is irrelevant — headers are matched by label, not position, and any row(s) above the header (a title/address block, common in real-world exports) are ignored. If no row satisfies all 5 required labels, the import processes 0 rows (not an error — reported as `{created: 0, updated: 0, unchanged: 0, skipped: 0}`).

### Row extraction and leniency (`parseImportFile`/`validateImportRows`/`parseImportNumber` port)

For every row after the header: blank `kodeItem` (after trim) is silently skipped (not counted — almost always a trailing empty row, not user data). Blank `namaItem` or `satuan` (after trim) is skipped and **counted** as skipped. Numbers are parsed leniently: `parseImportNumber` strips thousands-separator commas and spaces before parsing (e.g. `"15,000"` → `15000`); a value that still isn't numeric after stripping becomes `0` (matches the web app exactly — this is acceptable here because the row still goes through the same required/numeric validation as every other row, so a garbage price cell that parses to `0` gets caught by the same required-numeric rule, not silently accepted). Each remaining candidate row is validated with the same field rules as Mass Input (required/max-length/numeric/non-negative) — **but unlike Mass Input, invalid rows are skipped and counted individually, not treated as a whole-batch failure.** This asymmetry is deliberate and faithfully ported: a real-world spreadsheet export is never perfectly clean, and rejecting 500 good rows because one is malformed would defeat the purpose of a bulk import tool. `skipped` in the result accumulates both categories (missing required fields, and failed field validation).

**Deliberate improvement over the web app (prevents a real crash, not scope creep):** the original `parseImportFile` resolves each row's target product id by matching `kodeItem` against *already-existing* database rows (`$existingIds[$kodeItem] ?? null`), but never checks for `kodeItem` collisions *within the uploaded file itself*. Two sheet rows sharing a new (not-yet-existing) `kodeItem` would both resolve to `id: null` and both attempt `CREATE` — the second hits the database's `kodeItem` unique constraint mid-transaction, an unhandled crash in the original app (no per-row try/catch exists around `Product::create`/`update` in `saveRows`). This port **deduplicates within-file `kodeItem` collisions before saving**: the first occurrence of a given `kodeItem` in the file wins, every later occurrence of the same code is skipped and counted (folded into the same `skipped` counter as other invalid rows — no new result field), avoiding the crash entirely.

### Save (`importProducts`, calls the shared `saveProductRows`)

Calls the same `saveProductRows` as Mass Input, but with `updateStok: true` — the one behavioral difference between the two paths. On an update, `stok` **is** overwritten from the sheet's value (the sheet's count wins, matching the web app's rationale: an inventory export is expected to carry authoritative current counts). Any actual stock change (`stokSesudah !== stokSebelum`) is logged as a new row in `stock_adjustments`: `{productId, userId, stokSebelum, stokSesudah, selisih: stokSesudah - stokSebelum, alasan: 'Import Excel', tanggal: <today, 'YYYY-MM-DD'>}`. **This is the first desktop-node feature to write to `stock_adjustments`** — the table has existed since the Fase 1 schema skeleton but no feature has used it until now; no new migration is needed. On create, `stok` is always set from the sheet, same as Mass Input's create path (`updateStok` only affects the *update* branch).

### Result summary

`{created, updated, unchanged, skipped}` — same shape the web app's toast reports, rendered here as a plain status message (this app has no toast library) in `Inventory.tsx`'s existing alert-message area, e.g. `"12 produk baru, 3 diperbarui, 5 tidak berubah, 2 baris dilewati."`

## 4. `saveProductRows` — Shared Business Logic

```
saveProductRows(db, rows, options: { updateStok: boolean, userId: number | null }): { created: number, updated: number, unchanged: number }
```

Single shared function in `main/inventory-bulk.ts`, called by both `bulkSaveProducts` (Mass Input, `updateStok: false`) and `importProducts` (Import Excel, `updateStok: true`) — mirrors the web app's own `saveRows` private method being shared by both `bulkSave` and `import`. Per row:

1. Resolve `kategori` (find-or-create against `categories.nama`, empty/null → `categoryId: null` — identical to `updateProduct`).
2. If `row.id` is set: fetch the existing product, update `kodeItem`/`barcode`/`namaItem`/`categoryId`/`satuan`/`hargaPokok`/`hargaJual` (and `stok`, only if `options.updateStok`). If nothing actually changed (deep-compare old vs. new attributes, matching Eloquent's `wasChanged()`), count as `unchanged` and log nothing. If something changed, count as `updated`; log a `product_price_histories` row if `hargaPokok`/`hargaJual` changed; log a `stock_adjustments` row if `options.updateStok` and `stok` changed.
3. If `row.id` is null: create a new product (`isActive: true`, `stok` from the row), count as `created`.

## Out of Scope

- Editing a row's Satuan/Harga Bertingkat before the row is first saved (the dialog needs a real product id — matches the web app's "Simpan baris dulu" gate exactly).
- Undo/rollback of a completed import — matches the web app; import is a final write, like any other mutation in this app.
- Preview-before-import / dry-run step — matches the web app; the file is parsed and saved in one action, no staged review.
- Any UI or logic changes to Kasir, Slice 1's core grid validation, or Slice 2's units/tiers dialog beyond reusing `ProductDetailDialog` as-is.
