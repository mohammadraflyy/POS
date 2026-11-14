import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/store_api.dart';
import '../lib/Screen/Live/LiveHistoryScreen.dart';
import '../lib/Screen/Live/LiveSaleScreen.dart';
import '../lib/Widgets/admin.dart';

/// A pretend server that remembers every call with its query.
class _Server {
  _Server(this.sales);
  final Map<int, Map<String, Object?>> sales;
  final calls = <String>[];
  final pages = <String>[];
  late final api = StoreApi((path, {required method, query, body}) async {
    calls.add('$method $path');
    if (path == '/v1/sales') {
      final page = query?['page'] ?? '1';
      pages.add(page);
      final rows = page == '1' ? [for (final id in [5, 6, 7]) _row(id)] : [_row(8)];
      return {'data': rows, 'currentPage': int.parse(page), 'lastPage': 2};
    }
    if (path.endsWith('/print')) return {'printed': true};
    final id = int.tryParse(path.split('/').last);
    final sale = sales[id];
    if (method == 'GET' && sale != null) return sale;
    throw StateError('Unexpected $method $path');
  }, (path, {method = 'GET', query, upload}) async => throw UnimplementedError());
  int get prints => calls.where((c) => c.endsWith('/print')).length;

  static Map<String, Object?> _row(int id) => {
    'id': id, 'createdAt': '2026-11-10T09:00:00.000', 'namaPelanggan': 'Pelanggan $id', 'metodePembayaran': 'tunai', 'status': 'selesai',
    'total': 1000 * id, 'dibayar': 1000 * id, 'laba': 100, 'items': [{'namaItem': 'Barang $id', 'qty': 1}],
  };
}

Map<String, Object?> _bon({String status = 'selesai'}) => {
  'id': 12, 'namaPelanggan': 'Bu Siti', 'metodePembayaran': 'bon', 'status': status, 'diskon': 1000, 'biayaLain': 2000,
  'total': 15000, 'dibayar': 5000, 'modal': 12000, 'laba': 3000, 'kasirName': 'Admin', 'createdAt': '2026-11-10T09:00:00.000',
  'items': [
    {'id': 1, 'namaItem': 'Beras', 'qty': 2, 'satuan': 'KG', 'hargaJual': 7000, 'diskon': 500, 'subtotal': 13500, 'priceSource': 'price_tier'},
    {'id': 2, 'namaItem': 'Gula', 'qty': 1, 'satuan': 'PCS', 'hargaJual': 2500, 'diskon': 0, 'subtotal': 2500},
  ],
  'bonPayments': [{'id': 1, 'tanggal': '2026-11-10', 'jumlah': 5000, 'keterangan': 'Titip siang'}],
  'edits': <Object>[],
};

/// The keys only exist on a PC, so each test runs as Windows on a 1440 x 900 window.
void desktopTest(String name, Future<void> Function(WidgetTester tester) body) => testWidgets(name, (tester) async {
  debugDefaultTargetPlatformOverride = TargetPlatform.windows;
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  try {
    await body(tester);
  } finally {
    debugDefaultTargetPlatformOverride = null;
  }
});

/// A root page whose button opens the nota, so Esc has somewhere to go back to.
Future<void> openNota(WidgetTester tester, _Server server, {Map<String, dynamic>? confirmation}) async {
  await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Builder(builder: (context) => Scaffold(body: Center(child: TextButton(
    onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LiveSaleScreen(api: server.api, id: 12, isAdmin: true, confirmation: confirmation, onEdit: (_) async {}))),
    child: const Text('buka')))))));
  await tester.tap(find.text('buka'));
  await tester.pumpAndSettle();
}

Future<void> press(WidgetTester tester, LogicalKeyboardKey key) async {
  await tester.sendKeyEvent(key);
  await tester.pumpAndSettle();
}

