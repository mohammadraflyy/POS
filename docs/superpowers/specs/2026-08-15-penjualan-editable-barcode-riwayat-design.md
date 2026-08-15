# Penjualan: Tanggal Editable, Scan Barcode, Rincian Riwayat, dan Bon yang Bisa Ditambah

**Tanggal:** 2026-08-15
**Status:** Disetujui, siap direncanakan

## Ringkasan

Empat perubahan pada alur penjualan yang berdiri sendiri tetapi berbagi satu halaman baru
(`/sale/:id`) dan satu menu aksi baru di Riwayat Transaksi:

1. Tanggal dan jam penjualan bisa ditentukan saat checkout, dan bisa diubah belakangan oleh admin.
2. Scanner barcode USB bisa dipakai di Katalog Produk dan di Pembelian.
3. Nama pelanggan mendapat kolomnya sendiri di Riwayat, dan setiap transaksi punya halaman rincian.
4. Bon yang belum lunas bisa ditambah item, dan deretan tombol di Riwayat diganti menu titik tiga.

Fitur 3 dan 4 memakai satu halaman yang sama, jadi keduanya dikerjakan berurutan.

## Keadaan Sekarang

Fakta yang sudah diverifikasi di kode, bukan asumsi:

- `sales.namaPelanggan` sudah ada di skema. Nilainya ditampilkan di Riwayat tetapi
  didempet ke dalam kolom "Metode" sebagai `Pending Payment (nama)`.
- Handler IPC `kasir:getSaleDetail` sudah ada dan sudah mengembalikan item serta riwayat
  pembayaran bon, tetapi tidak ada satu pun halaman renderer yang memanggilnya.
- `products.barcode` sudah ada dan unik. `searchProductsQuick` (inventory) dan
  `searchProductsForPurchase` (purchase) keduanya sudah mencocokkan barcode lewat `LIKE`.
- `dropdown-menu.tsx` sudah terpasang di `components/ui/` dan sudah dipakai di `StockOpname.tsx`.
- `rekap.ts` membaca tanggal transaksi hanya dari `sales.createdAt`; tidak ada laporan yang
  menghitung tanggal dari `sale_items` atau `stock_movements`.
- `checkout()` di `kasir.ts` sudah memakai satu variabel `now` untuk `sales`, `sale_items`,
  dan `stock_movements`.

Dua cacat yang ditemukan saat menelusuri kode dan ikut diperbaiki di sini:

- Kolom "Metode" di `KasirHistory.tsx` memakai ternary dua arah yang lebih tua daripada
  metode `qris` dan `transfer`, sehingga kedua metode itu ditampilkan sebagai "Tunai".
- Palette produk di `Purchase.tsx` mencari lewat IPC di dalam `useEffect`. Enter dari
  scanner USB tiba sebelum hasilnya datang, jadi hasil scan tidak menambah item apa pun.

Tidak ada migrasi basis data pada spec ini. Seluruh kolom yang dipakai sudah ada.

## Fitur 1 — Tanggal dan Jam Penjualan Bisa Diedit

### Saat checkout

`CheckoutInput` mendapat field opsional `tanggal: string | null` berisi waktu lokal
dengan format `YYYY-MM-DDTHH:mm`, persis keluaran `<input type="datetime-local">`.
Di dalam `checkout()`, satu baris berubah:

```ts
const now = input.tanggal ? new Date(input.tanggal) : new Date()
```

Karena `now` sudah dipakai bersama oleh `sales`, `sale_items`, dan `stock_movements`,
seluruh transaksi konsisten memakai waktu yang dipilih tanpa perubahan lain.

Validasi: tanggal di masa depan ditolak dengan pesan `Tanggal transaksi tidak boleh melewati
waktu sekarang.` Tanggal yang tidak bisa di-parse ditolak dengan `Tanggal transaksi tidak valid.`
Tidak ada batas mundur — kasir memang kadang memasukkan penjualan kemarin.

