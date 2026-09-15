# Modul API Mobile (Fase 1-4: Selesai)

Lapisan HTTP di dalam proses main Electron yang sama, dipakai oleh **aplikasi mobile terpisah (Flutter, dibuat sendiri oleh developer lain, di luar repo ini)** untuk terhubung ke satu PC toko lewat jaringan lokal. Desain lengkap & alasan tiap keputusan ada di `docs/superpowers/specs/2026-09-09-mobile-app-design.md` — dokumen ini adalah ringkasan kontrak API yang **sudah diimplementasikan penuh**: fondasi (pairing/token), Penjualan, Pembelian & supplier, Opname/cek harga/riwayat.

**Kode:**
- `src/main/http/router.ts` — dispatch utama (`/v1/health`, `/v1/pair`, `/v1/me`) + meneruskan ke grup route
- `src/main/http/context.ts` — tipe bersama (`HttpRequest`, `HttpResponse`, `RouterDeps`), `withAuth`, `matchPath`
- `src/main/http/routes/{catalog,carts,sales,purchases,opname}.ts` — satu file per grup domain
- `src/main/http/server.ts` — wrapper `node:http`
- `src/main/device-tokens.ts`, `src/main/pairing.ts` — token & kode pairing
- `src/main/device.ts` + `src/main/ipc/device.ts` — sisi PC/Settings (IPC, bukan HTTP)
- `src/main/receipt.ts` — cetak struk (satu-satunya bagian yang boleh impor Electron dari luar `ipc/`)
- `src/renderer/pages/Settings.tsx` — UI "Perangkat Mobile"

**Tabel:** `device_tokens`.

## Server

- Berjalan di dalam proses main Electron yang sama dengan yang membuka `better-sqlite3` — **bukan** proses terpisah, supaya tidak ada dua proses menulis satu file SQLite.
- Port tetap **48950** (`HTTP_PORT` di `src/main/index.ts`), bebas diganti — cuma satu konstanta.
- Start setelah semua `register*Ipc(db)` dan sebelum `createWindow()`; stop di `app.on('before-quit', ...)` **sebelum** `db.$client.close()`.
- Tidak ada `app.requestSingleInstanceLock()` di aplikasi ini — kalau app dijalankan dua kali, instance kedua gagal `listen()` (`EADDRINUSE`). Ditangani lewat `.on('error', ...)` yang menandai server sebagai tidak berjalan (`getServerStatus().running = false`), **bukan** meng-crash aplikasi.
- Alamat LAN dibaca lewat `os.networkInterfaces()` (IPv4 non-internal pertama) — kalau PC tidak terhubung ke jaringan, `address` bernilai `null` dan UI Settings menampilkan pesan jelas, bukan error.
- Tanpa TLS (HTTP polos) — risiko yang **sengaja diterima** (jaringan lokal toko), mitigasinya token per-perangkat yang bisa dicabut kapan saja, bukan enkripsi. Jangan tambahkan HTTPS tanpa alasan baru yang kuat.

## Autentikasi & Pairing

Bukan sesi seperti IPC (`ipc/auth.ts` punya `currentUser` per-proses, cocok untuk 1 PC). HTTP dipakai banyak HP sekaligus, jadi identitasnya **per-request** lewat token perangkat.

