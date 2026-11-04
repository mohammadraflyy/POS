# POS Mobile Flutter — API fase 1–4

Paket ini memperbarui aplikasi Flutter sebelumnya berdasarkan mobile-api(1).md. Setelah pairing, tab Kasir, Pembelian, Opname, dan Riwayat memakai API PC. Tidak ada lagi layar penghalang “layanan transaksi belum tersedia”. Mode demo tetap terpisah dan tidak menyentuh toko.

## Memasang pada proyek yang sudah dipakai

1. Backup folder lib dan test yang lama.
2. Ganti lib dengan folder lib dari ZIP ini. Dependensi sama dengan paket sebelumnya.
3. Bila belum terpasang, jalankan dari root proyek:

```powershell
flutter pub add flutter_secure_storage:9.2.4 mobile_scanner:7.0.0
```

4. Salin folder test bila ingin menjalankan test baru. Pindahkan test counter Flutter lama yang sudah tidak relevan.
5. Pastikan konfigurasi Android di bawah sudah benar, lalu:

```powershell
flutter pub get
flutter analyze
flutter test
flutter run
```

Hentikan aplikasi dan jalankan ulang setelah perubahan native/dependensi. Untuk perubahan Dart saja lakukan hot restart. pubspec.yaml disertakan sebagai referensi atau untuk proyek baru; pertahankan dependensi dan assets tambahan jika proyek Anda memilikinya.

Proyek baru dapat dibuat dengan `flutter create --platforms=android --project-name point_of_sales pos_mobile`, lalu salin isi paket ke proyek hasil generator. ZIP berisi source Flutter, bukan APK atau native project hasil build.

## Pairing: scan lalu login

1. PC dan HP menggunakan jaringan LAN/Wi-Fi yang sama. Jalankan POS PC yang mengimplementasikan API fase 1–4.
2. Di PC buka Pengaturan > Perangkat Mobile dan buat QR pairing.
3. Pada HP scan QR tersebut. Alamat dan kode diambil otomatis; setelah scan cukup isi username/password akun PC dan nama perangkat.
4. Tekan Hubungkan perangkat. QR bukan pengganti autentikasi akun.
5. Token tersimpan aman. Saat membuka aplikasi lagi, koneksi dicoba dengan token tersimpan, tanpa scan/login ulang.

Alamat/kode manual disembunyikan di balik tombol “Masukkan alamat / kode secara manual”. Kode sekali pakai dan kedaluwarsa 5 menit mengikuti PC. Tidak ada input versi, dart-define versi, atau pemeriksaan kecocokan appVersion, sesuai permintaan pengguna. Respons bisnis tidak diwajibkan memiliki appVersion.

401 dari semua request bisnis maupun /me menghapus sesi lokal dan kembali ke pairing tanpa retry. Kata sandi tidak disimpan. Menghapus sesi lokal tidak mencabut device token server; pencabutan dilakukan dari PC.

## Alur yang terhubung ke PC

### Kasir

- Cari nama/kode/barcode dan pindah halaman katalog. Barcode kamera menjadi query katalog; pilih produk hasil pencarian yang benar. Scanner keyboard juga bisa mengisi kolom pencarian.
- Pilih satuan, qty pecahan, harga manual opsional, dan diskon baris; tambah diskon nota jika diperlukan.
- Setiap perubahan mengirim seluruh keranjang ke POST /v1/carts/price setelah debounce singkat. Respons lama diabaikan jika keranjang sudah berubah.
- Harga/tier, diskon, subtotal, total, dan kecukupan stok memakai hasil PC. Flutter tidak menghitung total transaksi live dari harga produk. Konversi input/format uang bukan kalkulasi transaksi.
- Selama preview belum siap, gagal, atau ada stokCukup:false, bayar dinonaktifkan.
- Pembayaran mendukung tunai, bon, QRIS, transfer. Daftar pelanggan berasal dari /v1/customers. QRIS/transfer di sini mencatat pembayaran yang sudah diterima toko; bukan payment gateway atau pembuat QR pembayaran.
- Checkout hanya dikirim satu kali ke POST /v1/sales. PC mencetak otomatis.
- printed:false tetap berarti penjualan tersimpan. Aplikasi membuka detail nota dan menawarkan POST /v1/sales/:id/print; tidak mengulang checkout.

### Riwayat

GET /v1/sales dengan pencarian, pagination, rentang tanggal, metode, dan filter status selesai. Detail nota melalui /v1/sales/:id. Riwayat bon dan audit hanya dibaca jika ada pada respons. Tidak ada cancel/delete/edit/cicilan baru dari HP karena endpoint HTTP tersebut tidak disediakan.

### Pembelian dan supplier

Cari/pilih supplier, atau tambah supplier dengan nama/telepon/alamat/keterangan. Supplier opsional sesuai contoh request API (supplierId:null). Form pembelian mendukung beberapa baris, termasuk produk yang sama pada satuan berbeda. Produk dipilih lewat pencarian atau barcode exact melalui /v1/purchases/products/barcode/:code. Tanggal, catatan, dan uang muka opsional dikirim ke POST /v1/purchases. Uang muka tidak dikirim jika kosong (lunas); 0 dikirim untuk utang penuh. Validasi total, stok, dan weighted average cost dilakukan PC. Tidak ada penjumlahan total pembelian live di HP karena API tidak menyediakan preview pembelian.

