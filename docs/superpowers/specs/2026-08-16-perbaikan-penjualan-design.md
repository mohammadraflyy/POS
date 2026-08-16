# Perbaikan Penjualan: Edit Transaksi, Scan, Satuan, dan Cetak

**Tanggal:** 2026-08-16
**Status:** Disetujui, siap direncanakan
**Cakupan:** `desktop-node/` saja.

## Ringkasan

Tujuh perubahan pada alur penjualan. Satu di antaranya besar (edit transaksi penuh), enam
sisanya perbaikan terarah. Enam yang kecil sengaja dikerjakan lebih dulu karena tiga di
antaranya — urutan keranjang, nomor urut, dan pencarian per satuan — dipakai langsung oleh
layar edit transaksi.

1. **Edit transaksi.** Semua transaksi bisa diedit kembali, semua variabelnya, termasuk
   tanggal dan jam, dan termasuk Pending Payment yang belum lunas.
2. **Scan produk.** Scan barcode di halaman Penjualan sekarang tidak berfungsi. Diperbaiki.
3. **Pemilihan item.** Setelah item dipilih, palette menutup sendiri dan kasir kembali ke
   view penjualan. Hasil pencarian menampilkan semua satuan yang dimiliki item itu.
4. **Cetak.** Label diubah jadi "Print/Cetak", dan proses cetak tidak lagi membuat kasir
   menunggu.
5. **Tambah produk.** Kolom satuan mengambil pilihan dari Master Satuan, bukan ketik bebas.
6. **Urutan keranjang.** Barang terbaru di atas, terlama di bawah.
7. **Nomor urut.** Keranjang mendapat kolom nomor baris.

## Keadaan Sekarang

Fakta yang sudah diverifikasi langsung di kode, bukan asumsi.

- `Kasir.tsx:171-174` — `paletteResults` menyaring `namaItem` dan `kodeItem` saja.
  **`barcode` tidak ikut disaring.** Inilah sebab scan "tidak dapat digunakan": barcode yang
  diketik scanner ke kotak pencarian selalu berakhir "Produk tidak ditemukan".
- `Kasir.tsx:616-620` — `onSelect` menambah item ke keranjang lalu mengosongkan query, tetapi
  **tidak pernah memanggil `setPaletteOpen(false)`**. Palette menggantung terbuka.
- `Kasir.tsx:191-276` — jalur scanner global (buffer keystroke + Enter) sudah benar, tetapi
  hanya aktif saat tidak ada input yang fokus. Begitu kasir menekan `/` atau menutup palette,
  fokus balik ke kotak pencarian dan jalur ini mati.
- `cart-logic.ts:145-155` — `addLine` selalu menambah di akhir array dan selalu memakai
  `productUnitId: null`. Tidak ada cara menambahkan langsung ke satuan turunan.
- `CartGrid.tsx:78-186` — enam kolom (produk, satuan, harga, qty, subtotal, aksi). Tidak ada
  kolom nomor. Kolom harga tidak editable.
- `PaymentDialog.tsx:339` — tombol berbunyi `Simpan + Cetak`. `PaymentDialog.tsx:81-92`
  memasang dialog konfirmasi sebelum mencetak.
- `Kasir.tsx:380-418` — dialog pembayaran ditahan terbuka sampai `printReceipt` selesai.
- `print-windows.ts:93-133` — tiap cetak menulis dua file tmp, memanggil `powershell.exe`, dan
  `Add-Type` mengompilasi ulang kelas C# `RawPrinterHelper` dari nol. Kompilasi itu sumber
  jeda utamanya.
- `MassInput.tsx:255` dan `Inventory.tsx:430` — kolom satuan memakai `renderTextEditor`
  polos. `masterSatuan.list()` sudah tersedia di preload (`preload/index.ts:168`).
- `schema.ts:171` — `sale_items.price_source` sudah punya nilai `'manual'`. Tidak perlu
  migrasi untuk harga override.
