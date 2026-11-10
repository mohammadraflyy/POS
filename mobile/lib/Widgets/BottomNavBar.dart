import 'package:flutter/material.dart';
import '../core/theme.dart';

/// The phone's four destinations and "Lainnya", each with a short label. The active one
/// is ink with a neutral pill behind its icon; the rest are grey. No brand colour.
class BottomNavBar extends StatelessWidget {
  const BottomNavBar({super.key, required this.selectedIndex, required this.onDestinationSelected,
    this.labels = const ['Kasir', 'Pembelian', 'Opname', 'Riwayat'],
    this.icons = const [Icons.storefront_outlined, Icons.shopping_bag_outlined, Icons.inventory_2_outlined, Icons.receipt_long_outlined]});
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<String> labels;
  final List<IconData> icons;
  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Material(color: surface, child: SafeArea(top: false, child: Container(
      decoration: BoxDecoration(border: Border(top: BorderSide(color: lineColor))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < labels.length; i++) Expanded(
        child: Semantics(selected: selectedIndex == i, button: true, label: labels[i],
          child: InkWell(onTap: () => onDestinationSelected(i), child: Padding(
            padding: const EdgeInsets.fromLTRB(Space.xs, Space.sm, Space.xs, Space.sm),
            child: ExcludeSemantics(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(
                width: 52,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selectedIndex == i
                      ? (isDark ? const Color(0xFF1E293B) : const Color(0xFF0F172A))
                      : Colors.transparent,
                  border: selectedIndex == i && isDark
                      ? Border.all(color: const Color(0xFF38BDF8), width: 1.2)
                      : null,
                  borderRadius: BorderRadius.circular(15),
                  boxShadow: selectedIndex == i && !isDark ? [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 4, offset: const Offset(0, 1))
                  ] : null,
                ),
                child: Icon(
                  icons[i],
                  color: selectedIndex == i
                      ? (isDark ? const Color(0xFF38BDF8) : Colors.white)
                      : muted,
                  size: 20,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                labels[i],
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  color: selectedIndex == i
                      ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F172A))
                      : muted,
                  fontWeight: selectedIndex == i ? FontWeight.bold : FontWeight.w500,
                ),
              ),
            ])),
          ))),
      )]),
    )));
  }
}
