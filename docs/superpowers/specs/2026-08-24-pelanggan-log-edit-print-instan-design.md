# Master Pelanggan, Log Edit Transaksi, Print Instan, dan Pintasan Keyboard

**Tanggal:** 2026-08-24
**Status:** Disetujui, siap direncanakan
**Cakupan:** `desktop-node/` saja.

## Ringkasan

Lima perubahan pada modul penjualan. Dua di antaranya menyentuh skema (`sale_edits` dan
`customers` + `sales.customer_id`), satu mengganti mekanisme cetak sampai ke lapisan sistem
operasi, dan dua sisanya perubahan interaksi keyboard.

1. **Keterangan edit transaksi.** Setiap penyimpanan hasil edit wajib menyertakan alasan, dan
   alasan itu tersimpan sebagai riwayat, bukan sebagai satu kolom yang tertimpa.
2. **Menu Pelanggan.** Tabel master pelanggan dengan CRUD penuh, dan transaksi terhubung
   ke master itu lewat kunci asing.
3. **Print instan.** Jalur cetak berhenti memanggil `powershell.exe` per struk dan memanggil
   `winspool.drv` langsung dari proses main.
4. **Pintasan keyboard.** `PageUp`/`PageDown` memindahkan fokus antara kolom Jumlah dan kotak
   Cari; `End` menggantikan `Enter` sebagai jalan membuka dialog pembayaran.
5. **Konfirmasi cetak.** Pilihan mencetak pindah ke sesudah transaksi tersimpan.

Revamp UI Penjualan **tidak** termasuk cakupan — diminta ditunda oleh pemilik.

## Keadaan Sekarang

Fakta yang diverifikasi langsung di kode, bukan asumsi.

- `db/schema.ts:141-161` — `sales` menyimpan `namaPelanggan` sebagai **teks bebas**. Tidak ada
  tabel `customers`, tidak ada kunci asing, tidak ada tempat menyimpan telepon atau alamat.
- `kasir/CustomerPicker.tsx:39-41` — komentarnya menyatakannya terang-terangan: "There is no
  customer master - a name that has never been used on a sale is simply typed here and becomes
  one." Daftar pilihan berasal dari nama-nama pada penjualan lampau.
- `main/kasir.ts` — `updateSale` menulis ulang transaksi tanpa mencatat apa pun tentang siapa
  yang mengedit atau mengapa. Tidak ada tabel log, tidak ada kolom alasan.
- `print-windows.ts:116-151` — tiap cetak menulis dua berkas tmp lalu men-spawn
  `powershell.exe`. Komentar di baris 21-23 menyatakan kompilasi `Add-Type` "was the bulk of the
  delay" dan sudah diselesaikan dengan cache DLL. **Klaim itu tidak lagi berlaku sebagai
  penjelasan atas sisa delay.** DLL memang tidak dikompilasi ulang, tetapi startup PowerShell
  sendiri berbiaya ~300-600 ms dan dibayar penuh pada setiap struk. `-NoProfile` tidak
  menghapusnya. Inilah "delay setengah detik" yang dikeluhkan.
- `escpos.ts:84-173` — `buildReceiptEscPos` adalah perakitan byte murni. Waktunya dalam orde
  mikrodetik dan tidak pernah menjadi sumber lambatnya cetak.
- `Kasir.tsx:315-406` — pemroses keydown global memiliki `F3`, `/`, `Alt+K`, `Alt+P`, dan
  `Enter` tunggal sebagai pintasan Bayar. `PageUp`/`PageDown` tidak dipakai di sini.
- `PaymentDialog.tsx:121-128` — **`PageUp`/`PageDown` sudah dipakai** untuk memutar aksi
  terpilih (cetak/simpan/batal) di dalam dialog pembayaran.
- `Kasir.tsx:456-474` — `handleCartCellKeyDown` juga memetakan `Enter` ke pembukaan dialog
  pembayaran saat sel keranjang sedang aktif.
- `Kasir.tsx:511-520` — cetak dijalankan tanpa ditunggu setelah transaksi tersimpan; kegagalan
  muncul sebagai pesan yang menyebut nomor struk.
- `PaymentDialog.tsx:11-13, 338-352` — tombol utama berbunyi "Print/Cetak" dan menjalankan
  simpan **dan** cetak sekaligus. Tidak ada konfirmasi cetak terpisah di titik mana pun.
