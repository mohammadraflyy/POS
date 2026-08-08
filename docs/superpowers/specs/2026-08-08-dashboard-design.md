# Dashboard — Design Spec

**Module:** Dashboard (today's overview/landing page) for `desktop-node`, porting `DashboardController` + `resources/js/pages/dashboard.tsx` from the Laravel web app. Also becomes the new post-login landing route.

**Why:** Gives the store owner an at-a-glance snapshot on login: today's revenue/profit/receivables/transaction count, low-stock alerts, today's top sellers, and the most recent transactions — with links out to the fuller Rekap, Inventory, and Riwayat Transaksi pages.

## Source of Truth (Laravel web app)

`DashboardController` (single-action, invokable) — `app/Http/Controllers/DashboardController.php`:

- `LOW_STOCK_THRESHOLD = 5` (private const).
- Date range: always "today" (`startOfDay()` to `endOfDay()`), no filter UI, no query params — unlike Rekap, this page has no date picker at all.
- **Omzet hari ini**: `SUM(sales.total)` where `status='selesai' AND metode_pembayaran='tunai'`, today only.
- **Jumlah transaksi hari ini**: `COUNT(*)` of `selesai` sales, today only.
- **Laba hari ini**: `SUM(subtotal - (qty * konversi * harga_pokok))` from `sale_items` joined to `sales`, `status='selesai'`, today only — same formula as Rekap.
- **Piutang beredar**: `SUM(total - dibayar)` for `selesai` bon sales — no date filter (all-time), matching what was already chosen for Rekap.
- **Stok menipis**: active products with `stok <= 5`, ordered by `stok` ascending, limit 10. Columns: `id, kode_item, nama_item, satuan, stok`.
- **Produk terlaris hari ini**: top 5 products by `SUM(qty)` today, same shape as Rekap's `produkTerlaris` but scoped to today only.
- **Transaksi terbaru**: the 5 most recent sales by `created_at` descending — **no status filter, no date filter** (cancelled sales and sales from any date can appear here, unlike every other query on this page). Each row includes its line items (for an item-summary display) and `nama_pelanggan`, `metode_pembayaran`, `status`, `total`, `dibayar`, `created_at`.

`resources/js/pages/dashboard.tsx`: 4 summary `Card`s + a "Lihat Rekap Lengkap" link to Rekap, then a 2-column row (Stok Menipis + Produk Terlaris Hari Ini, each with a "Lihat semua" link out), then a full-width Transaksi Terbaru table. Money via `formatRupiah`; `created_at` via `toLocaleString('id-ID')`. Transaction status cell: red "Dibatalkan" for cancelled, amber "Sisa {rupiah}" for a partially-paid bon sale, green "Lunas" otherwise. Stock cell shows a destructive warning icon when `stok <= 0`.

## Global Constraints

- **Dashboard becomes the new `/` landing route** (explicit user decision). Kasir moves from `/` to `/kasir`. This requires updating every existing reference to `/` as Kasir's route:
  - `App.tsx`: `/` → `Dashboard`, add `/kasir` → `Kasir`.
  - `app-sidebar.tsx`: "Penjualan" nav item's `href` → `/kasir`.
  - `Kasir.tsx`: its own breadcrumb `href` → `/kasir`.
  - `KasirHistory.tsx`: breadcrumb `href` → `/kasir`, and the "Batal" button's `navigate('/')` → `navigate('/kasir')`.
  - `BonPayment.tsx`: breadcrumb `href` → `/kasir`.
  - `Login.tsx`'s post-login `navigate('/')` needs **no change** — `/` now correctly resolves to Dashboard.
- **Maximal reuse of the already-shipped `getRekap`**: `main/dashboard.ts`'s `getDashboard(db)` computes today's local date (same `${y}-${m}-${d}` pattern used everywhere else in this app) and calls `getRekap(db, {from: today, to: today})`, taking its `summary` (omzetTunai, piutangBeredar, jumlahTransaksi, labaKotor) and `produkTerlaris` (already capped at exactly 5) directly — no new queries, no duplicated formulas, and this call inherits `getRekap`'s already-tested-and-TZ-pinned local-day correctness for free.
- **Only two genuinely new queries**: `stokMenipis` and `transaksiTerbaru` (detailed below).
- **`LOW_STOCK_THRESHOLD = 5`**, hardcoded, matching the source app exactly — no new settings UI for this.
- **`transaksiTerbaru` has no status or date filter** — this is the one place on this page where cancelled sales and old sales are intentionally visible, matching the source app.
- No dashboard customization/widgets, no real-time auto-refresh/polling — this is a page-load snapshot, matching the source app exactly.
- Money crosses the IPC boundary as Rupiah `number`; computed as integer cents in `main/dashboard.ts`.

## Architecture

```
main/dashboard.ts       — pure business logic: getDashboard(db): DashboardResult
main/ipc/dashboard.ts   — auth-guarded IPC handler, thin wrapper, money conversion
renderer/pages/Dashboard.tsx — 4 cards + 2-column row + full-width recent-transactions table
```

## Business Logic (`main/dashboard.ts`)

`export function getDashboard(db): DashboardResult`

- `DashboardResult = { summary: RekapSummary; stokMenipis: StokMenipisRow[]; produkTerlarisHariIni: ProdukTerlarisRow[]; transaksiTerbaru: TransaksiTerbaruRow[] }` — `RekapSummary` and `ProdukTerlarisRow` are the exact types already exported from `main/rekap.ts` (reused, not redefined).
- `StokMenipisRow = { id: number; kodeItem: string; namaItem: string; satuan: string; stok: number }`.
- `TransaksiTerbaruRow = { id: number; namaPelanggan: string | null; metodePembayaran: 'tunai' | 'bon'; status: 'selesai' | 'dibatalkan'; total: number; dibayar: number; createdAt: Date; itemSummary: string }` (money in cents; `itemSummary` is a pre-joined `"Produk A x2, Produk B x1"` string, computed the same way `main/purchase.ts`'s `listPurchases` already does).
- Implementation: call `getRekap(db, {from: today, to: today})`, extract `summary`/`produkTerlaris` (renamed to `produkTerlarisHariIni` in the result). Query `stokMenipis` directly against `products` (`isActive=true AND stok <= 5`, order by `stok` asc, limit 10). Query `transaksiTerbaru` against `sales` (order by `createdAt` desc, limit 5, no filters), then a second query for those 5 sales' `sale_items` joined to `products` for item names, joined in JS into each row's `itemSummary` — mirroring `listPurchases`'s established pattern exactly.

## IPC (`main/ipc/dashboard.ts`)

- `dashboard:getDashboard` — auth-guarded, forwards to `getDashboard`, converts every money field (summary's 3 money fields, `produkTerlarisHariIni[].totalPenjualan`, `transaksiTerbaru[].total`/`.dibayar`) from cents to Rupiah.

## Renderer (`renderer/pages/Dashboard.tsx`)

- Fetches once on mount, no filters, no idle state.
- 4 summary `Card`s (Omzet Hari Ini, Transaksi Hari Ini, Laba Hari Ini, Piutang Bon Beredar) + a "Lihat Rekap Lengkap" button linking to `/rekap`.
- 2-column row: **Stok Menipis** (`ReportTable`, columns Kode/Produk/Stok with a destructive warning icon when `stok <= 0`, "Lihat semua" action linking to `/inventory`) + **Produk Terlaris Hari Ini** (`ReportTable`, columns Produk/Qty/Total).
- Full-width **Transaksi Terbaru** (`ReportTable`, columns Waktu (`id-ID` locale)/Item (the pre-joined `itemSummary` string)/Metode (`"Tunai"` or `"Bon (nama)"`)/Status (red "Dibatalkan" / amber "Sisa {rupiah}" / green "Lunas", computed client-side from `total`/`dibayar`/`status`/`metodePembayaran`)/Total, with a "Lihat semua" action linking to `/history`.

## Testing

Real in-memory SQLite, no mocks. Since `getDashboard` reuses `getRekap` internally (already fully tested), Dashboard's own tests focus on what's new:

- `stokMenipis`: a product at exactly `stok=5` is included, `stok=6` is excluded, an inactive product with `stok=0` is excluded, ordered ascending, capped at 10 (seed 12 low-stock products, assert exactly 10 returned).
- `transaksiTerbaru`: returns the 5 most recent sales ordered descending by `createdAt`; a cancelled sale still appears (no status filter); a sale from outside "today" still appears (no date filter); `itemSummary` correctly joins multiple line items into a `", "`-separated string.
- `getDashboard`'s summary/produkTerlarisHariIni fields match what a direct `getRekap(db, {from: today, to: today})` call would produce (a light integration check, not re-testing `getRekap`'s own formulas).

## Out of Scope

- No dashboard customization/widgets, no real-time auto-refresh.
- No new low-stock threshold setting.
- No changes to Rekap's own behavior — `getRekap` is called, not modified.
