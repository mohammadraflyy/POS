import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/theme.dart';
import 'Widgets/ui.dart';
import 'state/app_state.dart';
import 'state/kasir_keys.dart';
import 'state/theme_controller.dart';
import 'Screen/MainScreen.dart';
import 'Screen/Pairing/PairingScreen.dart';
import 'Screen/SplashScreen.dart';
import 'Screen/LocalServerGate.dart';
/// The shop PC (Windows) is also the server; phones connect to it over Wi-Fi.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await appTheme.load();
  await kasirKeys.load();
  palette = ThemeController.paletteFor(appTheme.value, WidgetsBinding.instance.platformDispatcher.platformBrightness);
  _paintCaption();
  runApp(Platform.isWindows ? const LocalServerGate(child: MyApp()) : const MyApp());
}

/// Paints the Windows title bar in the header's colours, so title bar and header read as
/// one strip (see windows/runner/flutter_window.cpp).
void _paintCaption() {
  if (!Platform.isWindows) return;
  const MethodChannel('pos/window')
      .invokeMethod('caption', {'background': surface.toARGB32(), 'text': ink.toARGB32(), 'dark': isDark})
      .catchError((_) => null); // older runner or a test host: keep the system title bar
}
class MyApp extends StatefulWidget {
  const MyApp({super.key, this.app});
  /// Injected by tests; the real app builds its own.
  final AppState? app;
  @override
  State<MyApp> createState() => _MyAppState();
}
class _MyAppState extends State<MyApp> with WidgetsBindingObserver {
  late final app = widget.app ?? AppState();
  Timer? _timer;
  @override
  void initState() {
    super.initState(); WidgetsBinding.instance.addObserver(this);
    appTheme.addListener(_applyTheme);
    app.restore();
    _timer = Timer.periodic(const Duration(seconds: 45), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) app.checkConnection();
    });
  }
  /// Light, dark or the device's own: switch the palette, then redraw everything that
  /// reads it - without recreating state, so the cart and open forms survive.
  void _applyTheme() {
    final next = ThemeController.paletteFor(appTheme.value, WidgetsBinding.instance.platformDispatcher.platformBrightness);
    if (identical(next, palette)) return;
    palette = next;
    _paintCaption();
    if (mounted) { setState(() {}); rebuildAll(context); }
  }
  @override
  void didChangePlatformBrightness() => _applyTheme();
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) app.checkConnection();
  }
  @override
  void dispose() { appTheme.removeListener(_applyTheme); _timer?.cancel(); WidgetsBinding.instance.removeObserver(this); app.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: app, builder: (context, _) => MaterialApp(
    // Recreate Navigator on mode changes: a revoked session cannot leave a detail route visible.
    key: ValueKey(app.initializing ? 'loading' : app.mode.name),
    title: 'Point of Sales', debugShowCheckedModeBanner: false, theme: buildTheme(palette),
    shortcuts: {...WidgetsApp.defaultShortcuts, ...MainScreen.menuShortcuts},
    home: NoticeListener(message: app.initializing ? null : app.notice,
      child: app.initializing ? const SplashScreen() : app.mode == AppMode.pairing
        ? PairingScreen(app: app) : MainScreen(app: app)),
  ));
}