- `Supplier.tsx` dan `ipc/supplier.ts` — pola halaman master yang sudah mapan: DataGrid yang
  bisa disunting langsung, baris kosong untuk penambahan, hapus dengan konfirmasi. Ini yang
  ditiru untuk halaman Pelanggan.
- `App.tsx:36-55` dan `components/app-sidebar.tsx:26-39` — rute dan menu didaftarkan manual,
  dikelompokkan menjadi penjualan, pembelian, dan laporan.

## 1. Keterangan Edit Transaksi

### Skema

Tabel baru, bukan kolom pada `sales`. Alasan: dengan satu kolom, alasan edit kedua akan
menimpa alasan edit pertama, dan justru urutan perubahan itulah yang ingin ditelusuri pemilik.

```ts
export const saleEdits = sqliteTable('sale_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  saleId: integer('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  keterangan: text('keterangan').notNull(),
  totalSebelum: integer('total_sebelum').notNull(),
  totalSesudah: integer('total_sesudah').notNull(),
  ...timestamps(),
})
```

`totalSebelum` dan `totalSesudah` disimpan agar riwayat bisa dibaca tanpa merekonstruksi
transaksi: pembaca langsung melihat uangnya bergerak ke mana.

### Perilaku

- `updateSale` menerima input tambahan `keterangan: string`. Nilai kosong atau hanya spasi
  ditolak **sebelum** transaksi disentuh, dengan pesan
  `Keterangan wajib diisi saat mengedit transaksi.`
- Baris log ditulis di dalam transaksi basis data yang sama dengan penulisan ulang penjualan.
  Bila penulisan ulang gagal, log ikut batal — tidak boleh ada log yang menggambarkan
  perubahan yang tidak pernah terjadi.
- `userId` diambil dari sesi yang sedang berjalan lewat `requireUser()`, bukan dari renderer.
- Berlaku untuk semua metode pembayaran, bukan hanya bon.
- Pembatalan transaksi (`cancelSale`) tidak disentuh. Di luar cakupan permintaan.

### Antarmuka

- `PaymentDialog` dalam mode edit mendapat area teks "Keterangan perubahan", wajib diisi.
  Tombol Simpan Perubahan nonaktif selama isinya kosong.
- `SaleDetail` mendapat panel "Riwayat Edit": waktu, nama kasir, keterangan, dan total sebelum
  serta sesudah, terbaru di atas.

### Pengujian

Pengujian pada `main/kasir.test.ts`, yang sudah memakai basis data berkas: keterangan kosong
ditolak; penyimpanan yang berhasil menghasilkan tepat satu baris `sale_edits` dengan total
sebelum dan sesudah yang benar; dua kali edit menghasilkan dua baris, bukan satu yang tertimpa.

## 2. Menu Pelanggan

### Skema

```ts
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nama: text('nama').notNull().unique(),
  telepon: text('telepon'),
  alamat: text('alamat'),
  keterangan: text('keterangan'),
  ...timestamps(),
})
```

`sales` mendapat `customerId: integer('customer_id').references(() => customers.id, { onDelete: 'restrict' })`.

**`sales.namaPelanggan` tetap ada dan tetap diisi**, sebagai potret nama pada saat penjualan.
Ini keputusan yang disengaja, dengan dua alasan. Pertama, semua pembaca yang sekarang — struk
ESC/POS, Riwayat, Dashboard, BonPayment — tidak perlu diubah sama sekali. Kedua, mengganti nama
pelanggan di master tidak boleh mengubah bunyi struk yang sudah tercetak.

Pelanggan umum diwakili `customerId` bernilai `NULL` dengan `namaPelanggan` tetap `UMUM`.
UMUM tidak menjadi baris master, sehingga tidak mungkin dihapus atau diganti namanya.

### Migrasi

Satu berkas migrasi drizzle berisi pembuatan tabel dan pengisian mundur:

1. Buat `customers` dan tambahkan `sales.customer_id`.
2. Sisipkan satu baris `customers` untuk setiap `nama_pelanggan` yang berbeda pada `sales`,
   kecuali `NULL` dan kecuali `UMUM` (perbandingan tanpa memandang besar kecil huruf).
3. Isi `sales.customer_id` dengan mencocokkan nama.
4. Penjualan bernama `UMUM` atau tanpa nama tetap ber-`customer_id` `NULL`.

Pengujian migrasi memakai pola berkas yang sudah ada, termasuk `db.$client.close()` sebelum
`rmSync` agar Windows tidak melempar `EPERM`.

### Perilaku

