import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/domain/kasir.dart';
import 'package:pos_server/src/domain/rekap.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

const hari = '2026-07-04';

int jual(Db db, List<CartItemInput> items, {MetodePembayaran metode = MetodePembayaran.tunai, int? diskon, String tanggal = '${hari}T10:00', int? dibayar}) {
  return checkout(
    db,
    CheckoutInput(
      metodePembayaran: metode,
      namaPelanggan: metode == MetodePembayaran.bon ? 'Bu Siti' : null,
      dibayar: dibayar ?? (metode == MetodePembayaran.tunai ? 100000000 : null),
      userId: 1,
      items: items,
      diskon: diskon,
      tanggal: tanggal,
    ),
  ).saleId;
}

Map<String, Object?> rekap(Db db, {String from = hari, String to = hari}) => getRekap(db, from: from, to: to);

Map<String, Object?> summary(Db db, {String from = hari, String to = hari}) => rekap(db, from: from, to: to)['summary'] as Map<String, Object?>;

void bayarBonPada(Db db, int saleId, int jumlah, String tanggal) {
  final now = nowSeconds();
  db.insert('INSERT INTO bon_payments (sale_id, jumlah, tanggal, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [saleId, jumlah, tanggal, now, now]);
  db.execute('UPDATE sales SET dibayar = dibayar + ? WHERE id = ?', [jumlah, saleId]);
}

void main() {
  test('sums tunai into omzetTunai and qris/transfer into omzetNonTunai, leaving out cancelled sales', () {
    final db = seedDb();
    jual(db, [const CartItemInput(productId: 1, qty: 1)]);
    jual(db, [const CartItemInput(productId: 2, qty: 1)], metode: MetodePembayaran.qris);
    jual(db, [const CartItemInput(productId: 2, qty: 2)], metode: MetodePembayaran.transfer);
    cancelSale(db, jual(db, [const CartItemInput(productId: 2, qty: 5)]));

    expect(summary(db), {'omzetTunai': 65000, 'omzetNonTunai': 9000, 'piutangBeredar': 0, 'jumlahTransaksi': 3, 'labaKotor': 5000 + 3 * 500});
  });

  test('leaves an unpaid bon out of omzet and laba, but counts it as piutang', () {
    final db = seedDb();
    jual(db, [const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon);

    expect(summary(db), {'omzetTunai': 0, 'omzetNonTunai': 0, 'piutangBeredar': 9000, 'jumlahTransaksi': 0, 'labaKotor': 0});
  });

  test('counts a settled bon on the day it was paid, and a part-paid one nowhere', () {
    final db = seedDb();
    final lunas = jual(db, [const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon);
    final sebagian = jual(db, [const CartItemInput(productId: 2, qty: 1)], metode: MetodePembayaran.bon);
    bayarBonPada(db, lunas, 400000, '2026-07-05');
    bayarBonPada(db, lunas, 500000, '2026-07-08');
    bayarBonPada(db, sebagian, 100000, '2026-07-08');

    expect(summary(db, to: '2026-07-07')['omzetTunai'], 0);
    expect(summary(db, from: '2026-07-08', to: '2026-07-08')['omzetTunai'], 9000);
    expect((rekap(db, from: '2026-07-08', to: '2026-07-08')['labaPerHari'] as List).single, {'tanggal': '2026-07-08', 'omzet': 9000, 'laba': 1500});
  });

  test('falls back to the sale date for a bon marked paid with no payment recorded', () {
    final db = seedDb();
    final saleId = jual(db, [const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon);
    db.execute('UPDATE sales SET dibayar = total WHERE id = ?', [saleId]);

    expect(summary(db)['omzetTunai'], 9000);
  });

  test('clamps an overpaid bon at zero in piutangBeredar', () {
    final db = seedDb();
    final lebih = jual(db, [const CartItemInput(productId: 2, qty: 1)], metode: MetodePembayaran.bon);
    jual(db, [const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon);
    db.execute('UPDATE sales SET dibayar = total + 100000 WHERE id = ?', [lebih]);

    expect(summary(db)['piutangBeredar'], 9000);
  });

  test('splits the bill discount across lines without losing a cent, and explains the laba', () {
    final db = seedDb();
    jual(db, [const CartItemInput(productId: 1, qty: 1), const CartItemInput(productId: 2, qty: 1, diskon: 50000)], diskon: 100001);

    final result = rekap(db);
    final penjelasan = result['penjelasanLaba'] as Map;
    final perHari = (result['labaPerHari'] as List).single as Map;

    expect(penjelasan['diskonItem'], 500);
    expect(penjelasan['diskonNota'], 1000.01);
    expect(penjelasan['penjualanKotor'], 68000);
    expect(penjelasan['omzet'], 68000 - 500 - 1000.01);
    expect(perHari['omzet'], penjelasan['omzet']);
    expect(penjelasan['modal'], 62500);
  });

  test('names a line sold under cost, and advises fixing the price', () {
    final db = seedDb();
    db.execute('UPDATE product_units SET harga_jual = 200000 WHERE id = 102');
    jual(db, [const CartItemInput(productId: 2, qty: 2)]);

    final penjelasan = rekap(db)['penjelasanLaba'] as Map;
    final baris = (penjelasan['barisRugi'] as List).single as Map;
    final saran = (penjelasan['saran'] as List).cast<Map>();

    expect(baris['laba'], -1000);
    expect(baris['satuan'], 'PCS');
    expect(penjelasan['totalRugi'], -1000);
    expect(saran.first['kode'], 'harga_di_bawah_modal');
    expect(saran.first['status'], 'aktif');
    expect(saran.map((s) => s['kode']), contains('katalog_di_bawah_margin'));
  });

  test('costs a DUS at its own cost and breaks profit down per satuan', () {
    final db = seedDb();
    jual(db, [const CartItemInput(productId: 2, productUnitId: 9, qty: 1), const CartItemInput(productId: 2, qty: 2)]);

    final perSatuan = (rekap(db)['labaPerSatuan'] as List).cast<Map>();

    expect(perSatuan.first, {'satuan': 'DUS', 'qtyTerjual': 1, 'omzet': 110000, 'laba': 10000, 'marginPersen': 10000 / 110000 * 100});
    expect(perSatuan.last['satuan'], 'PCS');
  });

  test('adds biaya lain-lain to laba as its own line', () {
    final db = seedDb();
    checkout(db, CheckoutInput(metodePembayaran: MetodePembayaran.tunai, namaPelanggan: null, dibayar: 100000000, userId: 1, items: [const CartItemInput(productId: 2, qty: 1)], biayaLain: 500000, tanggal: '${hari}T09:00'));

    final result = rekap(db);

    expect((result['summary'] as Map)['labaKotor'], 500 + 5000);
    expect((result['labaPerKategori'] as List).cast<Map>().map((r) => r['categoryName']), contains('Lain-lain'));
  });

  test('groups outstanding bon by customer', () {
    final db = seedDb();
    jual(db, [const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon);
    jual(db, [const CartItemInput(productId: 2, qty: 1)], metode: MetodePembayaran.bon);

    expect((rekap(db)['piutangPerPelanggan'] as List).single, {'customerId': 1, 'namaPelanggan': 'Bu Siti', 'telepon': null, 'totalPiutang': 12000, 'jumlahBon': 2});
  });

  test('values stock at stok x harga pokok, active products with stock only', () {
    final db = seedDb();
    db.execute('UPDATE products SET is_active = 0 WHERE id = 1');

    expect(getStockValue(db), {
      'totalNilai': 250000,
      'produk': [
        {'namaItem': 'Mie Instan', 'kodeItem': 'MIE1', 'satuan': 'PCS', 'stok': 100, 'hargaPokok': 2500, 'nilai': 250000},
      ],
    });
  });

  test('the dashboard shows today, low stock and the latest sales', () {
    final db = seedDb();
    jual(db, [const CartItemInput(productId: 1, qty: 6)], tanggal: '${tanggalLokal(DateTime.now())}T08:00');

    final dashboard = getDashboard(db);

    expect((dashboard['summary'] as Map)['jumlahTransaksi'], 1);
    expect((dashboard['stokMenipis'] as List).single, {'id': 1, 'kodeItem': 'BRS5', 'namaItem': 'Beras 5kg', 'satuan': 'PCS', 'stok': 4});
    expect(((dashboard['transaksiTerbaru'] as List).single as Map)['itemSummary'], 'Beras 5kg x6');
  });
}
