import 'package:flutter/material.dart';
import '../core/theme.dart';
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
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: lineColor))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [for (var i = 0; i < labels.length; i++) Expanded(
        child: Semantics(selected: selectedIndex == i, button: true, label: labels[i],
          child: InkWell(onTap: () => onDestinationSelected(i), child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Space.md, horizontal: Space.xs),
            child: ExcludeSemantics(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(icons[i], color: selectedIndex == i ? wine : muted, size: 22),
              const SizedBox(height: Space.xs),
              Text(labels[i], textAlign: TextAlign.center, style: TextStyle(fontSize: 12,
                color: selectedIndex == i ? wine : muted, fontWeight: selectedIndex == i ? FontWeight.w700 : FontWeight.w500)),
            ])),
          ))),
      )]),
    )));
  }
}
