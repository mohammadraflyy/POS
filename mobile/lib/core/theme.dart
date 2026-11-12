import 'package:flutter/material.dart';

// Achromatic ledger, from the taste-skill sheet (seed 544233759, kind commerce).
// The chrome holds no colour: ink, greys and a stone ground. The one hue is the shop's
// wine, and it goes on data only - the main figure or series of a screen - never on a
// button, a nav row or an icon. Status colours are for status.
//
// Two palettes, light and dark (true neutral darks, lightness steps instead of borders,
// the wine lifted so it still reads on black). Every colour below is read from the
// palette in force; the app switches it and rebuilds when the mode changes.

/// One full set of the app's colours.
class Palette {
  const Palette({
    required this.brightness, required this.canvas, required this.surface, required this.raised, required this.activePill,
    required this.lineColor, required this.ruleColor, required this.controlBorder, required this.ink, required this.muted,
    required this.secondaryInk, required this.primaryInk, required this.onPrimary, required this.dataHue, required this.dataHueSoft,
    required this.successColor, required this.warningColor, required this.errorColor,
    required this.pillPositiveBg, required this.pillPositiveInk, required this.pillNegativeBg, required this.pillNegativeInk,
    required this.pillWarningBg, required this.pillWarningInk, required this.pillNeutralBg, required this.pillNeutralInk,
    required this.noticeBorder, required this.gridLine, required this.baseline, required this.comparison, required this.overlay,
  });
  final Brightness brightness;
  final Color canvas, surface, raised, activePill, lineColor, ruleColor, controlBorder, ink, muted, secondaryInk, primaryInk, onPrimary;
  final Color dataHue, dataHueSoft, successColor, warningColor, errorColor;
  final Color pillPositiveBg, pillPositiveInk, pillNegativeBg, pillNegativeInk, pillWarningBg, pillWarningInk, pillNeutralBg, pillNeutralInk;
  final Color noticeBorder, gridLine, baseline, comparison;

  /// Hover and pressed washes: black on light, white on dark.
  final Color overlay;

  static const light = Palette(
    brightness: Brightness.light,
    canvas: Color(0xFFF1F5F9), surface: Colors.white, raised: Color(0xFFF8FAFC), activePill: Color(0xFFE2E8F0),
    lineColor: Color(0xFFCBD5E1), ruleColor: Color(0xFFE2E8F0), controlBorder: Color(0xFF94A3B8),
    ink: Color(0xFF0F172A), muted: Color(0xFF475569), secondaryInk: Color(0xFF1E293B),
    primaryInk: Color(0xFF0F172A), onPrimary: Colors.white,
    dataHue: Color(0xFF0284C7), dataHueSoft: Color(0xFFE0F2FE),
    successColor: Color(0xFF16A34A), warningColor: Color(0xFFD97706), errorColor: Color(0xFFDC2626),
    pillPositiveBg: Color(0xFFDCFCE7), pillPositiveInk: Color(0xFF15803D), pillNegativeBg: Color(0xFFFEE2E2), pillNegativeInk: Color(0xFFB91C1C),
    pillWarningBg: Color(0xFFFEF3C7), pillWarningInk: Color(0xFFB45309), pillNeutralBg: Color(0xFFF1F5F9), pillNeutralInk: Color(0xFF334155),
    noticeBorder: Color(0xFFF59E0B), gridLine: Color(0xFFCBD5E1), baseline: Color(0xFF64748B), comparison: Color(0xFF475569),
    overlay: Colors.black,
  );

  static const dark = Palette(
    brightness: Brightness.dark,
    canvas: Color(0xFF090D16), surface: Color(0xFF131D2E), raised: Color(0xFF1E293B), activePill: Color(0xFF334155),
    lineColor: Color(0xFF334155), ruleColor: Color(0xFF232F42), controlBorder: Color(0xFF475569),
    ink: Color(0xFFF8FAFC), muted: Color(0xFF94A3B8), secondaryInk: Color(0xFFE2E8F0),
    primaryInk: Color(0xFF38BDF8), onPrimary: Color(0xFF0F172A),
    dataHue: Color(0xFF38BDF8), dataHueSoft: Color(0xFF0C4A6E),
    successColor: Color(0xFF22C55E), warningColor: Color(0xFFF59E0B), errorColor: Color(0xFFEF4444),
    pillPositiveBg: Color(0xFF052E16), pillPositiveInk: Color(0xFF4ADE80), pillNegativeBg: Color(0xFF450A0A), pillNegativeInk: Color(0xFFF87171),
    pillWarningBg: Color(0xFF451A03), pillWarningInk: Color(0xFFFBBF24), pillNeutralBg: Color(0xFF1E293B), pillNeutralInk: Color(0xFFCBD5E1),
    noticeBorder: Color(0xFF92400E), gridLine: Color(0xFF2D3C52), baseline: Color(0xFF64748B), comparison: Color(0xFFCBD5E1),
    overlay: Colors.white,
  );
}

