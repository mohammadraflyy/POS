import 'package:flutter/material.dart';
import '../../core/theme.dart';

/// The Kasir screen's colours: the shared palette where it has a twin, plus the few
/// tints only the till uses. Light or dark follows the palette in force.
abstract final class KasirColors {
  static Color get primary => primaryInk;
  static Color get onPrimary => palette.onPrimary;

  /// Total panel wash start and icon tiles.
  static Color get tint => isDark ? const Color(0xFF0F1C29) : const Color(0xFFEEF4FA);

  /// Count badges and the total panel border.
  static Color get tint2 => dataHueSoft;
  static Color get selectedRow => isDark ? const Color(0xFF132536) : const Color(0xFFE3EDF7);

  /// Secondary text and keycap text: a darker step than [muted] so 11px type holds 4.5:1.
  static Color get label => isDark ? const Color(0xFFB3B3B3) : const Color(0xFF5A5A5A);
  static Color get muted => palette.muted;

  /// Table header, qty capsule and shortcut strip.
  static Color get accent => raised;
  static Color get border => lineColor;

  /// Cart table lines, stronger than [border].
  static Color get gridLine => isDark ? const Color(0xFF3A3A3A) : const Color(0xFFD4D4D4);
  static Color get destructive => isDark ? const Color(0xFFFB2C36) : const Color(0xFFE7000B);
  static Color get surface => palette.surface;
  static Color get ink => palette.ink;

  /// Change banner on the payment screen. The light green is a step darker than the old app's so 14px text holds 4.5:1.
  static Color get changeBg => isDark ? const Color(0xFF14301F) : const Color(0xFFDCF5E3);
  static Color get changeInk => isDark ? const Color(0xFF4ADE80) : const Color(0xFF166534);

  /// Kurang and Sisa bon banner.
  static Color get dueBg => isDark ? const Color(0xFF3A2414) : const Color(0xFFFEF0E1);
  static Color get dueInk => isDark ? const Color(0xFFFB923C) : const Color(0xFFC2410C);

  /// The one lift on the page: the total panel, the cart table and the Bayar button.
  static List<BoxShadow> get softShadow => [BoxShadow(color: Colors.black.withValues(alpha: isDark ? 0.35 : 0.06), blurRadius: 6, offset: const Offset(0, 2))];
}

/// A keyboard shortcut drawn as a keycap, as the old till showed them.
class KasirKey extends StatelessWidget {
  const KasirKey(this.label, {super.key});
  final String label;

  @override
  // The darker bottom edge is the outer box showing under the inner one: Flutter cannot round a border with mixed colours.
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.only(bottom: 1.5),
    decoration: BoxDecoration(color: KasirColors.gridLine, borderRadius: BorderRadius.circular(5)),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(5)),
      child: Text(label, style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, color: KasirColors.label)),
    ),
  );
}

/// A filled action in the till's solid blue; dimmed and inert when [onPressed] is null.
class KasirActionButton extends StatelessWidget {
  const KasirActionButton({super.key, required this.onPressed, required this.child, this.height = 56, this.width, this.tooltip});
  final VoidCallback? onPressed;
  final Widget child;
  final double height;
  final double? width;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final button = Opacity(opacity: enabled ? 1 : 0.45, child: Container(
      width: width, height: height,
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), boxShadow: enabled ? KasirColors.softShadow : null),
      child: Material(
        color: Colors.transparent,
        child: Ink(
          decoration: BoxDecoration(color: KasirColors.primary, borderRadius: BorderRadius.circular(10)),
          child: InkWell(
            onTap: onPressed, borderRadius: BorderRadius.circular(10),
            child: Center(child: DefaultTextStyle.merge(style: TextStyle(color: KasirColors.onPrimary), child: IconTheme.merge(data: IconThemeData(color: KasirColors.onPrimary), child: child))),
          ),
        ),
      ),
    ));
    return tooltip == null ? button : Tooltip(message: tooltip!, child: button);
  }
}
