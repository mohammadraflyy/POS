// Screenshots of the real app against the real server, filled with the demo shop.
//
//   flutter test test/screen_gallery_test.dart --dart-define=UI_PREVIEWS=true
//
// Writes build/screens/<width>-<screen>.png. Skipped in a normal test run.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
import '../lib/models/live_models.dart';
import '../lib/services/mutation_guard.dart';
import '../lib/services/store_api.dart';
import '../lib/state/live_store.dart';
import '../lib/Screen/Live/LivePaymentScreen.dart';
import '../lib/Screen/Live/LiveSaleScreen.dart';
import '../lib/Screen/Pairing/PairingScreen.dart';
import '../lib/Screen/AccountPanel.dart';

class _NoPending implements PendingStore {
  @override Future<String?> read() async => null;
  @override Future<void> write(String data) async {}
  @override Future<void> clear() async {}
}

const _enabled = bool.fromEnvironment('UI_PREVIEWS');

Future<void> _loadFonts() async {
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final file in files) {
      loader.addFont(File(file).readAsBytes().then((bytes) => ByteData.sublistView(bytes)));
    }
    await loader.load();
  }
  final sdk = Platform.environment['FLUTTER_ROOT'] ?? 'C:/flutter';
  await load('Geist', ['assets/fonts/Geist-Regular.ttf', 'assets/fonts/Geist-Medium.ttf', 'assets/fonts/Geist-Bold.ttf']);
  await load('GeistMono', ['assets/fonts/GeistMono-Regular.ttf', 'assets/fonts/GeistMono-Medium.ttf']);
  await load('Roboto', ['$sdk/bin/cache/artifacts/material_fonts/roboto-regular.ttf', '$sdk/bin/cache/artifacts/material_fonts/roboto-medium.ttf', '$sdk/bin/cache/artifacts/material_fonts/roboto-bold.ttf']);
  await load('MaterialIcons', ['$sdk/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
}

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  // the raster work must run on the real event loop, or the next pump never returns
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    final folder = Directory('build/screens');
    await folder.create(recursive: true);
    await File('${folder.path}/$name.png').writeAsBytes(data!.buffer.asUint8List());
  });
}

void main() {
  setUpAll(() async {
    if (!_enabled) return;
    await _loadFonts();
    // no secure storage in a test: an empty store, so no "check the last sale" warning
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'), (call) async => null);
  });

  for (final (size, label) in [(const Size(1440, 900), 'pc'), (const Size(390, 844), 'hp')]) {
    testWidgets('gallery at $label', (tester) async {
      tester.view.physicalSize = size; tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);

      final db = Db.open(':memory:');
      late AppState app;
      await tester.runAsync(() async {
        seedDemoData(db);
        final handler = buildHandler(ApiContext(db: db, pairing: PairingCodes(), receipts: ReceiptService(db, const NoPrinter()),
          serverAddress: () => '192.168.1.20', port: 48950));
        app = AppState(api: MobileApi(transport: InProcessTransport(handler)), storage: MemoryStorage());
        await app.login(host: '127.0.0.1:48950', username: 'admin', password: 'admin', deviceName: 'PC Kasir');
      });

      Future<void> settle() async {
        for (var i = 0; i < 6; i++) {
          await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 60)));
          await tester.pump(const Duration(milliseconds: 400));
        }
      }

      for (final (menu, name) in [(Menu.kasir, 'kasir'), (Menu.dashboard, 'dashboard'), (Menu.produk, 'produk'), (Menu.riwayat, 'riwayat'),
          (Menu.rekap, 'rekap'), (Menu.pembelian, 'pembelian'), (Menu.pengaturan, 'pengaturan'), (Menu.opname, 'opname'),
          (Menu.pengeluaran, 'pengeluaran'), (Menu.kartuStok, 'kartustok'), (Menu.pelanggan, 'pelanggan'), (Menu.hutang, 'hutang'), (Menu.pengguna, 'pengguna')]) {
        final key = GlobalKey();
        await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(),
          home: MainScreen(key: ValueKey(name), app: app, initialMenu: menu))));
        await settle();
        await _capture(tester, key, '$label-$name');
      }

      // screens reached from the till: a sale's detail, payment with a filled cart, and sign-in
      final api = StoreApi(app.businessRequest, app.businessFile);
      Future<void> shoot(String name, Widget screen) async {
        final key = GlobalKey();
        await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(palette), home: screen)));
        await settle();
        await _capture(tester, key, '$label-$name');
      }
      final saleId = (await tester.runAsync(() async => db.scalar<int>("SELECT max(id) FROM sales WHERE metode_pembayaran = 'bon'")))!;
      await shoot('nota', LiveSaleScreen(api: api, id: saleId, isAdmin: true));
      final guard = MutationGuard(_NoPending());
      await tester.runAsync(() => guard.load());
      final store = LiveStore(api, guard);
      final catalog = await tester.runAsync(() => api.catalog('', 1));
      for (final raw in jsonRows(catalog).take(3)) {
        final product = LiveProduct.fromJson(raw);
        store.put(LiveCartItem(product: product, unit: product.units.first, quantity: 2));
      }
      await shoot('bayar', LivePaymentScreen(store: store));
      await shoot('login', PairingScreen(app: AppState(storage: MemoryStorage())));

      // the account panel, then the main screens again in the dark palette
      await shoot('akun', Builder(builder: (ctx) {
        WidgetsBinding.instance.addPostFrameCallback((_) => showAccountPanel(ctx, app: app, shopName: 'Toko Sembako Berkah (Demo)', onOpenSettings: () {}));
        return const Scaffold();
      }));
      palette = Palette.dark;
      for (final (menu, name) in [(Menu.kasir, 'kasir'), (Menu.dashboard, 'dashboard'), (Menu.produk, 'produk'), (Menu.rekap, 'rekap')]) {
        final key = GlobalKey();
        await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(Palette.dark),
          home: MainScreen(key: ValueKey('dark-$name'), app: app, initialMenu: menu))));
        await settle();
        await _capture(tester, key, '$label-gelap-$name');
      }
      await shoot('gelap-bayar', LivePaymentScreen(store: store));
      palette = Palette.light;

      await tester.pumpWidget(const SizedBox());
      store.dispose(); guard.dispose();
      await tester.runAsync(() async { db.close(); });
    }, skip: !_enabled, timeout: const Timeout(Duration(minutes: 4)));
  }
}
