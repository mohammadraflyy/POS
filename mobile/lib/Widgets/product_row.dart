import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Data-first catalog row shared by live and demo. Height grows with text.
class ProductRow extends StatelessWidget {
  const ProductRow({super.key, required this.name, required this.code,
    required this.stock, required this.price, required this.unit,
    required this.onConfigure, required this.onAdd, this.inCart = false, this.available = true});
  final String name, code, stock, price, unit;
  final VoidCallback? onConfigure, onAdd;
  final bool inCart, available;

  @override
  Widget build(BuildContext context) => Material(
    color: inCart ? accentSurface : surface,
    child: InkWell(onTap: onConfigure, child: Container(
      decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: lineColor))),
      padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.sm, Space.md),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(name, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: Space.xs),
          Text('$code  /  $unit', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: Space.sm),
          Wrap(spacing: Space.lg, runSpacing: Space.xs, crossAxisAlignment: WrapCrossAlignment.center, children: [
            Text(price, style: amountStyle.copyWith(fontSize: 16)),
            Text(available ? 'Stok $stock' : 'Stok habis', style: TextStyle(color: available ? muted : errorColor, fontSize: 13)),
            if (inCart) const Text('Di keranjang', style: TextStyle(color: wine, fontSize: 13, fontWeight: FontWeight.w600)),
          ]),
        ])),
        const SizedBox(width: Space.sm),
        IconButton.filledTonal(tooltip: 'Tambah $name', onPressed: available ? onAdd : null,
          style: IconButton.styleFrom(backgroundColor: inCart ? surface : accentSurface, foregroundColor: wine),
          icon: const Icon(Icons.add, size: 22)),
      ]),
    )),
  );
}
