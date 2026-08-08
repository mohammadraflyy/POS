# Rekap / Laporan — Design Spec

**Module:** Rekap (sales & business reports) for `desktop-node`, porting `RekapController` + `resources/js/pages/rekap.tsx` from the Laravel web app.

**Why:** Gives the store owner a single reports page: cash revenue, outstanding receivables, transaction count, gross profit, and four breakdowns (profit by category, profit by day, top-selling products, purchases by supplier) over a chosen date range.

## Source of Truth (Laravel web app)

`RekapController` (single-action, invokable) — `app/Http/Controllers/RekapController.php:15-100`:

- **Date range**: `from = request->date('from') ?? today()->startOfMonth()`, `to = request->date('to') ?? today()`. Every sales-based query bounds `created_at` to `[from->startOfDay(), to->endOfDay()]` (full-day inclusive both ends). The supplier-purchases query bounds `purchases.tanggal` (a date column) to raw `[from, to]`.
- **Status filtering**: every sales-based query filters `status = 'selesai'` — cancelled (`dibatalkan`) sales are excluded from omzet, piutang, transaction count, laba kotor, laba per kategori, laba per hari, and produk terlaris. Purchases have no cancel concept, so no filter there.
- **Omzet tunai**: `SUM(sales.total)` where `status='selesai' AND metode_pembayaran='tunai'`, in range.
- **Jumlah transaksi**: `COUNT(*)` of `selesai` sales (tunai + bon), in range.
- **Piutang beredar** (web app's original behavior): `SUM(total - dibayar)` for `selesai` bon sales, in range. **This port deliberately changes this to all-time** (no date filter) — see Global Constraints.
- **Laba kotor**: `SUM(subtotal - (qty * konversi * harga_pokok))` from `sale_items` joined to `sales`, in range. This is the exact formula from a real, previously-fixed bug: naive `qty * harga_pokok` undercounts cost for derived-unit sales (e.g. selling 1 DUS where 1 DUS = 10 PCS at `harga_pokok` per PCS — cost must be `1 * 10 * harga_pokok`, not `1 * harga_pokok`). Confirmed by the web app's own regression test (`RekapProfitBreakdownTest.php`): selling 1 DUS (konversi 10, harga_jual 14000) of a product with `harga_pokok=1000/pcs` yields `laba_kotor = 4000` (`14000 - 1*10*1000`), not `13000` (the wrong `14000 - 1*1000` result).
- **Laba per kategori**: same join + `categories` (left join, `COALESCE(nama, 'Tanpa Kategori')`), grouped by category, ordered by laba descending. Left join means uncategorized products still appear, bucketed as "Tanpa Kategori".
- **Laba per hari**: grouped by `DATE(sales.created_at)`, ordered by date ascending.
- **Produk terlaris**: top 5 products by `SUM(qty)` descending (raw sold-unit quantity, not converted to base units — mixing DUS and PCS quantities for the same product isn't normalized before summing; this port matches that quirk exactly, not a bug to fix).
- **Pembelian per supplier**: `SUM(purchases.total)` grouped by supplier, filtered by `purchases.tanggal` in range, ordered descending. No status filter.

`resources/js/pages/rekap.tsx` — two `<input type="date">` fields (from/to) defaulting from server-provided `filters` (reflecting the controller's month-to-date default on first load with no query params), full-page-reload-style submit via Inertia `router.get`. Layout: 4 summary `Card`s in a responsive grid, then two 2-column rows of `ReportTable` (Produk Terlaris + Pembelian per Supplier, then Laba per Kategori + Laba per Hari). Money via `formatRupiah`; Laba per Hari's date via `toLocaleDateString('id-ID')`. No charts (tabular only). No print/export.

## Global Constraints

- **Piutang beredar is all-time, not date-range-scoped** — a deliberate improvement over the web app (explicit user decision: "how much are customers into us for right now" is more useful than a range-scoped number, and the range-scoped behavior is surprising/easy to misport as all-time by accident).
- **Default date range is month-to-date** (start of current month → today) on first render, computed client-side and fetched immediately on mount — matches the web app's default, not the empty-by-default convention used by `KasirHistory.tsx` elsewhere in this port. A reports page needs a bounded default; "everything ever" is a much heavier and less useful default for aggregates than for a transaction list.
- **Laba per hari groups by local calendar day, not UTC** — `sales.createdAt` is a full timestamp; grouping by UTC day would misfile a late-evening or early-morning WIB (UTC+7) sale into the wrong calendar day, the same bug class already found and fixed twice this session (Pembelian's `tanggal` default, Stock Opname's design already built around this lesson). The exact SQL/Drizzle expression for local-day grouping needs to be empirically verified during planning (per this session's established practice), not guessed.
- **`dibatalkan` sales excluded from every sales-based calculation** — omzet, jumlah transaksi, laba kotor, laba per kategori, laba per hari, produk terlaris. Purchases have no cancel concept.
- **Read-only module** — no writes, no `db.transaction`, no mutation IPC. `getRekap` is the only entry point.
- **One aggregate response, not five separate calls** — `getRekap(db, {from, to})` returns the full `RekapResult` (summary + all 4 breakdowns) in a single call, matching the web app's single-page-response model and avoiding 5 round-trips for what's conceptually one report.
- **No charts, no print/export** — matches the web app exactly; an already-established prior scoping decision (see project history), not re-litigated here.
- **Produk terlaris sums raw sold quantity across units without normalizing to base units** — matches the web app's exact behavior (a known quirk, not something this port corrects).
- Money crosses the IPC boundary as Rupiah `number`; computed/aggregated as integer cents in `main/rekap.ts`.

## Architecture

```
main/rekap.ts       — pure business logic: getRekap(db, { from, to }): RekapResult
main/ipc/rekap.ts   — auth-guarded IPC handler, thin wrapper, money conversion
renderer/pages/Rekap.tsx — date-range filter + 4 summary cards + 4 ReportTables
```

## Business Logic (`main/rekap.ts`)

`export function getRekap(db, input: { from: string; to: string }): RekapResult`

- `input.from`/`input.to` are `YYYY-MM-DD` strings from the renderer's date inputs.
- `RekapSummary = { omzetTunai: number; piutangBeredar: number; jumlahTransaksi: number; labaKotor: number }` (all money in cents).
- `LabaPerKategoriRow = { categoryName: string; omzet: number; laba: number }`
- `LabaPerHariRow = { tanggal: string; omzet: number; laba: number }`
- `ProdukTerlarisRow = { namaItem: string; qtyTerjual: number; totalPenjualan: number }`
- `PembelianPerSupplierRow = { supplierName: string; totalPembelian: number }`
- `RekapResult = { summary: RekapSummary; labaPerKategori: LabaPerKategoriRow[]; labaPerHari: LabaPerHariRow[]; produkTerlaris: ProdukTerlarisRow[]; pembelianPerSupplier: PembelianPerSupplierRow[] }`

Date-range filtering on `sales.createdAt` (a full timestamp) mirrors the existing pattern in `main/ipc/kasir.ts`'s `listSalesHistory` handler: `gte(sales.createdAt, new Date(\`${from}T00:00:00\`))` and `lte(sales.createdAt, new Date(\`${to}T23:59:59\`))`. Filtering on `purchases.tanggal` (already a `YYYY-MM-DD` text column) uses direct string comparison (`gte`/`lte` on the text column), same as the column's native sort order.

## IPC (`main/ipc/rekap.ts`)

- `rekap:getRekap` — auth-guarded, forwards to `getRekap`, converts every money field (summary's 3 money fields, plus `omzet`/`laba`/`totalPenjualan`/`totalPembelian` in each breakdown row) from cents to Rupiah before returning.

## Renderer (`renderer/pages/Rekap.tsx`)

- Date-range filter: two `<input type="date">` fields + "Terapkan" button, matching `KasirHistory.tsx`'s existing filter pattern.
- Defaults to month-to-date on mount (`from` = first day of current month, `to` = today, both computed client-side), fetches immediately with that default range — no empty/idle state, unlike Stock Opname's search-gated idle state (this page always has a sensible default to show).
- 4 summary `Card`s: Omzet Tunai, Piutang Bon Beredar (all-time), Jumlah Transaksi, Laba Kotor — `formatRupiah` for money, plain number for transaction count.
- 4 `ReportTable`s in a 2×2 grid, reusing the existing component: Produk Terlaris + Pembelian per Supplier (row 1), Laba per Kategori + Laba per Hari (row 2). Money columns right-aligned via `formatRupiah`; `Laba per Hari`'s `tanggal` column formatted via `id-ID` locale, matching the web app.
- Submitting a new range triggers one `getRekap` call, replacing all summary + breakdown state at once.

## Testing

Real in-memory SQLite (`createDb(':memory:', migrationsFolder)`), no mocks:

- Omzet tunai excludes bon sales and cancelled sales.
- Jumlah transaksi counts both tunai and bon `selesai` sales, excludes cancelled.
- Piutang beredar is genuinely all-time — a bon sale outside the queried date range still contributes to `piutangBeredar` (dedicated test proving the date filter does NOT apply here).
- Laba kotor's `qty * konversi * hargaPokok` formula — a dedicated regression test mirroring the web app's own gotcha-guard test (a derived-unit sale must compute cost correctly, not `qty * hargaPokok` alone).
- Laba per kategori's `'Tanpa Kategori'` fallback for products with no category.
- Laba per hari groups by local calendar day — a dedicated test using a timestamp near local midnight to prove no UTC-day misfiling (given this session's history of two real UTC-vs-local date bugs already).
- Produk terlaris returns at most 5 rows, ordered by quantity descending.
- Pembelian per supplier respects the date range on `purchases.tanggal`.
- Cancelled sales excluded from every relevant query (a single dedicated test per calculation, or one shared fixture reused across assertions).

## Out of Scope

- No charts — tabular only, matching the web app and an already-established prior scoping decision.
- No print/export.
- No "Neraca" (balance sheet) — flagged with a question mark in the original project roadmap, a materially larger accounting scope, never committed to; not part of this slice.
- No normalization of `produkTerlaris`'s summed quantities across different units — matches the web app's exact (quirky) behavior.
