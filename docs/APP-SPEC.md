# POS App — Spesifikasi Lengkap (DB → Business Flow) untuk Migrasi ke Pure Electron

Dokumen ini merangkum seluruh domain aplikasi (skema DB, model, alur bisnis, routing, frontend, printing, barcode scan, dan setup desktop saat ini) sebagai referensi tunggal untuk migrasi dari NativePHP kembali ke **pure Electron**. Diambil langsung dari kode per 2026-08-05 (branch `desktop-app-electron`).

## 1. Stack Saat Ini

- **Backend**: Laravel 13 (PHP 8.3), Inertia.js v3 (server-driven SPA, tanpa REST API terpisah untuk halaman).
- **Frontend**: React 19 + TypeScript, Tailwind v4, shadcn/ui, `react-data-grid` untuk tabel Kasir/Inventory.
- **Auth**: Laravel Fortify (login, register, 2FA, passkeys via `@laravel/passkeys`).
- **DB**: lihat `config/database.php` untuk driver aktif (migrasi ditulis generik, cocok SQLite maupun MySQL).
- **Desktop shell saat ini**: `nativephp/desktop` (^2.2) — membungkus app Laravel dengan Electron secara otomatis (auto-start PHP server, buka `Window`, dsb). Sebelumnya app ini punya `electron/main.cjs` hand-written yang sudah dihapus saat migrasi ke NativePHP (lihat `git show HEAD~ -- electron/main.cjs` bila perlu dilihat lagi).
- Satu-satunya kode NativePHP-spesifik: `app/Providers/NativeAppServiceProvider.php` — buka `Window` (judul = nama toko, 1280x800, maximized, load `route('login')`). Tidak ada logic printing/scanning yang sudah pakai API NativePHP.

## 2. Skema Database

Semua tabel inti (di luar tabel bawaan Laravel/Fortify/Passkey/Jobs/Cache):

### `products` (katalog barang)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `kode_item` | string, unique | SKU internal |
| `barcode` | string, unique, nullable | untuk scan kasir |
| `nama_item` | string | |
| `category_id` | FK → `categories`, nullable, `nullOnDelete` | |
| `satuan` | string | satuan dasar (mis. "PCS") |
| `harga_pokok` | decimal(12,2) | HPP satuan dasar |
| `harga_jual` | decimal(12,2) | harga jual satuan dasar (default, sebelum tier/unit override) |
| `stok` | integer | stok **dalam satuan dasar** — semua konversi unit lain dihitung balik ke sini |
| `is_active` | boolean | soft-disable tanpa hapus |

### `categories` — `nama` (unique). Master kategori (dulunya string bebas di `products.kategori`, sudah dimigrasi jadi tabel + FK).

### `product_units` (satuan turunan, mis. 1 DUS = 12 PCS)
`product_id` FK cascade · `satuan` · `konversi` (unsignedInteger, faktor ke satuan dasar) · `harga_jual` (harga khusus untuk satuan ini). Unique `(product_id, satuan)`.

### `product_price_tiers` (harga bertingkat berdasar qty, satuan dasar saja)
`product_id` FK cascade · `min_qty` (unsignedInteger) · `harga_jual`. Unique `(product_id, min_qty)`. Tier dengan `min_qty` tertinggi yang masih ≤ qty yang menang (lihat `Product::priceForQty()`).

### `product_price_histories` — audit trail perubahan harga
`product_id` FK cascade · `user_id` FK nullable · `harga_pokok_lama/baru` · `harga_jual_lama/baru`. Ditulis otomatis tiap kali harga produk berubah (edit manual, mass-save, atau import Excel).

### `suppliers` — `nama` · `telepon` · `alamat` · `keterangan`.

### `purchases` (barang masuk / pembelian dari supplier)
`supplier_id` FK nullable `nullOnDelete` · `user_id` FK nullable `nullOnDelete` · `tanggal` · `total` · `catatan`.

### `purchase_items`
`purchase_id` FK cascade · `product_id` FK `restrictOnDelete` (produk tak bisa dihapus kalau sudah ada histori pembelian) · `qty` · `harga_beli` · `subtotal`.

