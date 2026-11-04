# Verifikasi update API fase 1–4

Pemeriksaan yang dilakukan:
- Semua import lokal mengarah ke file yang tersedia.
- Delimiter/string/interpolasi Dart diperiksa secara struktural; ini bukan analyzer/compiler Dart.
- Path HTTP mode live dicocokkan terhadap dokumen mobile-api(1).md.
- Referensi gate versi dan layar “transaksi belum tersedia” dihapus dari mode live.
- Source/test/dokumentasi dikemas dan CRC ZIP diperiksa.

Belum dijalankan (Flutter/Dart SDK tidak tersedia):
- flutter analyze dan flutter test
- build APK dan visual rendering layar
- pairing dan transaksi terhadap PC nyata
- kamera serta secure storage pada perangkat

Test tambahan disertakan untuk array JSON tanpa appVersion, bearer, payload rupiah, stokCukup:false, validasi preview tidak lengkap, pesan 400, 401 bisnis, stale price response, printed:false setelah commit, serta marker transaksi tidak pasti yang mencegah retry otomatis. Test sebelumnya untuk demo/pairing tetap disertakan. Keberadaan test tidak berarti test telah lulus.

Batas schema CatalogItem/detail nota dicatat di coverage.md. Diperlukan fixture respons server yang nyata untuk menyatakan pemetaan end-to-end terverifikasi.

Update kamera: start/stop berurutan dan setelah preview terpasang, lifecycle/dispose, single scan route, errorBuilder dengan detail native. Kode diperiksa secara struktural; build Flutter dan kamera fisik belum dijalankan.
