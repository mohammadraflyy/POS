import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'OpnameSheet.dart';
class StockOpnameScreen extends StatefulWidget {
  const StockOpnameScreen({super.key, required this.app});
  final AppState app;
  @override
  State<StockOpnameScreen> createState() => _StockOpnameScreenState();
}
class _StockOpnameScreenState extends State<StockOpnameScreen> {
  String _query = '';
  final Set<String> _categories = {};
  @override
  Widget build(BuildContext context) {
    final categories = widget.app.demo.products.map((p) => p.category).toSet();
    final query = _query.toLowerCase().trim();
    var products = widget.app.demo.products.where((p) => (_categories.isEmpty || _categories.contains(p.category)) &&
      (query.isEmpty || '${p.code} ${p.name} ${p.barcode} ${p.category}'.toLowerCase().contains(query)));
    if (query.isNotEmpty) products = products.take(20);
    if (query.isEmpty && _categories.isEmpty) products = products.take(0);
    return ListView(padding: const EdgeInsets.all(Space.lg), children: [
      const PageIntro('Periksa stok', 'Koreksi hanya jika jumlah barang berbeda. Gunakan satuan dasar.'),
      TextField(onChanged: (v) => setState(() => _query = v), decoration: const InputDecoration(labelText: 'Pencarian', hintText: 'Cari nama, kode, atau barcode', prefixIcon: Icon(Icons.search))), const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [for (final category in categories) FilterChip(label: Text(category), selected: _categories.contains(category),
        onSelected: (selected) => setState(() { if (selected) { _categories.add(category); } else { _categories.remove(category); } }))]),
      const SizedBox(height: Space.lg),
      if (products.isEmpty) const SizedBox(height: 250, child: EmptyPanel(icon: Icons.manage_search, title: 'Temukan barang yang dihitung', message: 'Pilih kategori untuk melihat seluruh barang pada rak, atau masukkan kata pencarian.')),
      for (final product in products) RecordRow(title: product.name,
        subtitle: product.code + ' / ' + product.category,
        value: 'Stok ' + qty(product.stock) + ' ' + product.baseUnit.name,
        actionLabel: 'Koreksi stok',
        onTap: () => showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true,
          builder: (_) => OpnameSheet(app: widget.app, product: product))),
    ]);
  }
}
