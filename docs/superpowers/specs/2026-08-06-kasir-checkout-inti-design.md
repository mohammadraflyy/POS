# Fase 2, Slice 1 — Kasir: Checkout Inti — Design

Status: approved
Tanggal: 2026-08-06
Referensi: `docs/superpowers/specs/2026-08-06-electron-node-migration-design.md` (Fase 2 = Kasir), `docs/APP-SPEC.md` §3 (alur bisnis Kasir), `app/Http/Controllers/SaleController.php`, `app/Models/Product.php` (`priceForQty`), `app/Http/Requests/StoreSaleRequest.php`, `resources/views/receipts/struk.blade.php`

## Latar belakang

Fase 1 (`desktop-node/`) sudah membuktikan main↔preload↔renderer↔SQLite jalan end-to-end lewat login/logout. Fase 2 mem-port modul Kasir — modul paling kritis dan paling kompleks bisnisnya. Kasir dipecah jadi beberapa slice berurutan; dokumen ini adalah slice pertama: **checkout inti** (cart, harga/tier/satuan, simpan transaksi + stok, batal transaksi). Cetak struk, scan barcode, halaman History terpisah, dan bayar cicilan bon adalah slice-slice berikutnya.

## Sumber kebenaran (Laravel, per file yang sudah dibaca)

- `SaleController::store` — resolve tiap baris cart (satuan dasar + `priceForQty` ATAU `ProductUnit` kalau `product_unit_id` diisi), hitung `qty_dasar = qty * konversi`, validasi stok, lalu dalam `DB::transaction`: buat `Sale`, buat tiap `SaleItem` (snapshot `product_unit_id`/`qty`/`konversi`/`satuan`/`harga_jual`/`harga_pokok`/`subtotal`), decrement stok, hitung total, dan untuk tunai validasi `dibayar >= total` (throw di dalam transaksi → rollback otomatis).
- `SaleController::cancel` — tolak kalau `status === 'dibatalkan'` atau `bonPayments()->exists()`; kalau boleh, kembalikan stok tiap item (`qty * konversi`), set `status = 'dibatalkan'`, dalam transaksi.
- `Product::priceForQty(qty)` — dari `priceTiers`, ambil tier `min_qty` tertinggi yang `<= qty`, fallback ke `harga_jual` dasar produk.
- `StoreSaleRequest::rules()` — `metode_pembayaran` required in `tunai,bon`; `nama_pelanggan` required_if bon; `dibayar` required_if tunai; `items` min 1, tiap item butuh `product_id` valid, `qty >= 1`.

## Arsitektur

- **`desktop-node/src/main/kasir.ts`** — logic murni, importable tanpa Electron (pola sama seperti `auth.ts` di Fase 1):
  - `priceForQty(priceTiers: {minQty: number; hargaJual: number}[], hargaJualDasar: number, qty: number): number`
  - `resolveCartItem(product, productUnit | null, qty): {satuan, konversi, hargaJual, productUnitId, qtyDasar}` — throws kalau stok kurang
  - `checkout(db, input: CheckoutInput): {saleId: number, total: number}` — transaksi penuh
  - `cancelSale(db, saleId: number): void`
