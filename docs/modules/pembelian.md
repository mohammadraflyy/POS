# Modul Pembelian (Barang Masuk)

Mencatat barang masuk dari supplier: menambah stok, meng-update harga pokok rata-rata tertimbang (weighted average cost), dan mengelola utang ke supplier beserta cicilannya.

**Kode:** `src/main/purchase.ts` (logika) · `src/main/ipc/purchase.ts` (IPC handler) · `src/preload/index.ts` (`window.api.purchase.*`) · `src/renderer/pages/Purchase.tsx`, `HutangSupplier.tsx`.

**Tabel:** `purchases`, `purchase_items`, `purchase_payments`, `product_price_histories`, `stock_movements`.

## Aturan Bisnis (wajib dipatuhi)

1. **Validasi input** (`assertPurchaseInput`): `tanggal` wajib diisi, minimal 1 item, tiap item `qty > 0` (boleh pecahan, dibulatkan 3 desimal) dan `hargaBeli` finite & ≥ 0.
2. **Setiap baris pembelian selalu MENAMBAH stok** (base unit = `qty * konversi`) — beda dari stock opname yang bisa naik/turun. Ini pola inti pembelian, jangan diubah jadi "increment/decrement" seperti opname.
3. **Harga pokok rata-rata tertimbang**: setiap baris meng-update `products.hargaPokok` (level produk, base unit) DAN `product_units.hargaPokok` untuk **setiap satuan yang "membawa" biaya** — yaitu satuan yang dibeli beserta seluruh satuan yang lebih kecil di dalamnya (`unitsCarryingCost`/`unitsInside`). Satuan yang lebih besar (parent) dan satuan "saudara" (sibling) **tidak** ikut ter-update — barang secara fisik datang di dalam kemasan yang dibeli, bukan di kemasan lain.
4. Rumus (`hitungHargaPokokSatuan`) bekerja dalam **nilai rupiah** dibagi total qty (bukan rata-rata dua harga per-unit) supaya satuan turunan (mis. beli per DUS, stok dilacak per PCS) tidak dibulatkan dua kali.
5. Satu invoice pembelian **boleh punya beberapa baris untuk produk yang sama** (mis. 2 DUS + 3 PCS) — stok & cost harus terakumulasi baris demi baris (compounding), bukan tiap baris menghitung dari kondisi awal invoice.
6. Kalau `hargaPokok` berubah, dicatat 1 baris `product_price_histories` (snapshot before/after cost; `hargaJual` dicatat tidak berubah — pembelian tidak pernah mengubah harga jual).
7. Setiap baris dicatat ke `stock_movements` (`movementType: 'purchase'`).
8. **`dibayar` (uang muka)**: kalau tidak diisi (`undefined`), invoice dianggap **lunas penuh** (`dibayar = totalPembelian`). Kalau diisi, harus integer, ≥ 0, dan ≤ total. `total - dibayar` = utang ke supplier.
9. **Edit pembelian** (`updatePurchase`): item lama **dibalik dulu** (`reversePurchaseItems` — stok & cost mundur, urutan newest-first, kebalikan urutan apply) baru item baru diproses. Cicilan yang sudah dibayar (`purchase_payments`) **tidak boleh diubah/dihapus** — total baru tidak boleh lebih kecil dari cicilan yang sudah masuk. Uang muka baru = `dibayar ?? (total - cicilan)`.
10. Reversal cost (`balikHargaPokokSatuan`) memakai rata-rata **saat ini** (bukan replay histori penuh) — jaminannya cuma: nilai inventory turun tepat sebesar nilai pembelian yang dibalik. Hasil di-clamp ke ≥ 0.
11. **Delete pembelian** (`deletePurchase`): hard delete, membalik semua baris (stok & cost mundur), cascade `purchase_payments` (utang ikut hilang). **Tidak ada guard** — sengaja, sama seperti `deleteSale` di modul Penjualan.
12. **Pembayaran hutang supplier** (`recordSupplierPayment`): satu pembayaran (lump sum) dialokasikan **FIFO** ke invoice-invoice supplier yang belum lunas (tanggal terlama dulu), bisa menyentuh beberapa `purchases` sekaligus dalam 1 transaksi → hasil `alokasi[]`. Jumlah bayar tidak boleh melebihi total hutang supplier tsb.