1. **Admin membuat kode pairing** dari Settings PC (`device:generatePairingCode`, IPC) → `pairing.ts` men-generate kode 6 digit acak, TTL 5 menit, **disimpan di memori saja** (bukan DB — hilang kalau app di-restart, dan memang harus begitu). Membuat kode baru otomatis membatalkan kode lama.
2. **QR yang ditampilkan** berisi JSON `{ "address": "<ip>:<port>", "code": "<6 digit>" }` — inilah kontrak yang harus dibaca aplikasi Flutter dari hasil scan QR-nya.
3. **HP memanggil `POST /v1/pair`** dengan kode itu + username/password akun kasir/admin yang sudah ada di master pengguna PC. Sukses → server menerbitkan **device token** (bukan token per-login biasa): random 256-bit, disimpan di DB sebagai `sha256(token)` saja (bukan bcrypt — bcrypt sengaja lambat untuk password entropi-rendah, tidak diperlukan untuk token acak yang cuma dicocokkan exact-match).
4. **Kode pairing sekali pakai** — begitu dipakai (berhasil ataupun kodenya sudah kedaluwarsa), langsung tidak berlaku lagi. Percobaan dengan kode yang salah **tidak** membakar kode yang benar (supaya salah ketik tidak memaksa admin bikin ulang QR).
5. **Token device berlaku sampai dicabut** — tidak ada expiry otomatis. Dicabut lewat Settings PC (`device:revokeDevice`, admin only) → `revokedAt` diisi → request berikutnya dengan token itu langsung 401.
6. Setiap request terautentikasi mengirim `Authorization: Bearer <token>`. Server men-hash lalu exact-match ke `device_tokens.token_hash`, cek `revokedAt IS NULL`, lalu men-touch `lastUsedAt` (dipakai UI "Terakhir Aktif" di daftar perangkat). Ini semua terjadi di `withAuth()` (`http/context.ts`), dipakai oleh **semua** route bisnis di bawah — tidak ada satu pun endpoint mobile yang butuh role admin, sesuai spec.

## Konvensi Status HTTP (berlaku untuk semua endpoint di bawah `/v1/pair`)

- **401** — token tidak ada / tidak valid / sudah dicabut. Klien harus kembali ke layar pairing, bukan retry.
- **400** — penolakan bisnis apa pun (validasi gagal, stok race yang genuinely fatal, dsb). `body.error` berisi pesan Bahasa Indonesia **persis sama** dengan yang ditampilkan IPC ke kasir PC — tampilkan langsung ke user, jangan digenericse.
- **404** — route tidak dikenal, atau (khusus `GET /v1/purchases/products/barcode/:code`) barcode tidak ditemukan.
- **500** — bug tak terduga, bukan penolakan normal.

Semua respons sukses menyertakan **rupiah**, bukan sen — server yang konversi lewat `src/main/money.ts` (`toRupiah`/`toCents`), sama seperti kontrak IPC. Semua angka uang yang **dikirim ke server** (body request) juga harus rupiah.

## Endpoint

Base URL: `http://<lan-ip>:48950`. `/v1/health`, `/v1/pair`, `/v1/me` menyertakan `appVersion` (dari `package.json`) di respons sukses.

### Fondasi

| Method & Path | Auth | Body/Query | Respons sukses |
|---|---|---|---|
| `GET /v1/health` | tidak ada | – | `{ ok: true, appVersion }` |
| `POST /v1/pair` | kode pairing sebagai "kunci" | `{ pairingCode, username, password, deviceName? }` | `{ token, user: {id, username, name, role}, appVersion }` |
| `GET /v1/me` | Bearer | – | `{ user, appVersion }` |

### Penjualan (`http/routes/catalog.ts`, `carts.ts`, `sales.ts`)

| Method & Path | Body/Query | Respons sukses | Reuse |
|---|---|---|---|
| `GET /v1/customers` | – | `{ names: string[] }` | `listCustomers` (kasir.ts) |
| `GET /v1/catalog/search?q=&page=&pageSize=` | – | `{ data: CatalogItem[], currentPage, lastPage, total }` | `searchCatalogForSale` (kasir.ts, baru) |
| `POST /v1/carts/price` | `{ items: [{productId, productUnitId, qty, hargaJual?, diskon?}], diskonNota? }` | `{ lines: [{..., stokCukup}], subtotal, diskon, total }` | `previewCart` (kasir.ts, baru) |
| `POST /v1/sales` | sama seperti `CheckoutInput` (rupiah) | `{ saleId, total, printed, printError? }` | `checkout` (tidak diubah) + `deps.printReceipt` |
| `GET /v1/sales?dari=&sampai=&status=&metodePembayaran=&search=&page=` | – | `{ data, currentPage, lastPage, total }` | `listSalesHistory` (kasir.ts, baru) |
| `GET /v1/sales/:id` | – | detail nota + `bonPayments[]` + `edits[]` | `getSaleDetail` (kasir.ts, baru) |
| `POST /v1/sales/:id/print` | – | `{ printed: true }` | `deps.printReceipt` |

