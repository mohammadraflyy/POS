import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import '../services/draft_store.dart';

/// Full screen on the shop PC (no title bar, no taskbar) - remembered per device, so the till
/// comes back the way it was left. Only Windows has the window to toggle.
class WindowModeController extends ValueNotifier<bool> {
  WindowModeController({DraftStore? store, MethodChannel? channel})
      : _store = store ?? DraftStore.forDevice('layar-penuh'),
        _channel = channel ?? const MethodChannel('pos/window'),
        super(false);
  final DraftStore _store;
  final MethodChannel _channel;

  bool get supported => defaultTargetPlatform == TargetPlatform.windows;

  Future<void> load() async {
    try {
      if (await _store.read() == 'on') await _apply(true);
    } catch (_) {
      // first run, or storage unavailable: a normal window
    }
  }

  Future<void> toggle() => _apply(!value, remember: true);

  Future<void> _apply(bool on, {bool remember = false}) async {
    if (!supported) return;
    try {
      value = await _channel.invokeMethod<bool>('fullscreen', on) ?? on;
    } on MissingPluginException {
      return; // a test host or an older runner: no native window to change
    }
    if (remember) {
      try { await _store.write(value ? 'on' : 'off'); } catch (_) {}
    }
  }
}

/// The one controller for the app.
final windowMode = WindowModeController();
