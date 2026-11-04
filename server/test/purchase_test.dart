import 'package:pos_server/src/core/errors.dart';
import 'package:pos_server/src/db/db.dart';
import 'package:pos_server/src/domain/purchase.dart';
import 'package:test/test.dart';

Matcher throwsBusiness(String message) =>
    throwsA(isA<BusinessException>().having((e) => e.message, 'message', contains(message)));

/// The desktop app's purchase fixture: Kopi (PCS base, RENTENG of 12) and Gula (KG).
Db seedDb() {
  final db = Db.open(':memory:');
  final now = nowSeconds();

  db.insert("INSERT INTO users (id, username, password_hash, name, role, created_at, updated_at) VALUES (1, 'admin', 'hash', 'Admin', 'admin', ?, ?)", [now, now]);
  db.insert("INSERT INTO suppliers (id, nama, created_at, updated_at) VALUES (1, 'CV Sumber Makmur', ?, ?)", [now, now]);
  db.insert(
    "INSERT INTO products (id, kode_item, nama_item, harga_pokok, harga_jual, stok, created_at, updated_at) VALUES "
    "(1, 'KOPI1', 'Kopi Kapal Api', 150000, 200000, 10, ?, ?), (2, 'GULA1', 'Gula Pasir', 1200000, 1400000, 5, ?, ?)",
    [now, now, now, now],
  );
  db.insert(
    "INSERT INTO units (id, code, name, symbol, created_at, updated_at) VALUES (1, 'PCS', 'Pieces', 'pcs', ?, ?), (2, 'KG', 'Kilogram', 'kg', ?, ?), (3, 'Renteng', 'Renteng', 'rtg', ?, ?)",
    [now, now, now, now, now, now],
  );
  db.insert(
    'INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, created_at, updated_at) VALUES '
    '(101, 1, 1, 1, 1, 200000, 150000, 1, ?, ?), (102, 2, 2, 1, 1, 1400000, 1200000, 1, ?, ?), (1, 1, 3, 12, 12, 1800000, 1800000, 0, ?, ?)',
    [now, now, now, now, now, now],
  );

  return db;
}

PurchaseItemInput item({int productId = 1, int? productUnitId, num qty = 10, int hargaBeli = 140000}) =>
    PurchaseItemInput(productId: productId, productUnitId: productUnitId, qty: qty, hargaBeli: hargaBeli);

int buy(Db db, List<PurchaseItemInput> items, {String tanggal = '2026-08-08', int? dibayar, int? supplierId = 1}) =>
    recordPurchase(db, PurchaseInput(supplierId: supplierId, tanggal: tanggal, catatan: null, items: items, userId: 1, dibayar: dibayar));

Row product(Db db, int id) => db.first('SELECT * FROM products WHERE id = ?', [id])!;

Map<int, int> costByKonversi(Db db, int productId) => {
      for (final row in db.select('SELECT conversion_factor, harga_pokok FROM product_units WHERE product_id = ?', [productId]))
        row['conversion_factor'] as int: row['harga_pokok'] as int,
    };

