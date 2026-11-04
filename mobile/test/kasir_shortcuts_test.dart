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

/// The till's search box (Jumlah sits before it).
TextField searchField(WidgetTester tester) => tester.widgetList<TextField>(find.byType(TextField)).firstWhere((f) => f.decoration?.labelText != 'Jumlah');

/// The desktop till's keys work the same in the Flutter app on the shop PC.
void main() {
  late MutationGuard guard;
  late LiveStore store;

  Future<void> openTill(WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    tester.view.physicalSize = const Size(1400, 900); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    guard = MutationGuard(MemoryPending()); await guard.load();
    store = LiveStore(BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/catalog/search') return {'data': [{'id': 1, 'namaItem': 'Kopi Sachet', 'kodeItem': 'KOPI1', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 1500}], 'currentPage': 1, 'lastPage': 1};
      if (path == '/v1/customers') return {'names': <String>[]};
      if (path == '/v1/carts/price') return {'lines': [{'stokCukup': true, 'hargaJual': 1500}], 'subtotal': 1500, 'diskon': 0, 'total': 1500};
      throw StateError('Unexpected request: $path');
    }), guard);
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: LiveKasirScreen(store: store))));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Tambah Kopi Sachet'));
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(store.items, hasLength(1));
  }

  Future<void> finish(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox()); store.dispose(); guard.dispose();
    debugDefaultTargetPlatformOverride = null;
  }

  testWidgets('End opens payment, but not while typing in the search box', (tester) async {
    await openTill(tester);

    // the search box has focus on the PC: End moves the caret, it does not pay
    await tester.tap(find.byWidget(searchField(tester)));
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.byType(LivePaymentScreen), findsNothing);

    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.byType(LivePaymentScreen), findsOneWidget);
    await finish(tester);
  });

  testWidgets('Alt+K asks, then empties the cart', (tester) async {
    await openTill(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();
    expect(find.text('Kosongkan keranjang?'), findsOneWidget);

    await tester.tap(find.text('Kosongkan'));
    await tester.pumpAndSettle();
    expect(store.items, isEmpty);
    await finish(tester);
  });

  testWidgets('/ and PageDown jump back to the search box', (tester) async {
    await openTill(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    expect(searchField(tester).focusNode!.hasFocus, isTrue);

    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.pageDown);
    await tester.pump();
    expect(searchField(tester).focusNode!.hasFocus, isTrue);
    await finish(tester);
  });

  testWidgets('keys do nothing while another menu is in front of the till', (tester) async {
    await openTill(tester);
    // the workspace keeps the till alive behind other menus and marks it inactive
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: IndexedStack(index: 1, children: [
      LiveKasirScreen(store: store, active: false), const Text('Menu lain'),
    ]))));
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.f12);
    await tester.pumpAndSettle();
    expect(find.byType(LivePaymentScreen), findsNothing);
    await finish(tester);
  });

  testWidgets('Jumlah sets how many go in, then falls back to 1; PageUp jumps to it', (tester) async {
    await openTill(tester);
    final qtyField = find.widgetWithText(TextField, 'Jumlah');
    await tester.enterText(qtyField, '3');
    await tester.tap(find.byTooltip('Tambah Kopi Sachet'));
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(store.items.single.quantity, 4); // 1 from the setup plus 3
    expect(tester.widget<TextField>(qtyField).controller!.text, '1');

    FocusManager.instance.primaryFocus?.unfocus();
    await tester.sendKeyEvent(LogicalKeyboardKey.pageUp);
    await tester.pump();
    expect(tester.widget<TextField>(qtyField).focusNode!.hasFocus, isTrue);
    await finish(tester);
  });
}
