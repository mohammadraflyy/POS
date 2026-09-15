# Modul Penjualan (Kasir)

Transaksi jual-beli di kasir: keranjang → checkout → struk. Termasuk pembatalan, edit transaksi tersimpan, bon (utang pelanggan), dan cetak struk ESC/POS.

**Kode:** `src/main/kasir.ts` (logika) · `src/main/ipc/kasir.ts` (IPC handler) · `src/preload/index.ts` (`window.api.kasir.*`) · `src/renderer/pages/Kasir.tsx`, `KasirHistory.tsx`, `SaleDetail.tsx`, `BonPayment.tsx`.

**Tabel:** `sales`, `sale_items`, `sale_edits`, `bon_payments`, `stock_movements`, `store_settings`.

## Aturan Bisnis (wajib dipatuhi)

1. **Uang disimpan dalam sen (integer)** di DB & logika bisnis. Boundary IPC menerima/mengembalikan **rupiah (float)** — konversi pakai `toCents`/`toRupiah` di `ipc/kasir.ts`. Jangan campur satuan ini.
2. **Qty** boleh pecahan (mis. 0,25 kg), dibulatkan 3 desimal (`bulatkanQty`, lihat `qty.ts`). Qty ≤ 0 ditolak.
3. **Harga jual per baris** diresolusi berurutan: `manual override` (jika diisi kasir) → `price tier` (jika qty match rentang `minQty`–`maxQty` milik satuan yang dijual) → `harga normal` satuan tsb. Override manual **tidak boleh** di bawah `hargaPokok` satuan itu.
4. **Diskon baris** tidak boleh melebihi gross barisnya (`qty * hargaJual`). **Diskon nota** (seluruh bill) tidak boleh melebihi subtotal setelah diskon baris. Melebihi → ditolak (bukan di-clamp ke 0).
5. **Stok** dicek di base unit (`qty * konversi`), termasuk akumulasi kalau satu produk muncul di beberapa baris sekaligus. Stok tidak cukup → ditolak.
6. **Metode bayar**: `tunai`, `bon`, `qris`, `transfer`.
   - `bon` wajib `namaPelanggan` diisi.
   - `qris`/`transfer` otomatis dianggap lunas penuh (`dibayar = total`), uang tidak masuk kas fisik.
   - `tunai`: `dibayar` harus ≥ `total`, kalau kurang → error.
7. Checkout sukses → 1 baris `sales` + N `sale_items`, stok produk berkurang, dan `stock_movements` dicatat (`movementType: 'sale'`). Semua dalam **1 transaksi DB**.
8. **Cancel** (`kasir:cancelSale`, admin only): hanya transaksi `status: 'selesai'` dan **belum ada** `bon_payments`. Stok dikembalikan + movement `sale_cancel`. Sale tetap ada (soft-cancel).
9. **Edit transaksi tersimpan** (`kasir:updateSale`, admin only): item lama dibalik (stok dikembalikan) lalu item baru diproses ulang lewat resolver yang sama. `hargaPokok` baris lama **dipertahankan** (margin historis tidak boleh berubah oleh re-pricing hari ini). `dibayar` baru tidak boleh lebih kecil dari total `bon_payments` yang sudah tercatat. Setiap edit dicatat ke `sale_edits` (audit trail, append-only).
10. **Tambah item ke bon** (`kasir:addItemsToSale`): hanya untuk `metodePembayaran: 'bon'`, `status: 'selesai'`, dan belum lunas. Tanggal item baru = sekarang, tapi `sales.createdAt` tidak berubah (utang tetap tercatat di tanggal transaksi awal).
11. **Delete** (`kasir:deleteSale`, admin only): hapus permanen, cascade `bon_payments`. Beda dari cancel: **tidak ada guard** bon-sudah-dibayar — dipakai untuk transaksi yang memang salah dibuat.
12. **Bayar bon** (`kasir:recordBonPayment`): jumlah > 0, tidak boleh melebihi sisa piutang (`total - dibayar`), keterangan maks 500 karakter.
13. Struk dicetak **silent** via ESC/POS raw bytes (`escpos.ts` + `print-windows.ts`) ke printer yang disimpan di `store_settings.printerName`, fallback ke default printer OS — **bukan** `window.print()`.