- **`desktop-node/src/main/ipc/kasir.ts`** — `registerKasirIpc(db)`: `ipcMain.handle('kasir:listProducts' | 'kasir:listSalesToday' | 'kasir:checkout' | 'kasir:cancelSale', ...)`, pola sama seperti `ipc/auth.ts`.
- **`desktop-node/src/renderer/pages/Kasir.tsx`** — menggantikan `Home.tsx` sebagai halaman utama pasca-login di `App.tsx` (route `/`). `Home.tsx` dihapus (fungsinya — bukti stack nyambung — sudah tidak relevan begitu ada halaman fungsional beneran).
- **Uang**: integer sen di DB & logic (keputusan Fase 1). Input/tampilan di UI selalu Rupiah utuh; konversi ×100 terjadi di titik data masuk ke IPC (renderer→main), dan ÷100 di titik data keluar (main→renderer). Logic `checkout`/`priceForQty` di `kasir.ts` **selalu bekerja dalam sen** — tidak ada konversi di dalam `kasir.ts` itu sendiri, murni di boundary IPC/renderer.
- **Transaksi DB**: `db.transaction(fn)()` dari better-sqlite3 — sinkron, `throw` di dalam callback otomatis rollback. Ini paralel langsung dengan pola `DB::transaction` Laravel, termasuk kasus `dibayar < total` yang throw *setelah* baris-baris lain sudah "ditulis" di dalam callback yang sama (rollback membatalkan semuanya, stok tidak berkurang).
- **Auth**: checkout & cancel butuh user login (pakai `currentUser` in-memory dari Fase 1's `ipc/auth.ts` — `user_id` pada `sales` diisi dari situ). Kalau belum login, IPC handler throw error dan renderer's route guard (sudah ada dari Fase 1 — `Home.tsx`/`Kasir.tsx` redirect ke `/login` kalau `auth:me` kosong) mencegah halaman ini diakses tanpa login duluan.

## Alur Checkout (detail)

1. Renderer kirim `{ metodePembayaran, namaPelanggan, dibayar, items: [{productId, productUnitId, qty}] }` (dibayar dalam Rupiah, dikonversi ×100 sebelum `ipcRenderer.invoke`).
2. Main process: load semua `products` yang dibutuhkan (+`productUnits`, `+priceTiers`) sekaligus (mirip `Product::whereKey(...)->with(...)->get()->keyBy('id')` — satu query, bukan N+1).
3. Untuk tiap item: cari product; kalau `productUnitId` diisi, cari `ProductUnit` milik product itu (throw kalau tidak match — pesan sama: `"Satuan tidak valid untuk :nama."`); kalau tidak, pakai satuan dasar + `priceForQty`. Hitung `qtyDasar`. Kalau `product.stok < qtyDasar` → throw `"Stok :nama tidak cukup."`.
4. Dalam satu transaksi: insert `sales` (user_id dari currentUser, status selalu `'selesai'` — cocok Laravel), insert tiap `sale_items` dengan snapshot lengkap, `UPDATE products SET stok = stok - qtyDasar` per baris, `UPDATE sales SET total = ...`, dan untuk tunai: kalau `dibayar < total` → throw `"Uang bayar kurang dari total belanja."` (rollback).
5. Return `{saleId, total}` (sen) ke renderer; renderer tampilkan konfirmasi (total, kembalian untuk tunai = `max(dibayar - total, 0)`, dalam Rupiah).

## Cancel

`cancelSale(db, saleId)`: load sale; kalau `status === 'dibatalkan'` → throw `"Transaksi sudah dibatalkan."`; kalau ada baris di `bon_payments` untuk sale ini → throw `"Tidak bisa membatalkan, bon sudah ada pembayaran."`; kalau lolos: dalam transaksi, `UPDATE products SET stok = stok + (qty*konversi)` per `sale_items`, lalu `UPDATE sales SET status = 'dibatalkan'`.

## UI (minimal, genuinely usable)

- Daftar/cari produk aktif (dari `kasir:listProducts`, query read-only — bukan halaman manajemen produk, itu Fase 3) — tampilkan nama, satuan dasar, harga, stok.
- Cart: tambah produk (satuan dasar dulu; pemilihan satuan turunan by `productUnitId` didukung logic-nya tapi UI-nya boleh sesederhana dropdown per baris cart kalau produk itu punya `productUnits`), edit qty, hapus baris, lihat subtotal per baris & total.
- Pilih metode `tunai`/`bon`. Tunai → input `dibayar`, tampilkan kembalian live. Bon → input `nama_pelanggan` (required).
- Tombol checkout → panggil `kasir:checkout` → tampilkan konfirmasi sukses (atau error dari validasi, ditampilkan apa adanya — pesan-pesan di atas sudah dalam Bahasa Indonesia siap tampil).
- Daftar transaksi hari ini (dari `kasir:listSalesToday`) di bawah cart, tiap baris ada tombol "Batal" kalau `status === 'selesai'`.

## Testing

Vitest, in-memory SQLite real (pola Fase 1), semua di `desktop-node/src/main/kasir.test.ts`:
- `priceForQty`: tanpa tier (fallback harga dasar), satu tier terpenuhi, beberapa tier (ambil `min_qty` tertinggi yang `<= qty`).
- `checkout`: satuan dasar dengan tier harga; satuan turunan (`productUnitId`) override harga/konversi; stok cukup vs kurang (throw, stok tidak berubah — assert dengan query ulang); tunai dengan `dibayar` cukup vs kurang (kurang → throw, rollback penuh: sale tidak ada, stok tidak berkurang); bon (tidak perlu validasi `dibayar`, `dibayar` tersimpan 0).
- `cancelSale`: stok kembali sesuai `qty*konversi` tiap baris; tolak kalau sudah `dibatalkan`; tolak kalau ada `bon_payments` (test ini insert manual satu baris `bon_payments` untuk simulasi, karena UI-nya belum ada).

## Di luar scope slice ini

Cetak struk (`webContents.print`), scan barcode, halaman History terpisah (filter tanggal/status/search/pagination), bayar cicilan bon (`BonPaymentController` — tabel `bon_payments` sudah ada dari Fase 1, tapi belum ada cara mengisinya lewat UI di slice ini), shortcut keyboard, command-palette search produk, manajemen produk (CRUD/import Excel — Fase 3).
