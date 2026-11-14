import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/models/live_models.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import 'live_store_test.dart' show MemoryPending;

void main() {
  testWidgets('bon item auto-splits on price change with clear explanatory badges', (tester) async {
    // the wide till, whose search box adds by exact code
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    tester.view.physicalSize = const Size(1400, 900); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/carts/price') {
        final items = (body!['items'] as List).cast<Map<String, dynamic>>();
        var subtotal = 0;
        final lines = <Map<String, dynamic>>[];
        for (final item in items) {
          final qty = item['qty'] as num;
          final price = (item['hargaJual'] as num?) ?? 16000;
          final lineSubtotal = (qty * price).round();
          subtotal += lineSubtotal;
          lines.add({
            'productId': item['productId'],
            'productUnitId': item['productUnitId'],
            'qty': qty,
            'hargaJual': price,
            'subtotal': lineSubtotal,
            'stokCukup': true,
          });
        }
        return {
          'lines': lines,
          'subtotal': subtotal,
          'diskon': 0,
          'total': subtotal,
          'stockEnough': true,
        };
      }
      if (path == '/v1/catalog/search') {
        return {
          'items': [
            {
              'id': 10,
              'namaItem': 'Susu Kaleng',
              'kodeItem': 'SUSU01',
              'barcode': '123456',
              'stok': 50,
              'satuan': 'Kaleng',
              'hargaJual': 16000,
              'hargaPokok': 12000,
            }
          ],
          'currentPage': 1,
          'lastPage': 1,
          'total': 1,
        };
      }
      if (path == '/v1/customers') {
        return ['Budi', 'Andi'];
      }
      return {};
    });

    final store = LiveStore(api, guard);

    final unit = LiveUnit(null, 'Kaleng', 16000); // Katalog saat ini Rp16.000
    final product = LiveProduct(10, 'Susu Kaleng', 'SUSU01', 50, [unit]);

    // 1. Simulasikan buka nota bon lama yang tersimpan di mana harga Susu Kaleng masih Rp14.000
    final histLine = LiveCartItem(
      product: product,
      unit: unit,
      quantity: 2,
      manualPrice: 14000,
      priceNote: 'Harga riwayat nota (Rp14.000)',
    );

    store.startEdit(
      saleId: 88,
      lines: [histLine],
      date: DateTime.now(),
      method: 'bon',
      customer: 'Pak Joko (Bon)',
      paid: 0,
      charge: 0,
      text: '',
      billDiscount: 0,
    );

    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(),
      home: Scaffold(
        body: LiveKasirScreen(store: store),
      ),
    ));
    await tester.pumpAndSettle();

    Future<void> addSusu() async {
      final search = find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText != '1');
      await tester.tap(search);
      await tester.enterText(search, 'SUSU01');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
    }

    // Pastikan baris riwayat nota ditampilkan dengan badge riwayat
    expect(find.text('Harga riwayat nota (Rp14.000)'), findsOneWidget);
    expect(store.items.length, 1);
    expect(store.items.first.manualPrice, 14000);
    expect(store.items.first.quantity, 2);

    // 2. Kasir menambahkan Susu Kaleng yang di katalog saat ini harganya Rp16.000
    await addSusu();

    // Sistem secara otomatis memisahkan menjadi 2 baris terpisah!
    expect(store.items.length, 2);

    // Baris lama tetap memiliki harga riwayat lama Rp14.000
    final oldLine = store.items.firstWhere((i) => i.manualPrice == 14000);
    expect(oldLine.quantity, 2);
    expect(oldLine.priceNote, 'Harga riwayat nota (Rp14.000)');

    // Baris baru memiliki harga katalog saat ini Rp16.000 dengan badge keterangan yang jelas
    final newLine = store.items.firstWhere((i) => i.manualPrice == 16000);
    expect(newLine.quantity, 1);
    expect(newLine.priceNote, contains('Tambahan baru · harga katalog'));
    expect(newLine.priceNote, contains('16.000'));

    // Di UI cart panel, kedua badge keterangan tampil
    expect(find.text('Harga riwayat nota (Rp14.000)'), findsOneWidget);
    expect(find.textContaining('Tambahan baru · harga katalog'), findsOneWidget);

    // Tutup dialog informasi pemisahan harga
    await tester.tap(find.text('Mengerti'));
    await tester.pumpAndSettle();

    // 3. Kasir menambahkan Susu Kaleng lagi
    await addSusu();

    // Qty baris tambahan baru bertambah jadi 2, baris lama tetap 2
    final updatedNewLine = store.items.firstWhere((i) => i.manualPrice == 16000);
    expect(updatedNewLine.quantity, 2);
    final unchangedOldLine = store.items.firstWhere((i) => i.manualPrice == 14000);
    expect(unchangedOldLine.quantity, 2);

    await tester.pumpWidget(const SizedBox());
    store.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
}
