# Migrasi POS ke Flutter + Server Dart

Tanggal: 2026-11-04 (keputusan awal: 2026-10-14)

## Masalah

POS toko sekarang berjalan di `desktop-node`: aplikasi Electron (TypeScript +
React) yang sekaligus menjadi server untuk HP. Aplikasi HP (`mobile`, paket
`point_of_sales`) ditulis terpisah dalam Flutter. Jadi ada dua bahasa, dua
tampilan, dan dua tempat yang harus diubah untuk setiap fitur baru.

## Sasaran

Satu bahasa (Dart) untuk semua platform:

- **`server/`**: backend Dart (shelf + SQLite) yang berjalan di PC toko. Fitur
  setara `desktop-node`, dan kontrak `/v1/...` yang dipakai HP tetap sama
  persis, jadi HP yang sudah dipasang tidak perlu diubah.
- **`mobile/`**: satu aplikasi Flutter untuk Android dan Windows. Di PC kasir,
  aplikasi ini tersambung ke server di `127.0.0.1:48950`. Di HP, aplikasi
  tersambung lewat Wi-Fi setelah pairing QR.

Setelah migrasi selesai, `desktop-node` dipensiunkan.

Bukan bagian dari pekerjaan ini: mode offline di HP, sinkronisasi banyak toko,
dan iOS.

## Aturan selama migrasi

- `desktop-node` masih dipakai toko. Perubahan di sana hanya untuk perbaikan
  atau fitur yang toko butuhkan sekarang. **Setiap perubahan di desktop wajib
  ikut dibawa ke `server/`** supaya kesetaraan fitur tidak bocor.
- Skema database `server/` versi 1 identik dengan desktop v0.1.0, tabel per
  tabel, jadi `pos.sqlite` toko bisa disalin apa adanya.
  Perubahan skema berikutnya ditambahkan sebagai migrasi baru di
  `server/lib/src/db/schema.dart` dan tidak pernah mengedit migrasi lama.
- Uang disimpan dalam sen di database dan dikirim sebagai rupiah lewat HTTP,
  sama seperti di desktop.

## Status per 2026-11-04

### Server (`server/`)

Seluruh modul domain desktop sudah punya padanan:

| Desktop (`desktop-node/src/main`) | Server (`server/lib/src`) |
| --- | --- |
| auth, users, device-tokens, pairing | `domain/auth`, `users`, `device_tokens`, `pairing` |
| kasir, receipt, escpos, print-windows | `domain/kasir`, `printing/*` |
| inventory, inventory-bulk, inventory-units, master-satuan | `domain/inventory`, `inventory_units`, `master_satuan` |
| purchase, supplier, customer | `domain/purchase`, `parties` |
| stock-opname, stock-movements | `domain/stock` |
| rekap, dashboard, cost-correction, harga-efisiensi, expense | `domain/rekap`, `cost_correction`, `harga_efisiensi`, `expense` |

Semua IPC desktop sudah tersedia sebagai endpoint HTTP `/v1/...`.
Tambahan lainnya:

- `bin/import_legacy.dart` menyalin `pos.sqlite` desktop ke database server.
- `bin/seed_demo.dart` membuat database berisi data dummy untuk test.
- 119 test lolos.

**Belum ikut dari desktop:** commit `c9a1921` (2026-11-04):
- `POST /v1/sales` belum menerima `cetak: false` dan belum menjawab `printSkipped: true`.
- Pencarian produk pembelian belum mengembalikan `hargaJual`, dan
  `POST /v1/purchases` belum menerima `hargaJual` per baris.

### Aplikasi Flutter (`mobile/`)

Menu yang sudah ada: Dashboard, Kasir, Riwayat, Pelanggan, Pembelian, Hutang
supplier, Supplier, Produk (termasuk satuan, harga bertingkat, input massal,
impor), Opname, Kartu stok, Pengeluaran, Rekap, Pengguna, Pengaturan (printer,
perangkat). Target Android dan Windows sudah dibuat. 44 test lolos.

**Belum ada di Flutter** (sudah tersedia di server):
- Efisiensi harga (`/v1/products/efisiensi-harga/*`)
- Koreksi HPP (`/v1/rekap/cost-corrections*`)
- Hapus penjualan hari ini / sebelum tanggal (`/v1/sales-purge/*`)
- Hapus produk massal (`/v1/products/bulk-delete`)
- Pilihan "jangan cetak struk" dan ubah harga jual saat pembelian (menunggu server, lihat di atas)
- Kenyamanan kasir desktop: shortcut keyboard dan command palette
  (`desktop-node/src/renderer/pages/kasir/shortcuts.ts`, `CommandPalette.tsx`)

## Tahapan

1. **Simpan pekerjaan.** Commit `server/` dan `mobile/` ke git (sebelumnya
   belum pernah di-commit).
2. **Samakan fitur.** Bawa `c9a1921` ke server, lalu lengkapi menu Flutter yang
   belum ada (daftar di atas).
3. **Paketkan untuk PC toko.** Satu installer Windows yang berisi aplikasi
   Flutter dan `server.exe` (`dart build`). Server menyala otomatis bersama
   aplikasi atau sebagai proses latar. Database dan port tetap sama:
   `%APPDATA%\point-of-sale\` atau folder baru, dan port `48950`.
4. **Uji paralel.** Salin data toko asli (`import_legacy.dart`) ke PC uji,
   jalankan versi Flutter berdampingan selama beberapa hari, lalu cocokkan
   rekap, stok, hutang, dan piutang dengan desktop.
5. **Pindah.** Di hari yang disepakati: tutup desktop, impor data terakhir,
   pasang versi Flutter, lalu pairing ulang HP jika token perlu diterbitkan
   ulang. File database desktop disimpan sebagai backup.
6. **Pensiunkan `desktop-node`.** Setelah satu periode tanpa masalah, desktop
   hanya disimpan untuk referensi.

## Pertanyaan terbuka

- **Cara server berjalan di Windows.** Pilihannya: dijalankan oleh aplikasi
  Flutter sebagai proses anak, atau sebagai Windows service. Prinsip dari
  desain mobile tetap berlaku: hanya satu proses yang memegang file SQLite.
- **Lokasi database.** Pakai lagi `%APPDATA%\point-of-sale\pos.sqlite`, atau
  pindah ke folder baru supaya desktop dan Flutter tidak pernah membuka file yang sama.
- **Update otomatis.** Untuk Windows bisa lewat GitHub Releases
  (`mohammadraflyy/POS`, publik). Untuk Android, APK diunduh lalu dipasang
  dengan konfirmasi pengguna.
- **Token HP lama.** Apakah tetap berlaku setelah impor? Tabel `device_tokens`
  ikut tersalin, jadi seharusnya tetap berlaku. Perlu diuji di tahap 4.
