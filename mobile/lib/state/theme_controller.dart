import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../services/draft_store.dart';

/// Light, dark or follow the device - chosen in the account panel, remembered per device.
class ThemeController extends ValueNotifier<ThemeMode> {
  ThemeController({DraftStore? store}) : _store = store ?? DraftStore.forDevice('tampilan'), super(ThemeMode.light);
  final DraftStore _store;

  static const labels = {ThemeMode.light: 'Terang', ThemeMode.dark: 'Gelap', ThemeMode.system: 'Ikuti sistem'};

  Future<void> load() async {
    try {
      final saved = await _store.read();
      value = ThemeMode.values.firstWhere((m) => m.name == saved, orElse: () => ThemeMode.light);
    } catch (_) {
      // first run, or storage unavailable: light
    }
  }

  Future<void> choose(ThemeMode mode) async {
    value = mode;
    try { await _store.write(mode.name); } catch (_) {}
  }

  /// The palette for [mode] given the device's own brightness.
  static Palette paletteFor(ThemeMode mode, Brightness device) =>
      (mode == ThemeMode.dark || (mode == ThemeMode.system && device == Brightness.dark)) ? Palette.dark : Palette.light;
}

/// The one controller for the app.
final appTheme = ThemeController();

/// Marks every element dirty so widgets that read the colour getters directly pick up the
/// new palette, without recreating any state (the cart, open forms) the way a new key would.
void rebuildAll(BuildContext context) {
  void visit(Element element) { element.markNeedsBuild(); element.visitChildren(visit); }
  (context as Element).visitChildren(visit);
}
