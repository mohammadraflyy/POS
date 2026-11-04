import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/core/theme.dart';
import '../lib/services/draft_store.dart';
import '../lib/state/theme_controller.dart';

void main() {
  test('the chosen mode is remembered on the device and picks its palette', () async {
    final store = MemoryDraftStore();
    final first = ThemeController(store: store);
    await first.choose(ThemeMode.dark);

    final next = ThemeController(store: store);
    await next.load();
    expect(next.value, ThemeMode.dark);
    expect(ThemeController.paletteFor(next.value, Brightness.light), same(Palette.dark));
    expect(ThemeController.paletteFor(ThemeMode.system, Brightness.dark), same(Palette.dark));
    expect(ThemeController.paletteFor(ThemeMode.system, Brightness.light), same(Palette.light));
  });

  test('the dark palette keeps text readable and the wine visible on its cards', () {
    double luminance(Color c) => c.computeLuminance();
    double contrast(Color a, Color b) {
      final (hi, lo) = luminance(a) > luminance(b) ? (a, b) : (b, a);
      return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
    }
    for (final p in [Palette.light, Palette.dark]) {
      expect(contrast(p.ink, p.surface), greaterThan(7), reason: '${p.brightness} body text');
      expect(contrast(p.muted, p.surface), greaterThanOrEqualTo(4.5), reason: '${p.brightness} secondary text');
      expect(contrast(p.muted, p.canvas), greaterThanOrEqualTo(4.5), reason: '${p.brightness} secondary text on the ground');
      expect(contrast(p.dataHue, p.surface), greaterThanOrEqualTo(3), reason: '${p.brightness} the one data hue');
      expect(contrast(p.onPrimary, p.primaryInk), greaterThan(7), reason: '${p.brightness} primary button label');
    }
  });

  test('buildTheme follows the palette it is given and leaves the current one alone', () {
    palette = Palette.light;
    final dark = buildTheme(Palette.dark);
    expect(dark.brightness, Brightness.dark);
    expect(dark.scaffoldBackgroundColor, Palette.dark.canvas);
    expect(palette, same(Palette.light));
  });
}