Pembelian yang sudah tersimpan, edit/delete, dan pembayaran utang supplier tetap dikelola di PC karena endpoint terkait tidak ada dalam kontrak HTTP terbaru.

### Stock opname

Kategori dan produk diambil dari API. Query kategori dikirim sebagai categoryIds=1,2,3. Browsing kategori tanpa keyword tidak dibatasi klien; pencarian keyword mengikuti limit server. Hasil hitung dikirim dalam satuan dasar ke /v1/opname/adjustments, termasuk stok nol. UI meminta konfirmasi nilai akhir; PC menghitung selisih dan menyimpan stok/movement tanpa mengubah harga pokok. Tidak ada undo atau riwayat opname yang dibuat-buat.

## Koneksi terputus saat menyimpan

API tidak mendokumentasikan idempotency key. Karena itu tidak ada retry otomatis pada POST yang menyimpan data. Aplikasi menulis penanda terenkripsi per PC/pengguna sebelum penjualan, pembelian, supplier baru, atau opname dikirim.

- Respons 400/401/404 adalah penolakan eksplisit; penanda dibersihkan.
- Timeout, respons rusak, atau 500 bisa meninggalkan hasil tidak pasti. Aplikasi memblokir penyimpanan berikutnya dan meminta pemeriksaan riwayat/data di PC.
- Penanda tetap ada setelah aplikasi ditutup. Setelah memeriksa PC, tekan Periksa > Sudah saya periksa di PC untuk menghapus penanda. Jangan membuat ulang operasi yang sudah tercatat.
- Penanda ini bukan antrean offline dan tidak pernah mengirim ulang request.

## Konfigurasi Android

Flutter/Dart >=3.7.0. Target utama Android HP/tablet. Pada android/app/build.gradle.kts, gunakan minSdk minimal 23, atau pertahankan nilai proyek yang lebih tinggi:

```kotlin
minSdk = 23
```

Tambahkan di android/app/src/main/AndroidManifest.xml sebagai anak manifest, di luar application:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

Tambahkan/ubah atribut pada application yang sudah ada, tanpa menghapus activity/meta-data:

```xml
android:usesCleartextTraffic="true"
android:allowBackup="false"
```

PC menggunakan HTTP lokal port 48950 sesuai kontrak. Jika sudah memakai networkSecurityConfig, sesuaikan kebijakan cleartext di file itu. Izin kamera ditangani plugin scanner; input manual tetap tersedia. Firewall PC harus mengizinkan port tersebut. Gunakan IP PC yang ditampilkan Pengaturan, bukan alamat contoh.

Implementasi transport memakai dart:io, jadi bukan target Flutter Web. Kamera mobile_scanner tidak mendukung Windows/Linux. Target iOS memerlukan konfigurasi kamera, local network, ATS, dan Keychain tambahan; tidak divalidasi di paket ini.

## Struktur penting

- services/mobile_api.dart: transport JSON objek/array, status error, pairing, autentikasi.
- services/business_api.dart: seluruh path/query/body bisnis sesuai dokumen.
- models/live_models.dart: pemetaan data katalog/satuan dan respons harga PC.
- services/mutation_guard.dart: penanda hasil simpan yang belum pasti.
- state/live_store.dart: draft keranjang, preview server, checkout.
- Screen/Live/: screen mode terhubung.
- Screen/Penjualan, Pembelian, StockOpname dan services/demo_store.dart: mode demo terpisah.
- Screen/Pairing/: scan QR lalu login tanpa input versi.

## Batas verifikasi dan schema

Flutter/Dart SDK tidak tersedia di lingkungan pembuat paket, jadi analyze, test Flutter, build APK, render layar, kamera, serta pairing/transaksi ke PC nyata BELUM dijalankan. Pemeriksaan lokal hanya struktur source, import, endpoint, dan ZIP. Test disertakan tetapi belum dinyatakan lulus.

Dokumentasi terbaru menamai CatalogItem serta detail nota/supplier tanpa memberikan schema lengkap atau contoh JSON aktual. Parser utama mendukung nama field Indonesia yang digunakan dokumen sebelumnya serta beberapa alias umum. Semua asumsi dan kebutuhan contoh respons dicatat di docs/coverage.md. Jika nama barang/satuan/detail tidak muncul, kirim contoh JSON GET /v1/catalog/search dan GET /v1/sales/:id (hapus data pribadi); pemetaan bisa diperbaiki pada satu tempat. Harga checkout tidak pernah ditebak dari data katalog yang tidak lengkap.

Referensi plugin: [flutter_secure_storage 9.2.4](https://pub.dev/packages/flutter_secure_storage/versions/9.2.4), [mobile_scanner 7.0.0](https://pub.dev/packages/mobile_scanner/versions/7.0.0). Versi dependensi dipin, bukan klaim versi terbaru.

## Update penanganan kamera

Jika scan menampilkan “An unexpected error occurred”, gunakan scanner terbaru pada paket ini. Lihat docs/camera-troubleshooting.md untuk dua file yang berubah, cara build ulang, dan menyalin detail error native. Penyebab pada HP belum terkonfirmasi; patch memperbaiki lifecycle dan membuat diagnosis terlihat pada release build.
