# Fase 2 Slice 3 — History Transaksi — Design

Status: approved
Tanggal: 2026-08-07
Referensi: `docs/superpowers/specs/2026-08-06-electron-node-migration-design.md` (Fase 2 roadmap), `resources/js/pages/kasir-history.tsx`, `app/Http/Controllers/SaleController.php::history`, `docs/superpowers/plans/2026-08-07-kasir-ui-plan-c-cetak-struk.md` (final review's rekomendasi `getReceipt` extraction)

## Latar belakang

Slice 1-2 (checkout inti, UI full parity, cetak struk) sudah selesai. Kasir sekarang cuma bisa lihat/batalkan transaksi **hari ini** (section "Transaksi Hari Ini" di halaman Kasir, dibangun Slice 1 — bukan bagian dari web asli). Slice ini mem-port halaman History yang sesungguhnya (`kasir-history.tsx`, 362 baris): filter tanggal/status/metode/pencarian, pagination, cetak ulang struk transaksi lama, dan batalkan transaksi (dengan aturan berbeda dari section "hari ini": cuma boleh kalau `dibayar === 0`).

Tombol "Bayar Bon" (link ke halaman bon payment) **disembunyikan** di slice ini — keputusan eksplisit user, karena halaman tujuannya belum dibangun (slice terpisah nanti). Kolom Status tetap menampilkan "Sisa RpX" untuk bon belum lunas, cuma belum ada tombol aksinya.

## Sumber kebenaran (dibaca penuh)

- `resources/js/pages/kasir-history.tsx` — filter form (search/dari/sampai/status/metode), `react-data-grid` (kolom #/Tanggal/Item/Metode/Status/Total/Aksi), pagination via `sales.links`, cetak struk (`receiptSale` state + `window.print()` effect — di desktop-node diganti `printReceipt` IPC yang sudah ada), cancel (`Number(row.dibayar) === 0` sebagai syarat tombol muncul — **beda** dari section "Transaksi Hari Ini" di Kasir yang cuma cek `status === 'selesai'`).
- `app/Http/Controllers/SaleController.php::history` — filter Eloquent: `whereDate('created_at', >=/<=, dari/sampai)`, `where('status', ...)`, `where('metode_pembayaran', ...)`, search di `nama_pelanggan` ATAU `items.product.nama_item` (via `orWhereHas`), `paginate(20)`.
- `resources/js/hooks/use-available-height.ts` — hook kecil (ResizeObserver-free, pakai `getBoundingClientRect` + resize listener) untuk tinggi grid mengisi sisa viewport.
- `resources/js/components/ui/select.tsx` — shadcn `Select` (butuh `@radix-ui/react-select`, dependency baru).
- `resources/js/types/ui.ts`'s `Paginated<T>` — shape pagination Laravel (`data`, `links`, `current_page`, `last_page`, `total`).

## Arsitektur

### Backend
- **`kasir:listSalesHistory`** (IPC baru, `ipc/kasir.ts`): terima `{dari?, sampai?, status?, metodePembayaran?, search?, page}`, query dinamis (filter `createdAt` range, `status`, `metodePembayaran`, `search` di `namaPelanggan` LIKE atau join `sale_items`+`products.namaItem` LIKE), `LIMIT 20 OFFSET (page-1)*20`, return `{data: SaleHistoryDto[], currentPage, lastPage, total}` — bentuk lebih sederhana dari Laravel's `links` array (desktop-node bikin tombol halaman dari `currentPage`/`lastPage` langsung di renderer, bukan re-parse HTML label Laravel).
- **`getReceipt(db, saleId, kasirName)`** (fungsi baru, diekstrak dari `kasir:checkout`'s inline query jadi fungsi reusable di `ipc/kasir.ts` — bukan `main/kasir.ts`, karena ini murni read/join, bukan business logic yang butuh test terpisah seperti `checkout()`/`cancelSale()`). `kasir:checkout`'s handler diringkas jadi `return getReceipt(db, result.saleId, user.name)`.
- **`kasir:getReceiptForSale`** (IPC baru): `getCurrentUser()` guard, panggil `getReceipt(db, saleId, sale.user?.name ?? null)` — perlu join `users` untuk dapat nama kasir transaksi lama (bukan user yang sedang login), beda dari `checkout`'s `user.name` (kasir yang login saat itu).
- Cancel: pakai `cancelSale` yang sudah ada, tidak berubah.

### Frontend
- Route baru `/history` di `App.tsx` (react-router).
- **`useAvailableHeight`** (hook baru, port persis).
- **`Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue`** (komponen shadcn baru, `@radix-ui/react-select` dependency baru).
- **`KasirHistory.tsx`**: filter form, `react-data-grid` table, pagination (tombol Prev/Next + nomor halaman dari `currentPage`/`lastPage`, bukan re-render Laravel's `links` HTML labels), cetak struk (`getReceiptForSale` → `printReceipt`, reuse `Receipt` component dari Slice 2), cancel (reuse `cancelSale` IPC), tombol nav "Ke Kasir".
- Kasir.tsx dapat link "Riwayat Transaksi" (nav sederhana antar 2 halaman, belum ada layout/sidebar permanen — itu di luar scope).

## Testing

`getReceipt` diekstrak sebagai fungsi murni (menerima `db`/`saleId`/`kasirName`, tidak ada dependency ke Electron) — cukup sederhana (3 query + mapping, sama seperti yang sudah ada di checkout handler) sehingga tidak perlu test terpisah, konsisten dengan keputusan Slice 2 bahwa IPC read-layer tidak diuji unit (logic bisnis yang diuji ada di `main/kasir.ts`). `listSalesHistory`'s filter logic juga read-only tanpa business logic — tidak ada test baru di plan ini, verifikasi manual/CDP seperti slice-slice sebelumnya.

## Di luar scope

Halaman Bon Payment (tombol "Bayar Bon" disembunyikan), layout/sidebar navigasi permanen (nav antar halaman tetap link sederhana), export/print rekap dari History (beda dari cetak struk per transaksi).
