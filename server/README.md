# pos_server

Backend POS toko dalam Dart: database SQLite + HTTP API untuk aplikasi Flutter (`../mobile`).
Fitur setara `../desktop-node`, dan kontrak API mobile (`/v1/pair`, `/v1/catalog/search`, `/v1/carts/price`, `/v1/sales`, ...) sama persis.

```powershell
dart run bin/server.dart --db pos.sqlite --port 48950   # jalankan server
dart run bin/import_legacy.dart --from <pos.sqlite desktop> --db pos.sqlite   # salin data dari POS desktop
dart run bin/seed_demo.dart --db demo.sqlite   # database baru berisi data dummy untuk test
dart test                                                # semua test
```

Database baru otomatis punya akun `admin` / `admin`.

## Akses dari luar toko (Tailscale)

HP bisa tetap memakai server dari luar toko lewat jaringan Tailscale milik toko. Jaringan ini tertanam di aplikasi, jadi HP dan PC tidak perlu memasang aplikasi Tailscale.

- `tailnet/` berisi `posnet` (Go, memakai `tailscale.com/tsnet`). Di PC, program ini menerima koneksi Tailscale dan meneruskannya ke `127.0.0.1:48950`. Di HP, program ini membuka port lokal dan meneruskannya ke PC.
- `powershell -File tailnet/build.ps1` membangun `tailnet/dist/posnet.exe` dan `mobile/android/app/src/main/jniLibs/<abi>/libposnet.so`. `mobile/windows/installer/build.ps1` menjalankannya sendiri. Butuh Go (`winget install GoLang.Go`).
- Pemilik toko menempel OAuth client Tailscale ("kunci admin", scope Auth Keys: Write, tag `tag:pos`) di Pengaturan, lalu `PUT /v1/remote-access` dipanggil. Server membuat kunci sekali pakai untuk PC, lalu untuk tiap HP lewat `POST /v1/remote-access/grant`. HP meminta kunci ini sendiri saat berada di Wi-Fi toko, setelah melihat `remote` di `GET /v1/server/status`.
- Login dan pairing dibatasi: 5 password salah mengunci akun itu selama 5 menit (HTTP 429), dan 5 kode pairing salah membatalkan kode yang sedang berlaku.
- Server CLI: `dart run bin/server.dart --posnet tailnet/dist/posnet.exe`.
