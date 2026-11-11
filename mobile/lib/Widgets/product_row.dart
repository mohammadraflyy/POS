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
        ? (isDark ? const Color(0xFF0C4A6E).withValues(alpha: 0.35) : const Color(0xFFF0F9FF))
        : surface;
    final avatarBg = isDark ? raised : const Color(0xFFF1F5F9);
    final avatarFg = isDark ? ink : const Color(0xFF475569);

    return Material(
      color: rowBg,
      child: Tooltip(
        message: 'Tambah $name',
        waitDuration: const Duration(seconds: 1),
        child: InkWell(
          onTap: available ? (onAdd ?? onConfigure) : null,
          child: Container(
            decoration: BoxDecoration(
              border: Border(
                left: selected
                    ? BorderSide(color: isDark ? const Color(0xFF38BDF8) : const Color(0xFF0284C7), width: 3)
                    : BorderSide.none,
                bottom: BorderSide(color: ruleColor, width: 1),
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: Space.md, vertical: 12),
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
                        fontWeight: FontWeight.w600,
                        color: ink,
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
            ],
          ),
          ),
        ),
      ),
    );
  }
}

