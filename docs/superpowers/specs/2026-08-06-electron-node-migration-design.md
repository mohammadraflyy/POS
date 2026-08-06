# Migrasi POS ke Pure Electron (Node) — Design

Status: approved (arsitektur keseluruhan + Fase 1)
Tanggal: 2026-08-06
Referensi: `docs/APP-SPEC.md` (spec domain lengkap — skema DB, business flow, printing, scanning, hardware)

## Latar belakang

`docs/APP-SPEC.md` sudah membandingkan dua opsi migrasi dari NativePHP:

- **Opsi A** (ganti shell Electron saja, backend Laravel tetap) — direkomendasikan dokumen tsb, risiko rendah.
- **Opsi B** (full rewrite ke Node, hilangkan PHP sepenuhnya) — **dipilih user**. Motivasi: hilangkan runtime PHP dari distribusi installer.

Dokumen ini adalah spec untuk Opsi B.

## Strategi migrasi: bertahap (strangler)

App Node baru dibangun di folder terpisah, **`desktop-node/`**, di root repo yang sama. App Laravel yang sekarang (`app/`, `routes/`, `resources/`, `nativephp/`, dependency di `composer.json`) **tidak disentuh** dan tetap dipakai jualan selama migrasi berjalan. Tidak ada penghapusan kode PHP sampai Fase 5.

Urutan fase:

1. **Skeleton** — Electron+Vite+React+TS boilerplate, skema DB (Drizzle), login sederhana, window kosong yang bisa dibuka end-to-end. *(Detail lengkap di bawah — ini yang di-plan & diimplementasi duluan.)*
2. **Kasir** — modul paling kritis: checkout (transaksi/stok/tier harga/snapshot sale_items), cetak struk silent, scan barcode, history, bon payment. Divalidasi manual berdampingan dengan app lama sebelum lanjut fase berikutnya.
3. **Inventory, Purchase, Stock Opname**.
4. **Rekap, Settings, import Excel**.
5. **Cutover** — matikan app Laravel lama. Opsional: hapus `app/`, `nativephp/`, dependency Laravel dari repo (baru dilakukan setelah konfirmasi eksplisit user di titik itu).

Tiap fase adalah sub-proyek dengan spec+plan+implementasi sendiri. Dokumen ini hanya mendetailkan Fase 1; fase 2-5 di-spec ulang saat gilirannya tiba.

## Arsitektur (berlaku untuk semua fase)

- **Electron main process** — host semuanya. **Tidak ada HTTP server.** Business logic jalan langsung di main process, dipanggil lewat IPC.
- **DB**: SQLite via `better-sqlite3` + **Drizzle ORM**. File DB di `app.getPath('userData')` (setara `storage/database.sqlite` Laravel sekarang).
- **IPC**: `contextBridge` expose `window.api.<domain>.<action>()` dari `preload`, memanggil `ipcMain.handle('domain:action', ...)` di main process yang menjalankan query Drizzle langsung (sync).
- **Renderer**: React 19 + TypeScript (reuse komponen UI/shadcn yang ada sebisa mungkin saat porting tiap halaman). Routing: **React Router**, menggantikan Inertia. Tiap page fetch data lewat `window.api.*`, bukan props dari server.
- **Auth**: disederhanakan (bukan replikasi Fortify). 1 tabel `users` (username unique + password_hash). Tidak ada 2FA/passkey/self-register.
- **Print**: `BrowserWindow.webContents.print({ silent: true, deviceName })` via IPC — menggantikan `System::print()` NativePHP. (Diimplementasi di Fase 2, bukan Fase 1.)
- **Scanner**: tidak berubah — keyboard-wedge, `window.addEventListener('keydown', ...)` di renderer, persis pola sekarang (§7 APP-SPEC.md — 100% portable, tidak perlu native dependency).
- **Testing**: **Vitest**. Business logic (checkout, konversi satuan, price tier, laba kotor) ditulis sebagai fungsi murni terpisah dari IPC handler, supaya bisa dites tanpa boot Electron.

## Fase 1 — Skeleton (detail, siap di-plan)

### Struktur folder

```
desktop-node/
  src/
    main/
      db/
        schema.ts    # Drizzle schema: 14 tabel bisnis dari §2 APP-SPEC.md + `users`
        migrate.ts   # jalan saat app start, target app.getPath('userData')
      ipc/
        auth.ts      # login/logout/me handlers
      index.ts       # createWindow, register IPC handlers
    preload/
      index.ts       # contextBridge -> window.api.auth.*
    renderer/
      pages/
        Login.tsx
        Home.tsx      # placeholder "Halo, {nama_toko}" pasca-login — bukti stack nyambung end-to-end
      App.tsx          # React Router, redirect ke Login kalau belum auth
  drizzle/              # migration SQL hasil drizzle-kit
  vitest.config.ts
  package.json
```

### Tabel yang di-port (14, dari §2 APP-SPEC.md)

`products`, `categories`, `product_units`, `product_price_tiers`, `product_price_histories`, `suppliers`, `purchases`, `purchase_items`, `sales`, `sale_items`, `bon_payments`, `stock_adjustments`, `store_settings`, plus `users` baru (sederhana, bukan tabel Fortify). Struktur kolom & relasi ikuti persis §2 APP-SPEC.md. Data lama (dari `storage/database.sqlite` Laravel) **tidak** di-migrate di Fase 1 — itu keputusan terpisah nanti (mungkin butuh script import satu kali di Fase 5).

### Tooling

`electron-vite` sebagai scaffold (menggantikan hand-roll 3 config Vite terpisah untuk main/preload/renderer). Dev jalan dengan `npm run dev` di dalam `desktop-node/`, terpisah dari `npm run dev` di root repo (yang tetap berarti dev server Laravel+Inertia, tidak berubah).

### Auth

- Tabel `users`: `username` (unique), `password_hash`.
- Hash: **bcryptjs** (pure JS — `better-sqlite3` sudah butuh native rebuild via `electron-rebuild`, tidak perlu tambah native module lagi untuk login toko yang low-traffic).
- Session: variable in-memory di main process (`currentUser: User | null`), reset tiap restart app → selalu balik ke Login. Tidak ada token/cookie (cuma 1 renderer process long-lived).
- User awal dibuat lewat script `npm run db:seed`, bukan UI register.

### Kontrak IPC

Tiap handler `ipcMain.handle('domain:action', ...)` melempar `Error(message)` biasa kalau gagal. Preload teruskan lewat promise rejection apa adanya. Renderer tangkap di try/catch dan tampilkan pesan — pola setara dengan cara `kasir.tsx` sekarang menangkap `ValidationException` dari Inertia.

### Testing Fase 1

1 smoke test Vitest (`db/migrate.test.ts`): migrate ke DB in-memory, assert 14 tabel bisnis + `users` ada.

### Di luar scope Fase 1

Semua halaman bisnis (Kasir, Inventory, dst.), print, scan, packaging/`electron-builder` untuk distribusi installer. Masuk di fase-fase berikutnya.

## Risiko & catatan

- Logic bisnis paling kompleks (`SaleController::store` — transaksi/stok/tier harga, `RekapController` — 5 query agregat, import Excel) belum disentuh di Fase 1; itu risiko terbesar migrasi dan sengaja ditunda ke Fase 2-4 supaya di-port satu-satu dengan test, bukan sekaligus.
- Tidak ada downtime: app Laravel lama tetap jadi sumber kebenaran produksi sampai Fase 5 cutover eksplisit disetujui user.