Hak akses: semua kasir boleh, karena ini transaksi yang sedang dia buat sendiri.

### Setelah transaksi tersimpan

Fungsi baru di `src/main/kasir.ts`:

```ts
export function updateSaleDate(db: Db, saleId: number, tanggal: string): void
```

Hanya mengubah `sales.createdAt` dan `sales.updatedAt`. `sale_items.createdAt` dan
`stock_movements.createdAt` sengaja dibiarkan: keduanya mencatat barang yang benar-benar
keluar pada jam tersebut, sedangkan seluruh laporan uang membaca `sales.createdAt`.
Asimetri ini disengaja dan ditulis sebagai komentar di fungsinya.

Penjagaan: transaksi harus ada, dan validasi tanggal sama dengan di checkout.
Transaksi berstatus `dibatalkan` tetap boleh diubah tanggalnya — status itu tidak
memengaruhi arti tanggalnya.

Hak akses: `requireAdmin()` di handler IPC `kasir:updateSaleDate`. Mengubah tanggal
transaksi lama menggeser total rekap dan buku kas pada dua hari sekaligus, jadi haknya
disamakan dengan hapus dan purge.

### UI

- **Kasir.** Satu `<input type="datetime-local">` di `PaymentDialog`, default waktu sekarang,
  dikirim apa adanya ke `checkout`. Kontrol native, tanpa dependency baru.
- **Riwayat.** Menu "Ubah Tanggal" di dropdown titik tiga membuka dialog berisi satu
  `datetime-local` dan tombol simpan. Menu ini disembunyikan bila `window.api.auth.me()`
  mengembalikan peran selain admin; backend tetap menjaga lewat `requireAdmin()`.

### Konsekuensi yang diterima

Mengubah tanggal transaksi lama membuat laporan yang sudah dicetak tidak lagi cocok dengan
layar. Ini memang tujuan fiturnya dan diterima secara sadar.

## Fitur 2 — Scan Barcode dengan Scanner USB

Scanner USB berperilaku sebagai keyboard: mengetik seluruh digit dengan cepat lalu mengirim
Enter. Tidak ada dependency baru, tidak ada akses kamera.

### Katalog Produk

Fungsi baru di `src/main/inventory.ts`:

```ts
export function findProductByBarcode(db: Db, barcode: string): ProductListItem | null
```

Cocok persis (`eq`), bukan `LIKE`, sebab hasil scan tidak boleh ambigu. Barcode kosong
mengembalikan `null` tanpa menyentuh basis data. Diekspos sebagai `inventory:findByBarcode`.

Perilaku Enter di kotak cari `Inventory.tsx`:

1. Panggil `findByBarcode` dengan teks yang diketik.
2. Bila ketemu, buka halaman detail produk itu dan kosongkan kotak cari.
3. Bila tidak ketemu dan teksnya seluruhnya angka dengan panjang minimal 8, tampilkan
   tawaran "Buat produk baru dengan barcode ini" yang mengarah ke Input Massal dengan
   query string `?barcode=...`.
4. Selain itu, jalankan pencarian biasa seperti sekarang.

`MassInput.tsx` sudah membaca `useSearchParams`; tinggal menambah pembacaan `barcode`
untuk mengisi kolom barcode pada baris kosong pertama.

### Pembelian

Fungsi baru di `src/main/purchase.ts`:

```ts
export function findProductForPurchaseByBarcode(db: Db, barcode: string): PurchaseProductOption | null
```

Mengembalikan bentuk yang sama dengan `searchProductsForPurchase`, termasuk satuan dasar dan
daftar satuan turunan, supaya `addItem` di renderer bisa dipakai ulang tanpa perubahan.
Diekspos sebagai `purchase:findProductByBarcode`.

Perilaku Enter di `CommandInput` palette produk `Purchase.tsx`:

