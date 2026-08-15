# Roadmap Menuju Parity iPOS 4

Tanggal: 2026-08-13
Basis: pembacaan `desktop-node/src/main/db/schema.ts` dan modul `main/` per commit `01f627c`.

## Cara membaca dokumen ini

Urutan fase disusun dari rasio nilai/usaha dan ketergantungan, bukan dari kemiripan dengan iPOS. Setiap fase mandiri dan bisa dirilis sendiri. Ukuran usaha relatif: **S** (satu modul, tanpa perubahan schema besar), **M** (tabel baru + satu-dua modul ikut berubah), **L** (menyentuh kasir, pembelian, opname, dan laporan sekaligus).

Konvensi kerja yang berlaku: tes vitest di proses main, dan urutan rebuild `better-sqlite3` (`rebuild:node` sebelum tes, `rebuild:electron` sesudahnya) wajib diikuti atau aplikasi gagal boot.

---

## Fase 1 — HPP otomatis dari pembelian (S) — SELESAI 2026-08-13

**Masalah.** `createPurchase` di `src/main/purchase.ts` menulis `purchase_items`, menambah `products.stok`, dan mencatat `stock_movements`, tetapi tidak pernah menyentuh `products.hargaPokok`. Akibatnya HPP tetap angka yang diketik manual di form produk. `sale_items.hargaPokok` menyalin angka itu saat penjualan, sehingga seluruh margin di Rekap dan Dashboard ikut salah. Dengan satuan turunan, jaraknya makin lebar: beli 5 DUS @120.000 tidak mengubah HPP per PCS sama sekali.

**Kerjakan.**
- Hitung harga pokok per satuan dasar saat pembelian: `hargaBeli / konversi`.
- Pilih metodenya secara eksplisit — *last cost* (paling sederhana, cukup untuk toko retail) atau *moving average* (`(stokLama * hppLama + qtyDasar * hppBaru) / (stokLama + qtyDasar)`). Rekomendasi: moving average, karena last cost membuat margin melompat-lompat tiap kali harga supplier bergerak.
- Tulis baris `product_price_histories` supaya perubahan HPP punya jejak audit, sama seperti perubahan harga jual.
- Semua di dalam transaksi yang sama dengan `createPurchase`.

**Kenapa pertama.** Diff-nya kecil dan terkurung di satu fungsi, tapi memperbaiki angka yang dipakai untuk semua keputusan harga. Semua fase laporan di bawah tidak ada gunanya kalau HPP-nya salah.

**Tes.** Kasus di `purchase.test.ts`: beli satuan dasar, beli satuan turunan, beli dua kali dengan harga berbeda (verifikasi rata-rata), beli saat stok nol.

---

## Fase 2 — Hak akses pengguna (S) — SELESAI 2026-08-13

**Masalah.** `users` (`schema.ts:10`) hanya berisi `username`, `passwordHash`, `name`. Tidak ada kolom peran, dan tidak ada satu pun handler IPC yang memeriksa siapa pemanggilnya. Semua pengguna setara: kasir harian bisa mengubah harga jual, menghapus produk, membatalkan transaksi lama, dan menjalankan purge penjualan.

**Kerjakan.**
- Tambah `users.role` dengan enum `('admin', 'kasir')`. Dua peran dulu — jangan bikin matriks izin per menu sebelum ada yang meminta.
- Terapkan penjagaan di lapisan IPC (`src/main/ipc/*.ts`), bukan di renderer. Renderer boleh menyembunyikan tombol, tapi itu kosmetik; keputusan izin harus di proses main.
- Operasi khusus admin: ubah harga/HPP, hapus produk, batalkan penjualan, purge penjualan, stok opname, kelola pengguna, ubah settings.
- Seed: pengguna pertama jadi `admin`; migrasi menetapkan `admin` untuk semua baris lama supaya tidak ada yang terkunci di luar.

**Kenapa kedua.** Ini prasyarat sebelum aplikasi dipegang orang lain selain pemilik. Menambahkannya setelah ada banyak modul berarti menambal puluhan handler, bukan sembilan.

**Tes.** Satu tes per handler terlindungi: peran `kasir` ditolak, peran `admin` lolos.

**Hasil.** `users.role` (`'admin' | 'kasir'`), migrasi `0011` yang menaikkan semua akun lama jadi admin, penjagaan lewat `assertLoggedIn`/`assertAdmin` di `src/main/auth.ts` yang dibungkus `requireUser`/`requireAdmin` di `src/main/ipc/auth.ts`, manajemen pengguna di `src/main/users.ts` + halaman `/users`. Admin-only: ubah produk/satuan/tier harga, hapus produk, master satuan, import, batalkan & hapus penjualan, purge, ubah settings, hapus supplier, seluruh Rekap, seluruh `users:*`.

