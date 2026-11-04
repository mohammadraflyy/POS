import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/domain/kasir.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

Matcher throwsBusiness(String message) =>
    throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains(message)));

CheckoutInput tunai(List<CartItemInput> items, {int? dibayar, int? diskon, int? biayaLain, String? keterangan, String? tanggal}) =>
    CheckoutInput(
      metodePembayaran: MetodePembayaran.tunai,
      namaPelanggan: null,
      dibayar: dibayar ?? 100000000,
      userId: 1,
      items: items,
      diskon: diskon,
      biayaLain: biayaLain,
      keterangan: keterangan,
      tanggal: tanggal,
    );

CheckoutInput bon(List<CartItemInput> items, {String? nama = 'Bu Siti', int? dibayar}) => CheckoutInput(
      metodePembayaran: MetodePembayaran.bon,
      namaPelanggan: nama,
      dibayar: dibayar,
      userId: 1,
      items: items,
    );

const beras1 = CartItemInput(productId: 1, qty: 1);
const mie1 = CartItemInput(productId: 2, qty: 1);

int bonSale(Db db, {int qty = 3}) => checkout(db, bon([CartItemInput(productId: 2, qty: qty)])).saleId;

UpdateSaleInput edit(List<CartItemInput> items,
        {MetodePembayaran metode = MetodePembayaran.tunai, String? nama, int? dibayar, String tanggal = '2026-07-04T14:05', String? keterangan, int? biayaLain}) =>
    UpdateSaleInput(
      metodePembayaran: metode,
      namaPelanggan: nama,
      dibayar: dibayar ?? 100000000,
      tanggal: tanggal,
      userId: 1,
      items: items,
      keterangan: keterangan,
      biayaLain: biayaLain,
    );

