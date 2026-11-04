import 'package:flutter/material.dart';
import '../../Widgets/ui.dart';
import '../../models/pos_models.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
Future<void> showProductSheet(BuildContext context, AppState app, Product product, {CartLine? existing}) =>
  showModalBottomSheet<void>(context: context, isScrollControlled: true, showDragHandle: true,
    builder: (_) => ProductSheet(app: app, product: product, existing: existing));
class ProductSheet extends StatefulWidget {
  const ProductSheet({super.key, required this.app, required this.product, this.existing});
  final AppState app;
  final Product product;
  final CartLine? existing;
  @override
  State<ProductSheet> createState() => _ProductSheetState();
}
class _ProductSheetState extends State<ProductSheet> {
  late ProductUnit _unit;
  late TextEditingController _quantity;
  late TextEditingController _manual;
  late TextEditingController _discount;
  String? _error;
  @override
  void initState() {
    super.initState(); _unit = widget.existing?.unit ?? widget.product.baseUnit;
    _quantity = TextEditingController(text: qty(widget.existing?.quantity ?? 1000));
    _manual = TextEditingController(text: widget.existing?.manualPrice == null ? '' : moneyField(widget.existing!.manualPrice!));
    _discount = TextEditingController(text: moneyField(widget.existing?.discount ?? 0));
  }
  @override
  void dispose() { _quantity.dispose(); _manual.dispose(); _discount.dispose(); super.dispose(); }
  void _save() {
    try {
      final line = CartLine(product: widget.product, unit: _unit, quantity: qtyInput(_quantity.text),
        manualPrice: _manual.text.trim().isEmpty ? null : moneyInput(_manual.text), discount: moneyInput(_discount.text));
      widget.app.putLine(line); Navigator.pop(context);
    } catch (e) { setState(() => _error = errorText(e)); showError(context, e); }
  }
  @override
  Widget build(BuildContext context) => SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.viewInsetsOf(context).bottom + 24), child: Column(
    crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Row(children: [Text(widget.product.glyph, style: const TextStyle(fontSize: 42)), const SizedBox(width: 14), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(widget.product.name, style: Theme.of(context).textTheme.titleLarge), Text('Tersedia ${qty(widget.product.stock)} ${widget.product.baseUnit.name}', style: TextStyle(color: muted)),
      ]))]),
      const SizedBox(height: Space.xl), DropdownButtonFormField<ProductUnit>(value: _unit, decoration: const InputDecoration(labelText: 'Satuan'),
        items: widget.product.units.map((u) => DropdownMenuItem(value: u, child: Text('${u.name} • ${money(u.price)}'))).toList(),
        onChanged: widget.existing != null ? null : (u) => setState(() { _unit = u!; _manual.clear(); })),
      const SizedBox(height: Space.lg), TextField(controller: _quantity, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah', helperText: 'Boleh pecahan, misalnya 0,25')),
      const SizedBox(height: Space.lg), TextField(controller: _manual, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Harga manual (opsional)', hintText: 'Otomatis sesuai tier harga', helperText: 'Minimal ${money(_unit.cost)} per ${_unit.name}')),
      const SizedBox(height: Space.lg), TextField(controller: _discount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Diskon barang (Rp)', helperText: 'Nominal untuk seluruh baris barang ini')),
      if (_unit.tiers.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text('Harga grosir: ${_unit.tiers.map((t) => 'mulai ${qty(t.minQty)} ${_unit.name} → ${money(t.price)}').join(', ')}', style: TextStyle(color: muted, fontSize: 13))),
      const SizedBox(height: 12), Text('Barang dengan satuan yang sama akan diperbarui sesuai jumlah di atas.', style: TextStyle(fontSize: 13, color: muted)),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: errorColor))),
      const SizedBox(height: Space.lg), SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: _save, icon: const Icon(Icons.shopping_bag_outlined), label: const Text('Simpan ke keranjang'))),
    ],
  )));
}
