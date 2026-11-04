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
    try { Navigator.pop(context, LiveCartItem(product: widget.product, unit: unit, quantity: inputQty(quantity.text),
      manualPrice: manual.text.trim().isEmpty ? null : inputRupiah(manual.text), discount: discount.text.trim().isEmpty ? null : inputRupiah(discount.text))); }
    catch (e) { setState(() => error = errorText(e)); showError(context, e); }
  }
  @override Widget build(BuildContext context) => SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.viewInsetsOf(context).bottom + 24), child: Column(
    crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Text(widget.product.name, style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 16),
      DropdownButtonFormField<LiveUnit>(value: unit, isExpanded: true, decoration: const InputDecoration(labelText: 'Satuan'), items: widget.product.units.map((u) => DropdownMenuItem(value: u, child: Text('${u.name} • ${rupiah(u.price)}'))).toList(),
        onChanged: widget.existing == null ? (u) => setState(() => unit = u!) : null),
      const SizedBox(height: Space.lg), TextField(controller: quantity, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah', helperText: 'Boleh pecahan, misalnya 0,25')),
      const SizedBox(height: Space.lg), TextField(controller: manual, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Harga manual (Rp, opsional)', helperText: 'Kosong untuk harga otomatis dari PC')),
      const SizedBox(height: Space.lg), TextField(controller: discount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Diskon baris (Rp, opsional)')),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: errorColor))),
      const SizedBox(height: Space.lg), SizedBox(width: double.infinity, child: FilledButton(onPressed: save, child: const Text('Simpan ke keranjang'))),
    ])));
}