**Sisa risiko yang diputuskan pemilik.** Dashboard tetap terbuka untuk kasir, padahal `getDashboard` memakai `getRekap` sehingga `summary.labaKotor` ikut terkirim — laba harian masih terlihat kasir walau menu Rekap ditutup. Stok opname dan pembelian juga tetap terbuka untuk kasir.

---

## Fase 3 — Retur penjualan (M)

**Masalah.** Tidak ada tabel retur sama sekali. Satu-satunya jalan membatalkan penjualan adalah pembatalan seluruh nota, yang mengembalikan semua baris. Retur sebagian barang tidak bisa dicatat.

**Kerjakan.**
- Tabel `sale_returns` (`sale_id`, `user_id`, `tanggal`, `total`, `alasan`) dan `sale_return_items` (`product_id`, `product_unit_id`, `qty`, `konversi`, `base_quantity`, `harga_jual`, `harga_pokok`, `subtotal`).
- Tambah `'sale_return'` ke enum `stock_movements.movementType`. Stok naik sebesar `base_quantity`.
- Validasi: qty retur per baris tidak boleh melebihi qty terjual dikurangi yang sudah pernah diretur.
- Salin `hargaJual` dan `hargaPokok` dari `sale_items`, jangan hitung ulang dari master — harga sekarang bukan harga saat transaksi.
- Retur atas nota bon mengurangi sisa piutang, bukan mengeluarkan uang tunai.
- Rekap harus mengurangi omzet dan laba pada periode retur.

**Kenapa ketiga.** Ini kejadian harian di toko retail, dan tanpa itu kasir memakai jalan pintas yang merusak data (membatalkan lalu menjual ulang).

---

## Fase 4 — Hutang supplier (M)

**Masalah.** `purchases` (`schema.ts:96`) tidak punya status pembayaran maupun jatuh tempo. Sisi piutang sudah lengkap (`sales.metodePembayaran='bon'` + `bon_payments` + halaman `BonPayment.tsx`), sisi hutang tidak ada.

**Kerjakan.**
- Tambah `purchases.metodePembayaran` (`'tunai' | 'hutang'`), `dibayar`, dan `jatuhTempo`.
- Tabel `purchase_payments` — bentuknya cermin `bon_payments` (`schema.ts:148`).
- Halaman pembayaran hutang meniru `BonPayment.tsx`; logika cicilannya identik, tinggal dibalik arahnya.
- Dashboard: kartu total hutang jatuh tempo di samping kartu piutang yang sudah ada.

**Kenapa keempat.** Usahanya rendah karena polanya sudah terbukti di sisi piutang, dan bersama Fase 1 melengkapi gambaran sisi pembelian.

---

## Fase 5 — Retur pembelian (M)

Kebalikan Fase 3, dan bergantung pada Fase 4 supaya retur bisa memotong hutang yang belum dibayar. Tabel `purchase_returns` + `purchase_return_items`, enum movement `'purchase_return'`, stok turun. Kalau pembeliannya tunai, retur menjadi tagihan ke supplier; kalau hutang, langsung memotong sisa hutang.

---

## Fase 6 — Diskon nota dan pajak (S)

**Masalah.** `sales` tidak punya kolom diskon maupun pajak. Yang ada hanya harga bertingkat per baris (`product_price_tiers`) dan override manual per baris (`sale_items.priceSource='manual'`). Diskon "potong 10.000 untuk seluruh belanja" tidak bisa dicatat.

**Kerjakan.**
- `sales.diskon` (nominal), `sales.diskonPersen`, `sales.pajak`, `sales.subtotal`. Simpan hasil hitungnya, jangan hitung ulang saat menampilkan — tarif pajak bisa berubah.
- Struk (`escpos.ts`) menampilkan baris subtotal, diskon, pajak, total.
- Rekap: omzet memakai total setelah diskon; laba kotor memakai total setelah diskon dikurangi HPP.

**Catatan.** Pajak hanya perlu dibangun kalau toko memang PKP. Kalau tidak, kerjakan bagian diskon saja dan lewati kolom pajak.

---

## Fase 7 — Master pelanggan (M)