/// The palette in force; set by the app from the chosen mode before each build.
Palette palette = Palette.light;
bool get isDark => palette.brightness == Brightness.dark;

/// The page ground: a stone white from the shop's world, one level off the white cards.
Color get canvas => palette.canvas;
Color get surface => palette.surface;

/// A filled step on white: the selected chip, a pressed row, a well.
Color get raised => palette.raised;

/// The active nav row: a neutral grey pill on the ground.
Color get activePill => palette.activePill;

/// Card and panel edges.
Color get lineColor => palette.lineColor;

/// Row rules inside tables and lists, one step lighter than [lineColor].
Color get ruleColor => palette.ruleColor;

/// Control borders (inputs, outlined buttons), one step darker than [lineColor].
Color get controlBorder => palette.controlBorder;

Color get ink => palette.ink;

/// Secondary text; 5.3:1 on white and 4.8:1 on the ground (light), 7:1 on dark.
Color get muted => palette.muted;

/// Body text one step quieter than [ink] (table cells after the first).
Color get secondaryInk => palette.secondaryInk;

/// The one primary action: near-black with a white label (inverted on dark).
Color get primaryInk => palette.primaryInk;
Color get onPrimary => palette.onPrimary;

/// The shop's wine, on data only (today's bars, the figure that answers the screen).
Color get dataHue => palette.dataHue;

/// A pale tint of [dataHue] for a selected filter card.
Color get dataHueSoft => palette.dataHueSoft;

Color get successColor => palette.successColor;
Color get warningColor => palette.warningColor;
Color get errorColor => palette.errorColor;

/// Pale pill pairs: background and ink of the same hue.
Color get pillPositiveBg => palette.pillPositiveBg;
Color get pillPositiveInk => palette.pillPositiveInk;
Color get pillNegativeBg => palette.pillNegativeBg;
Color get pillNegativeInk => palette.pillNegativeInk;
Color get pillWarningBg => palette.pillWarningBg;
Color get pillWarningInk => palette.pillWarningInk;
Color get pillNeutralBg => palette.pillNeutralBg;
Color get pillNeutralInk => palette.pillNeutralInk;

/// The 1px border of a notice strip.
Color get noticeBorder => palette.noticeBorder;

/// Chart lines: faint gridlines, the heavier baseline, the grey of a comparison mark.
Color get gridLine => palette.gridLine;
Color get chartBaseline => palette.baseline;
Color get comparisonInk => palette.comparison;

const fontFamily = 'Geist';
const monoFamily = 'GeistMono';

abstract final class Space {
  static const xs = 4.0, sm = 8.0, md = 14.0, lg = 18.0, xl = 26.0, xxl = 36.0;

  /// The gap between cards and major sections, spacious and breathable.
  static const gap = 16.0;
}

/// Balanced and modern radii: 12 for cards, 8 for controls.
abstract final class Corners {
  static const chip = 6.0, control = 8.0, panel = 12.0, dialog = 16.0;
}

abstract final class Motion {
  static const feedback = Duration(milliseconds: 140);
  static const enter = Duration(milliseconds: 200);
  static const exit = Duration(milliseconds: 160);
  static Duration duration(BuildContext context, Duration normal) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : normal;
}

/// Figures in columns and anything that updates: tabular digits so rupiah line up.
TextStyle get amountStyle => TextStyle(fontFamily: fontFamily, fontFeatures: [FontFeature.tabularFigures()], fontWeight: FontWeight.w500, color: ink);

/// Money that answers a screen's question: the only bold on it.
TextStyle get moneyStyle => TextStyle(fontFamily: fontFamily, fontFeatures: [FontFeature.tabularFigures()], fontWeight: FontWeight.w700, color: ink);

bool usesSplitCart(BuildContext context, BoxConstraints box) =>
    box.maxWidth >= 900 && box.maxHeight >= 560 && MediaQuery.textScalerOf(context).scale(14) <= 20;

OutlineInputBorder _inputBorder(Color color, [double width = 1]) =>
    OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: BorderSide(color: color, width: width));

/// The theme for [p] (the light palette unless given). Widgets that read the colour
/// getters directly follow [palette], which the app sets to the same mode.
ThemeData buildTheme([Palette p = Palette.light]) {
  final previous = palette;
  palette = p;
  try {
    return _buildTheme();
  } finally {
    palette = previous;
  }
}