### `sales` (transaksi kasir)
`user_id` FK nullable · `nama_pelanggan` nullable · `metode_pembayaran` enum(`tunai`,`bon`) · `status` enum(`selesai`,`dibatalkan`) default `selesai` · `total` · `dibayar` (untuk tunai = total dibayar saat itu; untuk bon = akumulasi cicilan via `bon_payments`).

### `sale_items`
`sale_id` FK cascade · `product_id` FK `restrictOnDelete` · `product_unit_id` FK nullable `nullOnDelete` (null = pakai satuan dasar) · `qty` (dalam satuan yang dipilih, **bukan** selalu satuan dasar) · `konversi` (snapshot faktor konversi saat transaksi, default 1) · `satuan` (snapshot nama satuan) · `harga_jual` · `harga_pokok` (snapshot HPP saat itu) · `subtotal`.

Snapshot `konversi`/`satuan`/`harga_pokok` sengaja disimpan di baris transaksi supaya laporan lama tetap akurat meski master produk/unit berubah setelahnya.

### `bon_payments` (cicilan piutang/bon)
`sale_id` FK cascade · `jumlah` · `tanggal` · `keterangan`.

### `stock_adjustments` (stok opname / koreksi manual)
`product_id` FK `restrictOnDelete` · `user_id` FK nullable · `stok_sebelum` · `stok_sesudah` · `selisih` · `alasan` · `tanggal`. Berbeda dari `purchase_items` (yang selalu menambah): ini bisa naik atau turun (hasil hitung fisik).

### `store_settings` (single-row config toko)
`nama_toko` · `alamat` · `telepon` · `pesan_footer` (footer struk). Diakses via `StoreSetting::current()` (firstOrCreate baris tunggal).

**Relasi kunci** (lihat `app/Models/*.php` untuk detail lengkap):
`Product` 1—N `ProductUnit`, `ProductPriceTier`, `PurchaseItem`, `SaleItem`, `ProductPriceHistory`; N—1 `Category`. `Sale` 1—N `SaleItem`, `BonPayment`. `SaleItem` N—1 `Product`, `ProductUnit`. `Purchase` 1—N `PurchaseItem`; N—1 `Supplier`, `User`.

## 3. Alur Bisnis per Modul

### Kasir (`SaleController`, halaman `kasir.tsx`)
1. **Index** (`GET /kasir`): load katalog produk aktif (`is_active=true`) dengan `productUnits`+`priceTiers` eager-loaded, plus daftar transaksi hari ini. Setelah checkout, reload partial hanya `['sales']` (closure `products` di-skip Inertia — hindari query ~1400 baris katalog percuma).
2. **Checkout** (`POST /kasir`, `SaleController::store`):
   - Untuk tiap item cart: kalau ada `product_unit_id` → pakai harga/konversi/satuan dari `ProductUnit`; kalau tidak → satuan dasar, harga dari `Product::priceForQty($qty)` (qty-tier terbaik).
   - Hitung `qty_dasar = qty * konversi`, validasi stok cukup (`ValidationException` kalau kurang) — **semua dalam transaksi DB** (`DB::transaction`), termasuk decrement stok per baris dan `dibayar < total` check untuk metode tunai (rollback otomatis kalau uang kurang, gagal di tengah transaksi).
   - `sale_items` menyimpan snapshot lengkap (lihat §2) supaya cetak ulang/rekap tetap benar walau master berubah.
3. **Cancel** (`POST /kasir/{sale}/cancel`): tolak kalau sudah `dibatalkan` atau sudah ada `bon_payments`. Kalau boleh: kembalikan stok tiap item (`qty * konversi`) lalu set status `dibatalkan` — dalam transaksi.
4. **History** (`GET /kasir/history`): filter tanggal/status/metode/search, paginated 20.
5. **Bon payment** (`BonPaymentController`): hanya untuk sale `metode_pembayaran=bon` & `status=selesai`. Validasi `jumlah <= sisaPiutang()` (`total - dibayar`), lalu increment `dibayar`.

