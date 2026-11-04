// Screenshots of the real app against the real server, filled with the demo shop.
//
//   flutter test test/screen_gallery_test.dart --dart-define=UI_PREVIEWS=true
//
// Writes build/screens/<width>-<screen>.png. Skipped in a normal test run.
import 'dart:convert';
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
import 'package:shelf/shelf.dart' as shelf;

import '../lib/core/theme.dart';
import '../lib/Screen/MainScreen.dart';
import '../lib/Screen/menus.dart';
import '../lib/services/mobile_api.dart';
import '../lib/state/app_state.dart';
import 'session_test.dart' show MemoryStorage;

const _enabled = bool.fromEnvironment('UI_PREVIEWS');

/// Sends the app's requests straight into the server's handler, no sockets.
class InProcessTransport implements JsonTransport {
  InProcessTransport(this.handler);
  final shelf.Handler handler;
  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    final response = await handler(shelf.Request(method, Uri.parse('http://localhost${uri.path}${uri.hasQuery ? '?${uri.query}' : ''}'),
      headers: headers, body: body == null ? null : jsonEncode(body)));
    final text = await response.readAsString();
    return ApiResponse(response.statusCode, text.isEmpty ? null : jsonDecode(text));
  }
}

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
          (Menu.rekap, 'rekap'), (Menu.pembelian, 'pembelian'), (Menu.pengaturan, 'pengaturan')]) {
        final key = GlobalKey();
        await tester.pumpWidget(RepaintBoundary(key: key, child: MaterialApp(debugShowCheckedModeBanner: false, theme: buildTheme(),
          home: MainScreen(key: ValueKey(name), app: app, initialMenu: menu))));
        await settle();
        await _capture(tester, key, '$label-$name');
      }

      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(() async { db.close(); });
    }, skip: !_enabled, timeout: const Timeout(Duration(minutes: 4)));
  }
}
