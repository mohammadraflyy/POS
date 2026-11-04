import 'dart:convert';

import 'package:excel/excel.dart';
import 'package:pos_server/pos_server.dart';
import 'package:pos_server/src/domain/auth.dart';
import 'package:pos_server/src/domain/device_tokens.dart';
import 'package:pos_server/src/printing/printer.dart';
import 'package:pos_server/src/printing/receipts.dart';
import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

import 'support/fixtures.dart';

class FakePrinter implements RawPrinter {
  final jobs = <({String? printer, List<int> bytes})>[];
  bool fail = false;

  @override
  Future<List<PrinterInfo>> listPrinters() async => [const PrinterInfo(name: 'POS-58', isDefault: true)];

  @override
  Future<void> printRaw(String? printerName, List<int> bytes) async {
    if (fail) {
      throw StateError('kertas habis');
    }

    jobs.add((printer: printerName, bytes: bytes));
  }
}

class Api {
  Api() {
    db = seedDb();
    db.execute("UPDATE users SET password_hash = ? WHERE id = 1", [hashPassword('rahasia')]);
    db.insert("INSERT INTO users (id, username, password_hash, name, role, created_at, updated_at) VALUES (2, 'owner', ?, 'Pemilik', 'admin', 0, 0)", [hashPassword('admin123')]);
    ctx = ApiContext(db: db, pairing: PairingCodes(), receipts: ReceiptService(db, printer), serverAddress: () => '192.168.1.5', port: 48950);
    handler = buildHandler(ctx);
    kasirToken = issueDeviceToken(db, userId: 1, namaPerangkat: 'HP Kasir').token;
    adminToken = issueDeviceToken(db, userId: 2, namaPerangkat: 'HP Owner').token;
  }

  late final Db db;
  late final ApiContext ctx;
  late final Handler handler;
  late final String kasirToken;
  late final String adminToken;
  final printer = FakePrinter();

  Future<({int status, dynamic body, Response raw})> call(String method, String path, {Object? body, String? token, Map<String, String> headers = const {}}) async {
    final response = await handler(Request(
      method,
      Uri.parse('http://localhost$path'),
      headers: {if (token != null) 'authorization': 'Bearer $token', ...headers},
      body: body is List<int> ? body : (body == null ? null : jsonEncode(body)),
    ));
    final type = response.headers['content-type'] ?? '';

    return (status: response.statusCode, body: type.startsWith('application/json') ? jsonDecode(await response.readAsString()) : null, raw: response);
  }

  Future<dynamic> kasir(String method, String path, [Object? body]) async {
    final result = await call(method, path, body: body, token: kasirToken);
    expect(result.status, 200, reason: '$method $path -> ${result.body}');

    return result.body;
  }

  Future<dynamic> admin(String method, String path, [Object? body]) async {
    final result = await call(method, path, body: body, token: adminToken);
    expect(result.status, 200, reason: '$method $path -> ${result.body}');

    return result.body;
  }
}