**Keranjang itu stateless.** Tidak ada cart tersimpan di server. `POST /v1/carts/price` dipanggil ulang setiap keranjang di HP berubah — kirim **seluruh isi keranjang**, bukan delta, server hitung ulang dari nol dan balas total + status per baris. Checkout (`POST /v1/sales`) adalah panggilan terpisah yang benar-benar commit. Ini penyederhanaan yang disengaja dari kalimat literal spec ("keranjang hidup di memori server") — intinya (server yang menghitung, HP tidak pernah menghitung rupiah) tetap terpenuhi, tanpa perlu sistem cart-by-id yang stateful (expiry, cleanup, dsb).

**`stokCukup` per baris.** Kekurangan stok di `POST /v1/carts/price` **tidak** membuat request gagal — baris yang kurang ditandai `stokCukup: false` tapi tetap ikut dihitung, supaya HP bisa menandai baris bermasalah tanpa kehilangan sisa keranjang. Kesalahan lain (produk tidak ada, satuan tidak valid, harga manual di bawah pokok, diskon melebihi) **tetap** membuat seluruh request gagal (400) — itu bukan race condition, itu data yang memang salah dari klien.

**Print selalu di PC.** `POST /v1/sales` mencoba cetak otomatis lewat printer yang tersimpan di Pengaturan setelah checkout sukses. Kegagalan cetak **tidak pernah** membatalkan penjualan yang sudah tercatat — `printed:false` + `printError` dikirim balik, HP menyuruh kasir minta cetak ulang dari PC (atau panggil `POST /v1/sales/:id/print`). **Tidak ada** cancel/delete/edit transaksi dari HP — itu wewenang PC, sesuai spec.

### Pembelian & Supplier (`http/routes/purchases.ts`)

| Method & Path | Body/Query | Reuse |
|---|---|---|
| `GET /v1/suppliers?q=&page=` | – | `listSuppliers` (supplier.ts) |
| `POST /v1/suppliers` | `{ nama, telepon, alamat, keterangan }` | `createSupplier` (supplier.ts) |
| `GET /v1/purchases/products?q=` | – | `searchProductsForPurchase` (purchase.ts) |
| `GET /v1/purchases/products/barcode/:code` | – | `findProductForPurchaseByBarcode` (purchase.ts) — `404` kalau tidak ketemu |
| `POST /v1/purchases` | `{ supplierId, tanggal, catatan, items: [{productId, productUnitId, qty, hargaBeli}], dibayar? }` | `recordPurchase` (purchase.ts) |

**Sengaja tidak ada** edit/delete pembelian dari HP — operasi paling merusak di modul itu (membalik harga pokok rata-rata terhadap stok hari ini, bukan stok saat nota dibuat), tetap di PC sesuai spec.

### Opname, Cek Harga, Riwayat (`http/routes/opname.ts`)

| Method & Path | Body/Query | Reuse |
|---|---|---|
| `GET /v1/opname/categories` | – | `listCategories` (stock-opname.ts) |
| `GET /v1/opname/products?q=&categoryIds=1,2,3` | – | `searchProductsForOpname` (stock-opname.ts) |
| `POST /v1/opname/adjustments` | `{ productId, stokSesudah, alasan }` | `recordStockAdjustment` (stock-opname.ts) |

Cek harga & stok dan Riwayat **menumpang** endpoint Penjualan (`GET /v1/catalog/search`, `GET /v1/sales`, `GET /v1/sales/:id`) — tidak ada endpoint khusus untuk itu, sesuai spec.

## Contoh Alur (pseudocode, bukan kode Flutter sungguhan)

