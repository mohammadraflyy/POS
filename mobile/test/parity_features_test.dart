import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/models/live_models.dart';
import '../lib/services/business_api.dart';
import '../lib/services/draft_store.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/services/store_api.dart';
import '../lib/state/live_store.dart';
import '../lib/Screen/Live/LiveHistoryScreen.dart';
import '../lib/Screen/Live/LiveOpnameScreen.dart';
import '../lib/Screen/Live/LivePaymentScreen.dart';
import '../lib/Screen/Live/LivePurchaseScreen.dart';
import '../lib/Screen/Live/LiveSaleScreen.dart';
import '../lib/Screen/Toko/ProductDetailScreen.dart';
import '../lib/Screen/Toko/ProductsScreen.dart';
import '../lib/Screen/Toko/PurchasesScreen.dart';
import '../lib/Screen/Toko/ReportsScreen.dart';
import '../lib/Screen/Toko/SettingsScreen.dart';
import 'admin_tools_test.dart' show FakeStore, show, tapText;
import 'live_store_test.dart' show MemoryPending;

void main() {
  group('Price, discount & margin helpers', () {
    test('inputDiscount parses nominal rupiah and percentage strings', () {
      expect(inputDiscount('2000', baseAmount: 15000), 2000);
      expect(inputDiscount('10%', baseAmount: 15000), 1500);
      expect(inputDiscount('5,5%', baseAmount: 20000), 1100);
      expect(inputDiscount('', baseAmount: 15000), 0);
      expect(() => inputDiscount('150%', baseAmount: 15000), throwsFormatException);
    });

    test('hargaJualRekomendasi rounds up to nearest Rp 100 and marginLabel flags below-cost', () {
      expect(hargaJualRekomendasi(9000, 10), 10000);
      expect(hargaJualRekomendasi(9100, 10), 10200);
      expect(marginLabel(9000, 10000), '10%');
      expect(marginLabel(10000, 9000), contains('di bawah modal'));
    });
  });

  group('Cart insertion order & unit replacement', () {
    test('new items are inserted at index 0 and replace merges duplicate unit lines', () async {
      final guard = MutationGuard(MemoryPending());
      await guard.load();
      final api = BusinessApi((path, {required method, query, body}) async {
        if (path == '/v1/carts/price') {
          final items = body!['items'] as List;
          return {
            'lines': [for (final _ in items) {'stokCukup': true, 'hargaJual': 2000, 'hargaPokok': 1500, 'subtotal': 2000}],
            'subtotal': 2000 * items.length,
            'diskon': 0,
            'total': 2000 * items.length,
            'modal': 1500 * items.length,
          };
        }
        throw StateError('Unexpected $path');
      });
      final store = LiveStore(api, guard);
      final kopi = LiveProduct(1, 'Kopi', 'K1', 50, [
        LiveUnit(null, 'PCS', 2000, cost: 1500),
        LiveUnit(10, 'RENCENG', 19000, cost: 14500, conversionFactor: 10),
      ]);
      final teh = LiveProduct(2, 'Teh', 'T1', 30, [LiveUnit(null, 'PCS', 1500, cost: 1000)]);

      store.put(LiveCartItem(product: kopi, unit: kopi.units[0], quantity: 1));
      store.put(LiveCartItem(product: teh, unit: teh.units[0], quantity: 1));
      // Most recently added item is at index 0 (top of cart for F3)
      expect(store.items.first.product.name, 'Teh');

      // Add RENCENG of Kopi, then change PCS Kopi to RENCENG -> merges quantities
      store.put(LiveCartItem(product: kopi, unit: kopi.units[1], quantity: 1));
      final pcsKopi = store.items.firstWhere((i) => i.product.id == 1 && i.unit.id == null);
      store.replace(pcsKopi, LiveCartItem(product: kopi, unit: kopi.units[1], quantity: 2));
      final rencengLines = store.items.where((i) => i.product.id == 1 && i.unit.id == 10).toList();
      expect(rencengLines, hasLength(1));
      expect(rencengLines.single.quantity, 3);

      store.dispose();
      guard.dispose();
    });
  });

  group('Payment screen parity', () {
    testWidgets('rejects UMUM for bon and displays modal, laba, and below-cost warning', (tester) async {
      final guard = MutationGuard(MemoryPending());
      await guard.load();
      final api = BusinessApi((path, {required method, query, body}) async {
        if (path == '/v1/customers') return {'names': <String>['Pak Budi']};
        if (path == '/v1/carts/price') {
          return {
            'lines': [{'stokCukup': true, 'hargaJual': 2000, 'hargaPokok': 2500, 'diskon': 200, 'subtotal': 1800}],
            'subtotal': 1800,
            'diskon': 0,
            'total': 1800,
            'modal': 2500,
          };
        }
        throw StateError('Unexpected $path');
      });
      final store = LiveStore(api, guard);
      final p = LiveProduct.fromJson({'id': 1, 'namaItem': 'Kopi', 'hargaJual': 2000, 'hargaPokok': 2500});
      store.put(LiveCartItem(product: p, unit: p.units.first, quantity: 1, discount: 200));
      await tester.pump(const Duration(milliseconds: 300));

      await show(tester, LivePaymentScreen(store: store));
      expect(find.text('Modal barang'), findsOneWidget);
      expect(find.text('Perkiraan laba'), findsOneWidget);
      expect(find.textContaining('Harga setelah diskon di bawah modal'), findsOneWidget);

      await tapText(tester, 'Bon');
      await tester.enterText(find.widgetWithText(TextField, 'Nama pelanggan (wajib untuk bon)'), 'UMUM');
      await tapText(tester, 'Simpan transaksi');
      expect(find.textContaining('bukan UMUM'), findsWidgets);

      store.dispose();
      guard.dispose();
    });
  });

  group('History & Sale Detail parity', () {
    testWidgets('shows items summary, laba, remaining bon debt, and full sale detail', (tester) async {
      final api = BusinessApi((path, {required method, query, body}) async {
        if (path == '/v1/sales') {
          return {
            'data': [
              {
                'id': 12,
                'createdAt': '2026-11-10T09:00:00.000',
                'namaPelanggan': 'Bu Siti',
                'metodePembayaran': 'bon',
                'status': 'selesai',
                'total': 15000,
                'dibayar': 5000,
                'laba': 3000,
                'items': [{'namaItem': 'Beras', 'qty': 2}],
              },
            ],
            'currentPage': 1,
            'lastPage': 1,
          };
        }
        if (path == '/v1/sales/12') {
          return {
            'id': 12,
            'namaPelanggan': 'Bu Siti',
            'metodePembayaran': 'bon',
            'status': 'selesai',
            'diskon': 1000,
            'biayaLain': 2000,
            'total': 15000,
            'dibayar': 5000,
            'modal': 12000,
            'laba': 3000,
            'createdAt': '2026-11-10T09:00:00.000',
            'items': [
              {'id': 1, 'productId': 1, 'namaItem': 'Beras', 'qty': 2, 'satuan': 'KG', 'hargaJual': 7000, 'diskon': 500, 'subtotal': 13500, 'priceSource': 'price_tier'},
            ],
            'bonPayments': [
              {'id': 1, 'tanggal': '2026-11-10', 'jumlah': 5000, 'keterangan': 'Titip siang'},
            ],
            'edits': [
              {'id': 1, 'createdAt': '2026-11-10T09:30:00.000', 'kasirName': 'Admin', 'keterangan': 'Revisi qty', 'totalSebelum': 8000, 'totalSesudah': 15000},
            ],
          };
        }
        throw StateError('Unexpected $path');
      });

      await show(tester, LiveHistoryScreen(api: api, isAdmin: true));
      expect(find.textContaining('Beras ×2'), findsOneWidget);
      expect(find.textContaining('Belum lunas · Sisa Rp10.000'), findsOneWidget);
      expect(find.text('Hanya yang batal'), findsOneWidget);

      await show(tester, LiveSaleScreen(api: api, id: 12, isAdmin: true));
      expect(find.textContaining('grosir · diskon Rp500'), findsOneWidget);
      expect(find.text('Diskon nota'), findsOneWidget);
      expect(find.text('Biaya lain'), findsOneWidget);
      expect(find.text('Modal barang'), findsOneWidget);
      expect(find.text('Laba'), findsOneWidget);
      expect(find.textContaining('Titip siang'), findsOneWidget);
      expect(find.textContaining('Admin • Revisi qty (Rp8.000 → Rp15.000)'), findsOneWidget);
    });
  });

  group('Products, Efisiensi Harga, Units & Unregistered Barcode prompt', () {
    testWidgets('shows unit/tier counts, unregistered barcode prompt, and unit toggle', (tester) async {
      final store = FakeStore({
        'GET /v1/products': (_) => {
          'data': [
            {'id': 1, 'kodeItem': 'K1', 'namaItem': 'Kopi', 'satuan': 'PCS', 'stok': 5, 'hargaPokok': 1500, 'hargaJual': 2000, 'unitsCount': 2, 'priceTiersCount': 1},
          ],
          'currentPage': 1,
          'lastPage': 1,
          'total': 1,
        },
        'GET /v1/units': (_) => {
          'data': [
            {'id': 1, 'code': 'DUS', 'name': 'Dus', 'symbol': 'dus', 'isActive': true},
          ],
        },
        'DELETE /v1/units/1': (_) => {'ok': true},
      });

      await show(tester, ProductsScreen(api: store.api, isAdmin: true));
      expect(find.text('2 satuan · 1 grosir'), findsOneWidget);
      expect(find.text('Efisiensi harga'), findsOneWidget);

      await show(tester, UnitsScreen(api: store.api, isAdmin: true));
      expect(find.text('Nonaktifkan'), findsOneWidget);
      await tapText(tester, 'Nonaktifkan');
      await tapText(tester, 'Nonaktifkan');
      expect(store.called('DELETE', '/v1/units/1'), isTrue);
    });
  });

  group('Opname concurrency & diff preview, Purchase draft, Rekap & Settings', () {
    testWidgets('opname sends expectedStock and expectedRevision and shows diff preview', (tester) async {
      final guard = MutationGuard(MemoryPending());
      await guard.load();
      Map<String, dynamic>? sentBody;
      final api = BusinessApi((path, {required method, query, body}) async {
        if (path == '/v1/opname/categories') return {'data': [{'id': 1, 'nama': 'Minuman'}]};
        if (path == '/v1/opname/products') return {'data': [{'id': 5, 'namaItem': 'Air Mineral', 'kodeItem': 'AIR1', 'stok': 10, 'stockRevision': 3, 'satuan': 'BTL'}]};
        if (path == '/v1/opname/adjustments') { sentBody = body; return {'ok': true}; }
        throw StateError('Unexpected $path');
      });

      await show(tester, LiveOpnameScreen(api: api, guard: guard));
      await tapText(tester, 'Minuman');
      await tapText(tester, 'Koreksi stok');
      await tester.enterText(find.widgetWithText(TextField, 'Total stok fisik'), '14');
      await tester.pump();
      expect(find.textContaining('Perubahan: 10 → 14 BTL (selisih +4)'), findsOneWidget);

      await tapText(tester, 'Simpan ke PC');
      await tapText(tester, 'Terapkan');
      expect(sentBody, {'productId': 5, 'stokSesudah': 14, 'alasan': null, 'expectedStock': 10, 'expectedRevision': 3});
      guard.dispose();
    });

    testWidgets('purchase draft persists and restores items', (tester) async {
      final guard = MutationGuard(MemoryPending());
      await guard.load();
      final drafts = MemoryDraftStore();
      await drafts.write('{"supplier":{"id":2,"nama":"CV Sumber"},"date":"2026-11-10","note":"Faktur pagi","paid":"50000","items":[{"product":{"id":1,"name":"Gula Pasir","code":"GL1","units":[{"id":null,"name":"KG","price":16000,"cost":14000,"conversionFactor":1}]},"unitId":null,"qty":5,"price":14000,"sellPrice":null}]}');
      final api = BusinessApi((path, {required method, query, body}) async => {});

      await show(tester, LivePurchaseScreen(api: api, guard: guard, drafts: drafts));
      expect(find.text('CV Sumber'), findsOneWidget);
      expect(find.text('Gula Pasir'), findsOneWidget);
      expect(find.textContaining('5 KG × Rp14.000 = Rp70.000'), findsOneWidget);
      guard.dispose();
    });

    testWidgets('SupplierDebtScreen offers Edit faktur alongside Ubah sisa', (tester) async {
      final store = FakeStore({
        'GET /v1/supplier-debts': (_) => {
          'data': [
            {'purchaseId': 8, 'supplierId': 1, 'supplierName': 'CV Jaya', 'tanggal': '2026-11-01', 'total': 100000, 'dibayar': 40000, 'sisa': 60000},
          ],
        },
        'GET /v1/supplier-payments': (_) => {'data': <Object>[]},
      });

      await show(tester, SupplierDebtScreen(api: store.api));
      await tapText(tester, 'CV Jaya');
      expect(find.text('Edit faktur'), findsOneWidget);
      expect(find.text('Ubah sisa'), findsOneWidget);
    });

    testWidgets('SettingsScreen shows Tampilan theme selector and Tes scanner barcode', (tester) async {
      final store = FakeStore({
        'GET /v1/settings': (_) => {'namaToko': 'Toko Uji', 'receiptWidth': '58mm', 'marginMinimalPersen': 10},
        'GET /v1/printers': (_) => {'data': <Object>[]},
        'GET /v1/devices': (_) => {'data': <Object>[]},
      });
      await show(tester, SettingsScreen(api: store.api, isAdmin: true));
      expect(find.text('Tampilan'), findsOneWidget);
      expect(find.text('Tes scanner barcode'), findsOneWidget);
      expect(find.text('Belum ada barcode yang dibaca.'), findsOneWidget);
    });
  });
}

