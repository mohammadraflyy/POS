import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import '../lib/Screen/Live/LivePaymentScreen.dart';
import 'live_store_test.dart' show MemoryPending;

/// The change notice after a tunai sale, and Ctrl+P reprinting the last nota.
void main() {
  late MutationGuard guard;
  late LiveStore store;
  final calls = <String>[];

  Future<void> openTill(WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    tester.view.physicalSize = const Size(1400, 900); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    calls.clear();
    guard = MutationGuard(MemoryPending()); await guard.load();
    store = LiveStore(BusinessApi((path, {required method, query, body}) async {
      calls.add(path);
      if (path == '/v1/catalog/search') {
        return {'data': [{'id': 1, 'namaItem': 'Kopi Sachet', 'kodeItem': 'KOPI1', 'barcode': '8991001000110', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 1500}], 'currentPage': 1, 'lastPage': 1};
      }
      if (path == '/v1/customers') return {'names': <String>[]};
      if (path == '/v1/carts/price') return {'lines': [for (final _ in body!['items'] as List) {'stokCukup': true, 'hargaJual': 1500}], 'subtotal': 1500, 'diskon': 0, 'total': 1500};
      if (path == '/v1/sales') return {'saleId': 41, 'total': 1500, 'printed': false, 'printSkipped': true};
      if (path == '/v1/sales/41/print') return {'printed': true};
      throw StateError('Unexpected request: $path');
    }), guard);
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: LiveKasirScreen(store: store))));
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
  }

  Future<void> finish(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox()); store.dispose(); guard.dispose();
    debugDefaultTargetPlatformOverride = null;
  }

  /// Scans the coffee, opens payment and saves with [received] (empty = uang pas), optionally on another method key.
  Future<void> sell(WidgetTester tester, {String received = '', LogicalKeyboardKey? method}) async {
    for (final c in '8991001000110'.split('')) {
      await tester.sendKeyEvent(LogicalKeyboardKey(0x30 + int.parse(c)), character: c);
    }
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    if (received.isNotEmpty) {
      await tester.enterText(find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText == 'Kosong = uang pas'), received);
    }
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    if (method != null) await tester.sendKeyEvent(method);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();
  }

  Future<void> ctrlP(WidgetTester tester) async {
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump();
  }

  test('only tunai gives change', () {
    expect(const PaidSale(saleId: 1, total: 1500, method: 'tunai', paid: 2000).change, 500);
    expect(const PaidSale(saleId: 1, total: 1500, method: 'qris', paid: 2000).change, 0);
    expect(const PaidSale(saleId: 1, total: 1500, method: 'bon', paid: 2000).change, 0);
  });

  testWidgets('tunai with change shows the KEMBALIAN notice, a key press closes it, then the receipt prompt', (tester) async {
    await openTill(tester);
    await sell(tester, received: '2000');

    expect(find.text('KEMBALIAN'), findsOneWidget);
    expect(find.text('Rp500'), findsOneWidget);
    expect(find.text('Diterima Rp2.000 · Total Rp1.500'), findsOneWidget);
    expect(find.text('Nota #41'), findsOneWidget);
    expect(find.text('Cetak struk #41?'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();
    expect(find.text('KEMBALIAN'), findsNothing);
    expect(find.text('Cetak struk #41?'), findsOneWidget);

    await tester.tap(find.text('Lewati'));
    await tester.pumpAndSettle();
    expect(store.items, isEmpty);
    expect(find.byType(LivePaymentScreen), findsNothing);
    await finish(tester);
  });

  testWidgets('the notice closes by itself after 4 seconds', (tester) async {
    await openTill(tester);
    await sell(tester, received: '2000');
    expect(find.text('KEMBALIAN'), findsOneWidget);

    await tester.pump(const Duration(seconds: 3));
    expect(find.text('KEMBALIAN'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1, milliseconds: 100));
    await tester.pumpAndSettle();
    expect(find.text('KEMBALIAN'), findsNothing);
    expect(find.text('Cetak struk #41?'), findsOneWidget);
    await tester.tap(find.text('Lewati'));
    await tester.pumpAndSettle();
    await finish(tester);
  });

  testWidgets('uang pas skips the notice', (tester) async {
    await openTill(tester);
    await sell(tester);
    expect(find.text('KEMBALIAN'), findsNothing);
    expect(find.text('Cetak struk #41?'), findsOneWidget);
    await tester.tap(find.text('Lewati'));
    await tester.pumpAndSettle();
    await finish(tester);
  });

  testWidgets('QRIS skips the notice', (tester) async {
    await openTill(tester);
    await sell(tester, method: LogicalKeyboardKey.keyQ);
    expect(find.text('KEMBALIAN'), findsNothing);
    expect(find.text('Cetak struk #41?'), findsOneWidget);
    await tester.tap(find.text('Lewati'));
    await tester.pumpAndSettle();
    await finish(tester);
  });

  testWidgets('Ctrl+P before any sale says so and prints nothing', (tester) async {
    await openTill(tester);
    await ctrlP(tester);
    expect(find.text('Belum ada nota di sesi ini.'), findsOneWidget);
    expect(calls.where((c) => c.endsWith('/print')), isEmpty);
    await tester.pump(const Duration(seconds: 10));
    await finish(tester);
  });

  testWidgets('Ctrl+P after a sale reprints that nota once', (tester) async {
    await openTill(tester);
    await sell(tester);
    await tester.tap(find.text('Lewati'));
    await tester.pumpAndSettle();
    expect(calls.where((c) => c.endsWith('/print')), isEmpty);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    await ctrlP(tester);
    await tester.pump(const Duration(milliseconds: 100));
    expect(calls.where((c) => c == '/v1/sales/41/print'), hasLength(1));
    expect(find.text('Struk #41 dikirim ke printer PC.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 10));
    await finish(tester);
  });
}
