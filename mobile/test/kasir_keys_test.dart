import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/business_api.dart';
import '../lib/services/draft_store.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/kasir_keys.dart';
import '../lib/state/live_store.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import '../lib/Screen/Live/kasir_style.dart';
import '../lib/Screen/Live/LivePaymentScreen.dart';
import 'kasir_shortcuts_test.dart' show jumlahField, searchField;
import 'live_store_test.dart' show MemoryPending;

void main() {
  test('the chosen layout is remembered on the device, and the first run keeps the current keys', () async {
    final store = MemoryDraftStore();
    final fresh = KasirKeysController(store: store);
    await fresh.load();
    expect(fresh.value, KasirKeyLayout.current);

    await fresh.choose(KasirKeyLayout.globalArrows);
    final next = KasirKeysController(store: store);
    await next.load();
    expect(next.value, KasirKeyLayout.globalArrows);
  });

  group('Panah global', () {
    late MutationGuard guard;
    late LiveStore store;
    final windows = TargetPlatformVariant.only(TargetPlatform.windows);

    Future<void> openTill(WidgetTester tester) async {
      kasirKeys.value = KasirKeyLayout.globalArrows;
      addTearDown(() => kasirKeys.value = KasirKeyLayout.current);
      tester.view.physicalSize = const Size(1400, 900); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      guard = MutationGuard(MemoryPending()); await guard.load();
      store = LiveStore(BusinessApi((path, {required method, query, body}) async {
        if (path == '/v1/catalog/search') return {'data': [
          {'id': 1, 'namaItem': 'Kopi Sachet', 'kodeItem': 'KOPI1', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 1500, 'units': []},
          {'id': 2, 'namaItem': 'Kopi Susu', 'kodeItem': 'KOPI2', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 2000, 'units': []},
        ], 'currentPage': 1, 'lastPage': 1};
        if (path == '/v1/customers') return {'names': <String>['Bu Siti']};
        if (path == '/v1/sales') return {'saleId': 41, 'total': 1500, 'printed': false, 'printSkipped': true};
        if (path == '/v1/carts/price') return {'lines': [{'stokCukup': true, 'hargaJual': 1500}], 'subtotal': 1500, 'diskon': 0, 'total': 1500};
        throw StateError('Unexpected request: $path');
      }), guard);
      addTearDown(() { store.dispose(); guard.dispose(); });
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: LiveKasirScreen(store: store))));
      await tester.pumpAndSettle();
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.enterText(find.byWidget(searchField(tester)), 'KOPI1');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
      expect(store.items, hasLength(1));
    }

    bool hasFocus(WidgetTester tester, Finder field) => tester.widget<TextField>(field).focusNode!.hasFocus;
    bool typingNow() => FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null;
    Future<void> press(WidgetTester tester, LogicalKeyboardKey key) async {
      await tester.sendKeyEvent(key);
      await tester.pumpAndSettle();
    }

    testWidgets('PageUp goes to Jumlah and PageDown to the search box, from the search box, Jumlah and a cart line', (tester) async {
      await openTill(tester);
      final starts = <String, Future<void> Function()>{
        'search': () async => tester.tap(find.byWidget(searchField(tester))),
        'jumlah': () async => tester.tap(jumlahField),
        'cart line': () async {
          await tester.tap(find.byWidget(searchField(tester)));
          for (var i = 0; i < 4; i++) {
            await press(tester, LogicalKeyboardKey.arrowDown);
          }
          expect(store.selectedCartIndex, 0);
        },
      };
      for (final start in starts.entries) {
        await start.value();
        await press(tester, LogicalKeyboardKey.pageUp);
        expect(hasFocus(tester, jumlahField), isTrue, reason: 'PgUp from ${start.key}');
        expect(store.selectedCartIndex, isNull);

        await start.value();
        await press(tester, LogicalKeyboardKey.pageDown);
        expect(searchField(tester).focusNode!.hasFocus, isTrue, reason: 'PgDn from ${start.key}');
        expect(store.selectedCartIndex, isNull);
      }
    }, variant: windows);

    testWidgets('/ focuses the search box without opening the palette', (tester) async {
      await openTill(tester);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();

      await press(tester, LogicalKeyboardKey.slash);
      expect(searchField(tester).focusNode!.hasFocus, isTrue);
      expect(find.text('Cari barang'), findsNothing);
    }, variant: windows);

    testWidgets('Enter in Jumlah opens the palette with the search text', (tester) async {
      await openTill(tester);
      searchField(tester).controller!.text = 'Kopi';
      await tester.tap(jumlahField);
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();

      expect(find.text('Cari barang'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField).last).controller!.text, 'Kopi');
    }, variant: windows);

    testWidgets('Enter on an exact code adds it and leaves no text field focused, so End pays next', (tester) async {
      await openTill(tester);
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.enterText(find.byWidget(searchField(tester)), 'KOPI1');
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
      expect(store.items.single.quantity, 2);
      expect(searchField(tester).controller!.text, isEmpty);
      expect(typingNow(), isFalse);

      await press(tester, LogicalKeyboardKey.end);
      expect(find.byType(LivePaymentScreen), findsOneWidget);
    }, variant: windows);

    Future<void> openPaletteFor(WidgetTester tester, String text) async {
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.enterText(find.byWidget(searchField(tester)), text);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
      expect(find.text('Cari barang'), findsOneWidget);
    }

    testWidgets('in the palette PageDown moves the highlight', (tester) async {
      await openTill(tester);
      await openPaletteFor(tester, 'Kopi');

      await press(tester, LogicalKeyboardKey.pageDown);
      await tester.testTextInput.receiveAction(TextInputAction.go);
      await tester.pumpAndSettle();
      expect(store.items.map((i) => i.product.name), contains('Kopi Susu'));
    }, variant: windows);

    testWidgets('Esc in the palette leaves focus nowhere', (tester) async {
      await openTill(tester);
      await openPaletteFor(tester, 'Kopi');

      await press(tester, LogicalKeyboardKey.escape);
      expect(find.text('Cari barang'), findsNothing);
      expect(typingNow(), isFalse);
      expect(searchField(tester).focusNode!.hasFocus, isFalse);
    }, variant: windows);

    Future<void> openPayment(WidgetTester tester) async {
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();
      await press(tester, LogicalKeyboardKey.end);
      expect(find.byType(LivePaymentScreen), findsOneWidget);
    }

    testWidgets('payment: Alt+B picks Bon, and PgDn then Enter closes without saving', (tester) async {
      await openTill(tester);
      await openPayment(tester);

      await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyB);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
      await tester.pump();
      expect(find.text('Pelanggan (wajib)'), findsOneWidget);

      await press(tester, LogicalKeyboardKey.pageDown);
      await press(tester, LogicalKeyboardKey.enter);
      expect(find.byType(LivePaymentScreen), findsNothing);
      expect(store.items, hasLength(1));
    }, variant: windows);

    testWidgets('payment: PgUp returns to Simpan and Enter saves', (tester) async {
      await openTill(tester);
      await openPayment(tester);

      await press(tester, LogicalKeyboardKey.pageDown);
      await press(tester, LogicalKeyboardKey.pageUp);
      await press(tester, LogicalKeyboardKey.enter);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
      expect(find.text('Cetak struk #41?'), findsOneWidget);
      await press(tester, LogicalKeyboardKey.escape);
      expect(store.items, isEmpty);
    }, variant: windows);

    testWidgets('payment: Enter in Keterangan does not run the highlighted action', (tester) async {
      await openTill(tester);
      await openPayment(tester);

      final note = find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText == 'Opsional');
      await tester.ensureVisible(note);
      await tester.tap(note);
      await tester.enterText(note, 'titip');
      await press(tester, LogicalKeyboardKey.enter);
      expect(find.byType(LivePaymentScreen), findsOneWidget);
      expect(find.text('Cetak struk #41?'), findsNothing);
      expect(store.items, hasLength(1));
    }, variant: windows);

    FocusNode customerNode(WidgetTester tester) =>
      tester.widget<InkWell>(find.ancestor(of: find.text('Pelanggan'), matching: find.byType(InkWell))).focusNode!;

    testWidgets('Down from the search box lands on Pelanggan, and Enter opens the picker', (tester) async {
      await openTill(tester);
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.pump();

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      expect(customerNode(tester).hasFocus, isTrue);
      expect(store.selectedCartIndex, isNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('Pilih pelanggan'), findsOneWidget);
    }, variant: windows);

    FocusNode discountNode(WidgetTester tester) =>
      tester.widget<OutlinedButton>(find.ancestor(of: find.text('0 atau 10%'), matching: find.byWidgetPredicate((w) => w is OutlinedButton))).focusNode!;

    testWidgets('Down from Pelanggan lands on Diskon nota, and Enter opens the discount dialog', (tester) async {
      await openTill(tester);
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      expect(discountNode(tester).hasFocus, isTrue);
      expect(store.selectedCartIndex, isNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('Terapkan'), findsOneWidget);
    }, variant: windows);

    FocusNode rowNode(WidgetTester tester, String label) =>
      tester.widget<ButtonStyleButton>(find.ancestor(of: find.text(label), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton))).focusNode!;

    Future<void> downTo(WidgetTester tester, int times) async {
      await tester.tap(find.byWidget(searchField(tester)));
      for (var i = 0; i < times; i++) {
        await press(tester, LogicalKeyboardKey.arrowDown);
      }
    }

    testWidgets('Down from Diskon nota lands on Antrean baru; Right goes to Kosongkan and Left comes back', (tester) async {
      await openTill(tester);
      await downTo(tester, 3);
      expect(rowNode(tester, 'Antrean baru').hasFocus, isTrue);
      expect(store.selectedCartIndex, isNull);

      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(rowNode(tester, 'Kosongkan').hasFocus, isTrue);
      await press(tester, LogicalKeyboardKey.arrowLeft);
      expect(rowNode(tester, 'Antrean baru').hasFocus, isTrue);
    }, variant: windows);

    testWidgets('Enter on Kosongkan asks to clear the cart', (tester) async {
      await openTill(tester);
      await downTo(tester, 3);
      await press(tester, LogicalKeyboardKey.arrowRight);

      await press(tester, LogicalKeyboardKey.enter);
      expect(find.text('Kosongkan keranjang?'), findsOneWidget);
      expect(store.items, hasLength(1));
    }, variant: windows);

    testWidgets('Enter on Antrean baru opens a new queue', (tester) async {
      await openTill(tester);
      await downTo(tester, 3);
      final queues = store.queues.length;

      await press(tester, LogicalKeyboardKey.enter);
      expect(store.queues, hasLength(queues + 1));
    }, variant: windows);

    testWidgets('Down from the row enters the cart; Up or Esc on the first line returns to the row button last used, then Diskon nota, Pelanggan and the search box', (tester) async {
      await openTill(tester);
      await downTo(tester, 3);
      await press(tester, LogicalKeyboardKey.arrowRight);

      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(store.selectedCartIndex, 0);

      await press(tester, LogicalKeyboardKey.arrowUp);
      expect(store.selectedCartIndex, isNull);
      expect(rowNode(tester, 'Kosongkan').hasFocus, isTrue);

      await press(tester, LogicalKeyboardKey.arrowDown);
      await press(tester, LogicalKeyboardKey.escape);
      expect(store.selectedCartIndex, isNull);
      expect(rowNode(tester, 'Kosongkan').hasFocus, isTrue);

      await press(tester, LogicalKeyboardKey.arrowUp);
      expect(discountNode(tester).hasFocus, isTrue);

      await press(tester, LogicalKeyboardKey.arrowUp);
      expect(customerNode(tester).hasFocus, isTrue);

      await press(tester, LogicalKeyboardKey.arrowUp);
      expect(searchField(tester).focusNode!.hasFocus, isTrue);
    }, variant: windows);

    testWidgets('with an empty cart Down from Pelanggan skips Diskon nota and Kosongkan and stops on Antrean baru', (tester) async {
      await openTill(tester);
      store.clear();
      await tester.pumpAndSettle();
      await downTo(tester, 1);
      expect(customerNode(tester).hasFocus, isTrue);

      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(discountNode(tester).hasFocus, isFalse);
      expect(rowNode(tester, 'Antrean baru').hasFocus, isTrue);

      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(rowNode(tester, 'Kosongkan').hasFocus, isFalse);
      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(rowNode(tester, 'Antrean baru').hasFocus, isTrue);
      expect(store.selectedCartIndex, isNull);
    }, variant: windows);

    testWidgets('Ctrl+Down in the search box does not move focus to Pelanggan', (tester) async {
      await openTill(tester);
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
      expect(customerNode(tester).hasFocus, isFalse);
      expect(searchField(tester).focusNode!.hasFocus, isTrue);
    }, variant: windows);

    testWidgets('arrows never focus the Bayar button', (tester) async {
      await openTill(tester);
      bool onBayar() => FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<KasirActionButton>() != null;
      await tester.tap(find.byWidget(searchField(tester)));

      for (final key in [...List.filled(6, LogicalKeyboardKey.arrowDown), ...List.filled(6, LogicalKeyboardKey.arrowUp), LogicalKeyboardKey.arrowRight, LogicalKeyboardKey.arrowLeft]) {
        await tester.sendKeyEvent(key);
        await tester.pumpAndSettle();
        expect(onBayar(), isFalse);
      }
      expect(find.ancestor(of: find.text('Bayar'), matching: find.byWidgetPredicate((w) => w is Focus && !w.descendantsAreFocusable)), findsOneWidget);
    }, variant: windows);

    testWidgets('under the current layout Down in the search box does not move to Pelanggan', (tester) async {
      await openTill(tester);
      kasirKeys.value = KasirKeyLayout.current;
      await tester.tap(find.byWidget(searchField(tester)));
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pumpAndSettle();
      expect(customerNode(tester).hasFocus, isFalse);
    }, variant: windows);

    testWidgets('Left and Right are plain caret moves in the search box', (tester) async {
      await openTill(tester);
      await tester.enterText(find.byWidget(searchField(tester)), 'abc');
      await tester.pump();
      searchField(tester).controller!.selection = const TextSelection.collapsed(offset: 0);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
      await tester.pump();
      expect(searchField(tester).focusNode!.hasFocus, isTrue);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pump();
      expect(searchField(tester).focusNode!.hasFocus, isTrue);
      expect(searchField(tester).controller!.selection.baseOffset, 1);
    }, variant: windows);
  });
}
