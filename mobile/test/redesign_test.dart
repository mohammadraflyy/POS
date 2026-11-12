import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/Widgets/popup.dart' show AppPopup;
import '../lib/core/theme.dart';
import '../lib/Widgets/ui.dart';
import '../lib/Screen/MainScreen.dart';
import '../lib/Screen/Pairing/PairingScreen.dart';
import '../lib/Screen/Live/LiveKasirScreen.dart';
import '../lib/Screen/Live/LivePaymentScreen.dart';
import '../lib/Screen/Live/LivePurchaseScreen.dart';
import '../lib/Screen/Live/LiveSaleScreen.dart';
import '../lib/state/app_state.dart';
import '../lib/state/live_store.dart';
import '../lib/services/business_api.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/models/live_models.dart';

class _Memory extends PendingStore {
  String? value;
  @override Future<String?> read() async => value;
  @override Future<void> write(String data) async { value = data; }
  @override Future<void> clear() async { value = null; }
}

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  if (!const bool.fromEnvironment('UI_PREVIEWS')) return;
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final image = await boundary.toImage(pixelRatio: 1);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  await tester.runAsync(() async {
    final folder = Directory('build/ui-preview');
    await folder.create(recursive: true);
    await File('${folder.path}/$name.png').writeAsBytes(data!.buffer.asUint8List());
  });
  image.dispose();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    if (!const bool.fromEnvironment('UI_PREVIEWS')) return;
    final sdk = Platform.environment['FLUTTER_ROOT'] ?? 'C:/flutter';
    final loader = FontLoader('Roboto');
    for (final weight in ['regular', 'medium', 'bold']) {
      loader.addFont(File('$sdk/bin/cache/artifacts/material_fonts/roboto-$weight.ttf')
        .readAsBytes().then((bytes) => ByteData.sublistView(bytes)));
    }
    await loader.load();
  });

  for (final scenario in [
    (const Size(390, 844), 1.0, 'phone'),
    (const Size(844, 390), 1.0, 'landscape'),
    (const Size(1280, 800), 1.0, 'tablet'),
    (const Size(320, 720), 2.0, 'large-text'),
  ]) {
    testWidgets('all demo tabs and cart remain usable ${scenario.$3}', (tester) async {
      tester.view.physicalSize = scenario.$1; tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final app = AppState()..startDemo();
      app.add(app.demo.products.first);
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(theme: buildTheme(),
        builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scenario.$2)), child: child!),
        home: MainScreen(app: app))));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'kasir-${scenario.$3}');
      for (final label in ['Pembelian', 'Opname', 'Riwayat', 'Kasir']) {
        await tester.tap(find.text(label).last);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: label);
      }
      if (scenario.$3 != 'tablet') {
        await tester.tap(find.text('Keranjang · 1 barang'));
        await tester.pumpAndSettle();
        final button = find.text('Lanjut bayar');
        await tester.ensureVisible(button);
        await tester.pumpAndSettle();
        expect(button.hitTestable(), findsOneWidget);
        await tester.tap(button);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await _capture(tester, key, 'payment-${scenario.$3}');
      }
      await tester.pumpWidget(const SizedBox()); app.dispose();
    });
  }

  testWidgets('live catalog, checkout, and purchase render with server data', (tester) async {
    tester.view.physicalSize = const Size(390, 844); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final guard = MutationGuard(_Memory()); await guard.load();
    final api = BusinessApi((path, {required method, query, body}) async {
      if (path == '/v1/catalog/search') return {'data': [
        {'id': 1, 'namaItem': 'Beras Pandan Wangi 5 kg', 'kodeItem': 'BRS-005', 'satuan': 'PCS', 'stok': 24, 'hargaJual': 78000},
        {'id': 2, 'namaItem': 'Minyak Goreng 1 Liter', 'kodeItem': 'MYK-001', 'satuan': 'PCS', 'stok': 36, 'hargaJual': 19000},
        {'id': 3, 'namaItem': 'Gula Pasir Premium', 'kodeItem': 'GLA-001', 'satuan': 'KG', 'stok': 18, 'hargaJual': 17500},
      ], 'currentPage': 1, 'lastPage': 1};
      if (path == '/v1/customers') return {'names': <String>[]};
      if (path == '/v1/carts/price') return {'lines': [{'stokCukup': true, 'hargaJual': 78000}], 'subtotal': 78000, 'diskon': 0, 'total': 78000};
      throw StateError('Unexpected request: $path');
    });
    final store = LiveStore(api, guard);
    final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(theme: buildTheme(),
      home: Scaffold(appBar: AppBar(title: const Text('Kasir')), body: LiveKasirScreen(store: store)))));
    await tester.pumpAndSettle();
    expect(find.text('Beras Pandan Wangi 5 kg'), findsOneWidget);
    await tester.tap(find.byTooltip('Tambah Beras Pandan Wangi 5 kg'));
    await tester.pump(const Duration(milliseconds: 300)); await tester.pumpAndSettle();
    expect(store.items.single.quantity, 1);
    expect(store.price?.total, 78000);
    await _capture(tester, key, 'kasir-live');
    await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(theme: buildTheme(), home: LivePaymentScreen(store: store))));
    await tester.pumpAndSettle();
    await _capture(tester, key, 'payment-live');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(theme: buildTheme(),
      home: Scaffold(appBar: AppBar(title: const Text('Pembelian')), body: LivePurchaseScreen(api: api, guard: guard)))));
    await tester.pumpAndSettle();
    await _capture(tester, key, 'purchase-live');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox()); store.dispose(); guard.dispose();
  });

  testWidgets('print recovery calls only print endpoint once', (tester) async {
    final requests = <String>[];
    final api = BusinessApi((path, {required method, query, body}) async {
      requests.add('$method $path');
      if (path.endsWith('/print')) return {'printed': true};
      return {'id': 7, 'total': 78000, 'items': <Object>[]};
    });
    final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(theme: buildTheme(), home: LiveSaleScreen(api: api, id: 7,
      confirmation: const {'printed': false, 'total': 78000, 'printError': 'Printer tidak merespons.'}))));
    await tester.pumpAndSettle();
    await _capture(tester, key, 'print-warning');
    await tester.tap(find.widgetWithText(FilledButton, 'Cetak ulang'));
    await tester.pumpAndSettle();
    expect(requests, ['GET /v1/sales/7', 'POST /v1/sales/7/print']);
    expect(find.text('Struk dikirim ke printer PC.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion and large text modal remains readable', (tester) async {
    tester.view.physicalSize = const Size(320, 640); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: MediaQuery(
      data: const MediaQueryData(size: Size(320, 640), textScaler: TextScaler.linear(2), disableAnimations: true),
      child: Builder(builder: (context) => Scaffold(body: TextButton(onPressed: () {
        expect(Motion.duration(context, Motion.enter), Duration.zero);
        showNotice(context, 'Jumlah barang melebihi stok yang tersedia. Ubah jumlah sebelum melanjutkan.',
          title: 'Stok tidak cukup', kind: NoticeKind.warning);
      }, child: const Text('Buka')))),
    )));
    await tester.tap(find.text('Buka')); await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Mengerti')); await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsNothing);
  });

  testWidgets('pairing keyboard and field values survive an error', (tester) async {
    tester.view.physicalSize = const Size(390, 844); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final app = AppState(); final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(theme: buildTheme(), home: PairingScreen(app: app))));
    await tester.pumpAndSettle();
    await _capture(tester, key, 'pairing');
    await tester.enterText(find.byType(TextField).first, 'kasir-satu');
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpAndSettle();
    final button = find.widgetWithText(FilledButton, 'Hubungkan perangkat');
    await tester.ensureVisible(button); await tester.tap(button); await tester.pumpAndSettle();
    expect(find.byType(AppPopup), findsOneWidget);
    await tester.tap(find.text('Mengerti')); await tester.pumpAndSettle();
    expect(find.text('kasir-satu'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox()); app.dispose();
  });
}
