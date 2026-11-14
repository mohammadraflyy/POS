import 'package:flutter/material.dart';
import '../../Widgets/popup.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../core/format.dart';
import 'kasir_style.dart';

const _wideFrom = 860.0;
const _maxChipUnits = 4;

/// Wide screens get a centred card, phones a bottom sheet. [onRemove] adds "Hapus barang":
/// the sheet closes with null, then the callback runs.
Future<LiveCartItem?> editLiveItem(BuildContext context, LiveProduct product,
    {LiveCartItem? existing, num? defaultQuantity, VoidCallback? onRemove}) {
  final sheet = LiveItemSheet(product: product, existing: existing, defaultQuantity: defaultQuantity, onRemove: onRemove);
  if (MediaQuery.sizeOf(context).width >= _wideFrom) {
    return showDialog<LiveCartItem>(context: context, builder: (_) => sheet);
  }
  return showModalBottomSheet<LiveCartItem>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => sheet);
}

class LiveItemSheet extends StatefulWidget {
  const LiveItemSheet({super.key, required this.product, this.existing, this.defaultQuantity, this.onRemove});
  final LiveProduct product;
  final LiveCartItem? existing;
  final num? defaultQuantity;
  final VoidCallback? onRemove;
  @override State<LiveItemSheet> createState() => _LiveItemSheetState();
}

class _LiveItemSheetState extends State<LiveItemSheet> {
  late LiveUnit unit;
  late TextEditingController quantity, manual, discount;
  String? error;

  @override void initState() {
    super.initState();
    unit = widget.existing?.unit ?? widget.product.units.first;
    final q = widget.existing?.quantity ?? widget.defaultQuantity ?? 1;
    quantity = TextEditingController(text: q == q.roundToDouble() ? q.toInt().toString() : q.toString());
    quantity.selection = TextSelection(baseOffset: 0, extentOffset: quantity.text.length);
    manual = TextEditingController(text: widget.existing?.manualPrice?.toString() ?? '');
    discount = TextEditingController(text: widget.existing?.discount?.toString() ?? '');
    for (final c in [quantity, manual, discount]) { c.addListener(_edited); }
  }
  @override void dispose() { quantity.dispose(); manual.dispose(); discount.dispose(); super.dispose(); }

  // Rebuilds the live summary; a stale save error would no longer match what is typed.
  void _edited() => setState(() => error = null);

  ({num qty, num? manual, num price, num? discount}) _read() {
    final qtyVal = inputQty(quantity.text);
    final manualVal = manual.text.trim().isEmpty ? null : inputRupiah(manual.text);
    final price = manualVal ?? unit.price ?? 0;
    final discVal = discount.text.trim().isEmpty
        ? null
        : inputDiscount(discount.text, baseAmount: (price * qtyVal).round());
    return (qty: qtyVal, manual: manualVal, price: price, discount: discVal);
  }

  void save() {
    try {
      final r = _read();
      Navigator.pop(context, LiveCartItem(product: widget.product, unit: unit, quantity: r.qty,
        manualPrice: r.manual, discount: r.discount, priceNote: widget.existing?.priceNote));
    } catch (e) { setState(() => error = errorText(e)); }
  }

  void remove() {
    Navigator.pop(context);
    widget.onRemove!();
  }

  void _pickUnit(LiveUnit u) => setState(() {
    if (u.id != unit.id) manual.clear();
    unit = u;
  });

  // Whole steps, but a fraction typed below 1 stays: the minus never reaches zero.
  void _step(int delta) {
    num current;
    try { current = inputQty(quantity.text); } on FormatException { current = 1; }
    var next = current + delta;
    if (delta < 0 && next < 1) next = current < 1 ? current : 1;
    quantity.text = quantityText((next * 1000).round() / 1000);
  }

