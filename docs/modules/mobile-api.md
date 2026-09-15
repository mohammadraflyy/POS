# Modul API Mobile (Fase 1: Fondasi)

Lapisan HTTP di dalam proses main Electron yang sama, dipakai oleh **aplikasi mobile terpisah (Flutter, dibuat sendiri oleh developer lain, di luar repo ini)** untuk terhubung ke satu PC toko lewat jaringan lokal. Desain lengkap & alasan tiap keputusan ada di `docs/superpowers/specs/2026-09-09-mobile-app-design.md` — dokumen ini adalah ringkasan kontrak API yang **sudah diimplementasikan** (Fase 1 saja).

**Kode:** `src/main/http/router.ts` (routing murni, testable tanpa socket) · `src/main/http/server.ts` (wrapper `node:http`) · `src/main/device-tokens.ts` (token) · `src/main/pairing.ts` (kode pairing) · `src/main/device.ts` + `src/main/ipc/device.ts` (sisi PC/Settings) · `src/renderer/pages/Settings.tsx` (UI "Perangkat Mobile").

**Tabel:** `device_tokens`.

## Status: Fase 1 saja

Yang **sudah ada**: server HTTP, pairing, token, dan endpoint identitas (`/v1/health`, `/v1/pair`, `/v1/me`).
Yang **belum ada** (Fase 2-4, di luar dokumen ini): endpoint bisnis lewat HTTP — jual (`carts`), beli (`purchases`), opname (`opname`), riwayat (`sales`), pendaftaran supplier. AI/developer yang melanjutkan ke fase berikutnya harus membaca spec di `docs/superpowers/specs/2026-09-09-mobile-app-design.md` §"Kontrak API" untuk pengelompokan endpoint yang direncanakan, lalu ikuti pola yang sudah ada di sini (router murni + wrapper tipis, auth lewat `resolveDeviceToken`, `appVersion` di tiap respons) — jangan bikin pola baru.

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
5. **Token device berlaku sampai dicabut** — tidak ada expiry otomatis. Dicabut lewat Settings PC (`device:revokeDevice`, admin only) → `revokedAt` diisi → `GET /v1/me` dengan token itu langsung 401 setelahnya.
6. Setiap request terautentikasi mengirim `Authorization: Bearer <token>`. Server men-hash lalu exact-match ke `device_tokens.token_hash`, cek `revokedAt IS NULL`, lalu men-touch `lastUsedAt` (dipakai UI "Terakhir Aktif" di daftar perangkat).

## Endpoint HTTP

Base URL: `http://<lan-ip>:48950`. Semua respons JSON, semua ikut sertakan `appVersion` (dari `package.json`) — aplikasi mobile **wajib** membandingkannya dan menampilkan pesan jelas kalau versi tidak cocok, bukan error mentah (lihat spec §"Kontrak API").

| Method & Path | Auth | Body | Respons sukses | Kegagalan |
|---|---|---|---|---|
| `GET /v1/health` | tidak ada | – | `200 { ok: true, appVersion }` | – |
| `POST /v1/pair` | tidak ada (kode pairing-nya sendiri yang jadi "kunci") | `{ pairingCode, username, password, deviceName? }` | `200 { token, user: {id, username, name, role}, appVersion }` | `400` field wajib kosong · `401` kode pairing salah/kedaluwarsa/sudah dipakai, atau username/password salah (pesan sama untuk semua — tidak membocorkan mana yang salah) |
| `GET /v1/me` | `Authorization: Bearer <token>` | – | `200 { user, appVersion }` | `401` header tidak ada, token sampah, atau token sudah dicabut |
| lainnya | – | – | – | `404 { error: 'Not found' }` |
| error tak terduga (bug, bukan penolakan auth) | – | – | – | `500 { error: message }` |

Contoh alur pairing dari sisi klien (pseudocode, bukan kode Flutter sungguhan):

```
POST http://192.168.1.5:48950/v1/pair
{ "pairingCode": "482913", "username": "kasir1", "password": "rahasia123", "deviceName": "HP Kasir 2" }

→ 200 { "token": "a3f1...(64 hex char)", "user": { "id": 2, "username": "kasir1", "name": "Kasir Satu", "role": "kasir" }, "appVersion": "0.0.2" }
```

Simpan `token` secara aman di HP (mis. `flutter_secure_storage`), pakai untuk setiap request berikutnya:

```
GET http://192.168.1.5:48950/v1/me
Authorization: Bearer a3f1...

→ 200 { "user": {...}, "appVersion": "0.0.2" }
→ 401 kalau device sudah dicabut dari Settings PC — aplikasi mobile harus kembali ke layar pairing, bukan retry diam-diam.
```

## IPC sisi PC (Settings)

Tidak dipanggil dari HP — ini kanal IPC biasa untuk halaman Pengaturan di PC, lewat `window.api.device.*`:

| Channel | Akses | Kegunaan |
|---|---|---|
| `device:generatePairingCode` | **admin** | Bikin kode pairing baru + `serverAddress` gabungan `ip:port` untuk payload QR |
| `device:getServerStatus` | tanpa guard | `{ running, address, port }` — dipoll UI tiap 5 detik untuk indikator status |
| `device:listPairedDevices` | **admin** | Daftar semua device (aktif & yang sudah dicabut) berikut nama pengguna pemiliknya |
| `device:revokeDevice` | **admin** | Cabut satu device by id — idempoten kalau dipanggil dua kali |

## Model Data

`device_tokens(id, user_id → users.id ON DELETE CASCADE, nama_perangkat, token_hash UNIQUE, last_used_at, revoked_at, created_at, updated_at)`. `user_id` sengaja `cascade` (bukan `set null` seperti FK atribusi historis lain di app ini) — token tidak berarti apa-apa tanpa pemilik user-nya, jadi kalau user dihapus, device token-nya ikut hilang.

## Pola yang Harus Diikuti Kalau Menambah Endpoint (Fase 2+)

1. **Router murni dulu** — tambahkan case baru di `handleHttpRequest` (`http/router.ts`) yang menerima `HttpRequest` (objek biasa) dan mengembalikan `HttpResponse` (objek biasa), supaya bisa langsung dites lewat `router.test.ts` tanpa buka socket sungguhan. **Jangan** taruh logika di `http/server.ts` — file itu murni I/O plumbing (parse request Node, tulis response Node).
2. **Auth**: panggil `resolveDeviceToken(db, token)` lalu `assertLoggedIn`/`assertAdmin` dari `src/main/auth.ts` — fungsi itu **sudah** menerima user sebagai argumen biasa, tidak perlu diubah, dan sama persis yang dipakai IPC. Jangan bikin jalur otorisasi baru.
3. **Domain logic tetap satu salinan**: panggil fungsi yang sama dengan yang dipakai `ipc/*.ts` (mis. `checkout` dari `kasir.ts`, `recordPurchase` dari `purchase.ts`) — jangan menyalin ulang logika bisnis ke dalam handler HTTP. `src/main/money.ts` (`toRupiah`/`toCents`) sudah ditarik keluar dari `ipc/kasir.ts` persis untuk ini; pakai dari sana, jangan bikin salinan ketiga.
4. **Uang & satuan**: kontrak HTTP pakai **rupiah** (bukan sen) ke klien, sama seperti kontrak IPC — konversi di titik masuk/keluar handler, bukan di domain logic.
5. **Setiap respons ikut sertakan `appVersion`** — sudah jadi konvensi sejak `/v1/health`.
6. Test baru mengikuti pola `router.test.ts`: `createDb(':memory:', migrationsFolder)`, panggil `handleHttpRequest` langsung dengan objek request buatan tangan, tanpa `node:http` sungguhan.

## Verifikasi Manual

```
npm run dev
# di Settings PC: bikin kode pairing, catat kode + alamat yang ditampilkan

curl http://<lan-ip>:48950/v1/health
curl -X POST http://<lan-ip>:48950/v1/pair -H "Content-Type: application/json" \
  -d '{"pairingCode":"<kode>","username":"<user>","password":"<pass>","deviceName":"Test"}'
curl http://<lan-ip>:48950/v1/me -H "Authorization: Bearer <token dari respons pair>"
```

## Catatan

- Test otomatis (`src/main/device-tokens.test.ts`, `src/main/pairing.test.ts`, `src/main/http/router.test.ts`) memakai `createDb(':memory:', migrationsFolder)` seperti modul lain — di mesin ini sempat gagal jalan karena mismatch native binding `better-sqlite3` vs versi Node yang menjalankan Vitest (`npm run rebuild:node` untuk memperbaiki); ini masalah environment lokal, bukan bug di kode.
- Kode aplikasi Flutter **tidak** ada di repo ini dan **tidak** dibuat dari sini — dokumen ini murni kontrak API sisi PC yang harus dipenuhi klien mobile mana pun.
