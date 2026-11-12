import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/Screen/MainScreen.dart';
import '../lib/Widgets/cashier_lock_dialog.dart';
import '../lib/Widgets/auth_layout.dart' show AuthBanner;
import '../lib/Screen/Pairing/PairingScreen.dart';
import '../lib/Widgets/ui.dart' show SidebarArea;
import '../lib/services/mobile_api.dart';
import '../lib/state/app_state.dart';
import 'session_test.dart' show MemoryStorage;

class MockAuthTransport implements JsonTransport {
  MockAuthTransport({this.correctPassword = 'secret123'});
  final String correctPassword;
  int loginCalls = 0;

  @override
  Future<ApiResponse> send(String method, Uri uri, Map<String, String> headers, Map<String, dynamic>? body) async {
    if (uri.path == '/v1/auth/login') {
      loginCalls++;
      final pwd = body?['password']?.toString() ?? '';
      if (pwd == correctPassword) {
        return ApiResponse(200, {
          'token': 'new-auth-token',
          'user': {
            'id': 10,
            'username': 'budi',
            'name': 'Budi Santoso',
            'role': 'kasir',
          },
        });
      }
      return ApiResponse(401, {'error': 'Password tidak cocok'});
    }
    if (uri.path == '/v1/health') {
      return ApiResponse(200, {'ok': true});
    }
    if (uri.path == '/v1/me') {
      return ApiResponse(200, {
        'user': {'id': 10, 'username': 'budi', 'name': 'Budi Santoso', 'role': 'kasir'}
      });
    }
    if (uri.path == '/v1/settings') {
      return ApiResponse(200, {'namaToko': 'Toko Berkah'});
    }
    if (uri.path == '/v1/catalog/search') {
      return ApiResponse(200, {'data': [], 'currentPage': 1, 'lastPage': 1, 'total': 0});
    }
    if (uri.path == '/v1/units') {
      return ApiResponse(200, {'data': []});
    }
    if (uri.path == '/v1/carts/price') {
      return ApiResponse(200, {'lines': [], 'subtotal': 0, 'diskon': 0, 'total': 0, 'stockEnough': true});
    }
    return ApiResponse(200, {'data': []});
  }
}

Future<AppState> buildConnectedApp({String password = 'secret123'}) async {
  final transport = MockAuthTransport(correctPassword: password);
  final api = MobileApi(transport: transport);
  final app = AppState(api: api, storage: MemoryStorage());
  await app.login(
    host: '127.0.0.1:48950',
    username: 'budi',
    password: password,
    deviceName: 'Kasir-PC',
  );
  return app;
}

