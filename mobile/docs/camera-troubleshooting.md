# Kamera: “An unexpected error occurred”

Pesan tersebut adalah pesan generik scanner yang dapat muncul pada build release. Pesan itu sendiri tidak membuktikan bahwa izin ditolak ataupun bahwa HP tidak kompatibel. Penyebab khusus perangkat harus dilihat dari kode/message native yang sekarang ditampilkan.

## Update source

Perubahan hanya pada:
- lib/Screen/Pairing/ScanScreen.dart
- lib/Screen/Pairing/PairingScreen.dart

Scanner sekarang memakai controller eksplisit: start setelah preview terpasang; start/stop diserialkan; pause/resume mengikuti lifecycle; dialog izin tidak memicu start ganda; controller dilepas setelah operasi native selesai. Pairing hanya memindai QR dan tombol scan tidak bisa membuka dua layar sekaligus.

Error permissionDenied mendapat instruksi izin kamera. Error lain menampilkan kode plugin dan detail native, termasuk pada build release. Tersedia Coba lagi, pilihan kamera lain, Salin detail error, dan Kembali untuk input manual. Tidak ada QR pairing, token, atau password yang dicatat ke log.

Ini perbaikan lifecycle dan diagnosa, bukan klaim bahwa penyebab pada HP pengguna sudah ditemukan. Tidak mengubah atau memaksa versi plugin, resolusi kamera, Android SDK, atau izin sistem secara otomatis.

## Pasang update pada HP asli

1. Ganti dua file Dart di atas dari paket terbaru.
2. Pastikan CAMERA ada pada android/app/src/main/AndroidManifest.xml, sebagai anak manifest (bukan di dalam application). Permissions di debug/AndroidManifest.xml saja tidak cukup untuk build release.

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

3. Build ulang lalu instal APK terbaru di HP. Tidak perlu uninstall atau hapus data aplikasi.

```powershell
flutter build apk --release
```

APK standar: build/app/outputs/flutter-apk/app-release.apk. Pastikan yang dipasang benar-benar hasil build terbaru.

4. Buka pairing → Scan QR. Jika Android meminta izin, pilih izinkan saat digunakan.
5. Jika tetap gagal, tekan Salin detail error dan kirim isi detail beserta merek/model HP serta versi Android. Jangan mengirim QR pairing atau password.

Jika detail menyebut permissionDenied, periksa izin kamera aplikasi serta toggle akses kamera global pada HP. Jika menyebut kamera sedang digunakan, tutup aplikasi kamera/video call dan coba lagi. Jika menyebut MissingPluginException, hentikan aplikasi dan gunakan hasil build penuh, bukan hanya hot reload. Untuk error lain, gunakan detail native; jangan menebak perlu mengubah renderer/Gradle/versi plugin.

Jika proyek secara eksplisit memasang dev.steenbakker.mobile_scanner.useUnbundled=true, pemindai ML Kit memerlukan download pada pemakaian pertama. Default plugin adalah model bundled. Jangan menambahkan flag unbundled saat memperbaiki error tanpa bukti kebutuhan.

## Verifikasi

Pemeriksaan source/import/struktur dan isi ZIP dilakukan. Flutter SDK serta perangkat Android pengguna tidak tersedia, sehingga kamera fisik dan build APK belum diuji.

Kasus manual yang perlu dijalankan pada perangkat:
- Izin pertama kali diberikan: preview muncul dan QR mengisi form sekali.
- Izin ditolak: muncul pesan izin dan detail, tanpa dialog izin berulang otomatis.
- Kembali lalu buka scanner lagi: kamera dapat digunakan ulang.
- Aplikasi ke background lalu kembali: kamera berhenti dan dimulai berurutan.
- Ubah izin melalui Pengaturan: kembali lalu tekan Coba lagi.
- Ketuk tombol scan dengan cepat: hanya satu route scanner terbuka.

Referensi primer:
- https://pub.dev/packages/mobile_scanner/versions/7.0.0/changelog (pesan generik release dan errorBuilder dua argumen)
- https://pub.dev/packages/mobile_scanner/versions/7.0.0 (controller, lifecycle, bundled ML Kit)
