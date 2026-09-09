# Aplikasi Mobile sebagai Klien Tipis dari PC Toko

Tanggal: 2026-09-09

## Masalah

Aplikasi ini hanya bisa dipakai dari satu PC. Kasir kedua tidak bisa dibuka saat
antrean panjang, dan penghitungan stok di rak harus dicatat di kertas lalu
diketik ulang di depan.

Halangannya bukan tampilan, melainkan ketiadaan lapisan jaringan. Tidak ada satu
pun HTTP di kode: main process Electron berbicara ke jendelanya sendiri lewat
IPC, dan ke data lewat `better-sqlite3` yang memegang satu berkas SQLite di PC
itu. Logika bisnis (`kasir.ts`, `purchase.ts`, `inventory.ts`,
`stock-opname.ts`, dan enam modul lain) terikat pada proses tersebut.

## Sasaran

Perangkat Android bisa menjalankan operasi harian toko — menjual, menerima
barang, menghitung stok, mengecek harga, melihat riwayat, mendaftarkan supplier —
dengan stok dan katalog yang sama persis seperti yang dilihat PC, tanpa duplikasi
data dan tanpa sinkronisasi.

Bukan bagian dari pekerjaan ini: rekap, dashboard, pengaturan toko, manajemen
pengguna, pembatalan dan penghapusan nota penjualan, pengeditan nota pembelian,
serta operasi apa pun saat PC toko mati.

## Keputusan Arsitektur

### PC toko menjadi server, di dalam proses Electron yang sudah ada

Main process membuka HTTP server pada port tetap di jaringan lokal. Bukan proses
terpisah, bukan Windows service.

Alasannya penguncian berkas: `better-sqlite3` memegang berkas SQLite, dan dua
proses yang menulis berkas yang sama akan saling mengunci. Satu proses berarti
satu handle database, dan masalah itu tidak pernah lahir.

Alternatif yang ditolak:

- **Server Node terpisah atau Docker.** Menuntut pemindahan data ke Postgres atau
  MySQL, jauh lebih besar daripada kebutuhan ini, dan mencabut satu-satunya
  alasan aplikasi ini mudah dipasang.
- **Server di awan dengan sinkronisasi dua arah.** Menghadirkan stok yang terjual
  dua kali di dua perangkat, beserta aturan rekonsiliasi untuk menyelesaikannya.
  Ditolak karena toko ini punya satu PC yang selalu menyala di jam buka.

### Handler HTTP dan handler IPC adalah dua adaptor tipis di atas fungsi yang sama

`checkout`, `resolveItems`, `recordPurchase`, `recordStockAdjustment`, dan
seterusnya dipanggil apa adanya. Tidak ada logika yang disalin ke lapisan HTTP.

Dua hal harus dirapikan lebih dulu agar ini mungkin:

1. **Identitas per permintaan.** `requireUser()` dan `requireAdmin()`
   (`src/main/ipc/auth.ts:7`) membaca satu variabel `currentUser` di level modul —
   benar untuk satu orang di depan satu PC, salah untuk tiga klien sekaligus.
   Adaptor HTTP memanggil `assertLoggedIn(user)` dan `assertAdmin(user)` di
   `auth.ts`, yang sudah menerima user sebagai argumen, dengan user hasil
   penukaran token. Fungsi domain di bawahnya tidak berubah.
2. **Konversi rupiah dan sen.** `toRupiah` dan `toCents` sekarang hidup di dalam
   `src/main/ipc/kasir.ts`. Ditarik ke modul tersendiri agar adaptor HTTP
   memakainya alih-alih menyalinnya; salinan kedua berarti HP dan PC bisa berbeda
   pembulatan.

### Klien Flutter, dan server menghitung seluruh harga

Klien tidak pernah menghitung rupiah. Setiap perubahan keranjang dikirim ke
server, dan server mengembalikan keranjang beserta totalnya.

Ini menjaga aturan harga — harga bertingkat, diskon per baris, diskon nota,
lantai harga pokok — tetap satu salinan di tempat yang sudah diuji. Tanpa aturan
ini, logika `cart-logic.ts`, yang sudah sengaja diduplikasi antara renderer dan
main process, akan lahir untuk ketiga kalinya dalam bahasa Dart.

Kekhawatiran bahwa pendekatan ini terasa lambat tidak berlaku di sini: satu
putaran permintaan di Wi-Fi lokal sekitar 5–20 ms, bukan ratusan milidetik
seperti lewat internet.

## Autentikasi dan Pairing

