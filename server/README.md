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
