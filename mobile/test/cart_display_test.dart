import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/models/live_models.dart';
import '../lib/Screen/Live/LiveCartPanel.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/live_store.dart';
import 'live_store_test.dart' show MemoryPending;

void main() {
  testWidgets('LiveCartPanel renders multiple items with identical keys without duplicate key error', (tester) async {
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/carts/price') {
        return {
          'lines': [
            {'productId': 1, 'productUnitId': null, 'qty': 1, 'hargaJual': 5000, 'subtotal': 5000, 'stokCukup': true},
            {'productId': 1, 'productUnitId': null, 'qty': 2, 'hargaJual': 5000, 'subtotal': 10000, 'stokCukup': true},
          ],
          'subtotal': 15000,
          'diskon': 0,
          'total': 15000,
          'stockEnough': true,
        };
      }
      return {};
    });

    final store = LiveStore(api, guard);
    final p = LiveProduct(1, 'Item Kembar', 'KMB01', 10, [LiveUnit(null, 'Pcs', 5000)]);
    final item1 = LiveCartItem(product: p, unit: p.units.first, quantity: 1, manualPrice: 5000);
    final item2 = LiveCartItem(product: p, unit: p.units.first, quantity: 2, manualPrice: 5000);

    // Both items have identical key ('1:null:5000')
    expect(item1.key, equals(item2.key));
    store.items.addAll([item1, item2]);

    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: SizedBox(
          width: 400,
          height: 600,
          child: LiveCartPanel(store: store),
        ),
      ),
    ));

    expect(find.text('Item Kembar'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
    store.dispose();
  });

  testWidgets('LiveCartPanel shows fallback price and subtotal before server price arrives', (tester) async {
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async {
      // Intentionally slow or pending
      return {};
    });

    final store = LiveStore(api, guard);
    final p = LiveProduct(2, 'Barang Cepat', 'BC01', 10, [LiveUnit(null, 'Pcs', 12500)]);
    store.put(LiveCartItem(product: p, unit: p.units.first, quantity: 2));

    // Notice: store.price is currently null
    expect(store.price, isNull);

    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: SizedBox(
          width: 400,
          height: 600,
          child: LiveCartPanel(store: store),
        ),
      ),
    ));

    // Fallback price Rp 12.500 and subtotal Rp 25.000 are displayed, not '…'
    expect(find.textContaining('12.500'), findsOneWidget);
    expect(find.textContaining('25.000'), findsOneWidget);

    store.dispose();
  });

  testWidgets('LiveCartPanel displays empty placeholder when cart is empty even with customer set', (tester) async {
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async => {});
    final store = LiveStore(api, guard);
    store.setCustomer('Pelanggan VIP');

    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: SizedBox(
          width: 400,
          height: 600,
          child: LiveCartPanel(store: store),
        ),
      ),
    ));

    expect(find.textContaining('Pelanggan: Pelanggan VIP'), findsOneWidget);
    expect(find.text('Keranjang masih kosong. Scan barang atau pilih dari katalog.'), findsOneWidget);
    store.dispose();
  });

  test('LiveStore syncs activeQueue when items are put, replaced, or removed', () {
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async => {});
    final store = LiveStore(api, guard);

    final p = LiveProduct(3, 'Test Antrean', 'TA01', 10, [LiveUnit(null, 'Pcs', 10000)]);
    final item = LiveCartItem(product: p, unit: p.units.first, quantity: 1);

    store.put(item);
    expect(store.activeQueue.items.length, equals(1));
    expect(store.activeQueue.items.first.product.id, equals(3));

    final newItem = LiveCartItem(product: p, unit: p.units.first, quantity: 3);
    store.replace(item, newItem);
    expect(store.activeQueue.items.first.quantity, equals(3));

    store.remove(newItem);
    expect(store.activeQueue.items.isEmpty, isTrue);
  });

  testWidgets('clicking catalog row adds product even when loading is true', (tester) async {
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/carts/price') {
        return {'lines': [], 'subtotal': 0, 'diskon': 0, 'total': 0, 'stockEnough': true};
      }
      if (path == '/v1/catalog/search') {
        return {
          'items': [
            {'id': 99, 'namaItem': 'Barang Klik', 'kodeItem': 'BK01', 'barcode': '999', 'stok': 10, 'satuan': 'Pcs', 'hargaJual': 7000, 'hargaPokok': 5000}
          ],
          'currentPage': 1,
          'lastPage': 1,
        };
      }
      return {};
    });

    final store = LiveStore(api, guard);
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: LiveKasirScreen(store: store, active: true),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Barang Klik'), findsOneWidget);
    // Tap the catalog row
    await tester.tap(find.text('Barang Klik'));
    await tester.pump();

    // Verify it is added to the cart
    expect(store.items.length, equals(1));
    expect(store.items.first.product.id, equals(99));

    store.dispose();
  });

  testWidgets('cart navigation walks up with arrowUp and exits to search when reaching top', (tester) async {
    final guard = MutationGuard(MemoryPending());
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/carts/price') {
        return {'lines': [], 'subtotal': 0, 'diskon': 0, 'total': 0, 'stockEnough': true};
      }
      if (path == '/v1/catalog/search') {
        return {'items': [], 'currentPage': 1, 'lastPage': 1};
      }
      return {};
    });

    final store = LiveStore(api, guard);
    // Add 10 items to cart
    for (var i = 1; i <= 10; i++) {
      final p = LiveProduct(i, 'Item $i', 'CODE$i', 50, [LiveUnit(null, 'Pcs', 1000 * i)]);
      store.put(LiveCartItem(product: p, unit: p.units.first, quantity: 1));
    }
    expect(store.items.length, 10);

    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: LiveKasirScreen(store: store, active: true),
      ),
    ));
    await tester.pumpAndSettle();

    // Select index 2
    store.selectCartIndex(2);
    await tester.pumpAndSettle();
    expect(store.selectedCartIndex, 2);

    // Arrow up to index 1
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(store.selectedCartIndex, 1);

    // Arrow up to index 0 (paling atas)
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(store.selectedCartIndex, 0);

    // Arrow up again while already at top ("udah mentok")
    // Should clear cart selection and exit to search focus
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(store.selectedCartIndex, isNull);

    // Verify search field is now focused
    final searchInput = tester.widgetList<TextField>(find.byType(TextField)).firstWhere((f) => f.decoration?.labelText != 'Jumlah');
    expect(searchInput.focusNode?.hasFocus, isTrue);

    // Arrow right from search field (when empty) jumps back into cart at index 0
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(store.selectedCartIndex, 0);

    store.dispose();
  });
}