1. Cegah perilaku default Enter.
2. Panggil `findProductByBarcode` dengan teks yang diketik.
3. Bila ketemu, panggil `addItem(product)` lalu kosongkan input dan biarkan palette tetap
   terbuka, sehingga scan berturut-turut langsung menumpuk item.
4. Bila tidak ketemu, jatuh kembali ke pemilihan baris yang sedang disorot seperti sekarang.

Menaikkan qty saat produk yang sama di-scan dua kali sudah ditangani `addItem` yang ada.

## Fitur 3 — Kolom Pelanggan dan Halaman Rincian

### Kolom di Riwayat

Kolom "Metode" dipecah menjadi dua:

| Kolom | Isi |
| --- | --- |
| Pelanggan | `namaPelanggan ?? 'UMUM'` |
| Metode | `Tunai` / `Bon` / `QRIS` / `Transfer`, dipetakan langsung dari enum |

Ini sekaligus memperbaiki cacat QRIS dan Transfer yang tampil sebagai "Tunai".
Kolom Status yang sudah ada tidak berubah — sisa piutang bon tetap ditampilkan di sana.

### Halaman rincian

Route baru `/sale/:id` yang dilayani `src/renderer/pages/SaleDetail.tsx`. Sumber datanya
`kasir:getSaleDetail` yang sudah ada, diperluas dengan field yang belum dikirim:

- pada tiap item: `productId`, `productUnitId`, `hargaJual`, `subtotal`, `priceSource`
- pada transaksi: nama kasir, hasil join `users` lewat `sales.userId`

Isi halaman:

1. Header: nomor transaksi, tanggal, nama pelanggan, metode, status, kasir.
2. Tabel item: nama, qty, satuan, harga jual, subtotal.
3. Ringkasan uang: total, dibayar, sisa.
4. Tabel riwayat pembayaran bon, bila ada.
5. Panel "Tambah Item" dari Fitur 4, bila memenuhi syarat.

Baris di grid Riwayat bisa diklik untuk membuka halaman ini, selain lewat menu "Detail".

Karena `env.d.ts` adalah cermin manual dari bentuk yang dikirim handler, setiap field baru
di `getSaleDetail` harus ditambahkan di kedua tempat; TypeScript tidak akan menangkap
selisihnya.

## Fitur 4 — Bon Bisa Ditambah Item

### Backend

Fungsi baru di `src/main/kasir.ts`:

```ts
export function addItemsToSale(
  db: Db,
  saleId: number,
  items: CartItemInput[],
  userId: number,
): { total: number }
```

Memakai ulang `resolveCartItem` yang sudah ada, jadi harga bertingkat dan snapshot harga
pokok per satuan berlaku persis sama dengan checkout biasa.

Penjagaan, diperiksa seluruhnya sebelum apa pun ditulis:

- transaksi ada, kalau tidak: `Transaksi tidak ditemukan.`
- `status = 'selesai'`, kalau tidak: `Transaksi yang dibatalkan tidak bisa ditambah item.`
- `metodePembayaran = 'bon'`, kalau tidak: `Hanya transaksi bon yang bisa ditambah item.`
- `dibayar < total`, kalau tidak: `Bon sudah lunas, tidak bisa ditambah item.`
- daftar item tidak kosong dan setiap qty lebih dari 0
- stok setiap produk mencukupi, dihitung menumpuk bila satu produk muncul di beberapa baris

Yang ditulis, seluruhnya di dalam satu `db.transaction`:

- insert `sale_items` dengan `createdAt` = waktu sekarang
- kurangi `products.stok` sebanyak qty dasar
- insert `stock_movements` bertipe `sale` dengan `referenceId = saleId`
- naikkan `sales.total` sebesar jumlah subtotal baru, dan set `sales.updatedAt`

`sales.createdAt` tidak diubah: barangnya keluar hari ini, tetapi bonnya tetap bon lama.
`sales.dibayar` juga tidak diubah, sehingga sisa piutang naik dengan sendirinya.