### Inventory (`ProductController`, halaman `inventory.tsx` + `inventory/mass-input.tsx`)
- CRUD standar + **live search** (`/inventory/search`, dipakai command-palette `/` di Kasir & halaman lain) dan **mass-input** (grid ala Excel untuk tambah/edit banyak produk sekaligus, `bulkSave` — all-or-nothing dalam 1 transaksi).
- **Import Excel/CSV** (`ProductController::import`, pakai `PhpOffice\PhpSpreadsheet`): deteksi baris header berdasarkan label kolom (fleksibel urutan kolom, toleran variasi nama header spt "Kode Item"/"Harga Beli"/"Harga Pokok"), match `kode_item` existing → update (hanya kalau ada field berubah), sisanya create. Baris invalid di-skip, bukan gagal seluruh file.
- Setiap perubahan harga/stok otomatis mencatat `ProductPriceHistory`/`StockAdjustment` (audit trail) — termasuk dari mass-save & import.
- Delete produk gagal (dengan pesan jelas) kalau produk sudah pernah dipakai di transaksi (`QueryException` dari FK `restrictOnDelete`) — user diarahkan pakai nonaktifkan (`is_active=false`) saja.

### Pembelian / Barang Masuk (`PurchaseController`, halaman `purchase.tsx`)
Simpan `Purchase` + `PurchaseItem[]` dalam 1 transaksi, tiap item **increment** `products.stok` langsung (selalu menambah, beda dari stock opname).

### Stok Opname (`StockAdjustmentController`, halaman `stock-opname.tsx`)
Cari produk (kode/nama/kategori/barcode, bisa browse per kategori tanpa keyword), lalu catat `stok_sesudah` hasil hitung fisik → `StockAdjustment` (log `selisih`) + update `products.stok` langsung, dalam transaksi.

### Rekap (`RekapController`, halaman `rekap.tsx`)
Filter rentang tanggal (default: awal bulan s/d hari ini). Ringkasan: omzet tunai, piutang beredar (bon belum lunas), jumlah transaksi, **laba kotor** (`subtotal - qty*konversi*harga_pokok` — penting: pakai `konversi` supaya benar untuk baris satuan turunan, mis. jual per DUS). Plus breakdown laba per kategori, laba per hari, produk terlaris (top 5), pembelian per supplier.

### Settings
- `settings/toko` (`StoreController`): edit `store_settings` (dipakai sbg judul window Electron & header struk).
- `settings/riwayat-transaksi` (`PurgeSalesController`): hapus permanen semua `Sale` sebelum tanggal tertentu (cascade ke `sale_items`/`bon_payments`) — termasuk bon yang masih outstanding (UI sudah warning sebelum submit).
- `settings/security`, `settings/profile`: standar Fortify (password, 2FA, passkey) + profile.

## 4. Routing (ringkas — `routes/web.php` + `routes/settings.php`)

Semua route bisnis di-guard `middleware(['auth', 'verified'])`. Named routes utama: `kasir(.store|.history|.cancel|.bon-payments.*)`, `inventory(.store|.update|.destroy|.bulk-destroy|.search|.mass-input|.units.*|.price-tiers.*|.bulk-save|.import)`, `supplier(.store|.update|.destroy)`, `stock-opname(.search|.store)`, `rekap`, `purchase(.store)`, `categories.store`, plus Fortify auth routes (`login`, `register`, `two-factor-challenge`, passkey routes) dan `_native/api/*` (auto-registered oleh package NativePHP — **route ini hilang kalau NativePHP dicabut**, cek tidak ada kode app yang bergantung padanya — hasil grep: memang tidak ada).

## 5. Frontend — Inventaris Halaman (`resources/js/pages/`)

`kasir.tsx` (+ `kasir/shared.tsx`, `kasir/bon-payment.tsx`), `kasir-history.tsx`, `inventory.tsx` (+ `inventory/shared.tsx`, `inventory/mass-input.tsx`), `supplier.tsx`, `purchase.tsx`, `stock-opname.tsx`, `rekap.tsx`, `dashboard.tsx`, `settings/{store,security,profile,appearance}.tsx`, `auth/{login,register,forgot-password,reset-password,two-factor-challenge,verify-email,confirm-password}.tsx`, `welcome.tsx`.

