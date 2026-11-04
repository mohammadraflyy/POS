import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pos_server/pos_server.dart';
import 'package:pos_server/src/db/demo_seed.dart';
import 'package:pos_server/src/printing/printer.dart';
import 'package:pos_server/src/printing/receipts.dart';

import '../lib/core/theme.dart';
import '../lib/Screen/MainScreen.dart';
import '../lib/Screen/menus.dart';
import '../lib/services/mobile_api.dart';
import '../lib/state/app_state.dart';
import 'session_test.dart' show MemoryStorage;
import 'support/in_process.dart';

/// The desktop's nota features, end to end against the real server: an edited nota and a
/// sale with a charge, a note and its own date.
void main() {
  late Db db;
  late AppState app;

  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
      await tester.pump(const Duration(milliseconds: 300));
    }
  }

  Future<void> start(WidgetTester tester, Menu menu) async {
    tester.view.physicalSize = const Size(1440, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'), (call) async => null);
    db = Db.open(':memory:');
    await tester.runAsync(() async {
      seedDemoData(db);
      final handler = buildHandler(ApiContext(db: db, pairing: PairingCodes(), receipts: ReceiptService(db, const NoPrinter()), serverAddress: () => null, port: 48950));
      app = AppState(api: MobileApi(transport: InProcessTransport(handler)), storage: MemoryStorage());
      await app.login(host: '127.0.0.1:48950', username: 'admin', password: 'admin', deviceName: 'PC');
    });
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: MainScreen(app: app, initialMenu: menu)));
    await settle(tester);
  }

  Future<void> tapText(WidgetTester tester, String label) async {
    final target = find.text(label).evaluate().isNotEmpty ? find.text(label) : find.textContaining(label);
    await tester.ensureVisible(target.last);
    await tester.tap(target.last);
    await settle(tester);
  }

  testWidgets('a saved nota opens in the till, keeps its prices, and saves as an edit', (tester) async {
    await start(tester, Menu.riwayat);
    final saleId = (await tester.runAsync(() async => db.scalar<int>("SELECT max(id) FROM sales WHERE status = 'selesai' AND metode_pembayaran = 'tunai'")))!;
    final before = (await tester.runAsync(() async => db.first('SELECT total, created_at FROM sales WHERE id = ?', [saleId])))!;

    await tapText(tester, '#$saleId');
    await tapText(tester, 'Ubah nota di kasir');
    expect(find.textContaining('Mengubah nota #$saleId'), findsOneWidget);

    await tapText(tester, 'Bayar');
    expect(find.text('Ubah nota #$saleId'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Keterangan / alasan perubahan'), 'Salah input');
    await tapText(tester, 'Simpan perubahan');
    await tapText(tester, 'Lewati');

    final after = (await tester.runAsync(() async => db.first('SELECT total, created_at, keterangan FROM sales WHERE id = ?', [saleId])))!;
    expect(after['total'], before['total'], reason: 'the lines kept the prices they were sold at');
    expect(after['created_at'], before['created_at'], reason: 'an edit keeps the sale on its own day (to the minute)');
    expect(after['keterangan'], 'Salah input');
    expect(await tester.runAsync(() async => db.scalar<int>('SELECT count(*) FROM sale_edits WHERE sale_id = ?', [saleId])), 1);
    expect(find.textContaining('Mengubah nota'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(() async => db.close());
  });

  testWidgets('a sale carries its charge and note to the server', (tester) async {
    await start(tester, Menu.kasir);
    await tester.tap(find.byTooltip('Tambah Air Galon Isi Ulang'));
    await settle(tester);
    await tapText(tester, 'Bayar');
    await tester.enterText(find.widgetWithText(TextField, 'Biaya lain (Rp)'), '2000');
    await tester.enterText(find.widgetWithText(TextField, 'Keterangan'), 'Antar ke rumah');
    await tester.enterText(find.widgetWithText(TextField, 'Uang diterima (Rp)'), '10000');
    await settle(tester);
    expect(find.text('Kembalian'), findsOneWidget);
    expect(find.text('Rp2.000'), findsWidgets); // 10.000 - (6.000 + 2.000)
    await tapText(tester, 'Simpan transaksi');
    await tapText(tester, 'Lewati');

    final sale = (await tester.runAsync(() async => db.first('SELECT total, biaya_lain, keterangan FROM sales ORDER BY id DESC LIMIT 1')))!;
    expect(sale, {'total': 800000, 'biaya_lain': 200000, 'keterangan': 'Antar ke rumah'});
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(() async => db.close());
  });

  testWidgets('a saved purchase opens in the purchase form and saves as an edit', (tester) async {
    await start(tester, Menu.pembelian);
    final purchaseId = (await tester.runAsync(() async => db.scalar<int>('SELECT max(id) FROM purchases')))!;
    final lines = (await tester.runAsync(() async => db.scalar<int>('SELECT count(*) FROM purchase_items WHERE purchase_id = ?', [purchaseId])))!;

    await tapText(tester, 'Daftar pembelian');
    await tapText(tester, '#$purchaseId');
    await tapText(tester, 'Ubah pembelian');
    expect(find.text('Ubah pembelian #$purchaseId'), findsWidgets);

    final downPayment = find.widgetWithText(TextField, 'Uang muka (opsional, Rp)');
    await tester.scrollUntilVisible(downPayment, 200, scrollable: find.byType(Scrollable).last);
    await tester.enterText(downPayment, '0');
    await tapText(tester, 'Simpan perubahan');
    await tapText(tester, 'Simpan');

    final saved = (await tester.runAsync(() async => db.first('SELECT dibayar FROM purchases WHERE id = ?', [purchaseId])))!;
    expect(saved['dibayar'], 0, reason: 'the whole invoice is now owed');
    expect(await tester.runAsync(() async => db.scalar<int>('SELECT count(*) FROM purchase_items WHERE purchase_id = ?', [purchaseId])), lines);
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(() async => db.close());
  });

  testWidgets('mass input adds several products at once and refuses a bad row', (tester) async {
    await start(tester, Menu.produk);
    await tapText(tester, 'Input massal');
    final cells = find.byType(TextField);
    // row 1: a code that already exists, so the whole save is refused and the row is marked
    await tester.enterText(cells.at(0), 'AQUAG');
    await tester.enterText(cells.at(2), 'Galon kembar');
    await tester.enterText(cells.at(6), '6000');
    // row 2: a good new product
    await tester.enterText(cells.at(8), 'ES01');
    await tester.enterText(cells.at(10), 'Es Batu');
    await tester.enterText(cells.at(13), '1000');
    await tester.enterText(cells.at(14), '2000');
    await tester.enterText(cells.at(15), '25');
    await tapText(tester, 'Simpan 2 baris');
    expect(find.textContaining('Baris 1:'), findsOneWidget);
    expect(await tester.runAsync(() async => db.scalar<int>("SELECT count(*) FROM products WHERE kode_item = 'ES01'")), 0, reason: 'all or nothing');
    await tapText(tester, 'Mengerti');

    await tester.enterText(cells.at(0), 'GLN2');
    await tapText(tester, 'Simpan 2 baris');
    final added = await tester.runAsync(() async => db.select("SELECT kode_item, harga_jual, stok FROM products WHERE kode_item IN ('GLN2', 'ES01') ORDER BY kode_item"));
    expect(added, [
      {'kode_item': 'ES01', 'harga_jual': 200000, 'stok': 25},
      {'kode_item': 'GLN2', 'harga_jual': 600000, 'stok': 0},
    ]);
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(() async => db.close());
  });
}