- `schema.ts:242` — `stock_movements.movement_type` bernilai
  `['sale', 'sale_cancel', 'purchase', 'stock_adjustment']`. Grep seluruh `src/` menemukan
  hanya penulis, tidak ada satu pun pembaca. Tidak perlu migrasi untuk edit transaksi.
- `kasir.ts:125-137` — `parseTanggalTransaksi` sudah ada dan sudah menolak tanggal masa depan.
- Istilah: `bon` di data dan kode, **"Pending Payment"** di teks yang dilihat pengguna
  (`2026-08-07-pending-payment-design.md`).

## Bagian 1 — Enam Perbaikan Terarah

### 1.1 Scan produk berfungsi kembali

Dua perubahan di `Kasir.tsx`.

**Barcode masuk penyaringan.** `paletteResults` ikut mencocokkan `p.barcode`. Katalog kasir
sudah dimuat penuh di renderer lewat `kasir:listProducts`, jadi pencocokan ini sinkron — tidak
ada IPC, tidak ada balapan seperti yang dicatat di memori `usb-scanner-enter-beats-async-palette`.

**Enter di kotak pencarian mencoba barcode persis lebih dulu.** Sekarang Enter selalu membuka
palette. Diubah jadi: cari `products.find((p) => p.barcode === query.trim())`; kalau ketemu,
langsung masukkan ke keranjang, kosongkan kotak, palette tidak usah dibuka sama sekali. Kalau
tidak ketemu, baru buka palette seperti sekarang. Dengan begitu scan berturut-turut ke kotak
pencarian bekerja tanpa satu klik pun.

Jalur scanner global (`Kasir.tsx:191-276`) tidak diubah. Ia tetap melayani kasus fokus kosong.

### 1.2 Palette menutup setelah item dipilih

`onSelect` di `Kasir.tsx` memanggil `setPaletteOpen(false)` setelah menambah item. `onCloseAutoFocus`
yang sudah ada mengembalikan fokus ke kotak pencarian, jadi scan berikutnya langsung bisa.

### 1.3 Hasil pencarian menampilkan semua satuan

Hasil pencarian berubah dari satu baris per produk menjadi **satu baris per satuan**. Produk
dengan satuan dasar PCS dan turunan DUS muncul dua kali:

```
Indomie Goreng · IND-001          Rp 3.000 / PCS
Indomie Goreng · IND-001         Rp 70.000 / DUS
```

Bentuk barunya:

```ts
interface UnitResult {
  product: Product
  /** null berarti satuan dasar, konsisten dengan CartLine */
  productUnitId: number | null
  satuan: string
  hargaJual: number
}
```

`paletteResults` memetakan tiap produk yang cocok menjadi satu `UnitResult` untuk satuan dasar
plus satu untuk tiap `productUnits`. Batas 50 hasil tetap, dihitung setelah pemekaran.

`addLine` di `cart-logic.ts` menerima parameter `productUnitId` (default `null`) supaya baris
DUS bisa dibuat langsung. `lineKey` dan logika penggabungan yang sudah ada tidak berubah —
memilih DUS dua kali tetap menggabung ke satu baris.

### 1.4 Urutan keranjang: terbaru di atas

`addLine` menaruh baris baru di **awal** array, bukan akhir.

Baris yang digabung (produk + satuan yang sama discan ulang) **tetap di posisinya**, hanya
qty-nya naik. Kalau baris ikut melompat ke atas tiap kali discan, daftar akan bergerak-gerak
di depan mata kasir yang sedang men-scan barang yang sama berulang kali.

`restoreCart` mempertahankan urutan tersimpan apa adanya, jadi draft yang dipulihkan tampil
sama persis seperti saat ditinggalkan.

### 1.5 Kolom nomor urut di keranjang

Kolom pertama di `CartGrid`, lebar 50, `renderCell: ({ rowIdx }) => rowIdx + 1`. Karena
keranjang tidak berhalaman, nomornya murni posisi baris.

