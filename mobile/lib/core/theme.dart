import 'package:flutter/material.dart';
const wine = Color(0xFF9B2446);
const ink = Color(0xFF28242B);
const canvas = Color(0xFFF6F4F2);
const muted = Color(0xFF625D66);
const surface = Colors.white;
const lineColor = Color(0xFFE2DFE3);
const accentSurface = Color(0xFFF8EBEF);
const successColor = Color(0xFF276348);
const warningColor = Color(0xFF835400);
const errorColor = Color(0xFFAA2335);
abstract final class Space {
  static const xs = 4.0, sm = 8.0, md = 12.0, lg = 16.0, xl = 24.0, xxl = 32.0;
}
abstract final class Corners {
  static const control = 10.0, panel = 12.0, dialog = 20.0;
}
abstract final class Motion {
  static const feedback = Duration(milliseconds: 140);
  static const enter = Duration(milliseconds: 200);
  static const exit = Duration(milliseconds: 160);
  static Duration duration(BuildContext context, Duration normal) =>
      MediaQuery.disableAnimationsOf(context) ? Duration.zero : normal;
}
const amountStyle = TextStyle(fontFeatures: [FontFeature.tabularFigures()], fontWeight: FontWeight.w600);
bool usesSplitCart(BuildContext context, BoxConstraints box) =>
    box.maxWidth >= 900 && box.maxHeight >= 560 && MediaQuery.textScalerOf(context).scale(14) <= 20;
ThemeData buildTheme() => ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(seedColor: wine, brightness: Brightness.light).copyWith(
    primary: wine, onPrimary: Colors.white, surface: surface, onSurface: ink,
    onSurfaceVariant: muted, outlineVariant: lineColor, error: errorColor),
  visualDensity: VisualDensity.standard,
  materialTapTargetSize: MaterialTapTargetSize.padded,
  scaffoldBackgroundColor: canvas,
  appBarTheme: const AppBarTheme(backgroundColor: surface, foregroundColor: ink,
    surfaceTintColor: Colors.transparent, elevation: 0, scrolledUnderElevation: 0, centerTitle: false,
    titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: ink)),
  textTheme: const TextTheme(
    headlineLarge: TextStyle(fontSize: 28, fontWeight: FontWeight.w600, color: ink, height: 1.2),
    headlineMedium: TextStyle(fontSize: 24, fontWeight: FontWeight.w600, color: ink, height: 1.25),
    titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: ink, height: 1.3),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: ink, height: 1.4),
    bodyLarge: TextStyle(fontSize: 16, color: ink, height: 1.45),
    bodySmall: TextStyle(fontSize: 13, color: muted, height: 1.4),
    bodyMedium: TextStyle(fontSize: 14, color: ink, height: 1.4),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true, fillColor: surface, contentPadding: const EdgeInsets.all(Space.lg),
    floatingLabelBehavior: FloatingLabelBehavior.always, helperMaxLines: 3, errorMaxLines: 3,
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: const BorderSide(color: lineColor)),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: const BorderSide(color: lineColor)),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: const BorderSide(color: wine, width: 2)),
  ),
  filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(
    backgroundColor: wine, foregroundColor: Colors.white, minimumSize: const Size(48, 52),
    padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
    textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
  )),
  outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(
    foregroundColor: ink, side: const BorderSide(color: lineColor),
    minimumSize: const Size(48, 48), padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
  )),
  dividerTheme: const DividerThemeData(color: lineColor, thickness: 1, space: 1),
  textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(minimumSize: const Size(48, 48))),
  iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(minimumSize: const Size(48, 48))),
  chipTheme: ChipThemeData(backgroundColor: surface, selectedColor: accentSurface,
    side: const BorderSide(color: lineColor), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
    labelStyle: const TextStyle(color: ink, fontSize: 14)),
  dialogTheme: DialogThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.dialog))),
  bottomSheetTheme: const BottomSheetThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Corners.dialog)))),
  navigationBarTheme: NavigationBarThemeData(backgroundColor: surface, surfaceTintColor: Colors.transparent,
    indicatorColor: accentSurface, height: 72,
    labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
);