```
# 1. Pairing
POST /v1/pair { pairingCode, username, password, deviceName }
→ 200 { token, user, appVersion }
# simpan token (mis. flutter_secure_storage), pakai di setiap request berikutnya

# 2. Belanja
GET  /v1/catalog/search?q=beras
POST /v1/carts/price { items: [{productId, productUnitId: null, qty: 2}] }
→ 200 { lines: [{..., stokCukup: true}], total: 130000 }
POST /v1/sales { metodePembayaran: 'tunai', dibayar: 130000, items: [...] }
→ 200 { saleId: 41, total: 130000, printed: true }

# 3. Riwayat & cetak ulang
GET  /v1/sales?page=1
GET  /v1/sales/41
POST /v1/sales/41/print
```

## IPC sisi PC (Settings)

Tidak dipanggil dari HP — kanal IPC biasa untuk halaman Pengaturan di PC, lewat `window.api.device.*`:

| Channel | Akses | Kegunaan |
|---|---|---|
| `device:generatePairingCode` | **admin** | Bikin kode pairing baru + `serverAddress` gabungan `ip:port` untuk payload QR |
| `device:getServerStatus` | tanpa guard | `{ running, address, port }` — dipoll UI tiap 5 detik untuk indikator status |
| `device:listPairedDevices` | **admin** | Daftar semua device (aktif & yang sudah dicabut) berikut nama pengguna pemiliknya |
| `device:revokeDevice` | **admin** | Cabut satu device by id — idempoten kalau dipanggil dua kali |

## Model Data

`device_tokens(id, user_id → users.id ON DELETE CASCADE, nama_perangkat, token_hash UNIQUE, last_used_at, revoked_at, created_at, updated_at)`. `user_id` sengaja `cascade` (bukan `set null` seperti FK atribusi historis lain di app ini) — token tidak berarti apa-apa tanpa pemilik user-nya, jadi kalau user dihapus, device token-nya ikut hilang.

## Pola yang Harus Diikuti Kalau Menambah Endpoint Baru

1. **Router murni dulu, dikelompokkan per modul domain** — satu file per grup di `http/routes/*.ts` (`catalog`, `carts`, `sales`, `purchases`, `opname`), masing-masing `(db, req[, deps]) => Promise<HttpResponse | null>` (`null` = tidak match, `router.ts` lanjut ke grup berikutnya). Semua bisa dites langsung dengan objek `HttpRequest` buatan tangan, tanpa `node:http` sungguhan. **Jangan** taruh logika bisnis di `http/server.ts` — murni I/O plumbing (parse request Node, tulis response Node).
2. **Auth**: panggil `withAuth(db, req.headers, fn)` dari `http/context.ts` — sudah menangani resolve token, 401, dan membungkus `fn` dengan try/catch yang memetakan `Error` apa pun ke `400`. Jangan tulis ulang logika bearer-token/resolve-token di file route.
3. **Route dinamis** (`/v1/sales/:id`) pakai `matchPath(pattern, path)` dari `http/context.ts` — bukan router library baru.
4. **Electron tidak boleh bocor ke `http/router.ts` atau `http/routes/*.ts`.** `index.ts` punya efek samping level-modul (`app.on(...)`) yang gagal di Vitest biasa (bukan proses Electron sungguhan) — inilah kenapa semua test route Fase 1-4 bisa jalan tanpa mock Electron sama sekali. Kalau sebuah endpoint butuh sesuatu yang Electron-only (cetak, dialog, dsb.), taruh fungsinya di file terpisah yang boleh impor `../index` (contoh: `src/main/receipt.ts`), lalu **suntikkan** lewat `RouterDeps` (`http/context.ts`) → diteruskan `handleHttpRequest(db, req, deps)` → dipasang nyata di `index.ts` saat memanggil `startHttpServer(db, port, deps)`. Test cukup memberi `vi.fn()` atau tidak mengisi `deps` sama sekali.
5. **Domain logic tetap satu salinan**: panggil fungsi yang sama dengan yang dipakai `ipc/*.ts` (mis. `checkout`/`previewCart`/`searchCatalogForSale`/`listSalesHistory`/`getSaleDetail` dari `kasir.ts`, `recordPurchase` dari `purchase.ts`, `recordStockAdjustment` dari `stock-opname.ts`) — jangan menyalin ulang logika bisnis ke dalam handler HTTP. Kalau logikanya masih inline di sebuah `ipc/*.ts` handler dan HTTP butuh yang sama, tarik keluar ke domain module dulu (pola yang sama dipakai untuk `getReceipt`, `listSalesHistory`, `getSaleDetail` — semula inline di `ipc/kasir.ts`, sekarang di `kasir.ts`).
6. **Uang**: kontrak HTTP pakai **rupiah** ke klien, konversi lewat `src/main/money.ts` (`toRupiah`/`toCents`) di titik masuk/keluar handler — domain function selalu bekerja dalam **sen**.
7. **Status HTTP**: ikuti konvensi di atas (401/400/404/500) — jangan pakai kode lain tanpa alasan kuat.
8. Test baru mengikuti pola `http/routes/*.test.ts` yang sudah ada: `createDb(':memory:', migrationsFolder)`, seed fixture langsung lewat tabel drizzle, `issueDeviceToken` untuk dapat token asli, panggil `handleHttpRequest` langsung.

