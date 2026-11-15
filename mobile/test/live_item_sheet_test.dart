import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/models/live_models.dart';
import '../lib/Screen/Live/LiveItemSheet.dart';

LiveProduct _product() => LiveProduct(1, 'Beras Pandan Wangi 5kg', 'BRS5', 103, [
  LiveUnit(null, 'KG', 15500),
  LiveUnit(7, 'SAK', 75000, conversionFactor: 5),
]);

// Cost known and a 10+ tier on KG, so the tier and below-cost paths have something to hit.
LiveProduct _costed() => LiveProduct(1, 'Beras Pandan Wangi 5kg', 'BRS5', 103, [
  LiveUnit(null, 'KG', 15500, cost: 12000, tiers: const [LiveTier(10, null, 14000)]),
  LiveUnit(7, 'SAK', 75000, cost: 60000, conversionFactor: 5),
]);

/// Opens the sheet from a button and hands back what it popped.
Future<({Future<LiveCartItem?> Function() result})> _open(WidgetTester tester, Size size, {VoidCallback? onRemove, LiveProduct? product}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.reset);
  Future<LiveCartItem?>? pending;
  await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Builder(builder: (context) => Scaffold(
    body: TextButton(onPressed: () => pending = editLiveItem(context, product ?? _product(), onRemove: onRemove), child: const Text('open'))))));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return (result: () async => pending!);
}

bool _focused(WidgetTester tester, Finder inside) => Focus.of(tester.element(inside)).hasPrimaryFocus;

// The unit's name also labels the Jumlah row, so scope to the tile.
Finder _tile(String name) => find.descendant(of: find.widgetWithText(InkWell, name), matching: find.text(name));

TextField _field(WidgetTester tester, String key) => tester.widget<TextField>(find.byKey(ValueKey(key)));

Future<void> _press(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyEvent(key);
  await tester.pump();
}

Future<void> _chord(WidgetTester tester, LogicalKeyboardKey modifier, LogicalKeyboardKey key) async {
  await tester.sendKeyDownEvent(modifier);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(modifier);
  await tester.pump();
}