`CART_OTHER_COLUMNS_WIDTH` bertambah 50.

`QTY_COLUMN_IDX` di `CartGrid.tsx:52` diekspor tetapi grep seluruh `src/` tidak menemukan satu
pun pemakainya. Daripada menomori ulang konstanta mati, konstantanya dihapus.

### 1.6 Satuan dari Master Satuan

Editor sel bersama di `renderer/components/unit-select-editor.tsx`: sebuah `<select>` yang diisi
dari `masterSatuan.list()` dan hanya menampilkan satuan `isActive`. Polanya meniru editor satuan
yang sudah jalan di `CartGrid.tsx:102-125` — `renderEditCell` dengan `<select>` yang autofocus,
supaya navigasi keyboard grid tetap utuh.

Dipakai di dua tempat: kolom satuan `MassInput.tsx` dan kolom satuan `Inventory.tsx`.

Daftar satuan dimuat sekali per halaman dan dioper ke editor lewat closure, bukan diambil ulang
tiap sel dibuka.

Jalur teks bebas `resolveOrCreateUnit` (`master-satuan.ts:49`) **tetap ada** — import Excel masih
memerlukannya. Yang dikunci ke pilihan hanyalah pengetikan manual di grid.

### 1.7 Cetak: label dan kecepatan

**Label.** `PaymentDialog.tsx:339` menjadi `Print/Cetak`. Dialog konfirmasi cetak
(`PaymentDialog.tsx:81-92`) dihapus — dua ketukan Enter untuk satu struk adalah bagian dari
jeda yang dikeluhkan, dan kasir sudah melihat total di layar sebelum menekannya.

**Kasir tidak lagi menunggu.** Sekarang `printingSaleId` menahan dialog pembayaran sampai
`printReceipt` selesai. Diubah: begitu `checkout` berhasil, dialog ditutup dan keranjang direset
seketika; pencetakan berjalan di latar. Kegagalan cetak muncul sebagai pesan error di halaman
Penjualan dengan nomor transaksinya, jadi kasir tahu struk mana yang perlu dicetak ulang lewat
Riwayat. Transaksinya sendiri sudah aman tersimpan sebelum pencetakan dimulai.

**Kompilasi C# tidak diulang.** `printRaw` sekarang mengompilasi `RawPrinterHelper` tiap kali
dipanggil. Diubah: pada pemanggilan pertama, `Add-Type -OutputAssembly` menulis
`%TEMP%/pos-rawprint.dll`; pemanggilan berikutnya memakai `Add-Type -Path` atas DLL itu, yang
melewati csc sepenuhnya. Skripnya sendiri juga ditulis sekali dengan nama tetap, bukan nama acak
per cetak.

Yang tersisa hanyalah waktu start `powershell.exe` (~200–400 ms), dan itu pun sudah tidak
dilihat kasir karena berjalan di latar.

> Kalau ternyata masih terasa lambat, langkah berikutnya adalah menjaga satu proses PowerShell
> tetap hidup dan menyuapinya path file lewat stdin. Itu menambah urusan daur hidup proses,
> respawn, dan sentinel di stdout — sengaja tidak dikerjakan sekarang.

## Bagian 2 — Edit Transaksi

### 2.1 Masuk dan keluar

Menu titik tiga di Riwayat mendapat **Edit Transaksi**, yang menuju `/kasir?edit=123`.

Halaman Kasir membaca `?edit`, memanggil IPC baru `kasir:getSaleForEdit`, dan mengisi keranjang
dari `sale_items` (`productId`, `productUnitId`, `qty`, `hargaJual`, `priceSource`) beserta
kepalanya (pelanggan, metode, dibayar, tanggal).

