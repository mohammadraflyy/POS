import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/store_api.dart';
import '../lib/Screen/Toko/ProductsScreen.dart';
import '../lib/Screen/Toko/ReportsScreen.dart';
import '../lib/Screen/Toko/SettingsScreen.dart';
import '../lib/Screen/Toko/MassInputScreen.dart';
import '../lib/services/draft_store.dart';

/// A pretend server for the admin tools the desktop app had: answers by method + path
/// and remembers every call.
class FakeStore {
  final calls = <(String, String, Map<String, dynamic>?)>[];
  final Map<String, Object? Function(Map<String, dynamic>? body)> routes;
  FakeStore(this.routes);
  late final api = StoreApi((path, {required method, query, body}) async {
    calls.add((method, path, body));
    final route = routes['$method $path'];
    if (route == null) throw StateError('Unexpected $method $path');
    return route(body);
  }, (path, {method = 'GET', query, upload}) async => throw UnimplementedError());
  bool called(String method, String path) => calls.any((c) => c.$1 == method && c.$2 == path);
}

const page = {'currentPage': 1, 'lastPage': 1, 'total': 2};

Future<void> show(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: screen)));
  await tester.pumpAndSettle();
}

Future<void> tapText(WidgetTester tester, String label) async {
  await tester.ensureVisible(find.text(label).last);
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('ticks several products and deletes them at once, naming the ones with history', (tester) async {
    final store = FakeStore({
      'GET /v1/products': (_) => {'data': [
        {'id': 1, 'kodeItem': 'K1', 'namaItem': 'Kopi', 'satuan': 'PCS', 'stok': 5, 'hargaPokok': 1500, 'hargaJual': 2000},
        {'id': 2, 'kodeItem': 'T1', 'namaItem': 'Teh', 'satuan': 'PCS', 'stok': 3, 'hargaPokok': 1000, 'hargaJual': 1500},
      ], ...page},
      'POST /v1/products/bulk-delete': (_) => {'deleted': 1, 'blocked': ['Teh']},
    });
    await show(tester, ProductsScreen(api: store.api, isAdmin: true));

    expect(find.textContaining('Hapus terpilih'), findsNothing);
    await tester.tap(find.byType(Checkbox).at(0));
    await tester.tap(find.byType(Checkbox).at(1));
    await tester.pumpAndSettle();

    await tapText(tester, 'Hapus terpilih (2)');
    await tapText(tester, 'Hapus');

    expect(store.calls.firstWhere((c) => c.$2 == '/v1/products/bulk-delete').$3, {'ids': [1, 2]});
    expect(find.textContaining('tidak bisa dihapus karena sudah punya riwayat transaksi: Teh'), findsOneWidget);
  });

  testWidgets('a kasir sees no checkboxes', (tester) async {
    final store = FakeStore({'GET /v1/products': (_) => {'data': [{'id': 1, 'kodeItem': 'K1', 'namaItem': 'Kopi', 'satuan': 'PCS', 'stok': 5}], ...page}});
    await show(tester, ProductsScreen(api: store.api, isAdmin: false));

    expect(find.byType(Checkbox), findsNothing);
  });

  testWidgets('clears today\'s sales from the danger zone only after confirming', (tester) async {
    final store = FakeStore({
      'GET /v1/settings': (_) => {'namaToko': 'Toko Uji', 'receiptWidth': '58mm', 'marginMinimalPersen': 10},
      'GET /v1/printers': (_) => {'data': <Object>[]},
      'GET /v1/devices': (_) => {'data': <Object>[]},
      'POST /v1/sales-purge/today': (_) => {'deleted': 3, 'skipped': 1},
    });
    await show(tester, SettingsScreen(api: store.api, isAdmin: true));

    await tapText(tester, 'Hapus transaksi hari ini');
    await tapText(tester, 'Batal');
    expect(store.called('POST', '/v1/sales-purge/today'), isFalse);

    await tapText(tester, 'Hapus transaksi hari ini');
    await tapText(tester, 'Hapus permanen');
    expect(store.called('POST', '/v1/sales-purge/today'), isTrue);
    expect(find.textContaining('3 transaksi dihapus, 1 dilewati'), findsOneWidget);
  });

  testWidgets('a kasir has no danger zone', (tester) async {
    final store = FakeStore({
      'GET /v1/settings': (_) => {'namaToko': 'Toko Uji', 'receiptWidth': '58mm'},
      'GET /v1/printers': (_) => {'data': <Object>[]},
    });
    await show(tester, SettingsScreen(api: store.api, isAdmin: false));

    expect(find.text('Zona berbahaya'), findsNothing);
  });

  testWidgets('corrects the cost of a line sold at a loss: preview, reason, save', (tester) async {
    final store = FakeStore({
      'GET /v1/rekap': (_) => {
        'summary': {'omzetTunai': 1, 'labaKotor': -500},
        'penjelasanLaba': {'penjualanKotor': 3000, 'diskonItem': 0, 'diskonNota': 0, 'omzet': 3000, 'modal': 3500, 'labaKotor': -500,
          'jumlahBarisRugi': 1, 'totalRugi': -500, 'saran': <Object>[],
          'barisRugi': [{'saleItemId': 41, 'saleId': 9, 'productId': 2, 'namaItem': 'Mie Instan', 'satuan': 'PCS', 'qty': 1,
            'hargaJual': 3000, 'hargaPokok': 3500, 'diskon': 0, 'laba': -500}]},
        'labaPerKategori': <Object>[], 'labaPerHari': <Object>[], 'labaPerSatuan': <Object>[], 'produkTerlaris': <Object>[],
        'pembelianPerSupplier': <Object>[], 'piutangPerPelanggan': <Object>[],
        'stockValue': {'totalNilai': 0, 'produk': <Object>[]},
      },
      'POST /v1/rekap/cost-corrections/preview': (body) => {'token': 'tok-1', 'namaItem': 'Mie Instan', 'satuan': 'PCS', 'hargaPokok': body!['hargaPokok'],
        'labaLama': -500, 'labaBaru': 500,
        'rows': [{'saleItemId': 41, 'saleId': 9, 'tanggal': '2026-11-04T10:00:00.000', 'qty': 1, 'hargaPokokLama': 3500, 'omzet': 3000, 'labaLama': -500, 'labaBaru': 500}]},
      'POST /v1/rekap/cost-corrections': (_) => {'count': 1},
    });
    await show(tester, RekapScreen(api: store.api));

    expect(find.textContaining('Mie Instan (PCS) · nota #9'), findsOneWidget);
    await tapText(tester, 'Koreksi HPP');

    await tester.enterText(find.widgetWithText(TextField, 'HPP yang benar per PCS (Rp)'), '2500');
    await tapText(tester, 'Tampilkan pratinjau');
    expect(store.calls.last.$3, {'saleItemId': 41, 'scope': 'item', 'from': anything, 'to': anything, 'hargaPokok': 2500});
    expect(find.textContaining('1 baris akan dikoreksi'), findsOneWidget);

    // no reason, no save
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Simpan koreksi HPP')).onPressed, isNull);
    await tester.enterText(find.widgetWithText(TextField, 'Alasan koreksi'), 'Salah input, sesuai faktur');
    await tester.pumpAndSettle();
    await tapText(tester, 'Simpan koreksi HPP');

    final saved = store.calls.firstWhere((c) => c.$2 == '/v1/rekap/cost-corrections').$3!;
    expect(saved['token'], 'tok-1');
    expect(saved['alasan'], 'Salah input, sesuai faktur');
    expect(find.textContaining('1 baris dikoreksi'), findsOneWidget);
  });

  testWidgets('/ jumps to the search and Delete removes the ticked products, as on the desktop', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    final store = FakeStore({
      'GET /v1/products': (_) => {'data': [{'id': 1, 'kodeItem': 'K1', 'namaItem': 'Kopi', 'satuan': 'PCS', 'stok': 5}], ...page},
      'POST /v1/products/bulk-delete': (_) => {'deleted': 1, 'blocked': <String>[]},
    });
    await show(tester, ProductsScreen(api: store.api, isAdmin: true));

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    expect(tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus, isTrue);

    FocusManager.instance.primaryFocus?.unfocus();
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.sendKeyEvent(LogicalKeyboardKey.delete);
    await tester.pumpAndSettle();
    expect(find.text('Hapus 1 produk terpilih?'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('the new-product grid comes back after leaving it, and a save clears it', (tester) async {
    final drafts = MemoryDraftStore();
    final store = FakeStore({'POST /v1/products/bulk-save': (_) => {'success': true, 'created': 1, 'updated': 0, 'unchanged': 0}});
    await show(tester, MassInputScreen(api: store.api, drafts: drafts));
    await tester.enterText(find.byType(TextField).at(0), 'ES01');
    await tester.enterText(find.byType(TextField).at(2), 'Es Batu');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpWidget(const SizedBox());
    expect(drafts.value, contains('Es Batu'));

    await show(tester, MassInputScreen(api: store.api, drafts: drafts));
    expect(tester.widget<TextField>(find.byType(TextField).at(2)).controller!.text, 'Es Batu');
    await tapText(tester, 'Mengerti'); // the "restored" notice

    await tapText(tester, 'Simpan 1 baris');
    expect(drafts.value, isNull);
  });
}