void main() {
  group('nota detail', () {
    desktopTest('an open bon shows the lines table, the amber balance and Bayar bon', (tester) async {
      await openNota(tester, _Server({12: _bon()}));
      for (final head in ['NO', 'PRODUK', 'QTY', 'HARGA', 'DISKON', 'SUBTOTAL']) {
        expect(find.text(head), findsOneWidget, reason: head);
      }
      expect(find.text('Beras'), findsOneWidget);
      expect(find.text('grosir'), findsOneWidget);
      expect(find.text('−Rp500'), findsOneWidget);
      expect(find.text('Gula'), findsOneWidget);
      expect(find.text('Belum lunas · sisa Rp10.000'), findsOneWidget);
      expect(find.text('Sisa piutang'), findsOneWidget);
      expect(find.text('Bayar bon'), findsOneWidget);
      expect(find.textContaining('Modal Rp12.000 · laba'), findsOneWidget);
      expect(find.text('Cicilan bon'.toUpperCase()), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    desktopTest('P prints once, and Esc goes back to the page that opened it', (tester) async {
      final server = _Server({12: _bon()});
      await openNota(tester, server);
      await press(tester, LogicalKeyboardKey.keyP);
      expect(server.prints, 1);
      expect(find.text('Struk dikirim ke printer PC.'), findsOneWidget);
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byType(LiveSaleScreen), findsOneWidget, reason: 'the first Esc closes the notice');
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byType(LiveSaleScreen), findsNothing);
      expect(find.text('buka'), findsOneWidget);
    });

    desktopTest('arrows walk the actions and the lines, Enter runs the focused action', (tester) async {
      final server = _Server({12: _bon()});
      await openNota(tester, server);
      // opens on the first action, Bayar bon
      await press(tester, LogicalKeyboardKey.enter);
      expect(find.text('Simpan pembayaran'), findsOneWidget);
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.text('Simpan pembayaran'), findsNothing);

      await press(tester, LogicalKeyboardKey.arrowDown);
      await press(tester, LogicalKeyboardKey.enter);
      expect(server.prints, 1, reason: 'the second action is Cetak ulang');
      await press(tester, LogicalKeyboardKey.escape);

      // up through the first action into the lines, then back down onto the actions
      await press(tester, LogicalKeyboardKey.arrowUp);
      await press(tester, LogicalKeyboardKey.arrowUp);
      final bar = find.byWidgetPredicate((w) => w is Container && w.decoration is BoxDecoration && ((w.decoration! as BoxDecoration).border as Border?)?.left.width == 3);
      expect(bar, findsOneWidget, reason: 'the last line is highlighted');
      await press(tester, LogicalKeyboardKey.arrowUp);
      await press(tester, LogicalKeyboardKey.arrowDown);
      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(bar, findsNothing);
      await press(tester, LogicalKeyboardKey.enter);
      expect(find.text('Simpan pembayaran'), findsOneWidget, reason: 'back on Bayar bon');
    });

    desktopTest('letter keys do nothing while a dialog is open', (tester) async {
      final server = _Server({12: _bon()});
      await openNota(tester, server);
      await press(tester, LogicalKeyboardKey.keyB);
      expect(find.text('Simpan pembayaran'), findsOneWidget);
      await press(tester, LogicalKeyboardKey.keyP);
      await press(tester, LogicalKeyboardKey.keyS);
      expect(server.prints, 0);
      expect(find.text('Simpan pembayaran'), findsOneWidget);
    });

    desktopTest('a cancelled nota shows the red pill and no laba', (tester) async {
      await openNota(tester, _Server({12: _bon(status: 'dibatalkan')}));
      expect(find.text('Dibatalkan'), findsOneWidget);
      expect(find.textContaining('laba'), findsNothing);
      expect(find.text('Sisa piutang'), findsNothing);
      expect(find.text('Bayar bon'), findsNothing);
    });

    desktopTest('right after a sale it shows the slim notice and goes back to Kasir', (tester) async {
      await openNota(tester, _Server({12: _bon()}), confirmation: const {'saleId': 12, 'total': 15000, 'printed': true});
      await tester.tap(find.text('Mengerti'));
      await tester.pumpAndSettle();
      expect(find.text('Penjualan sudah tersimpan. Struk tercetak di PC.'), findsOneWidget);
      expect(find.text('Kasir'), findsOneWidget);
      expect(find.text('Riwayat'), findsNothing);
    });
  });

  group('riwayat list', () {
    DataView<Map<String, dynamic>> view(WidgetTester tester) => tester.widget(find.byType(DataView<Map<String, dynamic>>));
    bool searching(WidgetTester tester) => tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus;

    desktopTest('/ focuses the search, arrows pick rows, Enter opens, PgDn turns the page, ↑ on the first row goes back up', (tester) async {
      final server = _Server({6: {..._bon(), 'id': 6}});
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: Scaffold(body: LiveHistoryScreen(api: server.api, isAdmin: true))));
      await tester.pumpAndSettle();
      expect(view(tester).highlightedIndex, isNull);

      await press(tester, LogicalKeyboardKey.slash);
      expect(searching(tester), isTrue);
      await press(tester, LogicalKeyboardKey.escape);
      expect(searching(tester), isFalse);
      await press(tester, LogicalKeyboardKey.slash);

      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(searching(tester), isFalse);
      expect(view(tester).highlightedIndex, 0);
      await press(tester, LogicalKeyboardKey.arrowDown);
      expect(view(tester).highlightedIndex, 1);

      await press(tester, LogicalKeyboardKey.enter);
      expect(tester.widget<LiveSaleScreen>(find.byType(LiveSaleScreen)).id, 6);
      await press(tester, LogicalKeyboardKey.escape);
      expect(find.byType(LiveSaleScreen), findsNothing);
      expect(view(tester).highlightedIndex, 1, reason: 'the list keeps its place after the nota closes');

      await press(tester, LogicalKeyboardKey.pageDown);
      expect(server.pages.last, '2');
      expect(find.text('#8'), findsOneWidget);
      expect(view(tester).highlightedIndex, 0);

      await press(tester, LogicalKeyboardKey.arrowUp);
      expect(view(tester).highlightedIndex, isNull);
      expect(searching(tester), isTrue);
    });
  });
}
