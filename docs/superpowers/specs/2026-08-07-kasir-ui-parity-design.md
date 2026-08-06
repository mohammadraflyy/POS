# Fase 2 Slice 2 — Kasir UI Full Parity + Cetak Struk — Design

Status: approved
Tanggal: 2026-08-07
Referensi: `docs/superpowers/specs/2026-08-06-electron-node-migration-design.md` (Fase 2 roadmap), `docs/superpowers/plans/2026-08-06-kasir-checkout-inti.md` (Slice 1 — checkout inti, sudah selesai), `resources/js/pages/kasir.tsx`, `resources/js/pages/kasir/shared.tsx`, `resources/js/lib/utils.ts`, `resources/js/hooks/use-appearance.tsx`, `components.json`, `resources/views/receipts/struk.blade.php`

## Latar belakang

Slice 1 (`docs/superpowers/plans/2026-08-06-kasir-checkout-inti.md`) mem-port logic checkout inti dengan UI minimal (HTML polos, tanpa styling). User secara eksplisit minta UI-nya disamakan dengan versi web (`resources/js/pages/kasir.tsx`, 1298 baris) — **full parity**, bukan sekadar gaya visual: Tailwind v4 + shadcn/ui, `react-data-grid` dengan qty inline-edit & pill satuan, dialog pembayaran keyboard-driven, command palette pencarian produk, dark mode, shortcut scan barcode, dan cetak struk silent.

Karena skalanya besar (setara ~2 fase), dieksekusi sebagai **3 plan implementasi berurutan** di bawah satu spec ini — tidak ditunda, dikerjakan berturut-turut, masing-masing lewat siklus plan→implementasi→review sendiri:

1. **Plan A — Styling foundation**: Tailwind v4 + 7 komponen shadcn/ui + util (`cn`, `formatRupiah`, `useAppearance`).
2. **Plan B — Cart & Payment UI**: `react-data-grid` cart, dialog pembayaran, command palette, styling halaman Kasir penuh, wired ke IPC yang sudah ada dari Slice 1.
3. **Plan C — Scan shortcuts + Cetak struk**: perkaya listener scan, `kasir:printReceipt`, `kasir:getStoreSettings`, komponen Receipt.

## Sumber kebenaran (dibaca penuh)

- `resources/js/pages/kasir.tsx` — komponen utama: `CartLine`, `unitPrice`, `pickUnitForBaseQty`/`resolveLineQty` (resolusi satuan terbersih untuk qty pecahan), listener scan barcode global (buffer keystroke cepat + Enter, shortcut `/` untuk command palette, `Alt+K` clear cart, Enter tunggal = shortcut Bayar), kolom `react-data-grid` (Produk/Satuan/Harga/Qty/Subtotal/Aksi), `PaymentDialog` (keyboard-driven: PageUp/PageDown siklus aksi cetak/simpan/batal, `Alt+T`/`Alt+B`/`Alt+S`, Enter jalankan aksi terpilih), command palette (`CommandDialog` shadcn, cari produk by nama/kode).
- `resources/js/pages/kasir/shared.tsx` — `Receipt` component: struk 58mm, hanya tampil saat print (`.receipt-print` + CSS `@media print`), pakai `storeSettings` dari Inertia shared props.
- `resources/js/lib/utils.ts` — `cn()` (clsx+tailwind-merge), `formatRupiah()` (`Intl.NumberFormat('id-ID', {style:'currency', currency:'IDR'})`).
- `resources/js/hooks/use-appearance.tsx` — dark mode: `useSyncExternalStore`, localStorage + cookie (cookie untuk SSR Inertia — **tidak relevan di Electron**, di-drop).
- `components.json` — shadcn `style: "new-york"`, `baseColor: "neutral"`, `cssVariables: true`, alias `@/components/ui`, `iconLibrary: "lucide"`.
- `resources/views/receipts/struk.blade.php` — struk yang dicetak `System::print()` NativePHP: 58mm, `@page {size: 58mm auto; margin: 0}`, header toko, item, total, tunai/kembalian atau bon, footer.

## Plan A — Styling Foundation

### Dependency baru (`desktop-node/package.json`)
`tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`, `clsx`, `class-variance-authority`, `lucide-react`, `@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-slot`, `cmdk`.

### Setup
- `electron.vite.config.ts`: tambah `@tailwindcss/vite` plugin ke config `renderer`.
- CSS entry renderer baru (mis. `desktop-node/src/renderer/src/app.css`, di-import dari `main.tsx`): `@import 'tailwindcss'`, `@theme` dengan CSS variables warna (light+dark) — **port persis** dari `resources/css/app.css` (nilai HSL/OKLCH yang sama, supaya visual identik), termasuk `@custom-variant dark (&:is(.dark *))`.
- `desktop-node/src/renderer/lib/utils.ts`: `cn()` (identik) dan `formatRupiah()` — **beda dari web**: parameter tetap `number` tapi tidak perlu `Number(string)` di dalamnya karena desktop-node's IPC sudah mengembalikan `number` Rupiah asli (bukan string desimal Laravel).
- `desktop-node/src/renderer/hooks/use-appearance.ts`: port `useAppearance`/`initializeTheme`, **hapus** bagian `setCookie`/cookie (tidak ada SSR di Electron) — localStorage saja.

