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
    canvas: Color(0xFFF4F3F1), surface: Colors.white, raised: Color(0xFFEEEDEA), activePill: Color(0xFFE6E4E0),
    lineColor: Color(0xFFE6E6E6), ruleColor: Color(0xFFF0F0F0), controlBorder: Color(0xFFD4D4D4),
    ink: Color(0xFF0A0A0A), muted: Color(0xFF6B6B6B), secondaryInk: Color(0xFF3D3D3D),
    primaryInk: Color(0xFF141414), onPrimary: Colors.white,
    dataHue: Color(0xFF9B2446), dataHueSoft: Color(0xFFF7EEF0),
    successColor: Color(0xFF2E7D32), warningColor: Color(0xFF92400E), errorColor: Color(0xFFC4242A),
    pillPositiveBg: Color(0xFFDCFAE5), pillPositiveInk: Color(0xFF04250E), pillNegativeBg: Color(0xFFFFEDEA), pillNegativeInk: Color(0xFF831C1E),
    pillWarningBg: Color(0xFFFFFBEB), pillWarningInk: Color(0xFF92400E), pillNeutralBg: Color(0xFFEEEEEE), pillNeutralInk: Color(0xFF3D3D3D),
    noticeBorder: Color(0xFFFDE68A), gridLine: Color(0xFFEDEDED), baseline: Color(0xFFBDBDBD), comparison: Color(0xFF8A8A8A),
    overlay: Colors.black,
  );

  static const dark = Palette(
    brightness: Brightness.dark,
    canvas: Color(0xFF0B0B0B), surface: Color(0xFF151515), raised: Color(0xFF232323), activePill: Color(0xFF262626),
    lineColor: Color(0xFF2A2A2A), ruleColor: Color(0xFF202020), controlBorder: Color(0xFF3F3F3F),
    ink: Color(0xFFF5F5F5), muted: Color(0xFFA8A8A8), secondaryInk: Color(0xFFCFCFCF),
    primaryInk: Color(0xFFF2F2F2), onPrimary: Color(0xFF0A0A0A),
    dataHue: Color(0xFFD9587E), dataHueSoft: Color(0xFF2A1820),
    successColor: Color(0xFF3FC07A), warningColor: Color(0xFFE0A84A), errorColor: Color(0xFFE5566F),
    pillPositiveBg: Color(0xFF172A1D), pillPositiveInk: Color(0xFF3FC07A), pillNegativeBg: Color(0xFF2C1A20), pillNegativeInk: Color(0xFFE5566F),
    pillWarningBg: Color(0xFF2A2214), pillWarningInk: Color(0xFFE0A84A), pillNeutralBg: Color(0xFF262626), pillNeutralInk: Color(0xFFCFCFCF),
    noticeBorder: Color(0xFF5A4720), gridLine: Color(0xFF242424), baseline: Color(0xFF4A4A4A), comparison: Color(0xFF8A8A8A),
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
    focusColor: palette.overlay.withAlpha(20),
    appBarTheme: AppBarTheme(backgroundColor: canvas, foregroundColor: ink,
      surfaceTintColor: Colors.transparent, elevation: 0, scrolledUnderElevation: 0, centerTitle: false, toolbarHeight: 48,
      shape: Border(bottom: BorderSide(color: lineColor)),
      titleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w500, color: ink)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: surface, isDense: true,
      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      floatingLabelBehavior: FloatingLabelBehavior.always, helperMaxLines: 3, errorMaxLines: 3,
      labelStyle: TextStyle(color: muted, fontSize: 14), floatingLabelStyle: TextStyle(color: ink, fontSize: 14, fontWeight: FontWeight.w500),
      hintStyle: TextStyle(color: muted), helperStyle: TextStyle(color: muted, fontSize: 12),
      prefixIconColor: muted, suffixIconColor: muted,
      border: _inputBorder(controlBorder), enabledBorder: _inputBorder(controlBorder),
      focusedBorder: _inputBorder(ink, 1.5), disabledBorder: _inputBorder(lineColor),
      errorBorder: _inputBorder(errorColor), focusedErrorBorder: _inputBorder(errorColor, 1.5),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
      backgroundColor: primaryInk, foregroundColor: onPrimary,
      disabledBackgroundColor: raised, disabledForegroundColor: muted,
      minimumSize: Size(40, 40), padding: EdgeInsets.symmetric(horizontal: Space.lg),
      shape: buttonShape, elevation: 0, textStyle: TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14),
    )),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(
      foregroundColor: ink, backgroundColor: surface, side: BorderSide(color: controlBorder),
      minimumSize: Size(40, 40), padding: EdgeInsets.symmetric(horizontal: Space.lg),
      shape: buttonShape, textStyle: TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14),
    )),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: ink,
      minimumSize: Size(40, 40), shape: buttonShape, textStyle: TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14))),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: ink, minimumSize: Size(40, 40), shape: buttonShape)),
    iconTheme: IconThemeData(color: ink, size: 20),
    dividerTheme: DividerThemeData(color: lineColor, thickness: 1, space: 1),
    checkboxTheme: CheckboxThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)), side: BorderSide(color: controlBorder, width: 1.5),
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? primaryInk : surface)),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? onPrimary : surface),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? successColor : controlBorder),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent)),
    chipTheme: ChipThemeData(backgroundColor: surface, selectedColor: raised, checkmarkColor: ink,
      side: BorderSide(color: controlBorder), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
      labelStyle: TextStyle(fontFamily: fontFamily, color: ink, fontSize: 14), padding: EdgeInsets.symmetric(horizontal: 6)),
    tabBarTheme: TabBarThemeData(labelColor: ink, unselectedLabelColor: muted, indicatorColor: ink,
      indicatorSize: TabBarIndicatorSize.label, dividerColor: lineColor,
      labelStyle: TextStyle(fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w500),
      unselectedLabelStyle: TextStyle(fontFamily: fontFamily, fontSize: 14)),
    listTileTheme: ListTileThemeData(iconColor: muted, textColor: ink, selectedColor: ink, selectedTileColor: activePill),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: ink, linearTrackColor: ruleColor),
    dialogTheme: DialogThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent, elevation: 8,
      constraints: BoxConstraints(minWidth: 360, maxWidth: 640),
      titleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 18, fontWeight: FontWeight.w500, color: ink),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.dialog))),
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