void main() {
  testWidgets('CashierLockDialog in Demo Mode unlocks directly without password', (tester) async {
    final app = AppState(api: MobileApi(), storage: MemoryStorage());
    app.startDemo();

    bool? unlocked;
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              unlocked = await showCashierLockDialog(
                context,
                app: app,
                shopName: 'Toko Demo',
              );
            },
            child: const Text('Kunci Kasir'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('Kunci Kasir'));
    await tester.pumpAndSettle();

    expect(find.text('Kasir Terkunci'), findsOneWidget);
    expect(find.text('Demo'), findsOneWidget);
    expect(find.text('Buka Kunci Kasir'), findsOneWidget);

    // Tap Buka Kunci Kasir
    await tester.tap(find.text('Buka Kunci Kasir'));
    await tester.pumpAndSettle();

    expect(find.text('Kasir Terkunci'), findsNothing);
    expect(unlocked, isTrue);
  });

  testWidgets('CashierLockDialog in Connected Mode verifies password and shows error on failure', (tester) async {
    final app = await buildConnectedApp(password: 'secret123');

    bool? unlocked;
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () async {
              unlocked = await showCashierLockDialog(
                context,
                app: app,
                shopName: 'Toko Berkah',
              );
            },
            child: const Text('Kunci Kasir'),
          ),
        ),
      ),
    ));

    await tester.tap(find.text('Kunci Kasir'));
    await tester.pumpAndSettle();

    expect(find.text('Kasir Terkunci'), findsOneWidget);
    expect(find.text('Budi Santoso'), findsOneWidget);

    // Enter wrong password
    await tester.enterText(find.byType(TextField), 'salah123');
    await tester.tap(find.text('Buka Kunci Kasir'));
    await tester.pumpAndSettle();

    // Error message appears and dialog remains open
    expect(find.text('Password tidak cocok'), findsOneWidget);
    expect(unlocked, isNull);

    // Enter correct password and submit via Enter action
    await tester.enterText(find.byType(TextField), 'secret123');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    // Unlocks successfully
    expect(find.text('Kasir Terkunci'), findsNothing);
    expect(unlocked, isTrue);
  });

  testWidgets('MainScreen desktop header displays badge and proper Kunci Kasir button (not settings)', (tester) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final app = await buildConnectedApp();
    await tester.pumpWidget(MaterialApp(
      theme: buildTheme(Palette.light),
      home: MainScreen(app: app),
    ));
    await tester.pumpAndSettle();

    // Server badge and Kunci Kasir button exist on the desktop header
    expect(find.textContaining('Server Terhubung'), findsOneWidget);
    expect(find.widgetWithText(OutlinedButton, 'Kunci Kasir'), findsOneWidget);

    // Clicking Kunci Kasir opens CashierLockDialog, NOT AccountPanel (settings)
    await tester.tap(find.widgetWithText(OutlinedButton, 'Kunci Kasir'));
    await tester.pumpAndSettle();

    // Verifies lock dialog opens with proper title
    expect(find.text('Kasir Terkunci'), findsOneWidget);
    expect(find.text('Akun & Perangkat'), findsNothing); // AccountPanel was not opened!

    // Unlock with password
    // full screen: the till behind the lock is hidden
    expect(find.byType(SidebarArea), findsNothing);
    final lockInput = find.descendant(of: find.byType(CashierLockDialog), matching: find.byType(TextField));
    await tester.enterText(lockInput, 'secret123');
    await tester.tap(find.text('Buka Kunci Kasir'));
    await tester.pumpAndSettle();

    expect(find.text('Kasir Terkunci'), findsNothing);

    // Test Ctrl+L shortcut opens lock screen
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(find.text('Kasir Terkunci'), findsOneWidget);
    // wide window: the lock uses the sign-in layout, banner on the left
    expect(find.byType(AuthBanner), findsOneWidget);
  });

  testWidgets('Sign-in screen splits into banner and form on a wide window only', (tester) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = AppState(api: MobileApi(), storage: MemoryStorage());

    tester.view.physicalSize = const Size(1280, 800);
    await tester.pumpWidget(MaterialApp(theme: buildTheme(Palette.light), home: PairingScreen(app: app)));
    expect(find.byType(AuthBanner), findsOneWidget);
    expect(tester.getCenter(find.byType(TextField).first).dx, greaterThan(640));

    tester.view.physicalSize = const Size(600, 900);
    await tester.pump();
    expect(find.byType(AuthBanner), findsNothing);
  });

  testWidgets('Ctrl+Down and Ctrl+Up walk the sidebar menus from the keyboard', (tester) async {
    tester.view.physicalSize = const Size(1280, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = await buildConnectedApp();
    // the same shortcut table main.dart gives the app
    await tester.pumpWidget(MaterialApp(theme: buildTheme(Palette.light),
      shortcuts: {...WidgetsApp.defaultShortcuts, ...MainScreen.menuShortcuts}, home: MainScreen(app: app)));
    await tester.pumpAndSettle();

    bool? selected(String title) => tester.widget<Semantics>(find.descendant(of: find.byType(SidebarArea),
      matching: find.byWidgetPredicate((w) => w is Semantics && w.properties.label == title))).properties.selected;
    Future<void> ctrl(LogicalKeyboardKey key) async {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(key);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
    }

    expect(selected('Kasir'), isTrue);
    await ctrl(LogicalKeyboardKey.arrowDown);
    expect(selected('Riwayat'), isTrue);
    expect(selected('Kasir'), isFalse);
    await ctrl(LogicalKeyboardKey.arrowUp);
    expect(selected('Kasir'), isTrue);
  });

  testWidgets('Ctrl+Down to the bottom of a long sidebar scrolls the active menu into view', (tester) async {
    // short enough that the sidebar's menu list has to scroll
    tester.view.physicalSize = const Size(1280, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final app = await buildConnectedApp();
    await tester.pumpWidget(MaterialApp(theme: buildTheme(Palette.light),
      shortcuts: {...WidgetsApp.defaultShortcuts, ...MainScreen.menuShortcuts}, home: MainScreen(app: app)));
    await tester.pumpAndSettle();

    final list = find.descendant(of: find.byType(SidebarArea), matching: find.byType(ListView));
    final viewport = tester.getRect(list);
    for (var i = 0; i < 20; i++) {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
    }
    final active = find.descendant(of: list, matching: find.byWidgetPredicate((w) => w is Semantics && w.properties.selected == true));
    // the list really moved: without the scroll the last menu sits below the fold
    expect(Scrollable.of(tester.element(active)).position.pixels, greaterThan(0));
    final row = tester.getRect(active);
    expect(row.top, greaterThanOrEqualTo(viewport.top));
    expect(row.bottom, lessThanOrEqualTo(viewport.bottom));
  });
}