void main() {
  testWidgets('desktop: second unit tile, plus twice and Simpan return that unit with quantity 3', (tester) async {
    final opened = await _open(tester, const Size(1200, 800));
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('BRS5 · stok 103 KG'), findsOneWidget);

    await tester.tap(_tile('SAK'));
    await tester.pump();
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    await tester.tap(find.byTooltip('Tambah jumlah'));
    await tester.tap(find.byTooltip('Tambah jumlah'));
    await tester.pump();
    expect(find.text('Rp225.000'), findsOneWidget);
    expect(find.text('3 SAK × Rp75.000'), findsOneWidget);
    expect(find.text('− Rp0'), findsOneWidget);

    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    final item = await opened.result();
    expect(item!.unit.name, 'SAK');
    expect(item.quantity, 3);
    expect(item.manualPrice, isNull);
    expect(item.discount, isNull);
  });

  testWidgets('manual price and percent discount feed the summary and the result', (tester) async {
    final opened = await _open(tester, const Size(1200, 800));
    await tester.enterText(find.byKey(const ValueKey('manual')), '16000');
    await tester.enterText(find.byKey(const ValueKey('discount')), '10%');
    await tester.pump();
    expect(find.text('Rp14.400'), findsOneWidget);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    final item = (await opened.result())!;
    expect(item.manualPrice, 16000);
    expect(item.discount, 1600);
  });

  testWidgets('Esc closes without a result', (tester) async {
    final opened = await _open(tester, const Size(1200, 800));
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byType(Dialog), findsNothing);
    expect(await opened.result(), isNull);
  });

  testWidgets('an unreadable quantity shows a dash and the error only after Simpan', (tester) async {
    await _open(tester, const Size(1200, 800));
    await tester.enterText(find.byKey(const ValueKey('quantity')), 'abc');
    await tester.pump();
    expect(find.text('Jumlah harus berupa angka valid dan tidak negatif.'), findsNothing);
    await tester.tap(find.text('Simpan'));
    await tester.pump();
    expect(find.text('Jumlah harus berupa angka valid dan tidak negatif.'), findsOneWidget);
    expect(find.byType(Dialog), findsOneWidget);
  });

  testWidgets('minus never goes below 1 and keeps a typed fraction', (tester) async {
    await _open(tester, const Size(1200, 800));
    final field = find.byKey(const ValueKey('quantity'));
    await tester.tap(find.byTooltip('Kurangi jumlah'));
    await tester.pump();
    expect(tester.widget<TextField>(field).controller!.text, '1');
    await tester.enterText(field, '0,25');
    await tester.tap(find.byTooltip('Kurangi jumlah'));
    await tester.pump();
    expect(tester.widget<TextField>(field).controller!.text, '0,25');
  });

  testWidgets('no Hapus barang without onRemove', (tester) async {
    await _open(tester, const Size(1200, 800));
    expect(find.text('Hapus barang'), findsNothing);
  });

  testWidgets('Hapus barang closes with null, then calls onRemove', (tester) async {
    var removed = 0;
    final opened = await _open(tester, const Size(1200, 800), onRemove: () => removed++);
    await tester.tap(find.text('Hapus barang'));
    await tester.pumpAndSettle();
    expect(removed, 1);
    expect(await opened.result(), isNull);
  });

  testWidgets('phone: bottom sheet with the same content and result', (tester) async {
    final opened = await _open(tester, const Size(390, 800));
    expect(find.byType(Dialog), findsNothing);
    expect(find.byType(BottomSheet), findsOneWidget);
    await tester.tap(_tile('SAK'));
    await tester.tap(find.byTooltip('Tambah jumlah'));
    await tester.pump();
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    final item = (await opened.result())!;
    expect(item.unit.name, 'SAK');
    expect(item.quantity, 2);
  });

  testWidgets('the dialog is as big as its card, not a full-height frame around it', (tester) async {
    await _open(tester, const Size(1366, 768));
    final shell = find.descendant(of: find.byType(Dialog), matching: find.byType(Material)).first;
    expect(tester.getSize(shell).height, lessThan(600));
  });

  testWidgets('opens on Jumlah with the whole number selected', (tester) async {
    await _open(tester, const Size(1200, 800));
    final quantity = _field(tester, 'quantity');
    expect(quantity.focusNode!.hasPrimaryFocus, isTrue);
    expect(quantity.controller!.selection, const TextSelection(baseOffset: 0, extentOffset: 1));
    await tester.enterText(find.byKey(const ValueKey('quantity')), '12');
    await tester.pump();
    expect(find.text('12 KG × Rp15.500'), findsOneWidget);
  });

  testWidgets('up from Jumlah reaches the unit tiles, right moves to the next tile, Enter selects it', (tester) async {
    await _open(tester, const Size(1200, 800));
    await _press(tester, LogicalKeyboardKey.arrowUp);
    expect(_focused(tester, _tile('KG')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowRight);
    expect(_focused(tester, _tile('SAK')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowRight);
    expect(_focused(tester, _tile('SAK')), isTrue);
    await _press(tester, LogicalKeyboardKey.enter);
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(_field(tester, 'quantity').focusNode!.hasPrimaryFocus, isTrue);
  });

  testWidgets('down walks Jumlah, Harga satuan, Diskon, then the footer; left and right move between its buttons', (tester) async {
    await _open(tester, const Size(1200, 800), onRemove: () {});
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(_field(tester, 'manual').focusNode!.hasPrimaryFocus, isTrue);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(_field(tester, 'discount').focusNode!.hasPrimaryFocus, isTrue);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(_focused(tester, find.text('Simpan')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(_focused(tester, find.text('Simpan')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowLeft);
    expect(_focused(tester, find.text('Batal')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowLeft);
    expect(_focused(tester, find.text('Hapus barang')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowRight);
    expect(_focused(tester, find.text('Batal')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowUp);
    expect(_field(tester, 'discount').focusNode!.hasPrimaryFocus, isTrue);
    expect(_field(tester, 'discount').controller!.selection.isCollapsed, isTrue);
  });

  testWidgets('landing on a field selects its text so typing replaces it', (tester) async {
    await _open(tester, const Size(1200, 800));
    await tester.enterText(find.byKey(const ValueKey('manual')), '16000');
    await _press(tester, LogicalKeyboardKey.arrowUp);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    final manual = _field(tester, 'manual');
    expect(manual.focusNode!.hasPrimaryFocus, isTrue);
    expect(manual.controller!.selection, const TextSelection(baseOffset: 0, extentOffset: 5));
  });

  testWidgets('left and right stay caret moves inside Jumlah', (tester) async {
    await _open(tester, const Size(1200, 800));
    await _press(tester, LogicalKeyboardKey.arrowRight);
    await _press(tester, LogicalKeyboardKey.arrowLeft);
    expect(_field(tester, 'quantity').focusNode!.hasPrimaryFocus, isTrue);
  });

  testWidgets('Enter on Simpan returns the item, Enter on Batal returns null', (tester) async {
    var opened = await _open(tester, const Size(1200, 800));
    for (var i = 0; i < 3; i++) { await _press(tester, LogicalKeyboardKey.arrowDown); }
    await _press(tester, LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect((await opened.result())!.quantity, 1);

    opened = await _open(tester, const Size(1200, 800));
    for (var i = 0; i < 3; i++) { await _press(tester, LogicalKeyboardKey.arrowDown); }
    await _press(tester, LogicalKeyboardKey.arrowLeft);
    await _press(tester, LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(await opened.result(), isNull);
  });

  testWidgets('Alt+2 picks the second unit; PgUp and PgDn move between units without leaving Jumlah', (tester) async {
    await _open(tester, const Size(1200, 800));
    await _chord(tester, LogicalKeyboardKey.altLeft, LogicalKeyboardKey.digit2);
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    expect(_field(tester, 'quantity').focusNode!.hasPrimaryFocus, isTrue);
    await _press(tester, LogicalKeyboardKey.pageUp);
    expect(find.text('BRS5 · stok 103 KG'), findsOneWidget);
    await _press(tester, LogicalKeyboardKey.pageDown);
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    await _press(tester, LogicalKeyboardKey.pageDown);
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    await _chord(tester, LogicalKeyboardKey.altLeft, LogicalKeyboardKey.digit9);
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    expect(_field(tester, 'quantity').focusNode!.hasPrimaryFocus, isTrue);
  });

  testWidgets('+ and - step Jumlah and never land in the field as characters', (tester) async {
    await _open(tester, const Size(1200, 800));
    final text = _field(tester, 'quantity').controller!;
    await _press(tester, LogicalKeyboardKey.numpadAdd);
    await _press(tester, LogicalKeyboardKey.numpadAdd);
    expect(text.text, '3');
    await _press(tester, LogicalKeyboardKey.numpadSubtract);
    expect(text.text, '2');
    await tester.sendKeyDownEvent(LogicalKeyboardKey.equal, character: '+');
    await tester.sendKeyUpEvent(LogicalKeyboardKey.equal);
    await tester.pump();
    expect(text.text, '3');
    await _press(tester, LogicalKeyboardKey.minus);
    expect(text.text, '2');
    expect(text.text, isNot(contains('+')));
  });

  testWidgets('Alt+D jumps to Diskon with its text selected; 10% shows the rupiah and updates the subtotal', (tester) async {
    await _open(tester, const Size(1200, 800));
    await tester.enterText(find.byKey(const ValueKey('discount')), '10%');
    await tester.pump();
    expect(find.text('= Rp1.550'), findsOneWidget);
    expect(find.text('− Rp1.550  (10%)'), findsOneWidget);
    expect(find.text('Rp13.950'), findsOneWidget);

    await _chord(tester, LogicalKeyboardKey.altLeft, LogicalKeyboardKey.keyJ);
    expect(_field(tester, 'quantity').focusNode!.hasPrimaryFocus, isTrue);
    await _chord(tester, LogicalKeyboardKey.altLeft, LogicalKeyboardKey.keyD);
    final discount = _field(tester, 'discount');
    expect(discount.focusNode!.hasPrimaryFocus, isTrue);
    expect(discount.controller!.selection, const TextSelection(baseOffset: 0, extentOffset: 3));
    await _chord(tester, LogicalKeyboardKey.altLeft, LogicalKeyboardKey.keyH);
    expect(_field(tester, 'manual').focusNode!.hasPrimaryFocus, isTrue);
  });

  testWidgets('Ctrl+Delete removes the item when onRemove is given, and does nothing without it', (tester) async {
    var removed = 0;
    final opened = await _open(tester, const Size(1200, 800), onRemove: () => removed++);
    await _chord(tester, LogicalKeyboardKey.controlLeft, LogicalKeyboardKey.delete);
    await tester.pumpAndSettle();
    expect(removed, 1);
    expect(find.byType(Dialog), findsNothing);
    expect(await opened.result(), isNull);

    await _open(tester, const Size(1200, 800));
    await _chord(tester, LogicalKeyboardKey.controlLeft, LogicalKeyboardKey.delete);
    expect(find.byType(Dialog), findsOneWidget);
  });

  testWidgets('the subtotal in the title row is price × quantity − discount', (tester) async {
    await _open(tester, const Size(1200, 800));
    await tester.tap(_tile('SAK'));
    await tester.enterText(find.byKey(const ValueKey('quantity')), '2');
    await tester.enterText(find.byKey(const ValueKey('manual')), '80000');
    await tester.enterText(find.byKey(const ValueKey('discount')), '5000');
    await tester.pump();
    expect(find.text('SUBTOTAL'), findsOneWidget);
    expect(find.text('Rp155.000'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('quantity')), 'abc');
    await tester.pump();
    expect(find.text('—'), findsNWidgets(2));
  });

  test('priceTiers attach to the base unit via baseProductUnitId and to other units by id', () {
    final p = LiveProduct.fromJson({
      'productId': 1, 'namaItem': 'Beras', 'satuan': 'KG', 'hargaJual': 15500, 'baseProductUnitId': 5,
      'productUnits': [{'id': 7, 'satuan': 'SAK', 'konversi': 5, 'hargaJual': 75000}],
      'priceTiers': [
        {'productUnitId': 5, 'minQty': 10, 'maxQty': null, 'hargaJual': 14000},
        {'productUnitId': 7, 'minQty': 2, 'maxQty': 5, 'hargaJual': 70000},
      ],
    });
    expect(p.units[0].tiers.map((t) => t.price), [14000]);
    expect(p.units[1].tiers.map((t) => t.price), [70000]);
    expect(p.units[1].tiers.single.maxQty, 5);
  });

  test('priceFor picks the highest satisfied minQty, respects maxQty and falls back to price', () {
    final u = LiveUnit(null, 'KG', 15500, tiers: const [LiveTier(5, 9, 15000), LiveTier(10, null, 14000), LiveTier(20, null, 13000)]);
    expect(u.priceFor(3), 15500);
    expect(u.priceFor(5), 15000);
    expect(u.priceFor(9), 15000);
    expect(u.priceFor(10), 14000);
    expect(u.priceFor(25), 13000);
    expect(LiveUnit(null, 'KG', 15500, tiers: const [LiveTier(5, 9, 15000)]).priceFor(12), 15500);
  });

  testWidgets('a tier changes the price, breakdown, subtotal and note; below its minimum the normal price returns', (tester) async {
    await _open(tester, const Size(1200, 800), product: _costed());
    await tester.enterText(find.byKey(const ValueKey('quantity')), '12');
    await tester.pump();
    expect(find.text('12 KG × Rp14.000'), findsOneWidget);
    expect(find.text('Rp168.000'), findsOneWidget);
    expect(find.text('grosir 10+'), findsOneWidget);
    expect(find.text('otomatis'), findsNothing);

    await tester.enterText(find.byKey(const ValueKey('quantity')), '3');
    await tester.pump();
    expect(find.text('3 KG × Rp15.500'), findsOneWidget);
    expect(find.text('otomatis'), findsOneWidget);
    expect(find.text('grosir 10+'), findsNothing);
  });

  testWidgets('a discount that pushes the line below cost shows the loss and still saves', (tester) async {
    final opened = await _open(tester, const Size(1200, 800), product: _costed());
    await tester.enterText(find.byKey(const ValueKey('quantity')), '10');
    await tester.pump();
    expect(find.textContaining('Di bawah modal'), findsNothing);
    await tester.enterText(find.byKey(const ValueKey('discount')), '30000');
    await tester.pump();
    // 10 × 14.000 − 30.000 = 110.000 against a cost of 120.000
    expect(find.text('Di bawah modal — rugi Rp10.000'), findsOneWidget);
    await tester.tap(find.text('Simpan'));
    await tester.pumpAndSettle();
    expect((await opened.result())!.discount, 30000);
  });

  testWidgets('a manual price under the unit cost refuses to save', (tester) async {
    await _open(tester, const Size(1200, 800), product: _costed());
    await tester.enterText(find.byKey(const ValueKey('manual')), '11000');
    await tester.pump();
    await tester.tap(find.text('Simpan'));
    await tester.pump();
    expect(find.text('Harga satuan di bawah modal (Rp12.000).'), findsOneWidget);
    expect(find.byType(Dialog), findsOneWidget);
  });

  testWidgets('without a known cost there is no below-cost notice', (tester) async {
    await _open(tester, const Size(1200, 800));
    await tester.enterText(find.byKey(const ValueKey('discount')), '15000');
    await tester.pump();
    expect(find.textContaining('Di bawah modal'), findsNothing);
  });

  testWidgets('on a desktop the keycaps, key legend and slogan show', (tester) async {
    await _open(tester, const Size(1200, 800));
    expect(find.text('Alt+1'), findsOneWidget);
    expect(find.text('Alt+2'), findsOneWidget);
    expect(find.text('PgUp / PgDn ganti satuan'), findsOneWidget);
    expect(find.text('Alt+J/H/D'), findsOneWidget);
    expect(find.text('Ctrl+Del'), findsNothing);
    expect(find.text('Ketik angka, Enter. Selesai.'), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.windows));

  testWidgets('on a desktop the legend offers Ctrl+Del only with onRemove', (tester) async {
    await _open(tester, const Size(1200, 800), onRemove: () {});
    expect(find.text('Ctrl+Del'), findsOneWidget);
    expect(find.text('Ketik angka, Enter. Selesai.'), findsNothing);
  }, variant: TargetPlatformVariant.only(TargetPlatform.windows));
}
