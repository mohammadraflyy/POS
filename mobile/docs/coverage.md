# Kontrak API fase 1–4 dan cakupan klien

| Endpoint | Integrasi Flutter |
| --- | --- |
| GET /v1/health, POST /v1/pair, GET /v1/me | Pairing QR/manual, secure token, reconnect, semua 401 kembali pairing |
| GET /v1/customers | Saran nama pelanggan di pembayaran |
| GET /v1/catalog/search | Katalog, cek harga/stok, pencarian barcode, pagination |
| POST /v1/carts/price | Seluruh draft, debounce, response revision guard, total otoritatif, stok per baris |
| POST /v1/sales | Commit satu kali, rupiah, metode bayar, identitas pelanggan, printer result |
| GET /v1/sales | Filter tanggal/pencarian/metode/status selesai dan pagination |
| GET /v1/sales/:id | Detail, bonPayments dan edits read-only |
| POST /v1/sales/:id/print | Cetak ulang tanpa checkout ulang |
| GET /v1/suppliers | Pencarian/pagination/pilih supplier |
| POST /v1/suppliers | Form nama, telepon, alamat, keterangan |
| GET /v1/purchases/products | Cari barang masuk |
| GET /v1/purchases/products/barcode/:code | Scan exact barcode, tampilkan 404 dari server |
| POST /v1/purchases | Invoice multi-baris, satuan, qty, harga beli, uang muka opsional |
| GET /v1/opname/categories | Filter kategori |
| GET /v1/opname/products | Keyword/kategori, satuan dasar |
| POST /v1/opname/adjustments | Stok akhir, alasan, konfirmasi, simpan di PC |

Source integrasi dibuat; kolom ini bukan klaim pengujian terhadap server nyata. Tidak ada endpoint di luar dokumentasi yang digunakan. Semua request bisnis memakai bearer; tidak ada gate admin lokal. Edit/delete/cancel penjualan, edit/delete pembelian, pembayaran utang/bon baru, dan history/undo opname tidak ditambahkan ke mode terhubung.

## Detail schema yang belum disertakan dalam dokumen

CatalogItem, satuan turunan, list supplier dan detail nota tidak diberikan sebagai definisi lengkap. Pemetaan yang diimplementasikan (perlu dicocokkan dengan JSON server nyata):

| Konsep | Field yang diterima |
| --- | --- |
| ID produk | productId atau id |
| Nama produk | namaItem, name, nama |
| Kode/stok | kodeItem/code/barcode, stok/stock |
| Satuan dasar | satuan string atau satuan.nama atau baseUnitName; ID request dasar null |
| Harga katalog | hargaJual atau price; hanya ditampilkan, bukan sumber kalkulasi |
| Daftar satuan turunan | units, productUnits, satuanTurunan |
| ID satuan turunan | productUnitId atau id |
| Label satuan turunan | namaSatuan/satuan/name/nama atau unit.nama/unit.name |
| Daftar tanpa schema wrapper | array langsung atau data/items/products/categories/suppliers |
| Detail penjualan | objek langsung atau properti sale; items pada root atau sale |
| Nama baris struk | namaItem/productName/namaProduk |
| Nilai line di preview | hargaJual jika tersedia; subtotal dan total nota mengikuti schema eksplisit |

Tidak ada default harga nol jika harga hilang: ditampilkan tanda —. Jika schema preview tidak menyertakan subtotal/diskon/total, boolean stokCukup, atau jumlah line berbeda, checkout diblokir dengan pesan format respons. Pemetaan line mengasumsikan urutan balasan sama dengan urutan items request; konfirmasi dengan source previewCart/fixture server bila berbeda.

Satuan turunan harus mempunyai ID product_units yang benar, bukan ID master satuan. Jika API CatalogItem memakai struktur berbeda, ubah parser dari contoh JSON/source PC sebelum menjalankan transaksi satuan turunan.

## Uang dan efek samping

Mode live mengirim/menerima rupiah. Parsing field input dan format tampilan terpusat; perhitungan harga, diskon, stok, weighted average, total, dan kembalian bukan tugas domain lokal live. Stock shortage preview tidak melempar error, tetapi mengunci checkout. Respons checkout tetap otoritatif jika harga/stok berubah sejak preview.

Penyimpanan gagal secara bisnis (400) memicu preview ulang pada kasir. Status tidak pasti (timeout/500/format respons setelah POST) meninggalkan marker terenkripsi; pengguna memeriksa PC sebelum melanjutkan. Tidak ada janji exactly-once dari jaringan tanpa dukungan server.
