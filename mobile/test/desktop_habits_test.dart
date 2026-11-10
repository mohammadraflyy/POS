import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/barcode_burst.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import 'live_store_test.dart' show MemoryPending;

/// The old desktop till's habits, kept in the Flutter app: a scanner works anywhere, the
/// payment keys, and "Cetak struk #N?" after the sale is saved.
void main() {
  group('BarcodeBurst', () {
    KeyDownEvent key(LogicalKeyboardKey k, String? c) => KeyDownEvent(physicalKey: PhysicalKeyboardKey.keyA, logicalKey: k, character: c, timeStamp: Duration.zero);

    test('a fast burst ending in Enter is a scan', () {
      var now = DateTime(2026);
      final burst = BarcodeBurst(clock: () => now);
      for (final c in '8991001000059'.split('')) { burst.feed(key(LogicalKeyboardKey.digit0, c)); now = now.add(const Duration(milliseconds: 20)); }
      expect(burst.feed(key(LogicalKeyboardKey.enter, null)).code, '8991001000059');
    });

    test('slow typing and short bursts are not scans', () {
      var now = DateTime(2026);
      final burst = BarcodeBurst(clock: () => now);
      for (final c in '12345'.split('')) { burst.feed(key(LogicalKeyboardKey.digit0, c)); now = now.add(const Duration(milliseconds: 300)); }
      expect(burst.feed(key(LogicalKeyboardKey.enter, null)).code, isNull);
      for (final c in '12'.split('')) { burst.feed(key(LogicalKeyboardKey.digit0, c)); }
      expect(burst.feed(key(LogicalKeyboardKey.enter, null)).code, isNull);
    });
  });

  group('till', () {
    late MutationGuard guard;
    late LiveStore store;
    final calls = <(String, Map<String, dynamic>?)>[];

    Future<void> openTill(WidgetTester tester, {bool away = false}) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      tester.view.physicalSize = const Size(1400, 900); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      calls.clear();
      guard = MutationGuard(MemoryPending()); await guard.load();
      store = LiveStore(BusinessApi((path, {required method, query, body}) async {
        calls.add((path, body));
        if (path == '/v1/catalog/search') {
          final q = query?['q'] ?? '';
          final all = [
            {'id': 1, 'namaItem': 'Kopi Sachet', 'kodeItem': 'KOPI1', 'barcode': '8991001000110', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 1500},
            {'id': 2, 'namaItem': 'Teh Celup', 'kodeItem': 'TEH1', 'barcode': '8991001000127', 'satuan': 'PCS', 'stok': 20, 'hargaJual': 7000},
          ];
          return {'data': all.where((p) => q.isEmpty || p['barcode'] == q || p['kodeItem'] == q).toList(), 'currentPage': 1, 'lastPage': 1};
        }
        if (path == '/v1/customers') return {'names': <String>[]};
        if (path == '/v1/carts/price') return {'lines': [for (final _ in body!['items'] as List) {'stokCukup': true, 'hargaJual': 1500}], 'subtotal': 1500, 'diskon': 0, 'total': 1500};
        if (path == '/v1/sales') return {'saleId': 41, 'total': 1500, 'printed': false, 'printSkipped': true};
        if (path == '/v1/sales/41/print') return {'printed': true};
        throw StateError('Unexpected request: $path');
      }), guard, viaInternet: () => away);
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: LiveKasirScreen(store: store))));
      await tester.pumpAndSettle();
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();
    }

    Future<void> finish(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox()); store.dispose(); guard.dispose();
      debugDefaultTargetPlatformOverride = null;
    }

    Future<void> scan(WidgetTester tester, String code) async {
      for (final c in code.split('')) {
        await tester.sendKeyEvent(LogicalKeyboardKey(0x30 + int.parse(c)), character: c);
      }
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    }

    testWidgets('a scan anywhere in the window puts that product in the cart', (tester) async {
      await openTill(tester);
      await scan(tester, '8991001000127');
      expect(store.items.single.product.name, 'Teh Celup');
      await finish(tester);
    });

    testWidgets('Alt+Q picks QRIS, Alt+S saves without a receipt, then asks to print', (tester) async {
      await openTill(tester);
      await scan(tester, '8991001000110');
      await tester.sendKeyEvent(LogicalKeyboardKey.end);
      await tester.pumpAndSettle();
      expect(find.text('Pembayaran'), findsOneWidget);

      FocusManager.instance.primaryFocus?.unfocus();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyQ);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
      await tester.pumpAndSettle();

      final sale = calls.firstWhere((c) => c.$1 == '/v1/sales').$2!;
      expect(sale['metodePembayaran'], 'qris');
      expect(sale['cetak'], false);
      expect(find.text('Cetak struk #41?'), findsOneWidget);
      expect(find.text('Total Rp1.500.'), findsOneWidget);

      await tester.tap(find.text('Cetak'));
      await tester.pumpAndSettle();
      expect(calls.any((c) => c.$1 == '/v1/sales/41/print'), isTrue);
      expect(find.text('Struk #41 dicetak.'), findsWidgets);
      expect(store.items, isEmpty);
      await finish(tester);
    });

    testWidgets('Lewati saves the sale and prints nothing', (tester) async {
      await openTill(tester);
      await scan(tester, '8991001000110');
      await tester.sendKeyEvent(LogicalKeyboardKey.end);
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Uang diterima (Rp)'), '2000');
      await tester.tap(find.text('Simpan transaksi  ·  Alt+S'));
      await tester.pumpAndSettle();

      expect(find.text('Kembalian Rp500.'), findsOneWidget);
      await tester.tap(find.text('Lewati'));
      await tester.pumpAndSettle();
      expect(calls.any((c) => c.$1 == '/v1/sales/41/print'), isFalse);
      await finish(tester);
    });

    testWidgets('outside the shop Enter skips the receipt, which would print at the shop', (tester) async {
      await openTill(tester, away: true);
      await scan(tester, '8991001000110');
      await tester.sendKeyEvent(LogicalKeyboardKey.end);
      await tester.pumpAndSettle();
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyQ);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
      await tester.pumpAndSettle();

      expect(find.textContaining('struk akan tercetak di printer toko'), findsOneWidget);
      expect(find.text('Cetak di toko'), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('Cetak struk #41?'), findsNothing);
      expect(calls.any((c) => c.$1 == '/v1/sales/41/print'), isFalse);
      await finish(tester);
    });
  });
}