## Endpoint (IPC channel via `window.api.purchase`)

| Channel | Akses | Input | Output |
|---|---|---|---|
| `recordPurchase` | user | `{ supplierId, tanggal, catatan, items[{productId, productUnitId, qty, hargaBeli}], dibayar? }` | `{ purchaseId }` |
| `updatePurchase` | user | `purchaseId`, input sama seperti `recordPurchase` | `{ total }` |
| `deletePurchase` | user | `purchaseId` | – |
| `getPurchaseDetail` | user | `purchaseId` | detail invoice untuk form edit (`items[]`, `uangMuka`, `cicilan`) |
| `listPurchases` | user | `{ page, pageSize? }` | list + pagination + `totalKeseluruhan` |
| `searchProducts` | user | `q` | produk + satuan turunan (untuk entry item) |
| `findProductByBarcode` | user | `barcode` | produk (exact match) atau `null` |
| `listSupplierDebts` | user | `supplierId?` | daftar invoice belum lunas (+`sisa`) |
| `recordSupplierPayment` | user | `{ supplierId, jumlah, tanggal, keterangan }` | `{ alokasi: [{purchaseId, jumlah}] }` |
| `listSupplierPayments` | user | `supplierId` | riwayat cicilan, terbaru dulu |

Semua channel di atas hanya memanggil `requireUser()` (tidak ada yang `requireAdmin`), berbeda dari sebagian channel Penjualan.

## Cara Pakai (dari renderer)

```ts
// catat pembelian baru — 5 DUS senilai 120.000/DUS, dibayar sebagian
const { purchaseId } = await window.api.purchase.recordPurchase({
  supplierId: 3,
  tanggal: '2026-09-15',
  catatan: null,
  items: [{ productId: 12, productUnitId: 7 /* satuan DUS */, qty: 5, hargaBeli: 120000 }],
  dibayar: 300000, // rupiah; sisanya (kalau ada) jadi utang
})

// bayar hutang supplier, dialokasikan otomatis ke invoice terlama
const { alokasi } = await window.api.purchase.recordSupplierPayment({
  supplierId: 3, jumlah: 500000, tanggal: '2026-09-15', keterangan: 'transfer BCA',
})
```

Uang: input/output IPC dalam **rupiah**, dikonversi ke/dari **sen** oleh `toCents`/`toRupiah` di `ipc/purchase.ts` — jangan kirim nilai sen langsung dari renderer.

## Catatan Teknis (menjaga korektnes / minim bug)

- `recordPurchase`, `updatePurchase`, `deletePurchase`, `recordSupplierPayment` semuanya dibungkus `db.transaction()` — stok, cost, `purchase_items`, dan `product_price_histories` selalu konsisten walau terjadi error di tengah.
- Logika average-cost (`hitungHargaPokokSatuan`, `balikHargaPokokSatuan`) adalah bagian paling gampang salah di modul ini — **jangan** modifikasi tanpa membaca komentar di `purchase.ts` dan tanpa menjalankan test yang mencakup kasus: beli berulang untuk 1 produk, beli satuan turunan (DUS/PCS), dan edit/delete pembelian lama.
- Test unit ada di `purchase.test.ts` (Vitest) — jalankan `npm test -- purchase` setelah mengubah modul ini.
- Sama seperti modul Penjualan: validasi input murni manual di `purchase.ts`, belum ada validasi skema di boundary IPC. Pertimbangkan `zod` bila menambah field baru yang kompleks (perlu approval dependency baru sesuai `CLAUDE.md`).
