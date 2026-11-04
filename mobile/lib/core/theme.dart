import 'package:flutter/material.dart';

// Achromatic ledger, from the taste-skill sheet (seed 544233759, kind commerce).
// The chrome holds no colour: ink, greys and a stone ground. The one hue is the shop's
// wine, and it goes on data only - the main figure or series of a screen - never on a
// button, a nav row or an icon. Status colours are for status.

/// The page ground: a stone white from the shop's world, one level off the white cards.
const canvas = Color(0xFFF4F3F1);
const surface = Colors.white;

/// A filled step on white: the selected chip, a pressed row, a well.
const raised = Color(0xFFEEEDEA);

/// The active nav row: a neutral grey pill on the stone ground.
const activePill = Color(0xFFE6E4E0);

/// Card and panel edges.
const lineColor = Color(0xFFE6E6E6);

/// Row rules inside tables and lists, one step lighter than [lineColor].
const ruleColor = Color(0xFFF0F0F0);

/// Control borders (inputs, outlined buttons), one step darker than [lineColor].
const controlBorder = Color(0xFFD4D4D4);

const ink = Color(0xFF0A0A0A);

/// Secondary text; 5.3:1 on white and 4.8:1 on [canvas].
const muted = Color(0xFF6B6B6B);

/// The one primary action: near-black with a white label.
const primaryInk = Color(0xFF141414);

/// The shop's wine, on data only (today's bars, the figure that answers the screen).
const dataHue = Color(0xFF9B2446);

/// A pale tint of [dataHue] for a selected filter card.
const dataHueSoft = Color(0xFFF7EEF0);

const successColor = Color(0xFF2E7D32);
const warningColor = Color(0xFF92400E);
const errorColor = Color(0xFFC4242A);

/// Pale pill pairs: background and ink of the same hue.
const pillPositiveBg = Color(0xFFDCFAE5), pillPositiveInk = Color(0xFF04250E);
const pillNegativeBg = Color(0xFFFFEDEA), pillNegativeInk = Color(0xFF831C1E);
const pillWarningBg = Color(0xFFFFFBEB), pillWarningInk = Color(0xFF92400E);
const pillNeutralBg = Color(0xFFEEEEEE), pillNeutralInk = Color(0xFF3D3D3D);

const fontFamily = 'Geist';
const monoFamily = 'GeistMono';

abstract final class Space {
  static const xs = 4.0, sm = 8.0, md = 12.0, lg = 16.0, xl = 24.0, xxl = 32.0;

  /// The one gap between cards, both ways.
  static const gap = 12.0;
}

/// The tight pair: 8 for cards, 6 for controls; dialogs float, so a little softer.
abstract final class Corners {
  static const chip = 4.0, control = 6.0, panel = 8.0, dialog = 12.0;
}

abstract final class Motion {
  static const feedback = Duration(milliseconds: 140);
  static const enter = Duration(milliseconds: 200);
  static const exit = Duration(milliseconds: 160);
  static Duration duration(BuildContext context, Duration normal) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : normal;
}

/// Figures in columns and anything that updates: tabular digits so rupiah line up.
const amountStyle = TextStyle(fontFamily: fontFamily, fontFeatures: [FontFeature.tabularFigures()], fontWeight: FontWeight.w500, color: ink);

/// Money that answers a screen's question: the only bold on it.
const moneyStyle = TextStyle(fontFamily: fontFamily, fontFeatures: [FontFeature.tabularFigures()], fontWeight: FontWeight.w700, color: ink);

bool usesSplitCart(BuildContext context, BoxConstraints box) =>
    box.maxWidth >= 900 && box.maxHeight >= 560 && MediaQuery.textScalerOf(context).scale(14) <= 20;

OutlineInputBorder _inputBorder(Color color, [double width = 1]) =>
    OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: BorderSide(color: color, width: width));

