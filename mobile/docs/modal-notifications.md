# Notifikasi modal mobile

Update 2026-09-23:

- Error dari form, pairing, katalog, pembelian, supplier, pembayaran, riwayat,
  dan opname ditampilkan melalui modal, termasuk saat form berada dalam bottom sheet.
- Snackbar hasil salin dan pembayaran demo diganti modal.
- Gangguan sesi/koneksi, kamera, harga keranjang, stok kurang, serta status transaksi
  yang belum pasti dipantau tanpa membuka ulang modal pada setiap rebuild.
- Hasil pembelian, penjualan, dan cetak ulang memakai modal. Kegagalan cetak setelah
  checkout tetap menyatakan penjualan sudah tersimpan dan tidak mengulang checkout.
- Modal ditutup dengan tombol Mengerti. Pesan identik yang masih menunggu ditampilkan
  sekali; pesan berbeda diantrekan. Detail dan tombol pemulihan pada layar tetap ada.
- Petunjuk input, status loading, dan keadaan daftar kosong tetap menjadi bagian layar.

Implementasi bersama: `lib/Widgets/notifications.dart`, diekspor melalui `ui.dart`.
Panggil `showError` atau `showNotice` dari handler aksi. Gunakan `NoticeListener`
di luar lazy list untuk pesan dari state yang bertahan.

Verifikasi:

- 26 test bisnis/API/sesi lulus.
- 5 test notifikasi lulus: antrean/deduplikasi, pengakuan eksplisit, rebuild,
  validasi pairing di layar kecil, cetak gagal tanpa checkout ulang, dan context terlepas.
- 3 test layout kasir lulus. Test landscape diperbaiki agar menggulir sampai tombol
  benar-benar dapat diketuk, bukan mengasumsikan grid sudah berada di viewport.
- Build APK release berhasil: `build/app/outputs/flutter-apk/app-release.apk`.
- Analyzer tidak melaporkan error kode; masih ada satu warning konfigurasi
  flutter_lints yang belum menjadi dependensi dan lima info API dropdown deprecated.
- Belum diuji pada HP, kamera fisik, atau printer/PC toko nyata.
