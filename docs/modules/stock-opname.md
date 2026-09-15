# Modul Stock Opname

Penyesuaian stok berdasarkan hasil hitung fisik di gudang/toko. Beda dari Pembelian (selalu menambah) dan Penjualan (selalu mengurangi): opname **menimpa** stok ke angka hasil hitung, sehingga selisihnya bisa naik atau turun.

**Kode:** `src/main/stock-opname.ts` (logika) · `src/main/ipc/stock-opname.ts` (IPC handler) · `src/preload/index.ts` (`window.api.stockOpname.*`) · `src/renderer/pages/StockOpname.tsx`.

**Tabel:** `stock_adjustments` (riwayat opname), `stock_movements`, `categories` (untuk filter).

## Aturan Bisnis (wajib dipatuhi)

1. **Pencarian produk untuk opname** (`searchProductsForOpname`) hanya produk `isActive: true`. Dua mode:
   - **Browsing**: `q` kosong tapi `categoryIds` diisi → tampilkan **semua** produk aktif di kategori tsb (tanpa limit) — dipakai untuk opname per-kategori/per-rak secara menyeluruh.
   - **Keyword search**: `q` diisi → cocokkan `kodeItem`/`namaItem`/`barcode`/nama kategori (LIKE), dibatasi **20 hasil**. `categoryIds` tetap jadi filter tambahan kalau diisi bersamaan.
2. **`recordStockAdjustment`**: `stokSesudah` wajib angka valid (`isQtyValid` — finite, ≥ 0), dibulatkan 3 desimal (`bulatkanQty`). `alasan` opsional, maks 255 karakter.
3. **Stok DITIMPA, bukan ditambah/dikurangi**: `products.stok` langsung di-`set` ke `stokSesudah`. `selisih = stokSesudah - stokSebelum` (bisa negatif) — ini yang membedakan opname dari `purchase_items` (yang menurut definisinya "selalu menambah").
4. Setiap penyesuaian dicatat 1 baris `stock_adjustments` (`stokSebelum`, `stokSesudah`, `selisih`, `alasan`, `tanggal`, `userId`) — ini **riwayat opname** per produk.
5. Juga dicatat ke `stock_movements` dengan `movementType: 'stock_adjustment'`, `productUnitId` = **satuan dasar (base unit)** produk tsb (opname selalu dihitung dalam satuan dasar, tidak per satuan turunan), `quantity = baseQuantity = selisih`, `conversionFactor: 1`.
6. **Tidak menyentuh `hargaPokok`** — opname murni koreksi kuantitas, bukan nilai. Beda dari Pembelian yang selalu meng-update harga pokok rata-rata.
7. Operasi dibungkus 1 transaksi (`db.transaction`): baca produk → hitung selisih → insert `stock_adjustments` → update `products.stok` → insert `stock_movements`, atomic.
8. Endpoint saat ini **tidak menyediakan** cancel/undo/edit/delete untuk satu opname yang sudah tercatat, maupun endpoint "list riwayat opname". Kalau modul ini dikembangkan lebih lanjut (mis. tambah riwayat/undo), ikuti pola guard yang sudah dipakai di Penjualan/Pembelian (cek status & efek samping sebelum membalik perubahan).

## Endpoint (IPC channel via `window.api.stockOpname`)

| Channel | Akses | Input | Output |
|---|---|---|---|
| `listCategories` | user | – | `{ id, nama }[]` |
| `searchProducts` | user | `{ q, categoryIds: number[] }` | `{ id, kodeItem, barcode, namaItem, categoryName, satuan, stok }[]` |
| `recordAdjustment` | user | `{ productId, stokSesudah, alasan: string \| null }` | `{ id }` (id baris `stock_adjustments`) |

Semua channel hanya memanggil `requireUser()` — tidak ada channel `requireAdmin` di modul ini, siapa pun yang login bisa melakukan opname.

## Cara Pakai (dari renderer)

```ts
// browsing semua produk aktif di 2 kategori tertentu
const rows = await window.api.stockOpname.searchProducts({ q: '', categoryIds: [4, 7] })

// catat hasil hitung fisik: stok sistem 100, hasil hitung 97 (selisih -3)
await window.api.stockOpname.recordAdjustment({
  productId: rows[0].id,
  stokSesudah: 97,
  alasan: 'opname bulanan - rusak/hilang',
})
```

`stokSesudah` dikirim sebagai angka biasa (bukan sen — stok bukan uang), boleh pecahan untuk produk yang dijual per KG/liter dsb.

## Catatan Teknis (menjaga korektnes / minim bug)

- `recordStockAdjustment` dibungkus `db.transaction()` — `stock_adjustments`, `products.stok`, dan `stock_movements` selalu konsisten.
- `stock_movements` adalah ledger append-only bersama untuk Penjualan, Pembelian, dan Stock Opname — jumlah `baseQuantity` di tabel ini untuk satu produk **harus selalu sama** dengan `products.stok` saat ini. Kalau menambah alur baru yang mengubah stok, wajib ikut menulis ke `stock_movements` dengan `movementType` yang sesuai (jangan menambah enum baru tanpa alasan kuat — lihat komentar di `purchase.ts`).
- Test unit ada di `stock-opname.test.ts` (Vitest) — jalankan `npm test -- stock-opname` setelah mengubah modul ini.
- Sama seperti modul lain: validasi input manual di `stock-opname.ts`, belum ada validasi skema di boundary IPC (`zod` bisa dipertimbangkan untuk pengembangan lebih lanjut, perlu approval dependency baru sesuai `CLAUDE.md`).