ThemeData buildTheme() {
  const text = TextTheme(
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
  final scheme = const ColorScheme.light(
    primary: primaryInk, onPrimary: Colors.white,
    secondary: primaryInk, onSecondary: Colors.white,
    secondaryContainer: raised, onSecondaryContainer: ink,
    primaryContainer: raised, onPrimaryContainer: ink,
    surface: surface, onSurface: ink, onSurfaceVariant: muted,
    surfaceContainerLowest: surface, surfaceContainerLow: surface, surfaceContainer: surface,
    surfaceContainerHigh: surface, surfaceContainerHighest: raised,
    outline: controlBorder, outlineVariant: lineColor,
    error: errorColor, onError: Colors.white,
    surfaceTint: Colors.transparent,
  );
  final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control));
  return ThemeData(
    useMaterial3: true,
    fontFamily: fontFamily,
    colorScheme: scheme,
    textTheme: text,
    visualDensity: VisualDensity.standard,
    scaffoldBackgroundColor: canvas,
    splashFactory: NoSplash.splashFactory,
    hoverColor: const Color(0x0A000000),
    highlightColor: const Color(0x0F000000),
    focusColor: const Color(0x14000000),
    appBarTheme: const AppBarTheme(backgroundColor: canvas, foregroundColor: ink,
      surfaceTintColor: Colors.transparent, elevation: 0, scrolledUnderElevation: 0, centerTitle: false, toolbarHeight: 48,
      shape: Border(bottom: BorderSide(color: lineColor)),
      titleTextStyle: TextStyle(fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w500, color: ink)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: surface, isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      floatingLabelBehavior: FloatingLabelBehavior.always, helperMaxLines: 3, errorMaxLines: 3,
      labelStyle: const TextStyle(color: muted, fontSize: 14), floatingLabelStyle: const TextStyle(color: ink, fontSize: 14, fontWeight: FontWeight.w500),
      hintStyle: const TextStyle(color: muted), helperStyle: const TextStyle(color: muted, fontSize: 12),
      prefixIconColor: muted, suffixIconColor: muted,
      border: _inputBorder(controlBorder), enabledBorder: _inputBorder(controlBorder),
      focusedBorder: _inputBorder(ink, 1.5), disabledBorder: _inputBorder(lineColor),
      errorBorder: _inputBorder(errorColor), focusedErrorBorder: _inputBorder(errorColor, 1.5),
    ),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
      backgroundColor: primaryInk, foregroundColor: Colors.white,
      disabledBackgroundColor: raised, disabledForegroundColor: muted,
      minimumSize: const Size(40, 40), padding: const EdgeInsets.symmetric(horizontal: Space.lg),
      shape: buttonShape, elevation: 0, textStyle: const TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14),
    )),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(
      foregroundColor: ink, backgroundColor: surface, side: const BorderSide(color: controlBorder),
      minimumSize: const Size(40, 40), padding: const EdgeInsets.symmetric(horizontal: Space.lg),
      shape: buttonShape, textStyle: const TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14),
    )),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: ink,
      minimumSize: const Size(40, 40), shape: buttonShape, textStyle: const TextStyle(fontFamily: fontFamily, fontWeight: FontWeight.w500, fontSize: 14))),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: ink, minimumSize: const Size(40, 40), shape: buttonShape)),
    iconTheme: const IconThemeData(color: ink, size: 20),
    dividerTheme: const DividerThemeData(color: lineColor, thickness: 1, space: 1),
    checkboxTheme: CheckboxThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)), side: const BorderSide(color: controlBorder, width: 1.5),
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? primaryInk : surface)),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : surface),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? successColor : controlBorder),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent)),
    chipTheme: ChipThemeData(backgroundColor: surface, selectedColor: raised, checkmarkColor: ink,
      side: const BorderSide(color: controlBorder), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
      labelStyle: const TextStyle(fontFamily: fontFamily, color: ink, fontSize: 14), padding: const EdgeInsets.symmetric(horizontal: 6)),
    tabBarTheme: const TabBarThemeData(labelColor: ink, unselectedLabelColor: muted, indicatorColor: ink,
      indicatorSize: TabBarIndicatorSize.label, dividerColor: lineColor,
      labelStyle: TextStyle(fontFamily: fontFamily, fontSize: 14, fontWeight: FontWeight.w500),
      unselectedLabelStyle: TextStyle(fontFamily: fontFamily, fontSize: 14)),
    listTileTheme: const ListTileThemeData(iconColor: muted, textColor: ink, selectedColor: ink, selectedTileColor: activePill),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: ink, linearTrackColor: ruleColor),
    dialogTheme: DialogThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent, elevation: 8,
      titleTextStyle: const TextStyle(fontFamily: fontFamily, fontSize: 18, fontWeight: FontWeight.w500, color: ink),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.dialog))),
    popupMenuTheme: PopupMenuThemeData(color: surface, surfaceTintColor: Colors.transparent, elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.panel), side: const BorderSide(color: lineColor))),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Corners.dialog)))),
    datePickerTheme: const DatePickerThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent),
    snackBarTheme: const SnackBarThemeData(backgroundColor: primaryInk, contentTextStyle: TextStyle(fontFamily: fontFamily, color: Colors.white)),
    tooltipTheme: TooltipThemeData(decoration: BoxDecoration(color: primaryInk, borderRadius: BorderRadius.circular(Corners.chip)),
      textStyle: const TextStyle(fontFamily: fontFamily, color: Colors.white, fontSize: 12)),
  );
}