- Penghapusan pelanggan ditolak bila pelanggan itu punya transaksi, berapa pun jumlahnya dan
  apa pun statusnya. Dijaga di proses main dengan hitungan eksplisit dan pesan berbahasa
  Indonesia yang jelas, dengan `onDelete: 'restrict'` sebagai jaring pengaman lapis kedua.
- Nama pelanggan unik. Penambahan nama yang sudah ada ditolak dengan pesan yang menyebut nama
  itu, bukan dengan galat batasan basis data mentah.
- `checkout` dan `updateSale` menerima `customerId: number | null` dan menyimpan keduanya:
  kunci asing dan potret nama.

### Berkas

- `src/main/customer.ts` — fungsi murni untuk daftar, tambah, ubah, hapus, meniru
  `src/main/supplier.ts`.
- `src/main/ipc/customer.ts` — pendaftaran IPC dengan `requireUser`/`requireAdmin` sesuai pola
  penjaga akses yang berlaku.
- `src/renderer/pages/Pelanggan.tsx` — meniru `Supplier.tsx`. Kolom: Nama, Telepon, Alamat,
  Keterangan, Jumlah Transaksi.
- Rute `/pelanggan` di `App.tsx`, entri menu pada kelompok penjualan di `app-sidebar.tsx`.
- `preload/index.ts` dan `renderer/env.d.ts` diperbarui bersamaan. Deklarasi tipe di `env.d.ts`
  tidak diperiksa silang oleh `tsc` terhadap pemroses IPC yang sesungguhnya, jadi keduanya
  harus ditulis dari sumber yang sama dalam satu langkah.

### CustomerPicker

Sumber datanya berubah dari nama-nama pada penjualan lampau menjadi tabel master, menampilkan
nama beserta telepon. Mengetik nama baru lalu menekan `Enter` tetap bekerja: nama itu langsung
dibuat sebagai baris `customers` dan dipakai pada transaksi berjalan. Kecepatan kasir tidak
berubah.

`onSelect` kini mengembalikan pasangan `{ id, nama }`, bukan hanya nama, karena `checkout`
membutuhkan keduanya. `Kasir.tsx` menyimpan `customerId` berdampingan dengan `namaPelanggan`,
dan `KasirDraft` di `localStorage` ikut menyimpannya. Draft lama yang tersimpan sebelum
perubahan ini tidak punya medan tersebut; `readStoredDraft` memperlakukannya sebagai `NULL`,
sama seperti ia sudah memperlakukan medan lain yang hilang. Bila `customerId` pada draft
menunjuk pelanggan yang sudah tidak ada, pemuatan mundur ke UMUM dan kasir memilih ulang —
draft adalah keranjang yang belum menjadi uang, jadi jatuh ke keadaan aman sudah memadai.

## 3. Print Instan

Isi `print-windows.ts` diganti. `koffi` memuat `winspool.drv` dan memanggilnya langsung dari
proses main Electron: `OpenPrinter`, `StartDocPrinter` dengan tipe data `RAW`,
`StartPagePrinter`, `WritePrinter`, lalu penutupan yang bersesuaian.

Yang dihapus: spawn `powershell.exe`, berkas `.ps1`, kompilasi dan cache DLL, berkas `.bin`
sementara, beserta pembersihannya.

Yang dipertahankan: rantai janji `printQueue`. Renderer menembakkan cetak tanpa menunggunya,
sehingga dua struk benar-benar bisa bertumpang tindih, bukan sekadar secara teori.

`buildReceiptEscPos` tidak disentuh sama sekali dan `escpos.test.ts` harus tetap hijau tanpa
perubahan.

### Risiko yang diketahui

`koffi` adalah dependensi native. Berbeda dengan `better-sqlite3`, koffi memakai Node-API dan
mengirim binary prebuilt, sehingga semestinya bebas dari ritual `rebuild:node` dan
`rebuild:electron`. Kata "semestinya" di sini disengaja: hal itu diverifikasi dengan Test Print
sungguhan pada perangkat, bukan diasumsikan. Bila koffi gagal dimuat di proses main, rencananya
mundur ke alternatif kedua, yaitu mengompilasi satu berkas exe konsol C# sekali lalu
menjalankannya lewat `execFile` (startup ~20-40 ms).

### Pengujian

Pengujian unit tidak bisa menyentuh printer sungguhan. Yang diuji: `printRaw` menolak nama
printer yang tidak ada dengan pesan yang bisa dibaca kasir, dan dua panggilan berurutan
diserialkan, bukan dijalankan bersamaan. Angka kecepatannya diambil dari pengukuran waktu di
sekitar `printRaw`, dicatat sebelum dan sesudah perubahan, supaya kata "instan" punya angka.

