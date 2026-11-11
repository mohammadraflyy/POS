import 'package:flutter/material.dart';
import '../core/theme.dart';
import 'admin.dart' show isDesktop;

/// One catalog line on the till: rounded avatar initials, name and code on the left,
/// tabular digits and unit on the right, stock indicator, and a tactile add button.
/// An item already in the cart shows a distinct 3px left indicator bar.
class ProductRow extends StatelessWidget {
  const ProductRow({
    super.key,
    required this.name,
    required this.code,
    required this.stock,
    required this.price,
    required this.unit,
    required this.onConfigure,
    required this.onAdd,
    this.inCart = false,
    this.available = true,
    this.selected = false,
  });

  final String name, code, stock, price, unit;
  final VoidCallback? onConfigure, onAdd;
  final bool inCart, available, selected;

  String _initials(String text) {
    final words = text.trim().split(RegExp(r'\s+'));
    if (words.isEmpty || words.first.isEmpty) return '?';
    if (words.length == 1) {
      final s = words.first;
      return s.length >= 2 ? s.substring(0, 2).toUpperCase() : s.toUpperCase();
    }
    final first = words[0][0];
    final second = words[1].isNotEmpty ? words[1][0] : '';
    return '$first$second'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final rowBg = selected
        ? (isDark ? const Color(0xFF1E293B) : const Color(0xFFE0F2FE))
        : surface;
    final indicatorColor = isDark ? const Color(0xFF38BDF8) : const Color(0xFF0284C7);
    final avatarBg = isDark ? raised : const Color(0xFFF1F5F9);
    final avatarFg = isDark ? ink : const Color(0xFF475569);

    return Material(
      color: rowBg,
      child: InkWell(
        onTap: onConfigure,
        child: Container(
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: selected ? indicatorColor.withValues(alpha: 0.5) : Colors.transparent, width: selected ? 1.5 : 0),
              bottom: BorderSide(color: selected ? indicatorColor.withValues(alpha: 0.5) : ruleColor, width: selected ? 1.5 : 1),
              left: BorderSide(color: selected ? indicatorColor : Colors.transparent, width: selected ? 4.5 : 0),
            ),
          ),
          padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: 11),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Product Initials Avatar Box (Mockup fidelity)
              if (MediaQuery.textScalerOf(context).scale(14) <= 20) ...[
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: avatarBg,
                    border: Border.all(color: lineColor),
                    borderRadius: BorderRadius.circular(Corners.control),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _initials(name),
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: avatarFg,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
                const SizedBox(width: Space.sm),
              ],

              // Title & Code
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: selected ? FontWeight.bold : FontWeight.w600,
                        color: selected ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0369A1)) : ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (inCart) ...[
                          Icon(Icons.check_circle_outline, size: 12, color: isDark ? const Color(0xFF34D399) : successColor),
                          const SizedBox(width: 4),
                        ],
                        Flexible(
                          child: Text(
                            inCart ? '$code · di keranjang' : code,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: inCart ? (isDark ? const Color(0xFF34D399) : successColor) : muted,
                              fontSize: 12,
                              fontFamily: monoFamily,
                              fontWeight: inCart ? FontWeight.w500 : FontWeight.w400,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Space.sm),

              // Price & Stock
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 150),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(text: price, style: amountStyle.copyWith(fontSize: 14, fontWeight: FontWeight.bold, color: ink)),
                        TextSpan(text: ' /$unit', style: TextStyle(color: muted, fontSize: 11)),
                      ]),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      available ? 'stok $stock' : 'stok habis',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: !available
                            ? errorColor
                            : (stock == '0' || stock == '1' || stock == '2' || stock == '3')
                                ? warningColor
                                : successColor,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Space.xs),

              // Tactile Add Button (+) matching mockup
              IconButton(
                tooltip: 'Tambah $name',
                onPressed: available ? onAdd : null,
                style: IconButton.styleFrom(
                  backgroundColor: available
                      ? (selected ? (isDark ? const Color(0xFF0284C7) : primaryInk) : primaryInk)
                      : (isDark ? raised : const Color(0xFFE2E8F0)),
                  foregroundColor: available ? onPrimary : muted,
                  disabledBackgroundColor: isDark ? raised : const Color(0xFFF1F5F9),
                  disabledForegroundColor: muted,
                  elevation: available ? 1 : 0,
                  minimumSize: const Size(36, 36),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
                  padding: EdgeInsets.zero,
                ),
                icon: const Icon(Icons.add, size: 18),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

