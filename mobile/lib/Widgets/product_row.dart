import 'package:flutter/material.dart';
import '../core/theme.dart';

/// One catalog line on the till: the name and code on the left, the price right-aligned in
/// tabular digits, stock in grey under it. A line already in the cart says so in words and
/// a 2px ink edge; no tinted fill.
class ProductRow extends StatelessWidget {
  const ProductRow({super.key, required this.name, required this.code,
    required this.stock, required this.price, required this.unit,
    required this.onConfigure, required this.onAdd, this.inCart = false, this.available = true});
  final String name, code, stock, price, unit;
  final VoidCallback? onConfigure, onAdd;
  final bool inCart, available;

  @override
  Widget build(BuildContext context) => Material(
    color: surface,
    child: InkWell(onTap: onConfigure, child: Container(
      decoration: BoxDecoration(border: Border(
        bottom: const BorderSide(color: ruleColor),
        left: BorderSide(color: inCart ? ink : Colors.transparent, width: 2))),
      padding: const EdgeInsets.fromLTRB(14, 10, Space.sm, 10),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
          const SizedBox(height: 2),
          Text(inCart ? '$code · di keranjang' : code, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: inCart ? ink : muted, fontSize: 12, fontFamily: monoFamily)),
        ])),
        const SizedBox(width: Space.md),
        // the figures end on one right edge; long prices shrink before they push the name
        ConstrainedBox(constraints: const BoxConstraints(maxWidth: 150), child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text.rich(TextSpan(children: [
            TextSpan(text: price, style: amountStyle.copyWith(fontSize: 15)),
            TextSpan(text: ' /$unit', style: const TextStyle(color: muted, fontSize: 12)),
          ]), maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.end),
          const SizedBox(height: 2),
          Text(available ? 'stok $stock' : 'stok habis', maxLines: 1, overflow: TextOverflow.ellipsis, style: amountStyle.copyWith(fontWeight: FontWeight.w400, color: available ? muted : errorColor, fontSize: 12)),
        ])),
        const SizedBox(width: Space.sm),
        IconButton(tooltip: 'Tambah $name', onPressed: available ? onAdd : null,
          style: IconButton.styleFrom(side: const BorderSide(color: controlBorder), backgroundColor: surface),
          icon: const Icon(Icons.add, size: 18)),
      ]),
    )),
  );
}
