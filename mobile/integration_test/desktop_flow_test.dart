// Drives the real Windows app against a running pos_server:
//   flutter test integration_test/desktop_flow_test.dart -d windows \
//     --dart-define=SERVER=127.0.0.1:48961 --dart-define=USER=admin --dart-define=PASS=admin
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:point_of_sales/main.dart';
import 'package:point_of_sales/Screen/Toko/ProductsScreen.dart';
import 'package:point_of_sales/services/session_storage.dart';
import 'package:point_of_sales/state/app_state.dart';

class MemoryStorage implements SessionStorage {
  String? value;
  @override Future<String?> read() async => value;
  @override Future<void> write(String value) async { this.value = value; }
  @override Future<void> clear() async { value = null; }
}

const server = String.fromEnvironment('SERVER', defaultValue: '127.0.0.1:48950');
const user = String.fromEnvironment('USER', defaultValue: 'admin');
const pass = String.fromEnvironment('PASS', defaultValue: 'admin');

/// Real network calls finish on their own time, so pump in steps until [finder] shows.
Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 15)}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  throw TestFailure('Timed out waiting for $finder');
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 15; i++) { await tester.pump(const Duration(milliseconds: 100)); }
}

Future<void> capture(WidgetTester tester, String name) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(shotKey));
  final image = await boundary.toImage(pixelRatio: 1);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  final folder = Directory('build/desktop-preview')..createSync(recursive: true);
  File('${folder.path}/$name.png').writeAsBytesSync(data!.buffer.asUint8List());
  image.dispose();
}

final shotKey = GlobalKey();

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('admin signs in on the PC and opens every menu', (tester) async {
    tester.view.physicalSize = const Size(1366, 820);
    tester.view.devicePixelRatio = 1;
    final app = AppState(storage: MemoryStorage());
    await tester.pumpWidget(RepaintBoundary(key: shotKey, child: MyApp(app: app)));
    await waitFor(tester, find.text('Masuk ke toko'));
    await capture(tester, '00-login');

    await tester.enterText(find.widgetWithText(TextField, 'Alamat server'), server);
    await tester.enterText(find.widgetWithText(TextField, 'Username'), user);
    await tester.enterText(find.widgetWithText(TextField, 'Password'), pass);
    await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
    await waitFor(tester, find.text('PEMBELIAN & STOK'));
    await settle(tester);
    expect(app.isAdmin, isTrue);
    await capture(tester, '01-kasir');

    // a sale end to end: find, add, pay
    await tester.enterText(find.widgetWithText(TextField, 'Cari barang'), 'mi instan');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await waitFor(tester, find.textContaining('Mi Instan'));
    await settle(tester);
    await capture(tester, '02-kasir-cari');

    const menus = ['Dashboard', 'Riwayat', 'Pelanggan', 'Pembelian', 'Hutang supplier', 'Supplier', 'Produk', 'Opname',
      'Kartu stok', 'Pengeluaran', 'Rekap', 'Pengguna', 'Pengaturan'];
    for (var i = 0; i < menus.length; i++) {
      final item = find.widgetWithText(ListTile, menus[i]);
      await tester.ensureVisible(item);
      await settle(tester);
      await tester.tap(item);
      await settle(tester);
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      expect(tester.takeException(), isNull, reason: menus[i]);
      await capture(tester, '${(i + 3).toString().padLeft(2, '0')}-${menus[i].toLowerCase().replaceAll(' ', '-')}');
    }

    // product detail from the catalog
    final produk = find.widgetWithText(ListTile, 'Produk');
    await tester.ensureVisible(produk);
    await settle(tester);
    await tester.tap(produk);
    await settle(tester);
    await tester.enterText(find.widgetWithText(TextField, 'Cari nama, kode, atau barcode'), 'mi instan');
    final row = find.descendant(of: find.byType(ProductsScreen), matching: find.text('Mi Instan Goreng'));
    await waitFor(tester, row);
    await settle(tester);
    expect(find.descendant(of: find.byType(ProductsScreen), matching: find.text('Air Mineral 600 ml')), findsNothing);
    await tester.tap(row.first);
    await waitFor(tester, find.text('Harga bertingkat'));
    await settle(tester);
    await capture(tester, '20-produk-detail');
    await tester.pageBack();
    await settle(tester);

    // a write through a form dialog: record an expense and see it listed
    final pengeluaran = find.widgetWithText(ListTile, 'Pengeluaran');
    await tester.ensureVisible(pengeluaran);
    await tester.tap(pengeluaran);
    await settle(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Catat'));
    await settle(tester);
    final note = 'Uji PC ${DateTime.now().millisecondsSinceEpoch}';
    await tester.enterText(find.widgetWithText(TextField, 'Kategori *'), 'BENSIN');
    await tester.enterText(find.widgetWithText(TextField, 'Jumlah *'), '25000');
    await tester.enterText(find.widgetWithText(TextField, 'Keterangan'), note);
    await tester.tap(find.widgetWithText(FilledButton, 'Simpan'));
    await waitFor(tester, find.text(note));
    await settle(tester);
    expect(find.text('Rp25.000'), findsWidgets);
    await capture(tester, '21-pengeluaran-tersimpan');
  });

  testWidgets('the same app at phone width uses the bottom bar and Lainnya', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    final app = AppState(storage: MemoryStorage());
    await tester.pumpWidget(RepaintBoundary(key: shotKey, child: MyApp(app: app)));
    await waitFor(tester, find.text('Masuk ke toko'));
    await tester.enterText(find.widgetWithText(TextField, 'Alamat server'), server);
    await tester.enterText(find.widgetWithText(TextField, 'Username'), user);
    await tester.enterText(find.widgetWithText(TextField, 'Password'), pass);
    await tester.tap(find.widgetWithText(FilledButton, 'Masuk'));
    await waitFor(tester, find.text('Lainnya'));
    await settle(tester);
    await capture(tester, 'phone-00-kasir');

    for (final title in ['Dashboard', 'Produk', 'Hutang supplier', 'Pengeluaran', 'Rekap', 'Pengaturan']) {
      await tester.tap(find.text('Lainnya'));
      await settle(tester);
      await capture(tester, 'phone-01-lainnya');
      await tester.tap(find.text(title).last);
      await settle(tester);
      await tester.pump(const Duration(seconds: 1));
      await settle(tester);
      expect(tester.takeException(), isNull, reason: title);
      await capture(tester, 'phone-${title.toLowerCase().replaceAll(' ', '-')}');
    }
  });
}