**Masalah.** Tidak ada tabel `customers`. `sales.namaPelanggan` (`schema.ts:122`) adalah teks bebas, dan pemilihnya mengambil nama dari transaksi lama. Artinya tidak ada limit kredit, tidak ada riwayat per pelanggan yang bisa dipercaya (salah ketik satu huruf jadi pelanggan baru), tidak ada harga khusus per pelanggan.

**Kerjakan.**
- Tabel `customers` (`nama`, `telepon`, `alamat`, `limitKredit`, `isActive`).
- `sales.customerId` nullable, `namaPelanggan` tetap ada sebagai snapshot nama saat transaksi.
- Migrasi data: kelompokkan nilai `namaPelanggan` yang ada, buat baris pelanggan, tautkan. Nama yang mirip harus dikonfirmasi manusia, jangan digabung otomatis.
- Bon memeriksa limit kredit sebelum menyetujui penjualan kredit.

**Kenapa setelah retur dan hutang.** Nilainya besar hanya kalau toko benar-benar melayani pelanggan langganan. Kalau mayoritas transaksi tunai anonim, turunkan prioritasnya atau lewati.

---

## Fase 8 — Kas, biaya operasional, laba bersih (L)

**Masalah.** Rekap hanya menghitung laba kotor dari penjualan. Tidak ada kas/bank, tidak ada biaya operasional (gaji, listrik, sewa), sehingga laba bersih tidak bisa dihitung.

**Kerjakan.**
- Tabel `cash_accounts` dan `cash_transactions` (masuk/keluar, kategori, referensi ke penjualan/pembelian/biaya).
- Tabel `expenses` dengan kategori biaya.
- Laporan laba rugi sederhana: omzet − HPP − biaya operasional.

**Jangan.** Jangan bangun jurnal umum berpasangan (debit/kredit) dan neraca kecuali diminta eksplisit. Itu bukan fitur, itu produk akuntansi tersendiri, dan pertanyaan "Neraca?" dari roadmap FASE 1 sampai sekarang belum pernah dikonfirmasi.

---

## Fase 9 — Multi gudang (L) — putuskan dulu, jangan langsung bangun

**Masalah.** `products.stok` adalah satu integer (`schema.ts:41`). Tidak ada dimensi gudang di mana pun: tidak di penjualan, pembelian, opname, maupun `stock_movements`.

**Konsekuensi kalau dikerjakan.** Stok harus pindah ke tabel `product_stocks` (`product_id`, `warehouse_id`, `stok`). Setiap tempat yang membaca atau menulis `products.stok` harus berubah: `kasir.ts` (cek stok dan pengurangan), `purchase.ts` (penambahan), `stock-opname.ts`, `dashboard.ts`, `rekap.ts` (nilai persediaan), `inventory.ts` dan importir massal. Plus tabel `warehouses`, `stock_transfers`, dan pemilih gudang di setiap layar transaksi.

**Rekomendasi.** Kerjakan hanya kalau memang ada lebih dari satu lokasi fisik hari ini. Untuk toko satu lokasi, biayanya jauh melebihi manfaatnya. Konfirmasi ke pemilik sebelum menjadwalkan.

---

## Di luar cakupan sampai ada permintaan tegas

- **Multi cabang / sinkronisasi.** Satu file SQLite lokal. Menjadikannya multi-cabang berarti server pusat, resolusi konflik, dan mode offline — itu proyek terpisah, bukan fase.
- **Poin dan promo member.** Bergantung pada Fase 7 dan hanya bermakna kalau ada program loyalitas nyata.
- **Salesman dan komisi.** Belum pernah disebut sebagai kebutuhan.
- **Scan-by-camera dan aplikasi kasir mobile.** Sudah ditahan sejak FASE 1, tetap ditahan.

---

## Ringkasan urutan

| Fase | Isi | Usaha | Blokir |
|---|---|---|---|
| 1 | HPP otomatis dari pembelian | S | — |
| 2 | Hak akses pengguna | S | — |
| 3 | Retur penjualan | M | — |
| 4 | Hutang supplier | M | — |
| 5 | Retur pembelian | M | Fase 4 |
| 6 | Diskon nota dan pajak | S | — |
| 7 | Master pelanggan | M | — |
| 8 | Kas, biaya, laba bersih | L | Fase 1 |
| 9 | Multi gudang | L | keputusan pemilik |

Fase 1 dan 2 layak dikerjakan lebih dulu tanpa diskusi lanjutan: kecil, tidak saling bergantung, dan keduanya memperbaiki risiko nyata yang ada hari ini.