## 6. Cetak Struk (Printing) — Mekanisme Saat Ini

**Tidak silent.** Semua tempat cetak (`kasir.tsx:582`, `kasir-history.tsx:96`, `settings/store.tsx:73` untuk Test Print) pakai `window.print()` murni — membuka dialog print OS/Electron, bukan langsung kirim ke printer.

- CSS `@media print` di `resources/css/app.css` (baris ~150-172): sembunyikan semua `body *`, tampilkan hanya `.receipt-print` (58mm width, `size: 58mm auto; margin: 0`). Komponen struk: `resources/js/pages/kasir/shared.tsx` (elemen `.receipt-print hidden` yang baru divisible saat print).
- Setelah `window.print()`, UI menunggu event `afterprint` **atau** `focus` window, **atau** timeout 5 detik (safety-net karena `afterprint` tidak selalu reliable lintas OS/browser) — baru reset state "Mencetak struk...".
- Tidak ada antrian custom — "antrian" print sepenuhnya diserahkan ke print spooler OS/Electron (satu printer job diproses satu-satu secara native).
- **Yang sudah terpasang tapi belum dipakai**: package `nativephp/desktop` menyediakan `Native\Desktop\Facades\System::print(string $html, ?Printer $printer, ?array $settings)` yang default `silent: true` di sisi Electron (`vendor/nativephp/desktop/resources/electron/electron-plugin/src/server/api/system.ts`) — tidak dipanggil di manapun dalam `app/`.

**Implikasi untuk migrasi ke pure Electron**: kalau NativePHP dicabut, API `System::print()` di atas ikut hilang. Cetak silent (tanpa dialog) di pure Electron harus diimplementasi sendiri lewat `BrowserWindow.webContents.print({ silent: true, deviceName })` di proses main Electron, dipanggil via IPC dari halaman Kasir (mirip pola yang tadinya dipakai `electron/main.cjs` sebelum migrasi ke NativePHP). Ini murni penambahan di layer Electron — tidak menyentuh skema DB atau `SaleController`.

## 7. Barcode Scan — Mekanisme Saat Ini

Scanner USB (keyboard-wedge, bertindak sebagai keyboard biasa) — **tidak butuh driver/SDK apa pun**, baik di browser biasa maupun Electron, karena OS mengirimkannya sebagai keystroke biasa.

- `kasir.tsx` pasang `window.addEventListener('keydown', handleKeydown)` global (bukan pada satu `<input>` khusus) — buffer keystroke yang datang sangat cepat (ciri khas scanner vs ketikan manusia) diakhiri `Enter`, lalu lookup `products.find(p => p.barcode === code)`. Kalau tidak ketemu → `setScanError`. Listener sengaja tidak aktif kalau fokus sedang di input/textarea lain, supaya tidak bentrok dengan pengetikan manual.
- Field pencarian produk (`/inventory/search`, `/stock-opname/search`) juga match `barcode LIKE %q%` selain kode/nama — jadi scan bisa dipakai di halaman itu juga lewat search box biasa.
- **Ini 100% portable ke pure Electron tanpa perubahan** — keyboard-wedge scanner tetap terdeteksi sebagai keyboard oleh Chromium/Electron, tidak ada dependency native yang perlu di-port.

## 8. Hardware — Scanner & Printer

Perangkat yang sudah dipakai user (dikonfirmasi dari sesi sebelumnya) dan sudah cocok dengan arsitektur di atas (keyboard-wedge scan + print-via-dialog/silent):

| Perangkat | Model | Tipe | Catatan kompatibilitas |
|---|---|---|---|
| **Scanner** | **Eztech GT-8800F** | 2D, USB, keyboard-wedge | Tidak perlu driver — plug & play, langsung jadi input keyboard. Sudah didukung penuh oleh listener di §7, termasuk setelah migrasi ke pure Electron. |
| **Printer** | **EPPOS EP58M** | Thermal 58mm, USB | Install sebagai printer Windows biasa (driver dari EPPOS) → dipilih di dialog print OS. Untuk silent print di Electron, ESC/POS-compatible seperti ini juga bisa dipanggil via `webContents.print({ silent: true, deviceName })` tanpa perlu raw ESC/POS. |

