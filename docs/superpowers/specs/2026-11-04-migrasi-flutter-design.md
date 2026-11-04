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
- `lib/src/embedded.dart`: server yang ditanam di aplikasi Windows (lihat Keputusan).
- 126 test lolos.

Commit `c9a1921` dari desktop sudah ikut: `POST /v1/sales` menerima `cetak: false`
(menjawab `printSkipped: true`), dan baris pembelian bisa membawa `hargaJual`.

### Aplikasi Flutter (`mobile/`)

Menu yang sudah ada: Dashboard, Kasir, Riwayat, Pelanggan, Pembelian, Hutang
supplier, Supplier, Produk (termasuk satuan, harga bertingkat, input massal,
impor, hapus massal), Opname, Kartu stok, Pengeluaran, Rekap (termasuk Koreksi
HPP dan riwayatnya), Pengguna, Pengaturan (printer, perangkat, zona berbahaya:
hapus transaksi hari ini / sebelum tanggal). Kasir di PC memakai tombol pintas
desktop: End atau F12 bayar, F3 ubah jumlah, Alt+K kosongkan, F2/PageDown atau `/` cari.
Installer Windows: `windows/installer/build.ps1`. 55 test lolos.

**Sengaja tidak dibuat:**
- Efisiensi harga. Di desktop juga disembunyikan (`EFISIENSI_HARGA_AKTIF = false`
  di `Rekap.tsx`). Servernya sudah siap kalau nanti mau ditampilkan.
- Command palette dan Alt+P (pilih pelanggan). Di Flutter, pencarian ada di layar
  kasir dan pelanggan dipilih di layar bayar.

**Untuk tahap HP (belum):**
- Tombol "jangan cetak struk" saat bayar dan kolom ubah harga jual saat pembelian.
  Server sudah mendukung keduanya.
- Kode server ikut terbawa ke APK walaupun tidak dipakai di Android. APK debug
  naik dari 177 MB ke 217 MB, jadi perlu dipisah sebelum APK dibagikan.

## Keputusan (2026-11-04)

- **Server ditanam di aplikasi Windows.** `main.dart` menjalankan
  `startLocalServer()` di isolate terpisah sebelum tampilan muncul. Android tidak
  pernah menjadi server. Satu installer, satu ikon, dan hanya satu proses yang
  memegang file SQLite. Kalau aplikasi PC ditutup, HP ikut terputus, sama seperti desktop lama.
- **Database baru di `%APPDATA%\point_of_sales\pos.sqlite`**, terpisah dari
  `%APPDATA%\point-of-sale\` milik desktop. Saat pertama kali dibuka, data desktop
  disalin lewat file sementara (`pos.sqlite.importing`), lalu file desktop tidak
  pernah disentuh lagi.
- **Port dicek dengan mencoba menyambung**, bukan dengan bind. Windows mengizinkan
  socket kedua bind ke port yang sudah dipakai Electron, sehingga dua server bisa
  hidup berdampingan dan mengimpor database yang masih dipakai. Kalau port terisi,
  aplikasi menampilkan "Tutup POS Desktop yang lama" dan tidak menyentuh file apa pun.
- **Installer per pengguna** (`%LOCALAPPDATA%\Programs\Point of Sales`, tanpa
  hak admin). Installer dan uninstaller menolak berjalan selama aplikasi terbuka.
  Uninstall tidak menghapus data toko.

## Tahapan

1. ~~**Simpan pekerjaan.**~~ Selesai 2026-11-04 (branch `feat/flutter-migration`).
2. ~~**Samakan fitur.**~~ Selesai 2026-11-04, lihat status di atas.
3. ~~**Paketkan untuk PC toko.**~~ Selesai 2026-11-04: `Point-of-Sales-Setup-<versi>.exe`.
4. **Uji paralel.** Salin data toko asli (`import_legacy.dart`) ke PC uji,
   jalankan versi Flutter selama beberapa hari, lalu cocokkan rekap, stok,
   hutang, dan piutang dengan desktop. Uji juga printer struk dan pairing HP.
5. **Pindah.** Di hari yang disepakati: tutup desktop, pasang installer, lalu buka
   aplikasi. Data terakhir tersalin otomatis. File database desktop tetap ada sebagai backup.
6. **Pensiunkan `desktop-node`.** Setelah satu periode tanpa masalah, desktop
   hanya disimpan untuk referensi.
7. **Fokus HP.** Lihat "Untuk tahap HP" di atas.

## Pertanyaan terbuka

- **Firewall Windows.** Saat server pertama kali membuka port, Windows bisa
  menanyakan izin (perlu admin). Ini sama seperti desktop lama, tapi tetap perlu
  dicek di PC toko supaya HP bisa tersambung.
- **Ikon aplikasi.** Masih ikon bawaan Flutter. Desktop lama juga memakai ikon bawaan Electron.
- **Update otomatis.** Untuk Windows bisa lewat GitHub Releases
  (`mohammadraflyy/POS`, publik). Untuk Android, APK diunduh lalu dipasang
  dengan konfirmasi pengguna.
- **Token HP lama.** Tabel `device_tokens` ikut tersalin, jadi HP yang sudah
  pairing ke desktop seharusnya langsung tersambung. Perlu diuji di tahap 4.
- **Versi.** Aplikasi bernomor 1.0.0, sedangkan server masih melaporkan `appVersion`
  0.1.0 di `/v1/health`. Nomornya perlu disamakan sebelum rilis.