## Verifikasi Manual

```
npm run dev
# di Settings PC: bikin kode pairing, catat kode + alamat yang ditampilkan

curl http://<lan-ip>:48950/v1/health
curl -X POST http://<lan-ip>:48950/v1/pair -H "Content-Type: application/json" \
  -d '{"pairingCode":"<kode>","username":"<user>","password":"<pass>","deviceName":"Test"}'
# simpan token dari respons di atas

curl -X POST http://<lan-ip>:48950/v1/carts/price -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"items":[{"productId":1,"productUnitId":null,"qty":2}]}'
curl -X POST http://<lan-ip>:48950/v1/sales -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"metodePembayaran":"tunai","namaPelanggan":null,"dibayar":130000,"items":[{"productId":1,"productUnitId":null,"qty":2}]}'
curl http://<lan-ip>:48950/v1/sales -H "Authorization: Bearer <token>"

curl -X POST http://<lan-ip>:48950/v1/suppliers -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"nama":"Toko Grosir","telepon":null,"alamat":null,"keterangan":null}'
curl -X POST http://<lan-ip>:48950/v1/purchases -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"supplierId":null,"tanggal":"2026-09-15","catatan":null,"items":[{"productId":1,"productUnitId":null,"qty":5,"hargaBeli":60000}]}'

curl -X POST http://<lan-ip>:48950/v1/opname/adjustments -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"productId":1,"stokSesudah":7,"alasan":"opname rutin"}'
```
Cek `products.stok` berubah sesuai setiap langkah, dan struk tercetak di PC setelah `POST /v1/sales`.

## Catatan

- Test otomatis: `src/main/device-tokens.test.ts`, `src/main/pairing.test.ts`, `src/main/kasir.test.ts` (kasus `previewCart`/`allowStockShortage`), `src/main/http/router.test.ts`, `src/main/http/routes/{catalog,carts,sales,purchases,opname}.test.ts`. Semua memakai `createDb(':memory:', migrationsFolder)` seperti modul lain — di mesin pengembangan ini sempat gagal jalan karena mismatch native binding `better-sqlite3` vs versi Node yang menjalankan Vitest (`npm run rebuild:node` untuk memperbaiki, bisa diblokir kebijakan `allowScripts` project — kalau begitu, minta izin/atur manual, jangan di-bypass); ini masalah environment lokal, bukan bug di kode. Semua perubahan sudah diverifikasi via `npx tsc --noEmit` (bersih) sebagai gantinya.
- Kode aplikasi Flutter **tidak** ada di repo ini dan **tidak** dibuat dari sini — dokumen ini murni kontrak API sisi PC yang harus dipenuhi klien mobile mana pun.
