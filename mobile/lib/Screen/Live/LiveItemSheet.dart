import 'package:flutter/material.dart';
import '../../Widgets/ui.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../core/format.dart';
Future<LiveCartItem?> editLiveItem(BuildContext context, LiveProduct product, {LiveCartItem? existing}) =>
  showModalBottomSheet<LiveCartItem>(context: context, isScrollControlled: true, showDragHandle: true,
    builder: (_) => LiveItemSheet(product: product, existing: existing));
class LiveItemSheet extends StatefulWidget {
  const LiveItemSheet({super.key, required this.product, this.existing});
  final LiveProduct product;
  final LiveCartItem? existing;
  @override State<LiveItemSheet> createState() => _LiveItemSheetState();
}
class _LiveItemSheetState extends State<LiveItemSheet> {
  late LiveUnit unit;
  late TextEditingController quantity, manual, discount;
  String? error;
  @override void initState() { super.initState(); unit = widget.existing?.unit ?? widget.product.units.first;
    quantity = TextEditingController(text: widget.existing?.quantity.toString() ?? '1');
    manual = TextEditingController(text: widget.existing?.manualPrice?.toString() ?? '');
    discount = TextEditingController(text: widget.existing?.discount?.toString() ?? '');
  }
  @override void dispose() { quantity.dispose(); manual.dispose(); discount.dispose(); super.dispose(); }
  void save() {
    try {
      final qtyVal = inputQty(quantity.text);
      final manualVal = manual.text.trim().isEmpty ? null : inputRupiah(manual.text);
      final unitPrice = manualVal ?? unit.price ?? 0;
      final discVal = discount.text.trim().isEmpty
          ? null
          : inputDiscount(discount.text, baseAmount: (unitPrice * qtyVal).round());
      Navigator.pop(context, LiveCartItem(product: widget.product, unit: unit, quantity: qtyVal,
        manualPrice: manualVal, discount: discVal));
    }
    catch (e) { setState(() => error = errorText(e)); showError(context, e); }
  }
  @override Widget build(BuildContext context) => SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.viewInsetsOf(context).bottom + 24), child: Column(
    crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text(widget.product.name, style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 16),
      DropdownButtonFormField<LiveUnit>(value: unit, isExpanded: true, decoration: const InputDecoration(labelText: 'Satuan'), items: widget.product.units.map((u) => DropdownMenuItem(value: u, child: Text('${u.name} • ${rupiah(u.price)}'))).toList(),
        onChanged: (u) => setState(() {
          if (u != null && u.id != unit.id) manual.clear();
          if (u != null) unit = u;
        })),
      const SizedBox(height: Space.lg), TextField(controller: quantity, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah', helperText: 'Boleh pecahan, misalnya 0,25')),
      const SizedBox(height: Space.lg), TextField(controller: manual, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Harga manual (Rp, opsional)', helperText: 'Kosong untuk harga otomatis dari PC')),
      const SizedBox(height: Space.lg), TextField(controller: discount, keyboardType: TextInputType.text, decoration: const InputDecoration(labelText: 'Diskon baris (Rp atau %, opsional)', helperText: 'Contoh: 2000 atau 10%')),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: errorColor))),
      const SizedBox(height: Space.lg), SizedBox(width: double.infinity, child: FilledButton(onPressed: save, child: const Text('Simpan ke keranjang'))),
    ])));
}
