import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/Screen/MainScreen.dart';
import '../lib/Widgets/shortcut_list.dart';
import '../lib/services/draft_store.dart';
import '../lib/state/app_state.dart';
import '../lib/state/theme_controller.dart';
import '../lib/state/window_mode.dart';

const _channel = MethodChannel('pos/window');

/// Answers the native "fullscreen" call the way the runner does and records what was asked.
List<bool> _mockRunner() {
  final asked = <bool>[];
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_channel, (call) async {
    if (call.method == 'fullscreen') { asked.add(call.arguments as bool); return call.arguments; }
    return null;
  });
  addTearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(_channel, null));
  return asked;
}

void main() {
  group('WindowModeController', () {
    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('toggle asks the runner, flips the state and remembers it', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      final asked = _mockRunner();
      final store = MemoryDraftStore();
      final mode = WindowModeController(store: store);

      await mode.toggle();
      expect(mode.value, isTrue);
      expect(await store.read(), 'on');
      await mode.toggle();
      expect(mode.value, isFalse);
      expect(await store.read(), 'off');
      expect(asked, [true, false]);
    });

    test('load puts the window back in full screen when it was left that way', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      final asked = _mockRunner();
      final store = MemoryDraftStore()..value = 'on';
      final mode = WindowModeController(store: store);

      await mode.load();
      expect(mode.value, isTrue);
      expect(asked, [true]);

      final fresh = WindowModeController(store: MemoryDraftStore()..value = 'off');
      await fresh.load();
      expect(fresh.value, isFalse);
      expect(asked, [true]);
    });

    test('off Windows toggle does nothing, without an error', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      final asked = _mockRunner();
      final mode = WindowModeController(store: MemoryDraftStore());

      await mode.toggle();
      expect(mode.value, isFalse);
      expect(asked, isEmpty);
    });

    test('a host without the runner channel stays windowed', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      final store = MemoryDraftStore();
      final mode = WindowModeController(store: store);

      await mode.toggle();
      expect(mode.value, isFalse);
      expect(await store.read(), isNull);
    });
  });

  group('shortcutGroups', () {
    test('the Kasir group follows the chosen layout and lists Ctrl+P', () {
      final current = shortcutGroups(globalArrows: false, fullscreen: true);
      final global = shortcutGroups(globalArrows: true, fullscreen: true);
      expect(current[1].$1, 'Kasir');
      expect(global[1].$1, 'Kasir, panah global');
      expect(current[1].$2, contains(('PgUp/PgDn', 'pindah panel')));
      expect(global[1].$2, contains(('PgUp', 'ke Jumlah')));
      expect(current[1].$2, contains(('Ctrl+P', 'cetak ulang nota terakhir')));
    });

    test('F11 is listed only where full screen exists', () {
      expect(shortcutGroups(globalArrows: false, fullscreen: true)[0].$2.map((r) => r.$1), contains('F11'));
      expect(shortcutGroups(globalArrows: false, fullscreen: false)[0].$2.map((r) => r.$1), isNot(contains('F11')));
    });
  });

  group('MainScreen on a PC', () {
    final clock = find.textContaining(RegExp(r'^\d\d:\d\d$'));

    Future<void> open(WidgetTester tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      tester.view.physicalSize = const Size(1400, 900); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(() => windowMode.value = false);
      final app = AppState()..startDemo();
      await tester.pumpWidget(MaterialApp(theme: buildTheme(), home: MainScreen(app: app)));
      await tester.pumpAndSettle();
    }

    Future<void> close(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      debugDefaultTargetPlatformOverride = null;
    }

    testWidgets('F11 toggles full screen, the button follows and the clock shows only then', (tester) async {
      final asked = _mockRunner();
      await open(tester);
      expect(find.byTooltip('Layar penuh (F11)'), findsOneWidget);
      expect(clock, findsNothing);

      await tester.sendKeyEvent(LogicalKeyboardKey.f11);
      await tester.pumpAndSettle();
      expect(asked, [true]);
      expect(find.byTooltip('Keluar layar penuh (F11)'), findsOneWidget);
      expect(find.byIcon(Icons.fullscreen_exit), findsOneWidget);
      expect(clock, findsOneWidget);

      await tester.tap(find.byTooltip('Keluar layar penuh (F11)'));
      await tester.pumpAndSettle();
      expect(asked, [true, false]);
      expect(find.byTooltip('Layar penuh (F11)'), findsOneWidget);
      expect(clock, findsNothing);
      await close(tester);
    });

    testWidgets('F11 still works while the cashier lock covers the screen', (tester) async {
      final asked = _mockRunner();
      await open(tester);
      await tester.tap(find.byTooltip('Kunci Kasir (Ctrl+L)'));
      await tester.pumpAndSettle();
      expect(find.text('Kasir Terkunci'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.f11);
      await tester.pumpAndSettle();
      expect(asked, [true]);
      await tester.sendKeyEvent(LogicalKeyboardKey.f11);
      await tester.pumpAndSettle();
      expect(asked, [true, false]);
      expect(find.text('Kasir Terkunci'), findsOneWidget);
      await close(tester);
    });

    testWidgets('Ctrl+/ opens the shortcut list and Esc closes it', (tester) async {
      await open(tester);
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
      expect(find.text('Daftar shortcut'), findsOneWidget);
      expect(find.text('Ctrl+P'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('Daftar shortcut'), findsNothing);
      await close(tester);
    });

    testWidgets('the ? button opens the same list, and Enter closes it', (tester) async {
      await open(tester);
      await tester.tap(find.byTooltip('Daftar shortcut (Ctrl+/)'));
      await tester.pumpAndSettle();
      expect(find.text('Daftar shortcut'), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('Daftar shortcut'), findsNothing);
      await close(tester);
    });

    testWidgets('Ctrl+D and the moon button switch to dark, and every top-bar action shows its key', (tester) async {
      addTearDown(() => appTheme.value = ThemeMode.light);
      await open(tester);
      for (final key in ['Ctrl+/', 'F11', 'Ctrl+D', 'Ctrl+L']) {
        expect(find.text(key), findsOneWidget, reason: key);
      }

      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyD);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
      expect(appTheme.value, ThemeMode.dark);

      appTheme.value = ThemeMode.light;
      await tester.tap(find.byTooltip('Mode gelap (Ctrl+D)'));
      await tester.pumpAndSettle();
      expect(appTheme.value, ThemeMode.dark);
      await close(tester);
    });
  });
}
