import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../models/pos_models.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
class FormPembelianScreen extends StatefulWidget {
  const FormPembelianScreen({super.key, required this.app});
  final AppState app;
  @override
  State<FormPembelianScreen> createState() => _FormPembelianScreenState();
}
class _FormPembelianScreenState extends State<FormPembelianScreen> {
  final _supplier = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _price = TextEditingController();
  final _paid = TextEditingController();
  late Product _product;
  late ProductUnit _unit;
  DateTime _date = DateTime.now();
  String? _error;
  bool _saved = false;
  @override
  void initState() { super.initState(); _product = widget.app.demo.products.first; _unit = _product.baseUnit; _price.text = moneyField(_unit.cost); }
  @override
  void dispose() { for (final c in [_supplier, _quantity, _price, _paid]) { c.dispose(); } super.dispose(); }
  void _save() {
    if (_saved) return;
    try {
      widget.app.demo.purchase(product: _product, unit: _unit, quantity: qtyInput(_quantity.text),
        price: moneyInput(_price.text), supplier: _supplier.text, date: _date, paid: _paid.text.trim().isEmpty ? null : moneyInput(_paid.text));
      _saved = true; widget.app.refreshDemo(); Navigator.pop(context);
    } catch (e) { setState(() => _error = errorText(e)); showError(context, e); }
  }
  @override
  Widget build(BuildContext context) {
    int? total;
    try { total = (qtyInput(_quantity.text) * moneyInput(_price.text) / 1000).round(); } catch (_) {}
    return Scaffold(appBar: AppBar(title: const Text('Pembelian baru')), body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 620), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      const Pill('PEMBELIAN DEMO • 1 BARANG PER INVOICE'), const SizedBox(height: Space.lg),
      TextField(controller: _supplier, textInputAction: TextInputAction.next, decoration: const InputDecoration(labelText: 'Nama supplier', prefixIcon: Icon(Icons.local_shipping_outlined))),
      const SizedBox(height: Space.lg), OutlinedButton.icon(onPressed: () async { final date = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime.now()); if (date != null && mounted) setState(() => _date = date); }, icon: const Icon(Icons.calendar_today_outlined), label: Text(dateText(_date))),
      const SizedBox(height: Space.lg), DropdownButtonFormField<Product>(value: _product, isExpanded: true, decoration: const InputDecoration(labelText: 'Produk'), items: widget.app.demo.products.map((p) => DropdownMenuItem(value: p, child: Text(p.name))).toList(),
        onChanged: (p) => setState(() { _product = p!; _unit = p.baseUnit; _price.text = moneyField(_unit.cost); })),
      const SizedBox(height: Space.lg), DropdownButtonFormField<ProductUnit>(key: ValueKey(_product.id), value: _unit, decoration: const InputDecoration(labelText: 'Satuan'), items: _product.units.map((u) => DropdownMenuItem(value: u, child: Text(u.name))).toList(),
        onChanged: (u) => setState(() { _unit = u!; _price.text = moneyField(u.cost); })),
      const SizedBox(height: Space.lg), TextField(controller: _quantity, textInputAction: TextInputAction.next, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah barang masuk')),
      const SizedBox(height: Space.lg), TextField(controller: _price, textInputAction: TextInputAction.next, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Harga beli per satuan (Rp)')),
      const SizedBox(height: Space.lg), TextField(controller: _paid, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Uang muka (opsional)', helperText: 'Kosong = lunas. Isi 0 untuk utang penuh.')),
      const SizedBox(height: Space.lg), WhitePanel(child: Column(children: [SummaryRow('Total pembelian', total == null ? '—' : money(total), strong: true), SummaryRow('Stok saat ini', '${qty(_product.stock)} ${_product.baseUnit.name}')])),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_error!, style: const TextStyle(color: errorColor))),
      const SizedBox(height: Space.xl), FilledButton.icon(onPressed: _saved ? null : _save, icon: const Icon(Icons.add_shopping_cart), label: const Text('Simpan pembelian demo')),
    ])))));
  }
}
