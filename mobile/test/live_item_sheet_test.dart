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

/// Opens the sheet from a button and hands back what it popped.
Future<({Future<LiveCartItem?> Function() result})> _open(WidgetTester tester, Size size, {VoidCallback? onRemove}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.reset);
  Future<LiveCartItem?>? pending;
  await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Builder(builder: (context) => Scaffold(
    body: TextButton(onPressed: () => pending = editLiveItem(context, _product(), onRemove: onRemove), child: const Text('open'))))));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return (result: () async => pending!);
}

bool _focused(WidgetTester tester, Finder inside) => Focus.of(tester.element(inside)).hasPrimaryFocus;

Future<void> _press(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyEvent(key);
  await tester.pump();
}

void main() {
  testWidgets('desktop: second unit chip, plus twice and Simpan return that unit with quantity 3', (tester) async {
    final opened = await _open(tester, const Size(1200, 800));
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('BRS5 · stok 103 KG'), findsOneWidget);

    await tester.tap(find.text('SAK'));
    await tester.pump();
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    await tester.tap(find.byTooltip('Tambah jumlah'));
    await tester.tap(find.byTooltip('Tambah jumlah'));
    await tester.pump();
    expect(find.text('Rp225.000'), findsOneWidget);
    expect(find.text('3 SAK × Rp75.000 − Rp0'), findsOneWidget);

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
    await tester.enterText(find.widgetWithText(TextField, 'Harga manual'), '16000');
    await tester.enterText(find.widgetWithText(TextField, 'Diskon'), '10%');
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
    await tester.enterText(find.widgetWithText(TextField, 'Jumlah'), 'abc');
    await tester.pump();
    expect(find.text('Jumlah harus berupa angka valid dan tidak negatif.'), findsNothing);
    await tester.tap(find.text('Simpan'));
    await tester.pump();
    expect(find.text('Jumlah harus berupa angka valid dan tidak negatif.'), findsOneWidget);
    expect(find.byType(Dialog), findsOneWidget);
  });

  testWidgets('minus never goes below 1 and keeps a typed fraction', (tester) async {
    await _open(tester, const Size(1200, 800));
    final field = find.widgetWithText(TextField, 'Jumlah');
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
    await tester.tap(find.text('SAK'));
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
    final quantity = tester.widget<TextField>(find.widgetWithText(TextField, 'Jumlah'));
    expect(quantity.focusNode!.hasPrimaryFocus, isTrue);
    expect(quantity.controller!.selection, const TextSelection(baseOffset: 0, extentOffset: 1));
    await tester.enterText(find.widgetWithText(TextField, 'Jumlah'), '12');
    await tester.pump();
    expect(find.text('12 KG × Rp15.500 − Rp0'), findsOneWidget);
  });

  testWidgets('up from Jumlah reaches the unit chips, right moves to the next chip, Enter selects it', (tester) async {
    await _open(tester, const Size(1200, 800));
    await _press(tester, LogicalKeyboardKey.arrowUp);
    expect(_focused(tester, find.text('KG')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowRight);
    expect(_focused(tester, find.text('SAK')), isTrue);
    await _press(tester, LogicalKeyboardKey.arrowRight);
    expect(_focused(tester, find.text('SAK')), isTrue);
    await _press(tester, LogicalKeyboardKey.enter);
    expect(find.text('BRS5 · stok 20,6 SAK'), findsOneWidget);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(tester.widget<TextField>(find.widgetWithText(TextField, 'Jumlah')).focusNode!.hasPrimaryFocus, isTrue);
  });

  testWidgets('down walks Jumlah, Harga manual, Diskon, then the footer; left and right move between its buttons', (tester) async {
    await _open(tester, const Size(1200, 800), onRemove: () {});
    TextField field(String label) => tester.widget<TextField>(find.widgetWithText(TextField, label));
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(field('Harga manual').focusNode!.hasPrimaryFocus, isTrue);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    expect(field('Diskon').focusNode!.hasPrimaryFocus, isTrue);
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
    expect(field('Diskon').focusNode!.hasPrimaryFocus, isTrue);
    expect(field('Diskon').controller!.selection.isCollapsed, isTrue);
  });

  testWidgets('landing on a field selects its text so typing replaces it', (tester) async {
    await _open(tester, const Size(1200, 800));
    await tester.enterText(find.widgetWithText(TextField, 'Harga manual'), '16000');
    await _press(tester, LogicalKeyboardKey.arrowUp);
    await _press(tester, LogicalKeyboardKey.arrowDown);
    final manual = tester.widget<TextField>(find.widgetWithText(TextField, 'Harga manual'));
    expect(manual.focusNode!.hasPrimaryFocus, isTrue);
    expect(manual.controller!.selection, const TextSelection(baseOffset: 0, extentOffset: 5));
  });

  testWidgets('left and right stay caret moves inside Jumlah', (tester) async {
    await _open(tester, const Size(1200, 800));
    await _press(tester, LogicalKeyboardKey.arrowRight);
    await _press(tester, LogicalKeyboardKey.arrowLeft);
    expect(tester.widget<TextField>(find.widgetWithText(TextField, 'Jumlah')).focusNode!.hasPrimaryFocus, isTrue);
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
}