Pengaturan di PC menampilkan QR berisi alamat server dan kode pairing sekali
pakai. HP memindainya dan menukarnya dengan token perangkat.

Token disimpan di tabel baru:

```
device_tokens(id, nama_perangkat, token_hash, user_id, created_at, revoked_at)
```

Disimpan di database, bukan di memori, agar perangkat tidak perlu dipasangkan
ulang setiap pagi. Pengaturan PC bisa mencabut perangkat yang hilang.

Pairing lewat QR sekaligus menyelesaikan alamat IP yang bergeser saat router
memberi DHCP baru: pindai ulang, selesai.

Pairing menghubungkan perangkat, bukan orang. Setelah terpasang, pemakai HP masuk
dengan akun miliknya sendiri dari master pengguna yang sudah ada, dan token
diterbitkan untuk akun itu — karena itu `user_id` ada di tabel di atas. Akibatnya
nota dari HP tercatat atas nama kasir yang benar-benar melayaninya, bukan atas
nama siapa pun yang kebetulan membuka Pengaturan di PC saat QR dibuat. Satu
perangkat yang dipakai bergantian oleh dua kasir cukup berganti login, tanpa
pairing ulang.

Setiap permintaan membawa `Authorization: Bearer <token>`. Server memetakan token
ke user, lalu meneruskannya ke `assertLoggedIn` atau `assertAdmin`.

## Kontrak API

Dikelompokkan mengikuti modul domain yang sudah ada:

- `auth` — tukar kode pairing, identitas perangkat saat ini
- `catalog` — pencarian produk berhalaman, pencarian berdasarkan barcode
- `carts` — buat keranjang, tambah/ubah/hapus baris, checkout
- `purchases` — buat nota pembelian, daftar supplier, daftarkan supplier baru
- `opname` — daftar kategori, cari produk untuk dihitung, simpan penyesuaian
- `sales` — riwayat hari ini, detail nota, cetak ulang

Setiap respons membawa versi aplikasi. HP versi lama yang menempel ke PC yang
sudah diperbarui menampilkan pesan jelas, bukan kesalahan yang tidak terbaca.

Katalog ditarik berhalaman dan disimpan di cache HP, disegarkan dengan penanda
waktu. Bukan 1500 produk setiap kali layar dibuka: setiap permintaan memblokir
main process PC sesaat, karena `better-sqlite3` bersifat sinkron.

## Keranjang di Sisi Server

Keranjang hidup di memori server, bukan di tabel. Ia belum menjadi data bisnis
sampai dibayar — halaman Penjualan di PC pun menyimpan draftnya di localStorage.

Konsekuensinya, aplikasi PC yang restart di tengah transaksi menghilangkan
keranjang di server. Mitigasinya: HP menyimpan salinan ringan
`{productId, productUnitId, qty, diskon}` — bentuk `StoredCartLine` yang sudah
ada di kode — dan mengirimkannya kembali untuk membangun ulang. Ini juga yang
membuat HP selamat dari Wi-Fi yang putus sepuluh detik, tanpa menjadikannya
aplikasi offline-first.

Penetapan harga memakai jalur yang sama dengan checkout dalam mode pratinjau:
kekurangan stok dikembalikan **sebagai data, bukan exception**, agar HP menandai
baris yang bermasalah tanpa kehilangan isi keranjang. Ini perubahan kecil pada
`resolveItems`, yang sekarang selalu melempar.

## Layar di Aplikasi Mobile

**Penjualan.** Cari atau pindai, atur qty dan satuan, diskon per baris, pilih
pelanggan dari master atau ketik nama baru, bayar dengan tunai, bon, QRIS, atau
transfer. Server menyimpan nota dan mencetak struk di printer yang menempel di
PC.

**Pembelian.** Pilih supplier, pindai atau cari produk, isi qty, satuan, dan
harga beli, lalu simpan. Server memanggil `recordPurchase` yang sama dengan PC,
termasuk perhitungan harga pokok rata-rata bergeraknya.

Hanya membuat nota baru. Mengedit dan menghapus nota pembelian membalik rata-rata
terhadap stok hari ini, bukan stok saat nota dibuat — operasi paling merusak di
modul itu, dan tidak pantas berada di perangkat yang paling mudah salah pencet.
Keduanya tetap di PC.

**Pendaftaran supplier.** Nama, telepon, alamat, keterangan. Dipakai langsung
oleh layar Pembelian tanpa harus ke PC.