### Komponen shadcn/ui yang di-port (7, bukan semua)
`Button`, `Input`, `Label`, `Badge`, `Dialog` (+`DialogContent`/`DialogHeader`/`DialogTitle`), `Command` (+`CommandDialog`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem`), `Spinner`. Port kode persis dari `resources/js/components/ui/*.tsx` masing-masing, sesuaikan import path (`@/lib/utils` → path relatif desktop-node).

### Testing
Tidak ada logic baru yang perlu di-unit-test (murni styling/komponen presentasional) — verifikasi lewat `tsc --noEmit` + manual render check (halaman Login/Kasir yang sudah ada tetap render benar setelah Tailwind terpasang, sebelum Plan B mengubah isinya).

## Plan B — Cart & Payment UI

Ganti isi `desktop-node/src/renderer/pages/Kasir.tsx` (dari Slice 1, HTML polos) dengan port dari `kasir.tsx`:
- `CartLine`, `unitPrice` (pakai `priceForQty` yang sudah ada dari Slice 1 — tidak reimplementasi), `pickUnitForBaseQty`/`resolveLineQty`, `lineKey`.
- `react-data-grid` cart: kolom sama persis (Produk/Satuan/Harga/Qty/Subtotal/Aksi), qty inline-edit (`renderQtyEditCell`), pill satuan (`changeLineUnit`).
- `PaymentDialog`: shadcn `Dialog`, metode tunai/bon toggle, keyboard-driven action cycling (PageUp/PageDown/Enter/Alt+T/Alt+B/Alt+S), tampilan Kembalian/Kekurangan.
- Command palette (`CommandDialog`, shortcut `/`) untuk cari produk by nama/kode.
- Global keydown listener (barcode scan buffer + `/` + `Alt+K` clear cart + Enter-tunggal-bayar) — port dari `kasir.tsx`, **tanpa fitur cetak dulu** (itu Plan C) — checkout tanpa opsi print di titik ini, tombol "Simpan" saja (bukan "Simpan + Cetak").
- Data source: `window.api.kasir.listProducts()`/`listSalesToday()`/`checkout()`/`cancelSale()` yang sudah ada dari Slice 1 — **tidak ada perubahan IPC** di Plan B kecuali kalau field baru dibutuhkan render (mis. `priceTiers` sudah ada dari fix-wave Slice 1).
- Dark mode: `useAppearance` dari Plan A, toggle manual (belum ada UI togglenya di scope ini — ikut sistem default, sama seperti fallback web).

### Testing
Tidak ada logic bisnis baru (semua sudah dites di Slice 1) — halaman ini murni presentasional + orchestration. Verifikasi manual (CDP kalau tanpa display, sama seperti Slice 1) menggantikan checklist Slice 1's Step 6, dengan tambahan: qty inline-edit lewat grid, ganti satuan lewat pill, command palette cari produk, dialog pembayaran dengan PageUp/PageDown.

## Plan C — Scan Shortcuts Penuh + Cetak Struk

### Cetak struk
- **`checkout` IPC diperluas**: `kasir:checkout` sekarang mengembalikan sale lengkap (bukan cuma `{saleId, total}`) — termasuk `items` (dengan `namaItem` produk, bukan cuma `productId`) dan nama kasir (`user.name`), supaya `Receipt` bisa render tanpa round-trip tambahan. Ini murni memperluas response, tidak mengubah `checkout()` di `kasir.ts` (yang sudah dites) — perluasan terjadi di `ipc/kasir.ts` (join `products`/`users` setelah `checkout()` sukses).
- **`kasir:getStoreSettings`** (baru, read-only): baca baris tunggal `store_settings` (tabel sudah ada dari Fase 1 schema, belum ada pembacanya) — kalau belum ada baris, kembalikan default masuk akal (`nama_toko: 'Toko'`, field lain `null`) alih-alih error.
- **`kasir:printReceipt(saleId)`** (baru, IPC): main process panggil `mainWindow.webContents.print({silent: true})` — bukan `window.print()` (yang butuh dialog OS/browser). Renderer bertanggung jawab merender `<Receipt>` (hidden via CSS, sama seperti web) tepat sebelum invoke ini, supaya isi yang di-print sesuai `.receipt-print` yang aktif saat itu.
- Port CSS `@media print` (dari `resources/css/app.css`, aturan `.receipt-print`) ke `desktop-node`'s renderer CSS.
- Port komponen `Receipt` (dari `kasir/shared.tsx`) — **beda dari web**: `storeSettings` didapat dari `window.api.kasir.getStoreSettings()` (bukan `usePage().props`, karena tidak ada Inertia shared props di sini), `sale` dari hasil `checkout()` yang sudah diperluas (bukan re-fetch).

### Shortcut scan yang belum di-port di Plan B
`Alt+K` (clear cart — mungkin sudah masuk Plan B, cek saat itu), Enter-tunggal-sebagai-shortcut-Bayar (juga kemungkinan sudah di Plan B) — kalau keduanya sudah selesai di Plan B, Plan C fokus penuh ke cetak struk saja. (Keputusan pasti soal split B/C mana yang dapat shortcut mana ditentukan saat menulis plan masing-masing, supaya tidak dobel kerja.)

### Testing
`kasir:getStoreSettings` bisa diuji sebagai fungsi murni (baca row atau default) mirip pola `verifyLogin`. `kasir:printReceipt` tidak bisa di-unit-test (memanggil Electron API sungguhan) — verifikasi manual/CDP: struk ter-generate dengan data benar (item, total, kembalian/bon) sebelum panggilan print (yang sendiri tidak bisa diverifikasi tanpa printer fisik — cukup pastikan tidak crash dan payload yang dikirim ke `webContents.print` benar).

## Di luar scope 3 plan ini

Toggle dark mode di UI (switch manual — logic-nya ada tapi belum ada tombolnya), halaman History transaksi terpisah, bayar cicilan bon, manajemen produk (Fase 3), semua komponen shadcn/ui selain 7 yang disebutkan (ditambah nanti kalau modul lain butuh).
