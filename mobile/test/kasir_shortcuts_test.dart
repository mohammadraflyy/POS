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
import '../lib/Widgets/product_row.dart';
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
      if (path == '/v1/catalog/search') return {'data': [{'id': 1, 'namaItem': 'Kopi Sachet', 'kodeItem': 'KOPI1', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 1500,
        'units': [{'productUnitId': 7, 'satuan': 'RENTENG', 'konversi': 10, 'hargaJual': 14000}]}], 'currentPage': 1, 'lastPage': 1};
      if (path == '/v1/customers') return {'names': <String>['Bu Siti', 'Pak Budi']};
      if (path == '/v1/carts/price') return {'lines': [{'stokCukup': true, 'hargaJual': 1500}], 'subtotal': 1500, 'diskon': 0, 'total': 1500};
      if (path == '/v1/sales') return {'saleId': 41, 'total': 1500, 'printed': false, 'printSkipped': true};
      if (path == '/v1/sales/41/print') return {'printed': true};
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

  testWidgets('PageDown jumps back to the search box', (tester) async {
    await openTill(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.pageDown);
    await tester.pump();
    expect(searchField(tester).focusNode!.hasFocus, isTrue);
    await finish(tester);
  });

  testWidgets('/ opens the product palette: arrows pick the unit, Enter adds the Jumlah', (tester) async {
    await openTill(tester);
    await tester.enterText(find.widgetWithText(TextField, 'Jumlah'), '2');
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(find.text('Cari barang'), findsOneWidget);
    expect(find.text('Kopi Sachet · RENTENG'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    await tester.testTextInput.receiveAction(TextInputAction.go);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    final renteng = store.items.firstWhere((i) => i.unit.id == 7);
    expect(renteng.quantity, 2);
    await finish(tester);
  });

  testWidgets('Alt+P picks a customer - a new name too - and payment starts with it', (tester) async {
    await openTill(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pumpAndSettle();
    expect(find.text('Pilih pelanggan'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'Bu Rina');
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(find.text('Pelanggan baru: Bu Rina'), findsOneWidget);
    await tester.testTextInput.receiveAction(TextInputAction.go);
    await tester.pumpAndSettle();
    expect(store.customerName, 'Bu Rina');
    expect(find.text('Pelanggan: Bu Rina'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextField, 'Bu Rina'), findsOneWidget);
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

  testWidgets('arrow keys move selection in catalog and Enter picks product into cart', (tester) async {
    await openTill(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();

    // With focus outside text field, Enter adds the selected product
    final initialQty = store.items.single.quantity;
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(store.items.single.quantity, initialQty + 1);

    // Typing in search then pressing Enter picks the selected match
    await tester.tap(find.byWidget(searchField(tester)));
    await tester.enterText(find.byWidget(searchField(tester)), 'Kopi');
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(store.items.single.quantity, initialQty + 2);

    await finish(tester);
  });

  testWidgets('clicking product row on desktop adds with entered quantity directly without modal', (tester) async {
    await openTill(tester);
    final qtyField = find.widgetWithText(TextField, 'Jumlah');
    await tester.enterText(qtyField, '5');
    await tester.pump();

    // Clicking anywhere on the product row adds directly
    await tester.tap(find.byType(ProductRow).first);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();

    // 1 from initial setup + 5 from click = 6
    expect(store.items.single.quantity, 6);
    expect(tester.widget<TextField>(qtyField).controller!.text, '1');
    await finish(tester);
  });

  testWidgets('fluid payment with keyboard: Alt+U for uang pas then Alt+S, then Enter prints receipt', (tester) async {
    await openTill(tester);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();

    // End opens payment
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.byType(LivePaymentScreen), findsOneWidget);

    // Alt+U fills uang pas
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyU);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pump();

    final paidField = find.widgetWithText(TextField, 'Uang diterima (Rp)');
    expect(tester.widget<TextField>(paidField).controller!.text, '1500');

    // Alt+S saves the transaction
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();

    expect(find.text('Cetak struk #41?'), findsOneWidget);

    // Enter immediately triggers Cetak
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();

    expect(store.items, isEmpty);
    await finish(tester);
  });
}
