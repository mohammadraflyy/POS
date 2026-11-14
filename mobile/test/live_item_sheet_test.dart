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
}