  @override Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= _wideFrom;
    final content = Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _header(wide),
      Divider(height: 1, color: KasirColors.border),
      Flexible(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: _body(wide))),
      Divider(height: 1, color: KasirColors.border),
      Padding(padding: const EdgeInsets.all(16), child: _footer()),
    ]);
    if (!wide) {
      return SafeArea(top: false, child: Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom), child: content));
    }
    return Dialog(
      backgroundColor: Colors.transparent, elevation: 0, insetPadding: const EdgeInsets.all(24),
      child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: Container(
        decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
        clipBehavior: Clip.antiAlias,
        child: content,
      ))),
    );
  }

  Widget _header(bool wide) {
    final stock = widget.product.stock;
    final code = widget.product.code;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, wide ? 8 : 0, wide ? 8 : 20, 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Expanded(child: Padding(padding: EdgeInsets.only(top: wide ? 4 : 0), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: KasirColors.ink)),
          if (code.isNotEmpty || stock != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text.rich(
            TextSpan(style: TextStyle(fontSize: 13, color: KasirColors.label), children: [
              if (code.isNotEmpty) TextSpan(text: code, style: TextStyle(fontFamily: monoFamily)),
              if (code.isNotEmpty && stock != null) const TextSpan(text: ' · '),
              if (stock != null) TextSpan(text: 'stok ${quantityText(stock / unit.conversionFactor)} ${unit.name}'),
            ]),
          )),
        ]))),
        if (wide) IconButton(tooltip: 'Tutup', onPressed: () => Navigator.of(context).maybePop(), icon: const Icon(Icons.close)),
      ]),
    );
  }

  Widget _body(bool wide) {
    final manualField = TextField(controller: manual, textInputAction: TextInputAction.done, onSubmitted: (_) => save(),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: const InputDecoration(labelText: 'Harga manual', hintText: 'otomatis', floatingLabelBehavior: FloatingLabelBehavior.always));
    final discountField = TextField(controller: discount, textInputAction: TextInputAction.done, onSubmitted: (_) => save(),
      keyboardType: TextInputType.text,
      decoration: const InputDecoration(labelText: 'Diskon', hintText: 'Rp atau %', floatingLabelBehavior: FloatingLabelBehavior.always));
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text('Satuan', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: KasirColors.label)),
      const SizedBox(height: 8),
      _units(),
      const SizedBox(height: 20),
      Row(children: [
        _stepButton(Icons.remove, 'Kurangi jumlah', () => _step(-1)),
        const SizedBox(width: 12),
        Expanded(child: TextField(controller: quantity, autofocus: true, textAlign: TextAlign.center,
          textInputAction: TextInputAction.done, onSubmitted: (_) => save(),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: amountStyle.copyWith(fontSize: 20, fontWeight: FontWeight.w600),
          decoration: const InputDecoration(labelText: 'Jumlah', floatingLabelBehavior: FloatingLabelBehavior.always, floatingLabelAlignment: FloatingLabelAlignment.center))),
        const SizedBox(width: 12),
        _stepButton(Icons.add, 'Tambah jumlah', () => _step(1)),
      ]),
      const SizedBox(height: 20),
      if (wide) Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: manualField), const SizedBox(width: 12), Expanded(child: discountField)])
      else ...[manualField, const SizedBox(height: 16), discountField],
      const SizedBox(height: 20),
      _summary(),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: TextStyle(fontSize: 13, color: KasirColors.destructive))),
    ]);
  }

  Widget _stepButton(IconData icon, String label, VoidCallback onPressed) => IconButton.outlined(
    tooltip: label, onPressed: onPressed, icon: Icon(icon),
    style: IconButton.styleFrom(fixedSize: const Size(44, 44), side: BorderSide(color: KasirColors.gridLine), foregroundColor: KasirColors.ink));

  Widget _units() {
    final units = widget.product.units;
    if (units.length > _maxChipUnits) {
      return DropdownButtonFormField<LiveUnit>(initialValue: unit, isExpanded: true,
        items: [for (final u in units) DropdownMenuItem(value: u, child: Text('${u.name} • ${rupiah(u.price)}'))],
        onChanged: (u) { if (u != null) _pickUnit(u); });
    }
    return Wrap(spacing: 8, runSpacing: 8, children: [for (final u in units) _unitChip(u)]);
  }

  Widget _unitChip(LiveUnit u) {
    final selected = u.id == unit.id;
    final fg = selected ? KasirColors.onPrimary : KasirColors.ink;
    return Semantics(button: true, selected: selected, child: Material(
      color: selected ? KasirColors.primary : KasirColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control), side: BorderSide(color: selected ? KasirColors.primary : KasirColors.gridLine)),
      child: InkWell(
        onTap: () => _pickUnit(u), borderRadius: BorderRadius.circular(Corners.control),
        child: ConstrainedBox(constraints: const BoxConstraints(minHeight: 44), child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(u.name, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: fg)),
            const SizedBox(width: 8),
            Text(rupiah(u.price), style: amountStyle.copyWith(fontSize: 13, color: fg)),
          ]),
        )),
      ),
    ));
  }

  Widget _summary() {
    String line, total;
    try {
      final r = _read();
      final disc = r.discount ?? 0;
      line = '${quantityText(r.qty)} ${unit.name} × ${rupiah(r.price)} − ${rupiah(disc)}';
      total = rupiah(r.price * r.qty - disc);
    } on FormatException {
      line = '—';
      total = '—';
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: KasirColors.tint, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        Expanded(child: Text(line, style: amountStyle.copyWith(fontSize: 13, color: KasirColors.label))),
        const SizedBox(width: 12),
        Text(total, style: moneyStyle.copyWith(fontSize: 16)),
      ]),
    );
  }

  Widget _footer() => Row(children: [
    Expanded(child: Align(alignment: Alignment.centerLeft, child: widget.onRemove == null ? null : TextButton.icon(
      onPressed: remove, icon: const Icon(Icons.delete_outline, size: 18),
      label: const Text('Hapus barang', maxLines: 1, overflow: TextOverflow.ellipsis),
      style: TextButton.styleFrom(foregroundColor: KasirColors.destructive, minimumSize: const Size(0, 44))))),
    PopupButton('Batal', keyHint: 'Esc', onPressed: () => Navigator.of(context).maybePop()),
    const SizedBox(width: 10),
    PopupButton('Simpan', primary: true, tone: KasirColors.primary, keyHint: 'Enter', onPressed: save),
  ]);
}