Rekomendasi umum bila beli tambahan/pengganti (supaya tetap kompatibel tanpa perubahan kode):
- **Scanner**: pilih apa pun yang diberi label "USB HID keyboard-wedge / keyboard emulation" — merk lain yang cocok: Zebra DS2208, Honeywell Voyager 1200g, NETUM NT-1228. Hindari scanner yang hanya menyediakan SDK/driver proprietary (butuh integrasi native tambahan).
- **Printer**: printer thermal 58mm/80mm apa pun yang **terinstall sebagai printer Windows standar** (via driver resmi) langsung jalan dengan mekanisme sekarang — merk lain yang umum: Epson TM-T20/TM-T82, Xprinter XP-58IIH/XP-80, Zjiang ZJ-58. Kalau printer hanya expose port serial/raw tanpa driver Windows, perlu penambahan library ESC/POS (mis. `node-thermal-printer` di sisi Electron) — bukan kasus EP58M yang dipakai sekarang.

## 9. Rekomendasi Migrasi ke Pure Electron

Ada dua jalur, tergantung tujuan "pure electron":

**Opsi A — Ganti shell saja, backend Laravel tetap (direkomendasikan).**
NativePHP itu sendiri sebenarnya *adalah* Electron di baliknya (lihat `nativephp/electron/dist/` hasil build-nya) — bedanya NativePHP mengotomasi packaging PHP+Electron+updater. Kalau motivasinya adalah kontrol penuh / kurangi overhead abstraksi NativePHP, jalurnya:
1. Tulis ulang `electron/main.cjs` (pola yang dulu dipakai sebelum migrasi ke NativePHP) — spawn PHP built-in server (`php artisan serve` atau `php -S`) sebagai child process, buka `BrowserWindow` yang load `http://127.0.0.1:PORT`.
2. Tambahkan IPC handler untuk **silent print** (`webContents.print({silent:true})`) dan expose ke halaman Kasir via `contextBridge`/`preload.js`, panggil dari `kasir.tsx` menggantikan `window.print()` polos.
3. Scanner (§7) dan seluruh business logic (§2-§6) **tidak perlu diubah sama sekali** — itu semua jalan di layer Laravel/React yang sama persis.
4. Hapus dependency `nativephp/desktop` dari `composer.json`, `config/nativephp.php`, `app/Providers/NativeAppServiceProvider.php`.

Estimasi effort: kecil–menengah, karena hanya mengganti shell desktop, bukan rewrite bisnis logic. Ini yang paling "lazy" sekaligus paling aman — nol resiko terhadap 20 tabel, semua controller, dan seluruh frontend yang sudah teruji (71 Pest test).

**Opsi B — Full rewrite, hilangkan PHP sepenuhnya (Electron + Node backend).**
Kalau tujuannya distribusi tanpa runtime PHP sama sekali: seluruh §2-§6 (skema DB, `SaleController::store` — termasuk logic transaksi/stok/tier harga yang cukup rumit, `RekapController` — 5 query agregat, import Excel, dst.) harus ditulis ulang di Node (Prisma/Drizzle + SQLite, Express/tRPC, dst.), dan seluruh halaman Inertia (`resources/js/pages/*.tsx`) perlu di-port lepas dari Inertia (routing/props via HTTP biasa atau IPC). Effort besar, resiko regresi tinggi terhadap logic yang sudah dites & dipakai produksi (mis. rounding stok satuan turunan, laba-kotor per satuan, race condition stok — semua sudah dihandle lewat `DB::transaction`).

**Rekomendasi**: mulai dari Opsi A dulu. Dokumen ini (§1-§8) sudah cukup untuk itu tanpa perlu baca ulang seluruh kode — kalau nanti benar-benar mau full Node rewrite (Opsi B), dokumen ini tetap jadi spec sumber kebenaran untuk skema data & aturan bisnis yang harus direplikasi persis.
