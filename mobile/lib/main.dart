import 'dart:async';
import 'package:flutter/material.dart';
import 'core/theme.dart';
import 'Widgets/ui.dart';
import 'state/app_state.dart';
import 'Screen/MainScreen.dart';
import 'Screen/Pairing/PairingScreen.dart';
import 'Screen/SplashScreen.dart';
void main() { WidgetsFlutterBinding.ensureInitialized(); runApp(const MyApp()); }
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
    app.restore();
    _timer = Timer.periodic(const Duration(seconds: 45), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) app.checkConnection();
    });
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) app.checkConnection();
  }
  @override
  void dispose() { _timer?.cancel(); WidgetsBinding.instance.removeObserver(this); app.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: app, builder: (context, _) => MaterialApp(
    // Recreate Navigator on mode changes: a revoked session cannot leave a detail route visible.
    key: ValueKey(app.initializing ? 'loading' : app.mode.name),
    title: 'Point of Sales', debugShowCheckedModeBanner: false, theme: buildTheme(),
    home: NoticeListener(message: app.initializing ? null : app.notice,
      child: app.initializing ? const SplashScreen() : app.mode == AppMode.pairing
        ? PairingScreen(app: app) : MainScreen(app: app)),
  ));
}