ThemeData _buildTheme() {
  final text = TextTheme(
    // 12 / 14 / 16 / 24 / 30, weights 400 / 500 / 700 (700 for money only)
    headlineLarge: TextStyle(fontSize: 30, fontWeight: FontWeight.w500, color: ink, height: 1.2, letterSpacing: -0.6),
    headlineMedium: TextStyle(fontSize: 24, fontWeight: FontWeight.w500, color: ink, height: 1.25, letterSpacing: -0.4),
    headlineSmall: TextStyle(fontSize: 24, fontWeight: FontWeight.w500, color: ink, height: 1.25, letterSpacing: -0.4),
    titleLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.w500, color: ink, height: 1.25, letterSpacing: -0.4),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: ink, height: 1.4),
    titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: ink, height: 1.43),
    bodyLarge: TextStyle(fontSize: 16, color: ink, height: 1.5),
    bodyMedium: TextStyle(fontSize: 14, color: ink, height: 1.43),
    bodySmall: TextStyle(fontSize: 12, color: muted, height: 1.4),
    labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, height: 1.43),
    labelMedium: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: muted),
    labelSmall: TextStyle(fontSize: 12, color: muted),
  );
  final scheme = (isDark ? ColorScheme.dark : ColorScheme.light)(
    primary: primaryInk, onPrimary: onPrimary,
    secondary: primaryInk, onSecondary: onPrimary,
    secondaryContainer: raised, onSecondaryContainer: ink,
    primaryContainer: raised, onPrimaryContainer: ink,
    surface: surface, onSurface: ink, onSurfaceVariant: muted,
    surfaceContainerLowest: surface, surfaceContainerLow: surface, surfaceContainer: surface,
    surfaceContainerHigh: surface, surfaceContainerHighest: raised,
    outline: controlBorder, outlineVariant: lineColor,
    error: errorColor, onError: onPrimary,
    surfaceTint: Colors.transparent,
  );
    final focusHighlight = isDark ? const Color(0xFF38BDF8) : const Color(0xFF0284C7);
    final focusSoftBg = isDark ? const Color(0xFF1E293B) : const Color(0xFFF0F9FF);
    final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control));
    return ThemeData(
      useMaterial3: true,
      brightness: palette.brightness,
      fontFamily: fontFamily,
      colorScheme: scheme,
      textTheme: text,
      visualDensity: VisualDensity.standard,
      scaffoldBackgroundColor: canvas,
      splashFactory: NoSplash.splashFactory,
      hoverColor: palette.overlay.withAlpha(10),
      highlightColor: palette.overlay.withAlpha(15),
      focusColor: focusHighlight.withAlpha(35),
      appBarTheme: AppBarTheme(backgroundColor: canvas, foregroundColor: ink,
        surfaceTintColor: Colors.transparent, elevation: 0, scrolledUnderElevation: 0, centerTitle: false, toolbarHeight: 48,
        shape: Border(bottom: BorderSide(color: lineColor)),
        titleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w500, color: ink)),
      inputDecorationTheme: InputDecorationTheme(
        filled: true, fillColor: surface, isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        floatingLabelBehavior: FloatingLabelBehavior.always, helperMaxLines: 3, errorMaxLines: 3,
        labelStyle: TextStyle(color: muted, fontSize: 14),
        floatingLabelStyle: TextStyle(color: focusHighlight, fontSize: 14, fontWeight: FontWeight.bold),
        hintStyle: TextStyle(color: muted), helperStyle: TextStyle(color: muted, fontSize: 12),
        prefixIconColor: WidgetStateColor.resolveWith((states) => states.contains(WidgetState.focused) ? focusHighlight : muted),
        suffixIconColor: WidgetStateColor.resolveWith((states) => states.contains(WidgetState.focused) ? focusHighlight : muted),
        border: _inputBorder(controlBorder, 1.2), enabledBorder: _inputBorder(controlBorder, 1.2),
        focusedBorder: _inputBorder(focusHighlight, 2.5), disabledBorder: _inputBorder(lineColor),
        errorBorder: _inputBorder(errorColor, 1.2), focusedErrorBorder: _inputBorder(errorColor, 2.5),
      ),
      filledButtonTheme: FilledButtonThemeData(style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return raised;
          return primaryInk;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return muted;
          return onPrimary;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return BorderSide(color: focusHighlight, width: 2.5);
          return BorderSide.none;
        }),
        elevation: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return 3.0;
          return 0.5;
        }),
        minimumSize: const WidgetStatePropertyAll(Size(40, 42)),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: Space.lg)),
        shape: WidgetStatePropertyAll(buttonShape),
        shadowColor: WidgetStatePropertyAll(Colors.black.withAlpha(isDark ? 80 : 40)),
        textStyle: const WidgetStatePropertyAll(TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w600, fontSize: 14)),
      )),
      outlinedButtonTheme: OutlinedButtonThemeData(style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return muted;
          if (states.contains(WidgetState.focused)) return focusHighlight;
          return ink;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return Colors.transparent;
          if (states.contains(WidgetState.focused)) return focusSoftBg;
          return surface;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return BorderSide(color: focusHighlight, width: 2.5);
          return BorderSide(color: controlBorder, width: 1.2);
        }),
        minimumSize: const WidgetStatePropertyAll(Size(40, 42)),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: Space.lg)),
        shape: WidgetStatePropertyAll(buttonShape),
        textStyle: const WidgetStatePropertyAll(TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w600, fontSize: 14)),
      )),
      textButtonTheme: TextButtonThemeData(style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return muted;
          if (states.contains(WidgetState.focused)) return focusHighlight;
          return ink;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return focusSoftBg;
          return Colors.transparent;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return BorderSide(color: focusHighlight, width: 2.0);
          return BorderSide.none;
        }),
        minimumSize: const WidgetStatePropertyAll(Size(40, 40)),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: Space.md)),
        shape: WidgetStatePropertyAll(buttonShape),
        textStyle: const WidgetStatePropertyAll(TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14)),
      )),
      iconButtonTheme: IconButtonThemeData(style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return muted;
          if (states.contains(WidgetState.focused)) return focusHighlight;
          return ink;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return focusSoftBg;
          return Colors.transparent;
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) return BorderSide(color: focusHighlight, width: 2.0);
          return BorderSide.none;
        }),
        minimumSize: const WidgetStatePropertyAll(Size(40, 40)),
        shape: WidgetStatePropertyAll(buttonShape),
      )),
    cardTheme: CardThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(Corners.panel),
        side: BorderSide(color: lineColor),
      ),
      margin: EdgeInsets.zero,
    ),
    iconTheme: IconThemeData(color: ink, size: 20),
    dividerTheme: DividerThemeData(color: lineColor, thickness: 1, space: 1),
    checkboxTheme: CheckboxThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)), side: BorderSide(color: controlBorder, width: 1.5),
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? primaryInk : surface)),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? onPrimary : surface),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? successColor : controlBorder),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent)),
    chipTheme: ChipThemeData(
      backgroundColor: surface,
      selectedColor: isDark ? const Color(0xFF1E293B) : const Color(0xFF0F172A),
      checkmarkColor: isDark ? const Color(0xFF38BDF8) : Colors.white,
      side: WidgetStateBorderSide.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return BorderSide(color: isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F172A), width: 2.0);
        }
        if (states.contains(WidgetState.focused)) {
          return BorderSide(color: focusHighlight, width: 2.0);
        }
        return BorderSide(color: controlBorder, width: 1.0);
      }),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
      labelStyle: TextStyle(fontFamily: fontFamily, color: ink, fontSize: 14),
      secondaryLabelStyle: TextStyle(fontFamily: fontFamily, color: isDark ? const Color(0xFF38BDF8) : Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    ),
    tabBarTheme: TabBarThemeData(labelColor: ink, unselectedLabelColor: muted, indicatorColor: ink,
      indicatorSize: TabBarIndicatorSize.label, dividerColor: lineColor,
      labelStyle: TextStyle(fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w500),
      unselectedLabelStyle: TextStyle(fontFamily: fontFamily, fontSize: 14)),
    listTileTheme: ListTileThemeData(iconColor: muted, textColor: ink, selectedColor: ink, selectedTileColor: activePill),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: ink, linearTrackColor: ruleColor),
    // the same soft shell as AppPopup, so the dialogs still built by hand look like it
    dialogTheme: DialogThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent, elevation: 8,
      constraints: BoxConstraints(minWidth: 360, maxWidth: 640),
      titleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 17, fontWeight: FontWeight.w600, color: ink, height: 1.3),
      contentTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 14, color: muted, height: 1.5),
      actionsPadding: const EdgeInsets.fromLTRB(24, 4, 24, 20),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20), side: BorderSide(color: ruleColor))),
    popupMenuTheme: PopupMenuThemeData(color: surface, surfaceTintColor: Colors.transparent, elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.panel), side: BorderSide(color: lineColor))),
    bottomSheetTheme: BottomSheetThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Corners.dialog)))),
    datePickerTheme: DatePickerThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent),
    snackBarTheme: SnackBarThemeData(backgroundColor: primaryInk, contentTextStyle: TextStyle(fontFamily: fontFamily, color: onPrimary)),
    tooltipTheme: TooltipThemeData(decoration: BoxDecoration(color: primaryInk, borderRadius: BorderRadius.circular(Corners.chip)),
      textStyle: TextStyle(fontFamily: fontFamily, color: onPrimary, fontSize: 12)),
  );
}