## 4. Pintasan Keyboard

Logika pemilihan pintasan ditarik keluar dari `Kasir.tsx` menjadi fungsi murni pada
`src/renderer/pages/kasir/shortcuts.ts`. Alasannya bukan kerapian: saat ini tidak ada satu pun
perilaku keyboard di `Kasir.tsx` yang bisa dijangkau vitest, sedangkan perubahan ini menyentuh
tombol yang memicu penerimaan uang.

### Aturan

- `PageUp` memindahkan fokus ke kolom **Jumlah** dan memilih isinya.
- `PageDown` memindahkan fokus ke kotak **Cari** dan memilih isinya.
- Keduanya diproses **sebelum** penjaga `isEditableFocused()`, sebagaimana `F3`, agar kasir
  bisa melompat bolak-balik antara dua kolom itu sambil mengetik. Keduanya aman dilakukan
  demikian karena tidak mengetikkan karakter apa pun.
- Keduanya nonaktif total saat `paymentOpen`, `paletteOpen`, atau `customerOpen` bernilai
  benar. Dialog pembayaran sudah memiliki `PageUp`/`PageDown` untuk memutar aksi, dan dialog
  harus selalu menang.
- `End` membuka dialog pembayaran.
- **`Enter` tunggal di keranjang tidak lagi membayar.** Cabang lone-Enter pada pemroses global
  dan cabang `Enter` pada `handleCartCellKeyDown` dicabut. Akibat sampingannya, `Enter` di
  dalam grid kembali ke perilaku bawaan react-data-grid, yaitu masuk ke mode sunting sel.
- Deteksi ledakan ketukan pemindai barcode, yang juga memakai `Enter`, **tidak berubah**. Itu
  jalur terpisah yang membedakan scan dari ketukan manusia lewat jeda 100 ms, dan harus tetap
  utuh.

Bar bantuan di bawah keranjang diperbarui: `Enter Bayar` menjadi `End Bayar`, ditambah
`PgUp Jumlah` dan `PgDn Cari`.

### Pengujian

`shortcuts.test.ts` menguji fungsi murni itu: `End` menghasilkan aksi bayar; `Enter` tidak;
`PageUp` dan `PageDown` menghasilkan aksi fokus yang benar; ketiganya menghasilkan `null` saat
salah satu dialog terbuka.

## 5. Konfirmasi Cetak

Pilihan mencetak pindah ke sesudah transaksi tersimpan.

- `PaymentDialog` menyisakan dua aksi: **Simpan** dan **Batal**. Tombol "Print/Cetak" dan aksi
  `cetak` dihapus dari sana, termasuk dari daftar yang diputar `PageUp`/`PageDown`.
- Setelah checkout berhasil, dialog pembayaran menutup, lalu muncul dialog kecil
  **"Cetak struk #N?"** yang juga menampilkan kembalian. `Enter` atau Ya mencetak; `Esc` atau
  Lewati tidak.
- Konsekuensi yang disetujui pemilik: mencetak kini dua kali `Enter`, bukan satu. Imbalannya,
  kembalian terlihat lebih dulu sebelum keputusan mencetak diambil.
- Nomor transaksi ditahan di state agar dialog konfirmasi tetap tahu struk mana yang dimaksud
  setelah keranjang direset.
- Cetak tetap dijalankan tanpa ditunggu. Kegagalan tetap memunculkan pesan "cetak ulang dari
  Riwayat"; keberhasilan menambahkan pesan "Struk #N dicetak."

## Migrasi Basis Data

Satu berkas migrasi drizzle mencakup seluruhnya: tabel `sale_edits`, tabel `customers`, kolom
`sales.customer_id`, dan SQL pengisian mundur nama pelanggan.

## Urutan Pengerjaan

Print instan dikerjakan lebih dulu dan berdiri sendiri: keluhan yang paling terasa setiap hari,
tidak menyentuh skema, dan mengandung satu-satunya risiko dependensi yang perlu diketahui lebih
awal. Berikutnya pintasan keyboard dan konfirmasi cetak, karena keduanya menyentuh berkas yang
sama (`Kasir.tsx` dan `PaymentDialog.tsx`) dan lebih murah dikerjakan dalam satu sentuhan.
Terakhir dua perubahan skema, dengan master pelanggan sesudah log edit, sebab master pelanggan
adalah yang paling luas jangkauannya.