**Stock opname.** Hitung fisik per kategori sambil berjalan di rak, pindai
barcode untuk melompat ke produk. Stok sistem dibaca saat menyimpan, bukan saat
memuat daftar: kasir masih menjual barang yang sedang dihitung, dan angka yang
dibaca setengah jam lalu melahirkan selisih susut yang salah.

**Cek harga dan stok.** Pindai atau ketik, lihat harga tiap satuan, harga
bertingkat, dan sisa stok. Menumpang pencarian yang sudah dibangun untuk dua
layar utama.

**Riwayat.** Nota hari ini, detailnya, dan cetak ulang. Tanpa pembatalan dan
tanpa penghapusan — keduanya memulihkan stok dan menggeser rekap pada dua hari
sekaligus, dan tetap menjadi wewenang PC.

## Kegagalan yang Ditangani

**Stok tidak dicadangkan saat masuk keranjang.** Pemeriksaan terjadi saat
checkout. Dua kasir bisa sama-sama memasukkan barang terakhir, dan yang kedua
ditolak di detik terakhir. Ini perilaku yang benar; yang harus dijamin adalah
penolakan itu tampil sebagai pesan pada baris yang bermasalah, bukan kegagalan
seluruh nota.

**Nota pembelian menggeser harga.** Setiap nota masuk mengubah harga pokok
rata-rata, dan harga pokok itulah lantai bagi harga manual di penjualan. Nota
yang disimpan dari gudang bisa mengubah lantai harga keranjang yang sedang
terbuka di PC. Karena keranjang dihitung ulang server pada setiap mutasi, kasir
melihat peringatannya alih-alih diam-diam salah.

**PC mati sama dengan HP berhenti melayani.** Indikator koneksi tampil permanen,
dan tombol simpan mati saat terputus — bukan gagal setelah ditekan.

**Firewall Windows menanyakan izin** saat port pertama kali dibuka. Kalau
ditolak, HP tidak akan pernah tersambung, dengan gejala yang membingungkan.
Pengaturan PC menampilkan status server beserta alamatnya agar bisa dipastikan.

**Struk keluar di PC.** Kalau pemegang HP sedang di gudang, struknya menunggu di
depan. Keputusan operasional, bukan kerusakan.

## Pengujian

Adaptor HTTP diuji dengan vitest seperti modul lain, memanggil handler secara
langsung tanpa jaringan sungguhan. Fungsi domain di bawahnya sudah dijaga oleh
652 test yang ada, dan tidak berubah.

Penukaran token, pencabutan perangkat, dan penolakan permintaan tanpa token diuji
sebagai unit — ini satu-satunya logika keamanan yang baru.

Sisi Flutter cukup widget test tipis: logika bisnisnya memang tidak berada di
sana. Alur ujung-ke-ujung diperiksa manual di perangkat sungguhan, karena kamera
dan printer tidak bisa disimulasikan dengan jujur.

## Fase

Setiap fase berdiri sendiri dan bisa dipakai sebelum fase berikutnya ada.

1. **Fondasi.** Adaptor HTTP, identitas per permintaan, tabel `device_tokens`,
   pairing lewat QR, indikator status server di Pengaturan PC. Belum ada layar
   mobile, tetapi tanpa ini tidak ada yang bisa berjalan.
2. **Penjualan.** Keranjang di server, pembayaran, cetak struk di PC. Fase
   terberat sekaligus paling berharga: selesai fase ini, kasir kedua sudah bisa
   berjualan.
3. **Pembelian dan supplier.** Termasuk pendaftaran supplier baru dari HP.
4. **Opname, cek harga, dan riwayat.** Tiga layar yang menumpang katalog dan
   pencarian dari fase sebelumnya.

## Risiko yang Diterima

**Lalu lintas tidak terenkripsi.** Jaringan lokal, tanpa TLS. Siapa pun yang
memiliki kata sandi Wi-Fi toko dan sebuah token bisa berbicara dengan API.
Mitigasinya token per perangkat yang bisa dicabut, bukan enkripsi.

**Aplikasi PC wajib terbuka selama jam buka.** Bukan service latar. Mode sleep PC
harus dimatikan. Ini aturan operasional yang perlu disampaikan ke pemilik, bukan
sesuatu yang bisa diselesaikan kode.

**Setiap permintaan HP memblokir main process sesaat.** Sudah terjadi lewat IPC
hari ini; HP menambah frekuensinya. Untuk skala toko ini kecil, dan mitigasinya
adalah katalog berhalaman yang di-cache, bukan perubahan arsitektur.