void main() {
  group('findTierForQty', () {
    test('takes the highest satisfied minQty when open-ended tiers overlap', () {
      const tiers = [PriceTier(minQty: 10, maxQty: null, hargaJual: 900), PriceTier(minQty: 50, maxQty: null, hargaJual: 800)];

      expect(findTierForQty(tiers, 9), isNull);
      expect(findTierForQty(tiers, 10)!.hargaJual, 900);
      expect(findTierForQty(tiers, 60)!.hargaJual, 800);
    });

    test('respects a closed range', () {
      const tiers = [PriceTier(minQty: 1, maxQty: 10, hargaJual: 900)];

      expect(findTierForQty(tiers, 11), isNull);
    });
  });

  group('checkout with discounts', () {
    test('takes a line discount off that line and off the sale total', () {
      final db = seedDb();
      final result = checkout(db, tunai([const CartItemInput(productId: 1, qty: 1, diskon: 500000)]));
      final item = saleItemRows(db, result.saleId).single;

      expect(item['diskon'], 500000);
      expect(item['harga_jual'], 6500000);
      expect(item['subtotal'], 6000000);
      expect(result.total, 6000000);
    });

    test('takes a bill-wide discount off the total and records it on the sale', () {
      final db = seedDb();
      final result = checkout(db, tunai([beras1], diskon: 1000000));

      expect(saleRow(db, result.saleId)['diskon'], 1000000);
      expect(saleRow(db, result.saleId)['total'], 5500000);
      expect(saleItemRows(db, result.saleId).single['subtotal'], 6500000);
    });

    test('measures the bill-wide discount after the line discounts', () {
      final db = seedDb();

      expect(
        () => checkout(db, tunai([const CartItemInput(productId: 1, qty: 1, diskon: 500000)], diskon: 6000100)),
        throwsBusiness('Diskon nota melebihi total belanja.'),
      );
    });

    test('refuses a line discount larger than the line', () {
      final db = seedDb();

      expect(() => checkout(db, tunai([const CartItemInput(productId: 1, qty: 1, diskon: 6500100)])), throwsBusiness('Diskon Beras 5kg melebihi harga barisnya.'));
    });
  });

  group('checkout', () {
    test('prices a base-unit tier, cuts stock and snapshots the line', () {
      final db = seedDb();
      final result = checkout(db, tunai([const CartItemInput(productId: 1, qty: 5)], dibayar: 31000000));
      final item = saleItemRows(db, result.saleId).single;

      expect(result.total, 5 * 6200000);
      expect(item['price_source'], 'price_tier');
      expect(item['base_quantity'], 5);
      expect(item['harga_pokok'], 6000000);
      expect(saleRow(db, result.saleId)['dibayar'], 31000000);
      expect(stokOf(db, 1), 5);
    });

    test('converts a derived-unit line into base stock and snapshots the unit cost', () {
      final db = seedDb();
      final result = checkout(db, tunai([const CartItemInput(productId: 2, productUnitId: 9, qty: 1)]));
      final item = saleItemRows(db, result.saleId).single;

      expect(stokOf(db, 2), 60);
      expect(item['konversi'], 40);
      expect(item['harga_pokok'], 10000000);
      expect(item['price_source'], 'normal');
    });

    test('records a signed sale movement in the sold unit and in base units', () {
      final db = seedDb();
      final result = checkout(db, tunai([const CartItemInput(productId: 2, productUnitId: 9, qty: 2)]));
      final movement = db.first('SELECT * FROM stock_movements WHERE reference_id = ?', [result.saleId])!;

      expect(movement['movement_type'], 'sale');
      expect(movement['quantity'], -2);
      expect(movement['base_quantity'], -80);
      expect(movement['conversion_factor'], 40);
    });

    test('prices a derived unit against its own tiers only', () {
      final db = seedDb();
      final now = nowSeconds();
      db.insert(
        'INSERT INTO product_price_tiers (product_id, product_unit_id, min_qty, harga_jual, created_at, updated_at) VALUES (2, 102, 2, 250000, ?, ?), (2, 9, 2, 10000000, ?, ?)',
        [now, now, now, now],
      );

      final result = checkout(db, tunai([const CartItemInput(productId: 2, productUnitId: 9, qty: 2)]));

      expect(saleItemRows(db, result.saleId).single['harga_jual'], 10000000);
      expect(result.total, 20000000);
    });

    test('settles qris and transfer in full with nothing tendered', () {
      final db = seedDb();

      for (final metode in [MetodePembayaran.qris, MetodePembayaran.transfer]) {
        final result = checkout(db, CheckoutInput(metodePembayaran: metode, namaPelanggan: null, dibayar: null, userId: 1, items: [beras1]));

        expect(saleRow(db, result.saleId)['dibayar'], result.total);
      }
    });

    test('creates a bon owing everything, or only the remainder of a partial payment', () {
      final db = seedDb();
      final unpaid = checkout(db, bon([const CartItemInput(productId: 2, qty: 3)]));
      final partial = checkout(db, bon([const CartItemInput(productId: 2, qty: 3)], dibayar: 400000));

      expect(saleRow(db, unpaid.saleId)['dibayar'], 0);
      expect(saleRow(db, unpaid.saleId)['nama_pelanggan'], 'Bu Siti');
      expect(saleRow(db, partial.saleId)['total'], 900000);
      expect(saleRow(db, partial.saleId)['dibayar'], 400000);
    });

    test('files a bon customer in the master once, case-insensitively', () {
      final db = seedDb();

      checkout(db, bon([mie1], nama: 'Bu Siti'));
      checkout(db, bon([mie1], nama: 'bu siti'));

      expect(db.scalar<int>('SELECT count(*) FROM customers'), 1);
    });

    test('refuses a bon without a real customer name', () {
      final db = seedDb();

      expect(() => checkout(db, bon([mie1], nama: '')), throwsBusiness('Nama pelanggan wajib diisi untuk transaksi bon.'));
      expect(() => checkout(db, bon([mie1], nama: '   ')), throwsBusiness('Nama pelanggan wajib diisi untuk transaksi bon.'));
    });

    test('refuses a negative payment', () {
      final db = seedDb();

      expect(() => checkout(db, bon([mie1], dibayar: -1)), throwsBusiness('Jumlah bayar tidak boleh negatif.'));
    });

    test('rolls everything back when stock is short', () {
      final db = seedDb();

      expect(() => checkout(db, tunai([const CartItemInput(productId: 1, qty: 11)])), throwsBusiness('Stok Beras 5kg tidak cukup.'));
      expect(stokOf(db, 1), 10);
      expect(db.scalar<int>('SELECT count(*) FROM sales'), 0);
    });

    test('rolls everything back when the cash does not cover the total', () {
      final db = seedDb();

      expect(() => checkout(db, tunai([beras1], dibayar: 100)), throwsBusiness('Uang bayar kurang dari total belanja.'));
      expect(stokOf(db, 1), 10);
      expect(db.scalar<int>('SELECT count(*) FROM sales'), 0);
      expect(db.scalar<int>('SELECT count(*) FROM stock_movements'), 0);
    });

    test('checks stock across two lines of the same product', () {
      final db = seedDb();

      expect(
        () => checkout(db, tunai([const CartItemInput(productId: 2, qty: 61), const CartItemInput(productId: 2, productUnitId: 9, qty: 1)])),
        throwsBusiness('Stok Mie Instan tidak cukup.'),
      );
      expect(stokOf(db, 2), 100);
    });

    test('rejects bad carts', () {
      final db = seedDb();

      expect(() => checkout(db, tunai([])), throwsBusiness('Keranjang tidak boleh kosong.'));
      expect(() => checkout(db, tunai([const CartItemInput(productId: 1, qty: 0)])), throwsBusiness('Qty harus lebih dari 0.'));
      expect(() => checkout(db, tunai([const CartItemInput(productId: 1, qty: -1)])), throwsBusiness('Qty harus lebih dari 0.'));
      expect(() => checkout(db, tunai([const CartItemInput(productId: 99, qty: 1)])), throwsBusiness('Produk tidak ditemukan.'));
      expect(() => checkout(db, tunai([const CartItemInput(productId: 1, productUnitId: 9, qty: 1)])), throwsBusiness('Satuan tidak valid untuk Beras 5kg.'));
    });

    test('allows a fractional qty and rounds the subtotal to the cent', () {
      final db = seedDb();
      final result = checkout(db, tunai([const CartItemInput(productId: 1, qty: 0.25)]));
      final item = saleItemRows(db, result.saleId).single;

      expect(item['qty'], 0.25);
      expect(item['subtotal'], (0.25 * 6500000).round());
      expect(stokOf(db, 1), 9.75);
    });

    test('files the sale under the given date, past or future', () {
      final db = seedDb();
      final past = checkout(db, tunai([mie1], tanggal: '2026-07-04T14:05'));
      final future = checkout(db, tunai([mie1], tanggal: '2099-01-01T08:00'));

      expect(saleRow(db, past.saleId)['created_at'], toEpochSeconds(DateTime(2026, 7, 4, 14, 5)));
      expect(saleItemRows(db, past.saleId).single['created_at'], toEpochSeconds(DateTime(2026, 7, 4, 14, 5)));
      expect(saleRow(db, future.saleId)['created_at'], toEpochSeconds(DateTime(2099)) + 8 * 3600);
      expect(() => checkout(db, tunai([mie1], tanggal: 'kemarin')), throwsBusiness('Tanggal transaksi tidak valid.'));
    });

    test('stores the note trimmed, and a blank one as null', () {
      final db = seedDb();
      final withNote = checkout(db, tunai([mie1], keterangan: '  pesanan antar  '));
      final blank = checkout(db, tunai([mie1], keterangan: '   '));

      expect(saleRow(db, withNote.saleId)['keterangan'], 'pesanan antar');
      expect(saleRow(db, blank.saleId)['keterangan'], isNull);
    });

    test('adds biaya lain-lain to the total and rejects a negative one', () {
      final db = seedDb();
      final result = checkout(db, tunai([mie1], biayaLain: 500000));

      expect(result.total, 800000);
      expect(saleRow(db, result.saleId)['biaya_lain'], 500000);
      expect(() => checkout(db, tunai([mie1], biayaLain: -1)), throwsBusiness('Biaya lain-lain'));
    });
  });

  group('getSaleDetail and listSalesHistory', () {
    test('cost the sale at the cost its lines were sold at, negative margins included', () {
      final db = seedDb();
      final normal = checkout(db, tunai([beras1]));
      // 4 x 3.000 less 1.200 off the line and 1.000 off the bill = 9.800, against 10.000 of cost
      final rugi = checkout(db, tunai([const CartItemInput(productId: 2, qty: 4, diskon: 120000)], diskon: 100000));

      expect(getSaleDetail(db, normal.saleId)['modal'], 60000);
      expect(getSaleDetail(db, normal.saleId)['laba'], 5000);
      expect(getSaleDetail(db, rugi.saleId)['laba'], -200);

      final history = listSalesHistory(db);
      final labaById = {for (final row in history['data'] as List) (row as Map)['id']: row['laba']};

      expect(labaById[normal.saleId], 5000);
      expect(labaById[rugi.saleId], -200);
    });

    test('filters the history by customer or product name', () {
      final db = seedDb();
      checkout(db, bon([mie1], nama: 'Warung Bu Rina'));
      checkout(db, tunai([beras1]));

      expect((listSalesHistory(db, search: 'Rina')['data'] as List), hasLength(1));
      expect((listSalesHistory(db, search: 'Beras')['data'] as List), hasLength(1));
      expect((listSalesHistory(db, metodePembayaran: 'bon')['data'] as List), hasLength(1));
      expect(listSalesHistory(db, search: 'tidak ada')['total'], 0);
    });
  });

  group('cancelSale', () {
    test('restores stock, logs the reversal and marks the sale', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([const CartItemInput(productId: 2, productUnitId: 9, qty: 1)])).saleId;

      cancelSale(db, saleId);

      expect(stokOf(db, 2), 100);
      expect(saleRow(db, saleId)['status'], 'dibatalkan');
      expect(db.scalar<num>('SELECT sum(base_quantity) FROM stock_movements WHERE product_id = 2'), 0);
      expect(() => cancelSale(db, saleId), throwsBusiness('Transaksi sudah dibatalkan.'));
    });

    test('refuses a bon that already has payments, and an unknown sale', () {
      final db = seedDb();
      final saleId = bonSale(db);
      recordBonPayment(db, saleId, 100000, null);

      expect(() => cancelSale(db, saleId), throwsBusiness('Tidak bisa membatalkan, bon sudah ada pembayaran.'));
      expect(() => cancelSale(db, 999), throwsBusiness('Transaksi tidak ditemukan.'));
    });
  });

  group('deleteSale', () {
    test('gives the stock back and removes the sale with its items', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([const CartItemInput(productId: 1, qty: 2)])).saleId;

      deleteSale(db, saleId);

      expect(stokOf(db, 1), 10);
      expect(db.scalar<int>('SELECT count(*) FROM sale_items'), 0);
    });

    test('does not restore stock twice for a cancelled sale', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([const CartItemInput(productId: 1, qty: 2)])).saleId;

      cancelSale(db, saleId);
      deleteSale(db, saleId);

      expect(stokOf(db, 1), 10);
    });

    test('deletes a paid bon along with its payments', () {
      final db = seedDb();
      final saleId = bonSale(db);
      recordBonPayment(db, saleId, 100000, null);

      deleteSale(db, saleId);

      expect(db.scalar<int>('SELECT count(*) FROM bon_payments'), 0);
      expect(stokOf(db, 2), 100);
    });
  });

  group('recordBonPayment', () {
    test('records a payment dated today and raises dibayar', () {
      final db = seedDb();
      final saleId = bonSale(db);

      recordBonPayment(db, saleId, 400000, ' cicilan ');
      recordBonPayment(db, saleId, 500000, null);

      final payments = db.select('SELECT * FROM bon_payments ORDER BY id');
      final today = DateTime.now();

      expect(saleRow(db, saleId)['dibayar'], 900000);
      expect(payments.first['keterangan'], 'cicilan');
      expect(payments.first['tanggal'], '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}');
    });

    test('refuses what is not an active bon, or not a sensible amount', () {
      final db = seedDb();
      final saleId = bonSale(db);
      final cash = checkout(db, tunai([mie1])).saleId;

      expect(() => recordBonPayment(db, 999, 100, null), throwsBusiness('Transaksi tidak ditemukan.'));
      expect(() => recordBonPayment(db, cash, 100, null), throwsBusiness('Transaksi ini bukan bon aktif.'));
      expect(() => recordBonPayment(db, saleId, 0, null), throwsBusiness('Jumlah bayar harus lebih dari 0.'));
      expect(() => recordBonPayment(db, saleId, 900001, null), throwsBusiness('Jumlah bayar melebihi sisa piutang.'));
      expect(() => recordBonPayment(db, saleId, 100, 'x' * 501), throwsBusiness('Keterangan maksimal 500 karakter.'));
      expect(saleRow(db, saleId)['dibayar'], 0);

      cancelSale(db, saleId);
      expect(() => recordBonPayment(db, saleId, 100, null), throwsBusiness('Transaksi ini bukan bon aktif.'));
    });
  });

  group('addItemsToSale', () {
    test('appends the line, raises the total and cuts stock, keeping the sale date', () {
      final db = seedDb();
      final saleId = checkout(db, bon([mie1])).saleId;
      final createdAt = saleRow(db, saleId)['created_at'];

      final total = addItemsToSale(db, saleId, [const CartItemInput(productId: 2, productUnitId: 9, qty: 1)]);

      expect(total, 300000 + 11000000);
      expect(stokOf(db, 2), 59);
      expect(saleItemRows(db, saleId).last['harga_pokok'], 10000000);
      expect(saleRow(db, saleId)['created_at'], createdAt);
    });

    test('refuses anything but an unpaid bon', () {
      final db = seedDb();
      final cash = checkout(db, tunai([mie1])).saleId;
      final paid = checkout(db, bon([mie1], dibayar: 300000)).saleId;
      final saleId = bonSale(db);

      expect(() => addItemsToSale(db, cash, [mie1]), throwsBusiness('Hanya transaksi bon yang bisa ditambah item.'));
      expect(() => addItemsToSale(db, paid, [mie1]), throwsBusiness('Bon sudah lunas, tidak bisa ditambah item.'));
      expect(() => addItemsToSale(db, 999, [mie1]), throwsBusiness('Transaksi tidak ditemukan.'));
      expect(() => addItemsToSale(db, saleId, []), throwsBusiness('Tidak ada item yang ditambahkan.'));
      expect(() => addItemsToSale(db, saleId, [const CartItemInput(productId: 1, qty: 11)]), throwsBusiness('Stok Beras 5kg tidak cukup.'));

      cancelSale(db, saleId);
      expect(() => addItemsToSale(db, saleId, [mie1]), throwsBusiness('Transaksi yang dibatalkan tidak bisa ditambah item.'));
    });
  });

  group('updateSale', () {
    test('leaves stock untouched when nothing changed, and returns removed lines', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([const CartItemInput(productId: 1, qty: 2), mie1])).saleId;

      updateSale(db, saleId, edit([const CartItemInput(productId: 1, qty: 2), mie1]));
      expect(stokOf(db, 1), 8);
      expect(stokOf(db, 2), 99);

      updateSale(db, saleId, edit([const CartItemInput(productId: 1, qty: 2)]));
      expect(stokOf(db, 2), 100);
    });

    test('lets the qty rise past current stock because the old lines go back first', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([const CartItemInput(productId: 1, qty: 8)])).saleId;

      updateSale(db, saleId, edit([const CartItemInput(productId: 1, qty: 10)]));
      expect(stokOf(db, 1), 0);
      expect(() => updateSale(db, saleId, edit([const CartItemInput(productId: 1, qty: 11)])), throwsBusiness('Stok Beras 5kg tidak cukup.'));
      expect(stokOf(db, 1), 0);
    });

    test('moves the sale and its lines to the new date', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;

      updateSale(db, saleId, edit([mie1], tanggal: '2099-01-01T00:00'));

      expect(saleRow(db, saleId)['created_at'], toEpochSeconds(DateTime(2099)));
    });

    test('keeps the original cost of a line already on the sale, and prices a new line today', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;
      db.execute('UPDATE product_units SET harga_pokok = 280000 WHERE id = 102');
      db.execute('UPDATE product_units SET harga_pokok = 6100000 WHERE id = 101');

      updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 2), beras1]));
      final items = saleItemRows(db, saleId);

      expect(items.firstWhere((i) => i['product_id'] == 2)['harga_pokok'], 250000);
      expect(items.firstWhere((i) => i['product_id'] == 1)['harga_pokok'], 6100000);
    });

    test('charges a manual price as such, but never below cost', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;

      updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 1, hargaJual: 280000)]));
      expect(saleItemRows(db, saleId).single['price_source'], 'manual');
      expect(
        () => updateSale(db, saleId, edit([const CartItemInput(productId: 1, qty: 1, hargaJual: 100)])),
        throwsBusiness('Harga Beras 5kg di bawah harga pokok satuan PCS.'),
      );
    });

    test('guards bon payments already recorded and the cash tendered', () {
      final db = seedDb();
      final saleId = bonSale(db);
      recordBonPayment(db, saleId, 400000, null);

      expect(
        () => updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon, nama: 'Bu Siti', dibayar: 300000)),
        throwsBusiness('Dibayar tidak boleh kurang dari pembayaran yang sudah tercatat.'),
      );
      expect(
        () => updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon, nama: '')),
        throwsBusiness('Nama pelanggan wajib diisi untuk transaksi bon.'),
      );
      expect(() => updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 3)], dibayar: 1)), throwsBusiness('Uang bayar kurang dari total belanja.'));

      updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 3)], metode: MetodePembayaran.bon, nama: 'Bu Siti', dibayar: 400000));
      expect(saleRow(db, saleId)['dibayar'], 400000);
    });

    test('forces dibayar to the total for qris', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;

      updateSale(db, saleId, edit([mie1], metode: MetodePembayaran.qris, dibayar: 1));
      expect(saleRow(db, saleId)['dibayar'], 300000);
    });

    test('refuses a cancelled or unknown sale and an empty cart', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;

      expect(() => updateSale(db, saleId, edit([])), throwsBusiness('Keranjang tidak boleh kosong.'));
      expect(() => updateSale(db, 999, edit([mie1])), throwsBusiness('Transaksi tidak ditemukan.'));

      cancelSale(db, saleId);
      expect(() => updateSale(db, saleId, edit([mie1])), throwsBusiness('Transaksi yang dibatalkan tidak bisa diubah.'));
      expect(stokOf(db, 2), 100);
    });

    test('keeps the movement ledger summing to products.stok', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([const CartItemInput(productId: 2, productUnitId: 9, qty: 1)])).saleId;

      updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 7)]));

      expect(100 + db.scalar<num>('SELECT sum(base_quantity) FROM stock_movements WHERE product_id = 2')!, stokOf(db, 2));
    });

    test('logs every save with both totals, and the note as its reason', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;

      updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 2)], keterangan: ' salah qty '));
      updateSale(db, saleId, edit([const CartItemInput(productId: 2, qty: 3)]));

      final edits = db.select('SELECT * FROM sale_edits ORDER BY id');

      expect(edits, hasLength(2));
      expect(edits.first['keterangan'], 'salah qty');
      expect(edits.first['total_sebelum'], 300000);
      expect(edits.first['total_sesudah'], 600000);
      expect(edits.last['keterangan'], '');
      expect(saleRow(db, saleId)['keterangan'], isNull);
    });

    test('writes no log row when the rewrite fails', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1])).saleId;

      expect(() => updateSale(db, saleId, edit([const CartItemInput(productId: 1, qty: 99)])), throwsBusiness('tidak cukup'));
      expect(db.scalar<int>('SELECT count(*) FROM sale_edits'), 0);
      expect(saleItemRows(db, saleId), hasLength(1));
    });

    test('keeps biaya lain-lain when omitted', () {
      final db = seedDb();
      final saleId = checkout(db, tunai([mie1], biayaLain: 500000)).saleId;

      updateSale(db, saleId, edit([mie1]));
      expect(saleRow(db, saleId)['total'], 800000);

      updateSale(db, saleId, edit([mie1], biayaLain: 0));
      expect(saleRow(db, saleId)['total'], 300000);
    });
  });

  group('previewCart', () {
    test('prices without touching stock and flags a shortage as data', () {
      final db = seedDb();
      final preview = previewCart(db, [const CartItemInput(productId: 1, qty: 5), const CartItemInput(productId: 2, qty: 120)]);
      final lines = (preview['lines'] as List).cast<Map<String, Object?>>();

      expect(lines.first['hargaJual'], 62000);
      expect(lines.first['stokCukup'], isTrue);
      expect(lines.last['stokCukup'], isFalse);
      expect(preview['total'], 5 * 62000 + 120 * 3000);
      expect(stokOf(db, 1), 10);
    });

    test('flags only the line that pushes a combined total over stock', () {
      final db = seedDb();
      final preview = previewCart(db, [const CartItemInput(productId: 2, qty: 70), const CartItemInput(productId: 2, productUnitId: 9, qty: 1)]);
      final lines = (preview['lines'] as List).cast<Map<String, Object?>>();

      expect(lines.map((l) => l['stokCukup']), [true, false]);
    });

    test('still rejects bad input', () {
      final db = seedDb();

      expect(() => previewCart(db, []), throwsBusiness('Keranjang tidak boleh kosong.'));
      expect(() => previewCart(db, [mie1], diskonNota: 300001), throwsBusiness('Diskon nota melebihi total belanja.'));
    });
  });

  group('purge', () {
    test('purgeTodaySales removes today\'s sales but skips a bon with payments', () {
      final db = seedDb();
      checkout(db, tunai([const CartItemInput(productId: 1, qty: 2)]));
      final paidBon = bonSale(db);
      recordBonPayment(db, paidBon, 100, null);

      expect(purgeTodaySales(db), {'deleted': 1, 'skipped': 1});
      expect(stokOf(db, 1), 10);
    });

    test('purgeSalesBefore refuses a future cutoff', () {
      final db = seedDb();

      expect(() => purgeSalesBefore(db, DateTime(2099)), throwsBusiness('Tanggal tidak boleh di masa depan.'));
    });
  });

  group('searchCatalogForSale', () {
    test('lists active products with derived units and tiers', () {
      final db = seedDb();
      final result = searchCatalogForSale(db, q: 'mie');
      final item = (result['data'] as List).single as Map;

      expect(item['satuan'], 'PCS');
      expect(item['baseProductUnitId'], 102);
      expect(item['hargaJual'], 3000);
      expect((item['productUnits'] as List).single, {'id': 9, 'satuan': 'DUS', 'konversi': 40, 'hargaJual': 110000, 'hargaPokok': 100000});
    });
  });
}
