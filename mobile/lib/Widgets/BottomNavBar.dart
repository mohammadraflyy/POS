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
    return Material(color: surface, child: SafeArea(top: false, child: Container(
      decoration: BoxDecoration(border: Border(top: BorderSide(color: lineColor))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < labels.length; i++) Expanded(
        child: Semantics(selected: selectedIndex == i, button: true, label: labels[i],
          child: InkWell(onTap: () => onDestinationSelected(i), child: Padding(
            padding: const EdgeInsets.fromLTRB(Space.xs, Space.sm, Space.xs, Space.sm),
            child: ExcludeSemantics(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 48, height: 28, alignment: Alignment.center,
                decoration: BoxDecoration(color: selectedIndex == i ? activePill : Colors.transparent, borderRadius: BorderRadius.circular(14)),
                child: Icon(icons[i], color: selectedIndex == i ? ink : muted, size: 20)),
              const SizedBox(height: 4),
              Text(labels[i], textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12,
                color: selectedIndex == i ? ink : muted, fontWeight: selectedIndex == i ? FontWeight.w500 : FontWeight.w400)),
            ])),
          ))),
      )]),
    )));
  }
}