Diekspos sebagai `kasir:addItemsToSale` dengan `requireUser()`.

### UI

Panel "Tambah Item" di `/sale/:id`, hanya dirender bila transaksi berupa bon, berstatus
selesai, dan belum lunas. Isinya palette cari/scan produk dengan pola yang sama seperti
Pembelian, pemilih satuan, kolom qty, dan tombol simpan. Setelah tersimpan, halaman
memuat ulang rinciannya.

### Menu titik tiga

Deretan tombol selebar 380px di Riwayat diganti satu `DropdownMenu` dengan pemicu ikon
titik tiga, lebar kolom menjadi 60px.

| Menu | Syarat tampil |
| --- | --- |
| Detail | selalu |
| Tambah Item | bon, selesai, belum lunas |
| Bayar Bon | bon, selesai, sisa lebih dari 0 |
| Cetak Struk | selalu |
| Ubah Tanggal | peran admin |
| Batalkan | selesai, `dibayar = 0` |
| Hapus | selalu, ditandai destruktif dan diletakkan paling bawah setelah pemisah |

Dialog konfirmasi yang sudah ada (`useConfirm`) tetap dipakai untuk Batalkan, Hapus,
dan Cetak.

## Pengujian

Semua logika baru berada di modul main yang murni terhadap basis data, sehingga bisa diuji
dengan vitest tanpa Electron. Ingat urutan rebuild ABI better-sqlite3 sebelum dan sesudah
menjalankan tes main-process.

`kasir.test.ts`:

- checkout dengan `tanggal` menulis `sales`, `sale_items`, dan `stock_movements` pada waktu itu
- checkout menolak tanggal di masa depan
- `updateSaleDate` mengubah `sales.createdAt` dan tidak menyentuh `stock_movements`
- `addItemsToSale` menambah item, mengurangi stok, menaikkan total, dan mencatat pergerakan stok
- `addItemsToSale` menolak transaksi tunai, transaksi dibatalkan, bon lunas, dan stok kurang
- `addItemsToSale` tidak menulis apa pun bila salah satu baris gagal validasi

`inventory.test.ts` dan `purchase.test.ts`:

- `findProductByBarcode` mengembalikan produk yang barcodenya persis sama
- `findProductByBarcode` mengembalikan `null` untuk barcode yang tidak ada, untuk string
  kosong, dan untuk kecocokan sebagian yang seharusnya tidak cocok

Perilaku renderer diperiksa manual: kolom Riwayat, menu titik tiga, dan alur scan.

## Yang Sengaja Tidak Dikerjakan

- **Master pelanggan.** Nama pelanggan tetap teks bebas. `CustomerPicker` sudah berfungsi
  sebagai pilih-atau-ketik-baru. Tambahkan tabel `customers` bila nanti butuh alamat,
  telepon, atau batas piutang per pelanggan.
- **Ubah qty dan hapus item pada bon.** Hanya penambahan yang didukung. Pengurangan
  mengharuskan pengembalian stok dan pembatalan snapshot harga pokok, jalur yang jauh
  lebih mudah salah dan belum dibutuhkan.
- **Edit isi transaksi non-bon.** Uang yang sudah masuk laci tidak boleh berubah diam-diam.
- **Scan lewat kamera.** Butuh dependency baru dan kalah akurat dari scanner fisik.
- **Menggeser `stock_movements` saat tanggal transaksi lama diubah.** Alasannya di Fitur 1.

## Urutan Pengerjaan

1. Fitur 2, scan barcode — berdiri sendiri, tidak menyentuh apa pun milik fitur lain.
2. Fitur 1, tanggal editable — backend dan UI Kasir; menu "Ubah Tanggal" menunggu langkah 4.
3. Fitur 3, kolom pelanggan dan halaman `/sale/:id`.
4. Fitur 4, tambah item ke bon dan menu titik tiga — memakai halaman dari langkah 3 dan
   memasang menu "Ubah Tanggal" dari langkah 2.