void main() {
  group('foundation', () {
    test('health answers without a token and carries the version', () async {
      final api = Api();

      expect((await api.call('GET', '/v1/health')).body, {'ok': true, 'appVersion': appVersion});
    });

    test('pairs a phone with a one-time code and its own account', () async {
      final api = Api();
      final code = api.ctx.pairing.generate().code;

      final wrong = await api.call('POST', '/v1/pair', body: {'pairingCode': code, 'username': 'kasir1', 'password': 'salah', 'deviceName': 'HP'});
      expect(wrong.status, 401);

      // a wrong password burns the code, so the phone has to scan a fresh one
      final reused = await api.call('POST', '/v1/pair', body: {'pairingCode': code, 'username': 'kasir1', 'password': 'rahasia'});
      expect(reused.status, 401);

      final fresh = api.ctx.pairing.generate().code;
      final paired = await api.call('POST', '/v1/pair', body: {'pairingCode': fresh, 'username': 'kasir1', 'password': 'rahasia', 'deviceName': 'HP Baru'});

      expect(paired.status, 200);
      expect(paired.body['user'], {'id': 1, 'username': 'kasir1', 'name': 'Kasir Satu', 'role': 'kasir'});
      expect((await api.call('GET', '/v1/me', token: paired.body['token'] as String)).body['user']['name'], 'Kasir Satu');
    });

    test('a missing, unknown or revoked token is a 401; a kasir on an admin route a 403', () async {
      final api = Api();

      expect((await api.call('GET', '/v1/me')).status, 401);
      expect((await api.call('GET', '/v1/me', token: 'nope')).status, 401);
      expect((await api.call('GET', '/v1/users', token: api.kasirToken)).status, 403);

      await api.kasir('POST', '/v1/auth/logout');
      expect((await api.call('GET', '/v1/me', token: api.kasirToken)).status, 401);
    });

    test('logs in with username and password, and rejects a bad one', () async {
      final api = Api();

      expect((await api.call('POST', '/v1/auth/login', body: {'username': 'owner', 'password': 'salah'})).status, 401);

      final login = await api.call('POST', '/v1/auth/login', body: {'username': 'owner', 'password': 'admin123', 'deviceName': 'PC Kasir'});
      expect(login.body['user']['role'], 'admin');
      expect((await api.call('GET', '/v1/users', token: login.body['token'] as String)).status, 200);
    });

    test('an unknown route is a JSON 404 and a bad body a JSON 400', () async {
      final api = Api();
      final missing = await api.call('GET', '/v1/tidak-ada', token: api.kasirToken);

      expect(missing.status, 404);
      expect(missing.body['error'], isA<String>());

      final bad = await api.call('POST', '/v1/carts/price', token: api.kasirToken, body: utf8.encode('{rusak'));
      expect(bad.status, 400);
    });

    test('admin makes a pairing code with the QR address and manages devices', () async {
      final api = Api();
      final pairing = await api.admin('POST', '/v1/devices/pairing-code');

      expect(pairing['serverAddress'], '192.168.1.5:48950');
      expect(pairing['code'], matches(RegExp(r'^\d{6}$')));

      final devices = (await api.admin('GET', '/v1/devices'))['data'] as List;
      expect(devices.map((d) => d['namaPerangkat']), containsAll(['HP Kasir', 'HP Owner']));

      await api.admin('DELETE', '/v1/devices/${devices.first['id']}');
      expect((await api.call('GET', '/v1/me', token: api.kasirToken)).status, 401);
    });
  });

  group('penjualan over HTTP', () {
    test('prices a cart, checks out, prints, lists and reprints', () async {
      final api = Api();
      final catalog = await api.kasir('GET', '/v1/catalog/search?q=beras');
      expect(catalog['data'].single['namaItem'], 'Beras 5kg');

      final price = await api.kasir('POST', '/v1/carts/price', {
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 5},
          {'productId': 2, 'productUnitId': 9, 'qty': 3},
        ],
        'diskonNota': 1000,
      });
      expect(price['lines'][0]['hargaJual'], 62000);
      expect(price['lines'][1]['stokCukup'], isFalse);
      expect(price['total'], 5 * 62000 + 3 * 110000 - 1000);

      final sale = await api.kasir('POST', '/v1/sales', {
        'metodePembayaran': 'tunai',
        'namaPelanggan': null,
        'dibayar': 400000,
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 5},
        ],
      });
      expect(sale, {'saleId': 1, 'total': 310000, 'printed': true, 'printSkipped': false});
      expect(api.printer.jobs, hasLength(1));
      expect(latin1.decode(api.printer.jobs.single.bytes), contains('TOTAL'));

      final history = await api.kasir('GET', '/v1/sales?page=1&status=selesai');
      expect(history['data'].single['items'], [
        {'namaItem': 'Beras 5kg', 'qty': 5},
      ]);

      final detail = await api.kasir('GET', '/v1/sales/1');
      expect(detail['dibayar'], 400000);

      expect(await api.kasir('POST', '/v1/sales/1/print'), {'printed': true});
      expect(api.printer.jobs, hasLength(2));
    });

    test('skips the receipt when the cashier chose not to print', () async {
      final api = Api();
      final sale = await api.kasir('POST', '/v1/sales', {
        'metodePembayaran': 'qris',
        'cetak': false,
        'items': [
          {'productId': 2, 'productUnitId': null, 'qty': 1},
        ],
      });

      expect(sale, {'saleId': 1, 'total': 3000, 'printed': false, 'printSkipped': true});
      expect(api.printer.jobs, isEmpty);
    });

    test('a failed print never fails the sale', () async {
      final api = Api()..printer.fail = true;
      final sale = await api.kasir('POST', '/v1/sales', {
        'metodePembayaran': 'qris',
        'namaPelanggan': null,
        'dibayar': null,
        'items': [
          {'productId': 2, 'productUnitId': null, 'qty': 1},
        ],
      });

      expect(sale['printed'], isFalse);
      expect(sale['printError'], contains('kertas habis'));
      expect(api.db.scalar<int>('SELECT count(*) FROM sales'), 1);
    });

    test('a business rejection is a 400 carrying the cashier\'s message', () async {
      final api = Api();
      final result = await api.call('POST', '/v1/sales', token: api.kasirToken, body: {
        'metodePembayaran': 'tunai',
        'dibayar': 100,
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 1},
        ],
      });

      expect(result.status, 400);
      expect(result.body, {'error': 'Uang bayar kurang dari total belanja.'});
    });

    test('bon payments, added items and the admin-only edit, cancel and delete', () async {
      final api = Api();
      await api.kasir('POST', '/v1/sales', {
        'metodePembayaran': 'bon',
        'namaPelanggan': 'Bu Rina',
        'dibayar': 1000,
        'items': [
          {'productId': 2, 'productUnitId': null, 'qty': 3},
        ],
      });

      await api.kasir('POST', '/v1/sales/1/bon-payments', {'jumlah': 2000, 'keterangan': 'cicilan'});
      expect((await api.kasir('POST', '/v1/sales/1/items', {
        'items': [
          {'productId': 2, 'productUnitId': null, 'qty': 1},
        ],
      }))['total'], 12000);
      expect((await api.kasir('GET', '/v1/customers'))['names'], ['Bu Rina']);

      expect((await api.call('PUT', '/v1/sales/1', token: api.kasirToken, body: {})).status, 403);

      final edit = await api.admin('GET', '/v1/sales/1/edit');
      expect(edit['items'], hasLength(2));

      await api.admin('PUT', '/v1/sales/1', {
        'metodePembayaran': 'bon',
        'namaPelanggan': 'Bu Rina',
        'dibayar': 3000,
        'tanggal': '2026-10-14T09:00',
        'keterangan': 'gabung baris',
        'items': [
          {'productId': 2, 'productUnitId': null, 'qty': 4},
        ],
      });
      expect((await api.kasir('GET', '/v1/sales/1'))['edits'].single['keterangan'], 'gabung baris');

      expect((await api.call('POST', '/v1/sales/1/cancel', token: api.adminToken)).body, {'error': 'Tidak bisa membatalkan, bon sudah ada pembayaran.'});
      await api.admin('DELETE', '/v1/sales/1');
      expect(stokOf(api.db, 2), 100);
    });
  });

  group('pembelian, supplier and opname over HTTP', () {
    test('records a purchase on credit and pays the supplier', () async {
      final api = Api();
      final supplier = await api.kasir('POST', '/v1/suppliers', {'nama': 'Toko Grosir', 'telepon': null, 'alamat': null, 'keterangan': null});

      expect((await api.kasir('GET', '/v1/suppliers?q=grosir'))['data'].single['nama'], 'Toko Grosir');
      expect((await api.kasir('GET', '/v1/purchases/products?q=mie'))['data'].single['units'].single['satuan'], 'DUS');

      final purchase = await api.kasir('POST', '/v1/purchases', {
        'supplierId': supplier['id'],
        'tanggal': '2026-10-14',
        'catatan': null,
        'dibayar': 0,
        'items': [
          {'productId': 2, 'productUnitId': 9, 'qty': 1, 'hargaBeli': 100000},
        ],
      });
      expect(purchase, {'purchaseId': 1});
      expect(stokOf(api.db, 2), 140);

      final debts = await api.kasir('GET', '/v1/supplier-debts?supplierId=${supplier['id']}');
      expect(debts['data'].single['sisa'], 100000);

      final paid = await api.kasir('POST', '/v1/supplier-payments', {'supplierId': supplier['id'], 'jumlah': 40000, 'tanggal': '2026-10-15', 'keterangan': null});
      expect(paid['alokasi'], [
        {'purchaseId': 1, 'jumlah': 40000},
      ]);

      final payments = await api.kasir('GET', '/v1/supplier-payments?supplierId=${supplier['id']}');
      await api.kasir('PUT', '/v1/supplier-payments/${payments['data'].single['id']}', {'jumlah': 50000, 'tanggal': '2026-10-15', 'keterangan': 'koreksi'});
      await api.kasir('PUT', '/v1/purchases/1/sisa-hutang', {'sisa': 10000});
      expect((await api.kasir('GET', '/v1/purchases/1'))['uangMuka'], 40000);
    });

    test('restates the selling price when a purchase line carries hargaJual', () async {
      final api = Api();

      expect((await api.kasir('GET', '/v1/purchases/products?q=beras'))['data'].single, containsPair('hargaJual', 65000));
      expect((await api.kasir('GET', '/v1/purchases/products?q=mie'))['data'].single['units'].single['hargaJual'], 110000);

      await api.kasir('POST', '/v1/purchases', {
        'supplierId': null,
        'tanggal': '2026-09-15',
        'catatan': null,
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 10, 'hargaBeli': 62000, 'hargaJual': 70000},
          {'productId': 2, 'productUnitId': 9, 'qty': 1, 'hargaBeli': 100000, 'hargaJual': 120000},
        ],
      });

      expect(api.db.first('SELECT harga_jual, harga_pokok FROM products WHERE id = 1'), {'harga_jual': 7000000, 'harga_pokok': 6100000});
      expect(api.db.scalar<int>('SELECT harga_jual FROM product_units WHERE id = 101'), 7000000);
      expect(
        api.db.first('SELECT harga_jual_lama, harga_jual_baru FROM product_price_histories WHERE product_id = 1 ORDER BY id DESC LIMIT 1'),
        {'harga_jual_lama': 6500000, 'harga_jual_baru': 7000000},
      );
      // a derived unit carries its own price; the product's base price is left alone
      expect(api.db.scalar<int>('SELECT harga_jual FROM product_units WHERE id = 9'), 12000000);
      expect(api.db.scalar<int>('SELECT harga_jual FROM products WHERE id = 2'), 300000);
    });

    test('leaves the selling price alone when hargaJual is omitted', () async {
      final api = Api();

      await api.kasir('POST', '/v1/purchases', {
        'supplierId': null,
        'tanggal': '2026-09-15',
        'catatan': null,
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 1, 'hargaBeli': 60000},
        ],
      });

      expect(api.db.scalar<int>('SELECT harga_jual FROM products WHERE id = 1'), 6500000);
    });

    test('a negative hargaJual on a purchase line is rejected', () async {
      final api = Api();
      final result = await api.call('POST', '/v1/purchases', token: api.kasirToken, body: {
        'supplierId': null,
        'tanggal': '2026-09-15',
        'catatan': null,
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 1, 'hargaBeli': 60000, 'hargaJual': -1},
        ],
      });

      expect(result.status, 400);
      expect(result.body['error'], contains('Harga jual tidak boleh negatif'));
    });

    test('a barcode nobody carries is a 404', () async {
      final api = Api();

      expect((await api.call('GET', '/v1/purchases/products/barcode/000', token: api.kasirToken)).status, 404);
    });

    test('counts stock and refuses a save the shelf has moved past', () async {
      final api = Api();
      final products = await api.kasir('GET', '/v1/opname/products?q=beras');
      final revision = products['data'].single['stockRevision'];

      await api.kasir('POST', '/v1/opname/adjustments', {'productId': 1, 'stokSesudah': 7.5, 'alasan': 'opname', 'expectedRevision': revision});
      expect(stokOf(api.db, 1), 7.5);

      final stale = await api.call('POST', '/v1/opname/adjustments', token: api.kasirToken, body: {'productId': 1, 'stokSesudah': 8, 'expectedRevision': revision});
      expect(stale.status, 400);

      final ledger = await api.kasir('GET', '/v1/stock-movements?q=beras');
      expect(ledger['data'].single['stockBefore'], 10);
      expect(ledger['data'].single['stockAfter'], 7.5);
    });
  });

  group('katalog, imports and reports over HTTP', () {
    test('imports products from an uploaded CSV, admin only', () async {
      final api = Api();
      const csv = 'Kode Item,Nama Item,Satuan,Harga Beli,Harga Jual,Stok,Jenis\nKOPI1,Kopi Bubuk,PCS,"1,500",2000,12,Minuman\n';

      expect((await api.call('POST', '/v1/products/import/products?fileName=x.csv', token: api.kasirToken, body: utf8.encode(csv))).status, 403);

      final result = await api.call('POST', '/v1/products/import/products?fileName=produk.csv', token: api.adminToken, body: utf8.encode(csv));
      expect(result.body, {'created': 1, 'updated': 0, 'unchanged': 0, 'skipped': 0});

      final product = (await api.kasir('GET', '/v1/products?search=kopi'))['data'].single;
      expect(product['hargaPokok'], 1500);
      expect(product['categoryName'], 'Minuman');
      expect(product['stok'], 12);
    });

    test('refuses the old .xls format with a clear message', () async {
      final api = Api();
      final result = await api.call('POST', '/v1/products/import/barcode?fileName=lama.xls', token: api.adminToken, body: [1, 2, 3]);

      expect(result.status, 400);
      expect(result.body['error'], contains('.xlsx'));
    });

    test('edits a product, adds a unit and a tier, and reads the detail back', () async {
      final api = Api();

      await api.admin('PUT', '/v1/products/1', {
        'kodeItem': 'BRS5',
        'barcode': '899',
        'namaItem': 'Beras Premium 5kg',
        'kategori': 'Sembako',
        'satuan': 'SAK',
        'hargaPokok': 61000,
        'hargaJual': 66000,
        'isActive': true,
      });
      final unit = await api.admin('POST', '/v1/products/1/units', {'unitId': 2, 'jumlahKemasan': 10, 'hargaJual': 640000});
      await api.admin('POST', '/v1/products/1/tiers', {'productUnitId': unit['id'], 'minQty': 2, 'maxQty': null, 'hargaJual': 630000});

      final detail = await api.kasir('GET', '/v1/products/1');
      expect(detail['namaItem'], 'Beras Premium 5kg');
      expect((detail['units'] as List).map((u) => u['satuan']), ['SAK', 'DUS']);
      expect(detail['priceTiers'], hasLength(2));
      expect((await api.kasir('GET', '/v1/products/barcode/899'))['id'], 1);
    });

    test('exports the rekap as a real xlsx workbook', () async {
      final api = Api();
      await api.kasir('POST', '/v1/sales', {
        'metodePembayaran': 'tunai',
        'dibayar': 65000,
        'tanggal': '2026-10-14T10:00',
        'items': [
          {'productId': 1, 'productUnitId': null, 'qty': 1},
        ],
      });

      expect((await api.call('GET', '/v1/rekap?from=2026-10-14&to=2026-10-14', token: api.kasirToken)).status, 403);
      expect((await api.admin('GET', '/v1/rekap?from=2026-10-14&to=2026-10-14'))['summary']['omzetTunai'], 65000);

      final export = await api.call('GET', '/v1/rekap/export?from=2026-10-14&to=2026-10-14', token: api.adminToken);
      final bytes = await export.raw.read().expand((chunk) => chunk).toList();
      final workbook = Excel.decodeBytes(bytes);

      expect(workbook.tables.keys, containsAll(['Riwayat Transaksi', 'Laba per Kategori', 'Nilai Stock']));
    });

    test('records, edits and exports cash expenses', () async {
      final api = Api();
      final created = await api.kasir('POST', '/v1/expenses', {'tanggal': '2026-10-14', 'kategori': 'DPAM', 'jumlah': 75000, 'keterangan': null});

      expect((await api.call('PUT', '/v1/expenses/${created['expenseId']}', token: api.kasirToken, body: {})).status, 403);
      await api.admin('PUT', '/v1/expenses/${created['expenseId']}', {'tanggal': '2026-10-14', 'kategori': 'DPAM', 'jumlah': 80000});
      expect((await api.kasir('GET', '/v1/expenses?from=2026-10-01&to=2026-10-31'))['totalJumlah'], 80000);

      final export = await api.call('GET', '/v1/expenses/export', token: api.adminToken);
      expect(export.raw.headers['content-type'], contains('spreadsheetml'));
    });

    test('settings round-trip and the printer list', () async {
      final api = Api();

      await api.admin('PUT', '/v1/settings', {'namaToko': 'Toko Maju', 'receiptWidth': '80mm', 'printerName': 'POS-58', 'marginMinimalPersen': 15});
      expect(await api.kasir('GET', '/v1/settings'), {
        'namaToko': 'Toko Maju',
        'alamat': null,
        'telepon': null,
        'pesanFooter': null,
        'printerName': 'POS-58',
        'receiptWidth': '80mm',
        'marginMinimalPersen': 15,
      });
      expect((await api.kasir('GET', '/v1/printers'))['data'].single['name'], 'POS-58');

      await api.kasir('POST', '/v1/printers/test');
      expect(api.printer.jobs.single.printer, 'POS-58');
    });

    test('previews and applies a price raise, admin only', () async {
      final api = Api();
      api.db.execute('UPDATE product_units SET harga_jual = 240000 WHERE id = 102');

      final plan = await api.admin('POST', '/v1/products/efisiensi-harga/preview', {'cakupan': 'rugi', 'metode': 'margin_minimal'});
      expect(plan['baris'].single['hargaBaru'], 2800);

      final applied = await api.admin('POST', '/v1/products/efisiensi-harga/apply', {
        'filter': {'cakupan': 'rugi', 'metode': 'margin_minimal'},
        'pilihan': null,
      });
      expect(applied, {'satuanDiubah': 1, 'tierDiubah': 0, 'dilewati': 0});
      expect(api.db.scalar<int>('SELECT harga_jual FROM products WHERE id = 2'), 280000);
    });
  });
}
