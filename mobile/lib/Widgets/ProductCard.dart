import 'package:flutter/material.dart';
import '../models/pos_models.dart';
import '../core/format.dart';
import '../core/theme.dart';
import 'ui.dart';
class ProductCard extends StatelessWidget {
  const ProductCard({super.key, required this.product, required this.onAdd, required this.onConfigure, required this.inCart});
  final Product product;
  final VoidCallback onAdd, onConfigure;
  final bool inCart;
  @override
  Widget build(BuildContext context) => Material(color: surface, shape: RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(Corners.panel), side: BorderSide(color: inCart ? ink : lineColor, width: inCart ? 1.5 : 1)), clipBehavior: Clip.antiAlias,
    child: InkWell(onTap: onConfigure, child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(child: Container(width: double.infinity, decoration: BoxDecoration(color: Color(product.color), borderRadius: BorderRadius.circular(13)), child: Stack(children: [
        Center(child: Text(product.glyph, style: const TextStyle(fontSize: 48))),
        if (inCart) Positioned(top: 6, right: 6, child: Icon(Icons.check_circle, size: 20, color: ink)),
        if (product.stock <= 0) Center(child: Pill('Stok habis', color: muted)),
      ]))),
      const SizedBox(height: 10), Text(product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      const SizedBox(height: 4), Text('Stok ${qty(product.stock)} ${product.baseUnit.name}', style: TextStyle(color: muted, fontSize: 11)),
      Row(children: [Expanded(child: Text(money(product.baseUnit.price), style: amountStyle)),
        IconButton.filledTonal(onPressed: product.stock <= 0 ? null : onAdd, tooltip: 'Tambah ${product.name}', icon: const Icon(Icons.add, size: 18), visualDensity: VisualDensity.compact),
      ]),
    ]))),
  );
}