Selama edit mode, draft penjualan berjalan di `localStorage['kasir:draft']` **tidak dibaca dan
tidak ditulis sama sekali**. Keranjang yang sedang ditinggal kasir harus utuh saat ia keluar dari
edit mode. Ini satu-satunya alasan `readStoredDraft` dan effect penyimpan draft di
`Kasir.tsx:126-130` perlu dijaga dengan syarat `editSaleId === null`.

Tampilan edit mode: judul halaman menandai `MODE EDIT #123`, tombol `Bayar` menjadi
`Simpan Perubahan`, dan ada tombol `Batal` yang kembali ke Riwayat tanpa menyimpan.

### 2.2 Harga per baris bisa dioverride

`CartLine` mendapat `hargaOverride: number | null`. `unitPrice()` mengembalikan override kalau
terisi, kalau tidak jatuh ke perhitungan tier yang sudah ada.

Kolom Harga di `CartGrid` menjadi editable **hanya saat edit mode** (`editable: () => editMode`).
Transaksi baru tetap mengikuti master dan tier, supaya salah ketik harga tidak bisa menyelinap
masuk ke penjualan harian.

Baris beroverride disimpan dengan `priceSource: 'manual'`.

`StoredCartLine` **tidak** ikut membawa `hargaOverride`. Draft hanya ditulis di luar edit mode,
dan di luar edit mode kolom harga tidak bisa diedit sama sekali, jadi tidak ada override yang
bisa hilang. Menambahkannya sekarang hanya menambah medan yang tidak pernah terisi.

### 2.3 `updateSale` di main process

Satu fungsi di `main/kasir.ts`, seluruhnya dalam satu transaksi DB:

```
1. muat sale; wajib ada
2. BALIKKAN setiap sale_item lama:
     products.stok += qty * konversi
     tulis stock_movements 'sale_cancel' (referenceId = saleId)
     hapus baris sale_items
3. RESOLVE item baru — di dalam transaksi, setelah stok dikembalikan,
   sehingga menaikkan qty melampaui stok saat ini tetap sah
4. TULIS baris baru: sale_items + stock_movements 'sale' + potong stok
5. UPDATE sales: namaPelanggan, metodePembayaran, total, dibayar,
   createdAt = parseTanggalTransaksi(tanggal), updatedAt = now
```

**Langkah 3 harus berada di dalam transaksi.** `resolveItems` (`kasir.ts:159`) sekarang menerima
`BetterSQLite3Database` dan dipanggil sebelum transaksi. Tipenya diperlebar agar menerima objek
transaksi juga. Kalau pemeriksaan stok tetap berjalan sebelum pembalikan, menaikkan qty barang
yang stoknya sudah habis terjual akan ditolak padahal seharusnya boleh.

**Ledger.** Pembalikan memakai `'sale_cancel'`, baris baru memakai `'sale'`. Tidak ada nilai enum
baru, tidak ada migrasi. Alasannya ditulis sebagai komentar di kode: tidak ada pembaca
`movement_type`, dan yang benar-benar dijaga adalah jumlah ledger tetap sama dengan
`products.stok`.

**HPP.** Baris baru yang `productId` + `productUnitId`-nya cocok dengan salah satu baris lama
**mewarisi `hargaPokok` lama**. Hanya baris yang betul-betul baru yang mengambil biaya sekarang
dari `product_units`. Tanpa aturan ini, mengoreksi qty hari ini akan menulis ulang margin
historis dengan harga beli minggu ini.

**Guard:**

| Kondisi | Pesan |
| --- | --- |
| metode `bon` tanpa nama pelanggan | `Nama pelanggan wajib diisi untuk transaksi bon.` |
| metode `tunai` dan `dibayar < total` | `Uang bayar kurang dari total belanja.` |
| ada `bon_payments`, `dibayar` turun di bawah jumlahnya | `Dibayar tidak boleh kurang dari pembayaran yang sudah tercatat.` |
| tanggal di masa depan | ditangani `parseTanggalTransaksi` yang sudah ada |
| keranjang kosong | `Keranjang tidak boleh kosong.` |

