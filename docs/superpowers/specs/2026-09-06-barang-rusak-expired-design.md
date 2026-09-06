# Menu Barang Rusak / Expired

Tanggal: 2026-09-06

## Masalah

Tidak ada tempat untuk mencatat barang yang keluar dari toko tanpa terjual: pecah,
kedaluwarsa, atau hilang. Yang tersedia sekarang hanya Stock Opname, dan memakainya
untuk keperluan ini menyisakan tiga lubang:

- **Kerugiannya tidak muncul di laporan mana pun.** `stock_adjustments`
  (`src/main/db/schema.ts:264`) hanya ditulis oleh `recordStockAdjustment`
  (`src/main/stock-opname.ts:114`) dan oleh import massal
  (`src/main/inventory-bulk.ts:272`); tidak ada satu pun pembacanya. Rekap menyusun
  `labaKotor` murni dari `sale_items`, jadi stok yang hilang lewat opname menurunkan
  `products.stok` tanpa pernah muncul sebagai rupiah di laporan.
- **Opname selalu satuan dasar.** `recordStockAdjustment` menulis
  `conversionFactor: 1` secara harfiah, padahal barang rusak biasanya dihitung per DUS
  atau per KARTON.
- **Opname meminta jumlah absolut, bukan selisih.** Formulirnya bertanya "stok fisik
  sekarang berapa", sedangkan yang ada di kepala pemakai adalah "buang 3 pcs".

Selain itu tidak ada tanggal kedaluwarsa di mana pun: `products` tidak punya kolomnya
dan tidak ada tabel batch.

## Sasaran

Satu menu untuk mencatat barang rusak/expired/hilang pada saat ketahuan, lengkap dengan
satuan dan nilai rupiahnya, ditambah satu tempat membacanya kembali di Rekap.

Bukan bagian dari pekerjaan ini:

- Tanggal kedaluwarsa per produk maupun batch/lot per pembelian, beserta peringatan
  menjelang expired. Keputusan sadar: satu tanggal per produk salah untuk barang yang
  datang berkali-kali dengan expired berbeda, dan batch per pembelian menyentuh
  pembelian, kasir, opname, sekaligus HPP — itu proyek tersendiri.
- Retur barang rusak ke supplier.
- Perubahan pada `labaKotor` Rekap dan pada buku kas.

## Desain

### 1. Data

Tabel baru:

```ts
export const stockWriteoffs = sqliteTable('stock_writeoffs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  productUnitId: integer('product_unit_id').references(() => productUnits.id, { onDelete: 'set null' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** jumlah dalam satuan yang dipilih; boleh pecahan sampai 3 desimal */
  qty: integer('qty').notNull(),
  /** conversionFactor satuan yang dipilih, 1 untuk satuan dasar */
  konversi: integer('konversi').notNull().default(1),
  /** qty * konversi - inilah yang dipotong dari products.stok */
  baseQuantity: integer('base_quantity').notNull(),
  /** HPP satu satuan yang dipilih, di-snapshot saat pencatatan */
  hargaPokok: integer('harga_pokok').notNull(),
  /** round(qty * hargaPokok) */
  nilaiKerugian: integer('nilai_kerugian').notNull(),
  jenis: text('jenis', { enum: ['rusak', 'expired', 'hilang'] }).notNull(),
  catatan: text('catatan'),
  tanggal: text('tanggal').notNull(),
  ...timestamps(),
})
```

`hargaPokok` di-snapshot dengan alasan yang sama seperti `sale_items.hargaPokok`
(`src/main/db/schema.ts:190`): mengubah HPP hari ini tidak boleh menulis ulang nilai
kerugian bulan lalu.

Kolom `qty`, `konversi`, `baseQuantity` bertipe `integer` mengikuti seluruh tabel lain.
SQLite memakai *integer affinity*, jadi 5,5 tersimpan apa adanya; yang membatasi hanya
penjaga di sisi TypeScript, dan di sini penjaganya adalah `isQtyValid`/`bulatkanQty`
(`src/main/qty.ts`).