## Endpoint (IPC channel via `window.api.kasir`)

| Channel | Akses | Input | Output |
|---|---|---|---|
| `listProducts` | user | – | daftar produk aktif + satuan turunan + tier harga |
| `listCustomers` | user | – | `string[]` nama pelanggan |
| `listSalesToday` | user | – | transaksi hari ini |
| `checkout` | user | `{ metodePembayaran, namaPelanggan, dibayar, tanggal?, diskon?, keterangan?, items[] }` | struk (`{ saleId, total, items[], ... }`) |
| `cancelSale` | **admin** | `saleId` | – |
| `deleteSale` | **admin** | `saleId` | – |
| `getSaleForEdit` | **admin** | `saleId` | data sale untuk form edit |
| `updateSale` | **admin** | `{ saleId, metodePembayaran, namaPelanggan, dibayar, tanggal, diskon?, keterangan?, items[] }` | `{ total }` |
| `addItemsToSale` | user | `{ saleId, items[] }` | `{ total }` |
| `recordBonPayment` | user | `{ saleId, jumlah, keterangan }` | – |
| `listSalesHistory` | user | `{ dari?, sampai?, status?, metodePembayaran?, search?, page }` | list + pagination |
| `getSaleDetail` | user | `saleId` | detail lengkap + `bonPayments[]` + `edits[]` |
| `getStoreSettings` | *(tanpa `requireUser`)* | – | identitas toko + printer |
| `updateStoreSettings` | **admin** | `{ namaToko, alamat, telepon, pesanFooter, printerName, receiptWidth }` | – |
| `printReceipt` | user | `saleId` | mencetak struk |
| `listPrinters` | user | – | daftar printer OS |
| `testPrint` | user | – | cetak struk contoh |
| `purgeTodaySales` | **admin** | – | `{ deleted, skipped }` — skip yang sudah ada bon_payment |
| `purgeSalesBefore` | **admin** | `before` (`YYYY-MM-DD`) | `{ deleted }` |

> Endpoint bertanda **admin** memanggil `requireAdmin()`; sisanya `requireUser()`. `getStoreSettings` sengaja tanpa guard — dipakai sebelum login untuk menampilkan nama toko.

## Cara Pakai (dari renderer)

```ts
// checkout
const receipt = await window.api.kasir.checkout({
  metodePembayaran: 'tunai',
  namaPelanggan: null,
  dibayar: 50000,        // rupiah, bukan sen
  items: [{ productId: 12, productUnitId: null, qty: 2 }], // productUnitId: null = satuan dasar
})
await window.api.kasir.printReceipt(receipt.saleId)

// bon: bayar cicilan
await window.api.kasir.recordBonPayment({ saleId: 41, jumlah: 20000, keterangan: 'cicilan 1' })
```

Semua error dari `main` dilempar sebagai `Error(pesan)` berbahasa Indonesia dan diteruskan apa adanya ke renderer (lihat `invoke()` di `preload/index.ts` yang membersihkan prefix IPC) — tampilkan `err.message` langsung ke user, jangan di-generic-kan.

## Catatan Teknis (menjaga korektnes / minim bug)

- Semua operasi multi-langkah (checkout, cancel, update, delete, purge) dibungkus `db.transaction()` (drizzle-orm) — all-or-nothing, tidak ada state stok/`sale_items` yang nyangkut di tengah jalan.
- `better-sqlite3` sinkron: tidak ada race condition antar-request dalam satu proses main Electron.
- Validasi input saat ini murni manual (if/throw) di `kasir.ts`, **bukan** di boundary IPC — tipe TypeScript pada handler `ipc/kasir.ts` hanya berlaku compile-time, tidak memvalidasi payload di runtime. Kalau menambah field baru, tambahkan juga validasi manual senada (ikuti pola yang sudah ada), atau pertimbangkan skema `zod` di boundary IPC bila kompleksitas bertambah (belum dipakai di project ini — perlu approval sebelum menambah dependency baru sesuai `CLAUDE.md`).
- Setiap fungsi punya test di `kasir.test.ts` (Vitest) — jalankan `npm test -- kasir` setelah mengubah modul ini.