Status `dibatalkan` tidak berubah karena pengeditan. Transaksi yang dibatalkan tetap dibatalkan;
tanggal dan isinya boleh dirapikan, statusnya tidak.

**Izin:** `requireAdmin`, sekelas `cancelSale` dan `deleteSale` yang sudah ada. (`updateSaleDate`
dulu juga `requireAdmin`, tetapi handler itu dihapus di 2.4.)

### 2.4 Yang dihapus

Menu **Ubah Tanggal** di Riwayat, dialognya, state `dateTarget`/`dateValue`/`savingDate`
(`KasirHistory.tsx:73-75, 197-225, 462-485`), handler IPC `kasir:updateSaleDate`, dan fungsi
`updateSaleDate` di `main/kasir.ts` — semuanya dihapus. Tanggal sekarang salah satu field biasa di
edit mode. Dua jalur menuju satu perubahan hanya berarti dua tempat yang bisa menyimpang.

Test yang menguji `updateSaleDate` dipindahkan untuk menguji `updateSale` dengan tanggal berubah.

## Urutan Pengerjaan

1. Nomor urut + urutan terbaru dulu (1.4, 1.5) — mengubah `CartGrid` dan `addLine`
2. Scan + palette menutup + hasil per satuan (1.1, 1.2, 1.3)
3. Satuan dari Master Satuan (1.6)
4. Label dan kecepatan cetak (1.7)
5. Edit transaksi (Bagian 2)

Langkah 1–4 berdiri sendiri dan bisa dirilis satu per satu. Langkah 5 memakai hasil langkah 1 dan
2 di layarnya.

## Test

`main/kasir.test.ts` — `updateSale`:

- stok kembali netral saat qty tidak berubah
- qty dinaikkan melebihi stok saat ini tetapi muat setelah pembalikan → berhasil
- qty dinaikkan melebihi stok bahkan setelah pembalikan → ditolak
- baris dihapus → stoknya kembali
- `bon` tanpa nama pelanggan → ditolak
- `tunai` kurang bayar → ditolak
- `dibayar` diturunkan di bawah `bon_payments` yang sudah tercatat → ditolak
- tanggal pindah → `sales.createdAt` bergeser
- harga manual → `subtotal` memakai harga itu dan `price_source` menjadi `'manual'`
- baris yang tidak berubah mempertahankan `hargaPokok` lamanya

`renderer/pages/kasir/cart-logic.test.ts`:

- `addLine` menaruh baris baru di awal
- `addLine` yang menggabung tidak memindahkan posisi baris
- `addLine` dengan `productUnitId` membuat baris satuan turunan
- `unitPrice` mengutamakan `hargaOverride` di atas tier
- `restoreCart` mempertahankan urutan baris yang tersimpan

`main/escpos.test.ts` tidak berubah — isi struk tidak tersentuh.

Verifikasi: `npx tsc --noEmit` dan `npm test` di `desktop-node/`. Catat memori
`electron-locks-sqlite-binary` — tutup aplikasi sebelum menjalankan test.

## Sengaja Tidak Dikerjakan

- **Status transaksi baru di database.** "Pending Payment" adalah nama user-facing untuk `bon`
  yang belum lunas, bukan status tersendiri. Sudah dikonfirmasi ke pemilik.
- **Keranjang di-park / hold.** Bukan bagian dari permintaan.
- **Proses PowerShell yang dijaga tetap hidup.** Lihat catatan di 1.7 — dipertimbangkan hanya
  kalau DLL yang di-cache ternyata belum cukup.
- **Riwayat perubahan transaksi (audit trail).** Tidak diminta. Kalau nanti dibutuhkan, tempatnya
  adalah tabel baru, bukan kolom tambahan di `sales`.
- **Kolom nomor urut di halaman rincian transaksi.** Permintaannya menyebut daftar barang
  penjualan, yaitu keranjang.