`stock_movements.movement_type` mendapat nilai baru `'write_off'`. Kolom itu
dideklarasikan sebagai `` `movement_type` text NOT NULL `` di
`drizzle/0010_outgoing_jane_foster.sql:8` — enum drizzle tidak memancarkan `CHECK`,
sehingga nilai baru adalah perubahan TypeScript saja. Nilai baru dipilih ketimbang
mendaur ulang `'stock_adjustment'` karena tabel ini justru akan punya pembaca.

HPP produk tidak disentuh. Barang yang keluar tidak menggeser rata-rata bergerak,
persis seperti pada penjualan.

### 2. Migrasi

Satu file migrasi baru (`drizzle-kit generate`, menghasilkan `0019_*.sql`) berisi
`CREATE TABLE stock_writeoffs`. Tidak ada backfill: sebelum ini tidak ada data yang
setara.

SQL hasil generate diperiksa dan, bila perlu, disunting tangan supaya ketiga klausa
`ON DELETE` benar-benar ada — drizzle pernah menjatuhkan aksi FK pada SQL yang
dihasilkannya.

### 3. Main process — `src/main/stock-writeoff.ts`

```ts
export interface WriteoffProductOption {
  id: number
  kodeItem: string
  namaItem: string
  satuan: string          // kode satuan dasar
  hargaPokok: number      // HPP satuan dasar
  stok: number
  units: { id: number; satuan: string; konversi: number; hargaPokok: number }[]
}

export function searchProductsForWriteoff(db, q: string): WriteoffProductOption[]
export function findProductForWriteoffByBarcode(db, barcode: string): WriteoffProductOption | null
export function recordStockWriteoff(db, input: RecordStockWriteoffInput): { id: number }
export function listStockWriteoffs(db, input: { from: string; to: string; q: string }): StockWriteoffListResult
export function deleteStockWriteoff(db, id: number): void
```

Pencarian meniru `searchProductsForPurchase` (`src/main/purchase.ts:761`): `like` pada
kode/nama/barcode, batas 20 baris, satuan dasar dari `getBaseProductUnit` dan satuan
turunan dari `listProductUnits` (`src/main/inventory-units.ts`). Bedanya tiap satuan
turut membawa `hargaPokok`-nya sendiri, karena nilai kerugian dihitung dari sana.
Pencarian lewat barcode memakai `eq`, bukan `like`, dengan alasan yang sama seperti
`findProductForPurchaseByBarcode`: scan yang ambigu tidak boleh diam-diam memilih
produk yang salah.

`recordStockWriteoff` berjalan dalam satu transaksi:

1. Validasi: `isQtyValid(qty)` dan `qty > 0`; `jenis` termasuk salah satu dari tiga
   nilai; `catatan` maksimal 255 karakter; produk ada.
2. Resolusi satuan: `productUnitId` kosong berarti satuan dasar (`konversi = 1`,
   `hargaPokok` dari `products.hargaPokok`). Bila diisi, baris `product_units` harus
   milik produk yang sama; `konversi` diambil dari `conversionFactor`-nya dan
   `hargaPokok` dari kolom `hargaPokok` baris itu.
3. `baseQuantity = bulatkanQty(qty * konversi)`.
4. **Tolak bila `baseQuantity > products.stok`**, dengan pesan
   `Stok tidak cukup, hanya tersisa <n> <satuan dasar>.` Stok yang salah adalah urusan
   Stock Opname; menu ini tidak boleh membuat stok negatif.
5. `nilaiKerugian = Math.round(qty * hargaPokok)`.
6. Insert `stock_writeoffs`; `products.stok -= baseQuantity`; insert satu baris
   `stock_movements` (`quantity: -qty`, `conversionFactor: konversi`,
   `baseQuantity: -baseQuantity`, `movementType: 'write_off'`,
   `referenceId` = id baris writeoff).

`listStockWriteoffs` menyaring `tanggal` pada rentang `from..to`, dan `q` mencocokkan
kode/nama produk. Mengembalikan daftar baris (produk, satuan, qty, jenis, catatan,
nilai kerugian, nama pengguna, tanggal) beserta `totalKerugian`.

`deleteStockWriteoff` mengikuti pola `deletePurchase` (`src/main/purchase.ts:577`)
dalam satu transaksi: baris dibaca dulu (tidak ada → `Catatan tidak ditemukan.`),
lalu `stock_movements` pembalik (`quantity: +qty`, `baseQuantity: +baseQuantity`,
`referenceId` sama), `products.stok += baseQuantity`, lalu barisnya dihapus. Karena
barisnya ikut hilang, pembalikan ganda mustahil.