void main() {
  group('moving average cost', () {
    test('averages a base-unit purchase', () {
      final db = seedDb();
      buy(db, [item()]);

      expect(product(db, 1)['harga_pokok'], 145000);
      expect(product(db, 1)['stok'], 20);
    });

    test('averages per base unit on a derived-unit purchase', () {
      final db = seedDb();
      // 2 renteng = 24 pcs for 1.900.000, on 10 pcs worth 1.500.000 => 3.400.000 / 34
      buy(db, [item(productUnitId: 1, qty: 2, hargaBeli: 950000)]);

      expect(product(db, 1)['harga_pokok'], 100000);
      expect(product(db, 1)['stok'], 34);
    });

    test('compounds several lines for the same product', () {
      final db = seedDb();
      buy(db, [item(), item(productUnitId: 1, qty: 1, hargaBeli: 1300000)]);

      expect(product(db, 1)['harga_pokok'], 131250);
      expect(product(db, 1)['stok'], 32);
    });

    test('takes the purchase cost outright when there was no stock', () {
      final db = seedDb();
      db.execute('UPDATE products SET stok = 0 WHERE id = 2');
      buy(db, [item(productId: 2, hargaBeli: 1100000)]);

      expect(product(db, 2)['harga_pokok'], 1100000);
    });

    test('logs a price history only when the cost moved', () {
      final db = seedDb();
      buy(db, [item(hargaBeli: 150000)]);
      expect(db.scalar<int>('SELECT count(*) FROM product_price_histories'), 0);

      buy(db, [item()]);
      final history = db.first('SELECT * FROM product_price_histories')!;
      expect(history['user_id'], 1);
      expect(history['harga_jual_lama'], 200000);
      expect(history['harga_jual_baru'], 200000);
    });

    test('moves the purchased unit and every smaller one, never larger units or siblings', () {
      final db = seedDb();
      buy(db, [item(productUnitId: 1, qty: 5, hargaBeli: 2500000)]);
      expect(costByKonversi(db, 1), {1: 200000, 12: 2400000});

      final db2 = seedDb();
      buy(db2, [item(productUnitId: 101, hargaBeli: 250000)]);
      expect(costByKonversi(db2, 1), {1: 200000, 12: 1800000});

      final db3 = seedDb();
      final now = nowSeconds();
      db3.insert("INSERT INTO units (id, code, name, symbol, created_at, updated_at) VALUES (4, 'SAK', 'Sak', 'sak', ?, ?)", [now, now]);
      db3.insert(
        'INSERT INTO product_units (id, product_id, unit_id, jumlah_kemasan, conversion_factor, harga_jual, harga_pokok, is_base_unit, created_at, updated_at) '
        'VALUES (2, 1, 4, 25, 25, 4000000, 3750000, 0, ?, ?)',
        [now, now],
      );
      buy(db3, [item(productUnitId: 2, qty: 5, hargaBeli: 3000000)]);
      final after = costByKonversi(db3, 1);
      expect(after[12], 1800000);
      expect(after[25], isNot(3750000));
      expect(after[1], isNot(150000));
    });

    test('balik is the inverse of hitung and never goes negative', () {
      final baru = hitungHargaPokokSatuan(10, 150000, 1, 10, 1400000);

      expect(balikHargaPokokSatuan(20, baru, 1, 10, 1400000), 150000);
      expect(balikHargaPokokSatuan(10, 145000, 1, 10, 1400000), 145000);
      expect(balikHargaPokokSatuan(20, 10000, 1, 10, 1400000), 0);
    });
  });

  group('recordPurchase', () {
    test('records a stock movement per line in the resolved unit', () {
      final db = seedDb();
      final purchaseId = buy(db, [item(productUnitId: 1, qty: 2, hargaBeli: 950000)]);
      final movement = db.first('SELECT * FROM stock_movements WHERE reference_id = ?', [purchaseId])!;

      expect(movement['movement_type'], 'purchase');
      expect(movement['product_unit_id'], 1);
      expect(movement['base_quantity'], 24);
    });

    test('rejects bad input', () {
      final db = seedDb();

      expect(() => buy(db, [], tanggal: '2026-08-08'), throwsBusiness('Item pembelian tidak boleh kosong.'));
      expect(() => buy(db, [item()], tanggal: ' '), throwsBusiness('Tanggal wajib diisi.'));
      expect(() => buy(db, [item(qty: 0)]), throwsBusiness('Qty harus lebih dari 0.'));
      expect(() => buy(db, [item(hargaBeli: -1)]), throwsBusiness('Harga beli tidak boleh negatif.'));
      expect(() => buy(db, [item(productId: 99)]), throwsBusiness('Produk tidak ditemukan.'));
      expect(() => buy(db, [item(productUnitId: 102)]), throwsBusiness('Satuan tidak valid untuk Kopi Kapal Api.'));
      expect(() => buy(db, [item()], dibayar: 1400001), throwsBusiness('Dibayar tidak boleh melebihi total pembelian.'));
      expect(() => buy(db, [item()], dibayar: -1), throwsBusiness('Dibayar tidak boleh negatif.'));
      expect(product(db, 1)['stok'], 10);
    });

    test('accepts a fractional qty', () {
      final db = seedDb();
      buy(db, [item(productId: 2, qty: 5.5, hargaBeli: 1100000)]);

      expect(product(db, 2)['stok'], 10.5);
    });
  });

  group('deletePurchase and updatePurchase', () {
    test('delete takes goods, value, lines and instalments back out', () {
      final db = seedDb();
      final purchaseId = buy(db, [item()], dibayar: 0);
      recordSupplierPayment(db, supplierId: 1, jumlah: 400000, tanggal: '2026-08-09');

      deletePurchase(db, purchaseId);

      expect(product(db, 1)['stok'], 10);
      expect(product(db, 1)['harga_pokok'], 150000);
      expect(db.scalar<int>('SELECT count(*) FROM purchase_payments'), 0);
      expect(db.scalar<num>('SELECT sum(base_quantity) FROM stock_movements WHERE reference_id = ?', [purchaseId]), 0);
      expect(() => deletePurchase(db, 99), throwsBusiness('Pembelian tidak ditemukan.'));
    });

    test('delete gives the cost back to every satuan it moved', () {
      final db = seedDb();
      final purchaseId = buy(db, [item(productUnitId: 1, qty: 2, hargaBeli: 1500000)]);

      deletePurchase(db, purchaseId);

      expect((costByKonversi(db, 1)[12]! - 1800000).abs(), lessThanOrEqualTo(1));
      expect(costByKonversi(db, 1)[1], 150000);
    });

    test('update replaces the lines and counts the goods once', () {
      final db = seedDb();
      final purchaseId = buy(db, [item()]);

      final total = updatePurchase(
        db,
        purchaseId,
        PurchaseInput(supplierId: 1, tanggal: '2026-08-09', catatan: 'salah qty', items: [item(qty: 4)], userId: 1),
      );

      expect(total, 560000);
      expect(product(db, 1)['stok'], 14);
      expect(product(db, 1)['harga_pokok'], hitungHargaPokokRataRata(10, 150000, 4, 560000));
      expect(db.first('SELECT * FROM purchases WHERE id = ?', [purchaseId])!['catatan'], 'salah qty');
    });

    test('update keeps instalments and refuses a total below them', () {
      final db = seedDb();
      final purchaseId = buy(db, [item()], dibayar: 0);
      recordSupplierPayment(db, supplierId: 1, jumlah: 600000, tanggal: '2026-08-09');

      updatePurchase(db, purchaseId, PurchaseInput(supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [item(qty: 8)], userId: 1, dibayar: 100000));
      expect(db.first('SELECT dibayar FROM purchases WHERE id = ?', [purchaseId])!['dibayar'], 700000);
      expect(getPurchaseDetail(db, purchaseId)['cicilan'], 6000);
      expect(getPurchaseDetail(db, purchaseId)['uangMuka'], 1000);

      expect(
        () => updatePurchase(db, purchaseId, PurchaseInput(supplierId: 1, tanggal: '2026-08-08', catatan: null, items: [item(qty: 1)], userId: 1)),
        throwsBusiness('Total pembelian tidak boleh lebih kecil dari cicilan yang sudah dibayar.'),
      );
    });
  });

  group('supplier debt', () {
    test('a purchase with no dibayar is settled; a short one leaves debt', () {
      final db = seedDb();
      buy(db, [item()]);
      final hutang = buy(db, [item()], dibayar: 400000);

      expect(listSupplierDebts(db), [
        {'purchaseId': hutang, 'supplierId': 1, 'supplierName': 'CV Sumber Makmur', 'tanggal': '2026-08-08', 'total': 14000, 'dibayar': 4000, 'sisa': 10000},
      ]);
    });

    test('splits a lump payment across invoices, oldest first', () {
      final db = seedDb();
      final lama = buy(db, [item()], tanggal: '2026-08-01', dibayar: 0);
      final baru = buy(db, [item()], tanggal: '2026-08-05', dibayar: 0);

      final alokasi = recordSupplierPayment(db, supplierId: 1, jumlah: 2000000, tanggal: '2026-08-10', keterangan: 'byr');

      expect(alokasi, [(purchaseId: lama, jumlah: 1400000), (purchaseId: baru, jumlah: 600000)]);
      expect(listSupplierDebts(db).single['sisa'], 8000);
    });

    test('rejects an overpayment, a non-positive amount and an unknown supplier', () {
      final db = seedDb();
      buy(db, [item()], dibayar: 400000);

      expect(() => recordSupplierPayment(db, supplierId: 1, jumlah: 1000001, tanggal: '2026-08-10'), throwsBusiness('Jumlah bayar melebihi sisa hutang supplier.'));
      expect(() => recordSupplierPayment(db, supplierId: 1, jumlah: 0, tanggal: '2026-08-10'), throwsBusiness('Jumlah bayar harus lebih dari 0.'));
      expect(() => recordSupplierPayment(db, supplierId: 99, jumlah: 100, tanggal: '2026-08-10'), throwsBusiness('Supplier tidak ditemukan.'));
    });

    test('corrects and deletes an instalment, moving the invoice by the difference', () {
      final db = seedDb();
      final purchaseId = buy(db, [item()], dibayar: 0);
      recordSupplierPayment(db, supplierId: 1, jumlah: 400000, tanggal: '2026-08-09', keterangan: 'salah');
      final paymentId = listSupplierPayments(db, 1).single['id'] as int;

      updateSupplierPayment(db, paymentId, jumlah: 500000, tanggal: '2026-08-10', keterangan: ' benar ');
      expect(listSupplierPayments(db, 1).single, {'id': paymentId, 'purchaseId': purchaseId, 'jumlah': 5000, 'tanggal': '2026-08-10', 'keterangan': 'benar'});
      expect(() => updateSupplierPayment(db, paymentId, jumlah: 1400001, tanggal: '2026-08-10'), throwsBusiness('Jumlah bayar melebihi sisa hutang faktur.'));

      deleteSupplierPayment(db, paymentId);
      expect(listSupplierDebts(db).single['sisa'], 14000);
      expect(() => deleteSupplierPayment(db, paymentId), throwsBusiness('Pembayaran tidak ditemukan.'));
    });

    test('sets an invoice\'s remaining debt directly, keeping instalments', () {
      final db = seedDb();
      final purchaseId = buy(db, [item()], dibayar: 0);
      recordSupplierPayment(db, supplierId: 1, jumlah: 400000, tanggal: '2026-08-09');

      updatePurchaseSisaHutang(db, purchaseId, 250000);
      expect(listSupplierDebts(db).single['sisa'], 2500);
      expect(getPurchaseDetail(db, purchaseId)['uangMuka'], 7500);

      expect(() => updatePurchaseSisaHutang(db, purchaseId, 1000001), throwsBusiness('Sisa hutang tidak boleh melebihi'));
      expect(() => updatePurchaseSisaHutang(db, purchaseId, -1), throwsBusiness('Sisa hutang tidak boleh negatif.'));

      updatePurchaseSisaHutang(db, purchaseId, 0);
      expect(listSupplierDebts(db), isEmpty);
    });
  });

  group('reads', () {
    test('lists purchases with their debt and a grand total', () {
      final db = seedDb();
      buy(db, [item()], dibayar: 400000);
      final list = listPurchases(db);
      final row = (list['data'] as List).single as Map;

      expect(row['sisa'], 10000);
      expect(row['itemSummary'], 'Kopi Kapal Api x10');
      expect(list['totalKeseluruhan'], 14000);
    });

    test('finds a product by exact barcode only', () {
      final db = seedDb();
      db.execute("UPDATE products SET barcode = '8991002101234' WHERE id = 1");

      expect(findProductForPurchaseByBarcode(db, '8991002101234')!['satuan'], 'PCS');
      expect(findProductForPurchaseByBarcode(db, '899100'), isNull);
      expect(findProductForPurchaseByBarcode(db, ''), isNull);
      expect((searchProductsForPurchase(db, 'kopi').single['units'] as List).single['satuan'], 'Renteng');
    });
  });
}
