import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/state/kasir_keys.dart';
import '../lib/state/live_store.dart';
import '../lib/Screen/Live/kasir_style.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import '../lib/Screen/Live/LivePaymentScreen.dart';
import 'kasir_shortcuts_test.dart' show searchField;
import 'live_store_test.dart' show MemoryPending;

void main() {
  final windows = TargetPlatformVariant.only(TargetPlatform.windows);
  late MutationGuard guard;
  late LiveStore store;
  late List<String> calls;

  Future<void> openPayment(WidgetTester tester, Size size, {bool arrows = false}) async {
    kasirKeys.value = arrows ? KasirKeyLayout.globalArrows : KasirKeyLayout.current;
    addTearDown(() => kasirKeys.value = KasirKeyLayout.current);
    tester.view.physicalSize = size; tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    calls = [];
    guard = MutationGuard(MemoryPending()); await guard.load();
    store = LiveStore(BusinessApi((path, {required method, query, body}) async {
      calls.add(path);
      if (path == '/v1/catalog/search') return {'data': [
        {'id': 1, 'namaItem': 'Kopi Sachet', 'kodeItem': 'KOPI1', 'satuan': 'PCS', 'stok': 50, 'hargaJual': 1500, 'units': []},
      ], 'currentPage': 1, 'lastPage': 1};
      if (path == '/v1/customers') return {'names': <String>[]};
      if (path == '/v1/sales') return {'saleId': 41, 'total': 1500, 'printed': false, 'printSkipped': true};
      if (path == '/v1/sales/41/print') return {'printed': true};
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
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.byType(LivePaymentScreen), findsOneWidget);
  }

  Finder fieldWithHint(String hint) => find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText == hint);
  final paidField = fieldWithHint('Kosong = uang pas');

  Future<void> press(WidgetTester tester, LogicalKeyboardKey key) async {
    await tester.sendKeyEvent(key);
    await tester.pumpAndSettle();
  }

  /// Where the arrow-path focus is: a text field by its hint, otherwise the stop whose box holds a known label.
  String stop(WidgetTester tester) {
    final focusContext = FocusManager.instance.primaryFocus!.context!;
    final editable = focusContext.findAncestorWidgetOfExactType<EditableText>();
    if (editable != null) {
      for (final (name, hint) in [('uang', 'Kosong = uang pas'), ('biaya', '0'), ('keterangan', 'Opsional'), ('pelanggan', 'Umum')]) {
        if (tester.widget<TextField>(fieldWithHint(hint)).controller == editable.controller) return name;
      }
    }
    final box = focusContext.findRenderObject()! as RenderBox;
    final area = box.localToGlobal(Offset.zero) & box.size;
    for (final (name, label) in [('metode', 'Tunai'), ('pelanggan', 'Pelanggan'), ('tanggal', 'Tanggal & Jam'), ('chips', 'Uang pas'), ('diskon', '+ Tambah'), ('simpan', 'Simpan transaksi'), ('batal', 'Batal')]) {
      if (find.text(label).evaluate().isNotEmpty && area.contains(tester.getCenter(find.text(label)))) return name;
    }
    return '?';
  }

  for (final size in const [Size(1440, 900), Size(1366, 768)]) {
    testWidgets('payment on ${size.width.toInt()}x${size.height.toInt()}: Simpan, Batal, the total and the change are on screen with nothing to scroll', (tester) async {
      await openPayment(tester, size);
      await tester.enterText(paidField, '2000');
      await tester.pump();

      final screen = Offset.zero & size;
      for (final finder in [find.text('TOTAL TAGIHAN'), find.text('Rp1.500').last, find.text('Kembalian'), find.text('Simpan transaksi'), find.text('Batal')]) {
        expect(screen.contains(tester.getRect(finder).bottomRight), isTrue, reason: '$finder is past the window');
      }
      for (final scrollable in tester.stateList<ScrollableState>(find.byType(Scrollable))) {
        expect(scrollable.position.maxScrollExtent, 0, reason: 'a scroll view on the payment page has content past the window');
      }
      expect(tester.takeException(), isNull);
    }, variant: windows);
  }

  testWidgets('Esc returns to the till without saving', (tester) async {
    await openPayment(tester, const Size(1366, 768));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byType(LivePaymentScreen), findsNothing);
    expect(find.byType(LiveKasirScreen), findsOneWidget);
    expect(calls, isNot(contains('/v1/sales')));
    expect(store.items, hasLength(1));
  }, variant: windows);

  testWidgets('End saves from the cash field', (tester) async {
    await openPayment(tester, const Size(1366, 768));
    await tester.enterText(paidField, '2000');

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();

    expect(calls, contains('/v1/sales'));
    expect(find.text('Cetak struk #41?'), findsOneWidget);
  }, variant: windows);

  testWidgets('End saves from Keterangan', (tester) async {
    await openPayment(tester, const Size(1366, 768));
    await tester.tap(fieldWithHint('Opsional'));
    await tester.enterText(fieldWithHint('Opsional'), 'titip');

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();

    expect(calls, contains('/v1/sales'));
    expect(find.text('Cetak struk #41?'), findsOneWidget);
  }, variant: windows);

  for (final (label, key) in [('Lewati', LogicalKeyboardKey.keyL), ('Cetak', LogicalKeyboardKey.keyC)]) {
    testWidgets('Alt+S saves, $label on the receipt prompt lands on a cleared till', (tester) async {
      await openPayment(tester, const Size(1366, 768));

      await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyS);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
      expect(find.text('Cetak struk #41?'), findsOneWidget);

      await tester.sendKeyEvent(key);
      await tester.pumpAndSettle();

      expect(find.text('Cetak struk #41?'), findsNothing);
      expect(find.byType(LivePaymentScreen), findsNothing);
      expect(find.byType(LiveKasirScreen), findsOneWidget);
      expect(store.items, isEmpty);
      expect(calls.contains('/v1/sales/41/print'), label == 'Cetak');
    }, variant: windows);
  }

  group('Panah global', () {
    const size = Size(1440, 900);

    testWidgets('Down walks Metode, Pelanggan, Tanggal, Uang diterima, the chips, Diskon nota, Biaya lain, Keterangan, then Simpan', (tester) async {
      await openPayment(tester, size, arrows: true);
      expect(stop(tester), 'uang');

      for (var i = 0; i < 3; i++) { await press(tester, LogicalKeyboardKey.arrowUp); }
      expect(stop(tester), 'metode');

      final walked = <String>[];
      for (var i = 0; i < 8; i++) {
        await press(tester, LogicalKeyboardKey.arrowDown);
        walked.add(stop(tester));
      }
      expect(walked, ['pelanggan', 'tanggal', 'uang', 'chips', 'diskon', 'biaya', 'keterangan', 'simpan']);

      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(stop(tester), 'simpan', reason: 'the path ends at the footer');
      await press(tester, LogicalKeyboardKey.arrowUp);
      expect(stop(tester), 'keterangan');
    }, variant: windows);

    testWidgets('Right on Metode picks QRIS and the path then skips the cash field and chips', (tester) async {
      await openPayment(tester, size, arrows: true);
      for (var i = 0; i < 3; i++) { await press(tester, LogicalKeyboardKey.arrowUp); }

      await press(tester, LogicalKeyboardKey.arrowRight);

      expect(find.textContaining('Pastikan pembayaran QRIS'), findsOneWidget);
      expect(paidField, findsNothing);
      expect(stop(tester), 'metode');
      final walked = <String>[];
      for (var i = 0; i < 3; i++) {
        await press(tester, LogicalKeyboardKey.arrowDown);
        walked.add(stop(tester));
      }
      expect(walked, ['pelanggan', 'tanggal', 'diskon']);
    }, variant: windows);

    testWidgets('Left and Right move between Pelanggan and Tanggal, and Enter opens each', (tester) async {
      await openPayment(tester, size, arrows: true);
      for (var i = 0; i < 2; i++) { await press(tester, LogicalKeyboardKey.arrowUp); }
      expect(stop(tester), 'pelanggan');

      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(stop(tester), 'tanggal');
      await press(tester, LogicalKeyboardKey.arrowLeft);
      expect(stop(tester), 'pelanggan');

      await press(tester, LogicalKeyboardKey.enter);
      expect(FocusManager.instance.primaryFocus!.context!.findAncestorWidgetOfExactType<EditableText>(), isNotNull);

      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(stop(tester), 'tanggal');
      await press(tester, LogicalKeyboardKey.enter);
      expect(find.byType(DatePickerDialog), findsOneWidget);
    }, variant: windows);

    testWidgets('Enter on a chip fills the cash field', (tester) async {
      await openPayment(tester, size, arrows: true);
      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(stop(tester), 'chips');

      await press(tester, LogicalKeyboardKey.enter);
      expect(tester.widget<TextField>(paidField).controller!.text, '1500');

      await press(tester, LogicalKeyboardKey.arrowRight);
      await press(tester, LogicalKeyboardKey.enter);
      expect(tester.widget<TextField>(paidField).controller!.text, '5000');
      expect(stop(tester), 'chips');
      expect(find.byType(LivePaymentScreen), findsOneWidget);
    }, variant: windows);

    testWidgets('Enter on Diskon nota opens the discount dialog once', (tester) async {
      await openPayment(tester, size, arrows: true);
      for (var i = 0; i < 2; i++) { await press(tester, LogicalKeyboardKey.arrowDown); }
      expect(stop(tester), 'diskon');

      await press(tester, LogicalKeyboardKey.enter);

      expect(find.text('Diskon Nota'), findsOneWidget);
    }, variant: windows);

    testWidgets('Right at the end of Biaya lain hops to Keterangan, and Left at its start hops back', (tester) async {
      await openPayment(tester, size, arrows: true);
      for (var i = 0; i < 2; i++) { await press(tester, LogicalKeyboardKey.arrowDown); }
      expect(stop(tester), 'diskon');
      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(stop(tester), 'biaya');

      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(stop(tester), 'keterangan');
      await press(tester, LogicalKeyboardKey.arrowLeft);
      expect(stop(tester), 'biaya');
    }, variant: windows);

    testWidgets('Right from Simpan focuses Batal and Enter goes back without saving', (tester) async {
      await openPayment(tester, size, arrows: true);
      for (var i = 0; i < 5; i++) { await press(tester, LogicalKeyboardKey.arrowDown); }
      expect(stop(tester), 'simpan');

      await press(tester, LogicalKeyboardKey.arrowRight);
      expect(stop(tester), 'batal');
      await press(tester, LogicalKeyboardKey.enter);

      expect(find.byType(LivePaymentScreen), findsNothing);
      expect(calls, isNot(contains('/v1/sales')));
    }, variant: windows);

    testWidgets('Enter on Simpan saves', (tester) async {
      await openPayment(tester, size, arrows: true);
      for (var i = 0; i < 5; i++) { await press(tester, LogicalKeyboardKey.arrowDown); }

      await press(tester, LogicalKeyboardKey.enter);
      await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();

      expect(find.text('Cetak struk #41?'), findsOneWidget);
    }, variant: windows);

    testWidgets('Ctrl+Down is left alone', (tester) async {
      await openPayment(tester, size, arrows: true);

      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await press(tester, LogicalKeyboardKey.arrowDown);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);

      expect(stop(tester), 'uang');
    }, variant: windows);
  });

  testWidgets('Saat ini: Down in the cash field does not move the focus', (tester) async {
    await openPayment(tester, const Size(1440, 900));
    expect(stop(tester), 'uang');

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();

    // the text field's own caret-down action asserts under the test binding; only the focus is checked here
    tester.takeException();
    expect(stop(tester), 'uang');
  }, variant: windows);

  testWidgets('the chip whose amount is typed is tinted, and the tint follows the typing', (tester) async {
    await openPayment(tester, const Size(1440, 900));
    Color chipColor(String text) => tester.widget<Material>(find.ancestor(of: find.text(text), matching: find.byType(Material)).first).color!;

    await tester.enterText(paidField, '5000');
    await tester.pump();
    expect(chipColor('Rp5.000'), KasirColors.tint2);
    expect(chipColor('Rp10.000'), KasirColors.surface);

    await tester.enterText(paidField, '10000');
    await tester.pump();
    expect(chipColor('Rp5.000'), KasirColors.surface);
    expect(chipColor('Rp10.000'), KasirColors.tint2);
  }, variant: windows);
}