### 4. IPC — `src/main/ipc/stock-writeoff.ts`

Lima handler bernama `stock-writeoff:searchProducts`, `:findByBarcode`,
`:record`, `:list`, `:delete`. Semuanya memanggil `requireUser()` seperti seluruh
handler lain; `:record` meneruskan `user.id` ke `userId`. Didaftarkan dari
`src/main/index.ts`.

Preload (`src/preload/index.ts`) mendapat namespace `stockWriteoff`, dan tipenya
dituliskan manual di `src/renderer/env.d.ts`. Cermin tipe itu tidak diperiksa
compiler terhadap handler-nya, jadi bidangnya dicocokkan dengan tangan.

### 5. Renderer — `src/renderer/pages/StockWriteoff.tsx`

Route `/stock-writeoff` di `App.tsx`; tautan sidebar di grup "Pembelian & Stok"
(`src/renderer/components/app-sidebar.tsx:32`) tepat di bawah Stock Opname, ikon
`PackageX`. Terlihat oleh semua peran — kasir yang menemukan barang pecah adalah orang
yang mencatatnya.

Satu halaman, dua bagian:

- **Formulir** — cari produk (ketik atau scan barcode) → pilih satuan (default satuan
  dasar) → qty → jenis (rusak/expired/hilang) → catatan → Simpan. Nilai kerugian
  ditampilkan hidup di samping qty supaya pemakai melihat rupiahnya sebelum menyimpan.
  Qty diketik dan dibaca lewat `formatQty`/`parseQty` (`src/renderer/lib/utils.ts`),
  bukan `Number()` mentah.
- **Riwayat** — filter rentang tanggal dan kata kunci, tabel baris beserta kolom nilai
  kerugian, total di footer, dan tombol Hapus per baris yang meminta konfirmasi lewat
  `use-confirm`. Nilai filter disimpan dengan `useStickyState` supaya tidak hilang saat
  berpindah halaman lalu kembali.

### 6. Rekap

`RekapSummary` mendapat `kerugianBarang: number`, dan `RekapResult` mendapat
`kerugianBarang: KerugianBarangRow[]` (`jenis`, `namaItem`, `qty`, `satuan`, `nilai`).
`Rekap.tsx` menampilkan satu kartu "Kerugian Barang" dan satu tabel rinciannya;
`buildRekapWorkbook` mendapat satu sheet baru.

`labaKotor` **tidak** diubah, dan `cash_expenses` **tidak** disentuh. Kerugian barang
bersifat non-kas: memasukkannya ke pengeluaran kas akan merusak buku kas yang berbasis
kas, dan mengurangkan langsung dari `labaKotor` akan mengubah angka yang selama ini
dipakai pemilik untuk membandingkan periode.

Rekap berbasis kas untuk penjualan, tetapi kerugian barang diakui pada `tanggal`
pencatatannya — tidak ada peristiwa pembayaran yang bisa dipakai sebagai tanggal lain.

### 7. Test

`src/main/stock-writeoff.test.ts`, memakai sqlite berbasis file seperti test lain
(dan menutup `db.$client` sebelum menghapus filenya):

- Mencatat 1 DUS (konversi 12) memotong `products.stok` sebanyak 12, dan
  `nilaiKerugian` memakai HPP baris DUS, bukan HPP satuan dasar.
- Qty pecahan (0,5 KG) tersimpan dan terpotong apa adanya.
- Qty 0, qty negatif, dan `jenis` di luar tiga nilai ditolak.
- `baseQuantity` melebihi stok ditolak, dan stok tidak berubah.
- Satuan milik produk lain ditolak.
- Menghapus catatan mengembalikan stok persis ke angka semula, dan catatan yang sama
  tidak bisa dihapus dua kali.
- Jumlah seluruh `stock_movements.baseQuantity` sebuah produk tetap sama dengan
  `products.stok` sesudah catat maupun sesudah hapus.

`src/main/rekap.test.ts` bertambah satu kasus: kerugian dalam rentang masuk ke
`summary.kerugianBarang`, sementara `labaKotor` pada rentang yang sama tidak bergeser.
