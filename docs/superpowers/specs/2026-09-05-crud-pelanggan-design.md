# Menu CRUD Pelanggan yang Tersambung ke Penjualan

Tanggal: 2026-09-05

## Masalah

Tidak ada master pelanggan. `sales.nama_pelanggan` adalah teks bebas, dan
`listCustomers()` (`src/main/kasir.ts:126`) menyusun daftar pelanggan dengan
mengambil nama distinct dari tabel `sales`. Akibatnya:

- Data pelanggan tidak bisa disimpan (telepon, alamat, keterangan tidak ada tempatnya).
- Salah ketik nama melahirkan "pelanggan" baru yang tidak bisa diperbaiki.
- Pelanggan tidak bisa dihapus atau dirapikan tanpa mengedit transaksi.

## Sasaran

Menu CRUD Pelanggan yang isinya benar-benar dipakai kasir: daftar di
`CustomerPicker` berasal dari master, dan setiap penjualan menunjuk ke baris
master lewat foreign key.

Bukan bagian dari pekerjaan ini: halaman piutang/bon per pelanggan, plafon bon,
dan laporan per pelanggan.

## Desain

### 1. Data

Tabel baru, meniru `suppliers` (`src/main/db/schema.ts:103`):

```ts
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  nama: text('nama').notNull(),
  telepon: text('telepon'),
  alamat: text('alamat'),
  keterangan: text('keterangan'),
  ...timestamps(),
})
```

`sales` mendapat satu kolom:

```ts
customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
```

`sales.nama_pelanggan` tetap ada dan tetap diisi. Kolom itu adalah snapshot:
struk, riwayat, dan Rekap membacanya apa adanya, sehingga mengganti nama di
master tidak menulis ulang transaksi yang sudah lewat, dan menghapus pelanggan
tidak menghilangkan nama dari nota lama.

### 2. Migrasi dan backfill

Satu file migrasi baru (`drizzle-kit generate`, menghasilkan `0018_*.sql`) berisi
`CREATE TABLE customers`, `ALTER TABLE sales ADD customer_id`, lalu backfill yang
ditulis manual di file yang sama:

1. Masukkan setiap `trim(nama_pelanggan)` distinct dari `sales` (yang tidak null
   dan tidak kosong) sebagai baris `customers`. `UMUM` ikut masuk, karena nama itu
   sudah muncul di picker dan menempel di transaksi seperti nama lain.
2. Isi `sales.customer_id` dengan mencocokkan `trim(nama_pelanggan)` ke
   `customers.nama`.

`created_at`/`updated_at` adalah epoch milidetik (`integer` mode `timestamp`),
jadi backfill memakai `CAST(strftime('%s','now') AS INTEGER) * 1000`.

Hasilnya menu Pelanggan langsung terisi seluruh pelanggan lama, bukan kosong.

### 3. Main process

`src/main/customer.ts` meniru `src/main/supplier.ts`:

- `listCustomers(db, { search, page, pageSize })` — paging dan pencarian nama,
  ditambah kolom `saleCount`. Subquery hitung ini **wajib** memakai identifier SQL
  mentah (`SELECT COUNT(*) FROM sales WHERE customer_id = customers.id`) karena
  query-nya tanpa JOIN; alasan lengkapnya ada di komentar `src/main/supplier.ts:26`.
- `createCustomer`, `updateCustomer`, `deleteCustomer` — validasi nama wajib diisi
  dan maksimal 255 karakter.
- `findOrCreateCustomerByName(db, nama)` — mengembalikan id baris yang namanya
  cocok **tanpa membedakan huruf besar/kecil**, atau membuat barisnya kalau belum
  ada. Pencocokan case-insensitive mencegah "Budi" dan "budi" menjadi dua
  pelanggan; `CustomerPicker` sudah menganggap keduanya sama.

`src/main/kasir.ts`:

- `createSale` dan `updateSale` memanggil `findOrCreateCustomerByName` di dalam
  transaksi yang sudah ada, lalu menyimpan `customerId` bersama `namaPelanggan`.
  Kasir tetap mengirim nama seperti sekarang, jadi pelanggan baru terbentuk
  otomatis tanpa langkah tambahan di register.
- `listCustomers` yang lama diganti: membaca master, urut nama.

### 4. Renderer

- `src/renderer/pages/Pelanggan.tsx` mengikuti `Supplier.tsx`: DataGrid dengan edit
  di tempat, pencarian, pilihan jumlah baris, tombol Tambah dan Hapus. Filter
  pencariannya memakai `useStickyState` supaya tidak ter-reset saat berpindah
  halaman.
- Route `/pelanggan` di `App.tsx` dan item sidebar (ikon `Users`).
- `src/main/ipc/customer.ts` meniru `ipc/supplier.ts`: `requireUser` untuk list,
  create, dan update; `requireAdmin` untuk delete. Preload dan `env.d.ts` menyusul.
- `CustomerPicker` tidak berubah bentuknya — tetap menerima `string[]` dan tetap
  menerima nama baru yang diketik; hanya sumber datanya yang kini master.

### 5. Test

- `src/main/customer.test.ts`: CRUD dan validasi; `findOrCreateCustomerByName`
  idempoten dan case-insensitive; menghapus pelanggan membuat `sales.customer_id`
  menjadi null sementara `nama_pelanggan` tetap utuh.
- `src/main/kasir.test.ts`: penjualan atas nama baru membuat tepat satu baris
  master, dan penjualan kedua atas nama yang sama tidak menambah baris.
- Test migrasi: nama lama menjadi baris master dan `customer_id` transaksi lama
  terisi.
