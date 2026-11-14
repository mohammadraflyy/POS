import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  final quantityFocus = FocusNode(), manualFocus = FocusNode(), discountFocus = FocusNode();
  // Wrap the unit chips and the footer buttons so up/down can treat each row as one stop.
  final _unitZone = FocusNode(skipTraversal: true, canRequestFocus: false);
  final _footerZone = FocusNode(skipTraversal: true, canRequestFocus: false);
  LiveUnit? _ringUnit;
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
  @override void dispose() {
    for (final c in [quantity, manual, discount]) { c.dispose(); }
    for (final n in [quantityFocus, manualFocus, discountFocus, _unitZone, _footerZone]) { n.dispose(); }
    super.dispose();
  }

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

  // Text fields swallow up/down, so the dialog walks its own stops: unit chips, Jumlah, Harga manual, Diskon, footer.
  KeyEventResult _onKey(FocusNode _, KeyEvent event) {
    if (event is KeyUpEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final stops = [_unitZone, quantityFocus, manualFocus, discountFocus, _footerZone];
    final at = stops.indexWhere((s) => s.hasFocus);
    if (at < 0) return KeyEventResult.ignored;
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.arrowUp) {
      final next = at + (key == LogicalKeyboardKey.arrowDown ? 1 : -1);
      if (next >= 0 && next < stops.length) _land(next);
      return KeyEventResult.handled;
    }
    final sideways = key == LogicalKeyboardKey.arrowRight ? 1 : key == LogicalKeyboardKey.arrowLeft ? -1 : 0;
    // Inside a text field left/right stay caret moves.
    if (sideways == 0 || (at != 0 && at != stops.length - 1)) return KeyEventResult.ignored;
    final row = stops[at].traversalDescendants.toList();
    final from = row.indexWhere((n) => n.hasPrimaryFocus);
    if (from >= 0) row[(from + sideways).clamp(0, row.length - 1)].requestFocus();
    return KeyEventResult.handled;
  }

  void _land(int stop) {
    final fields = [null, quantity, manual, discount, null];
    final field = fields[stop];
    if (field != null) {
      field.selection = TextSelection(baseOffset: 0, extentOffset: field.text.length);
      [quantityFocus, manualFocus, discountFocus][stop - 1].requestFocus();
      return;
    }
    final row = (stop == 0 ? _unitZone : _footerZone).traversalDescendants.toList();
    final chosen = stop == 0 ? widget.product.units.indexWhere((u) => u.id == unit.id) : row.length - 1;
    row[chosen.clamp(0, row.length - 1)].requestFocus();
  }

  @override Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= _wideFrom;
    final content = Focus(onKeyEvent: _onKey, canRequestFocus: false, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _header(wide),
      Divider(height: 1, color: KasirColors.border),
      Flexible(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: _body(wide))),
      Divider(height: 1, color: KasirColors.border),
      Padding(padding: const EdgeInsets.all(16), child: _footer()),
    ]));
    if (!wide) {
      return SafeArea(top: false, child: Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom), child: content));
    }
    // A bare shape: the themed dialog shell would draw its own border around the whole dialog area.
    return Dialog(
      backgroundColor: Colors.transparent, elevation: 0, insetPadding: const EdgeInsets.all(24), shape: const RoundedRectangleBorder(),
      child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 480), child: Container(
        decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
        clipBehavior: Clip.antiAlias,
        child: content,
      )),
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
    final manualField = TextField(controller: manual, focusNode: manualFocus, textInputAction: TextInputAction.done, onSubmitted: (_) => save(),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: const InputDecoration(labelText: 'Harga manual', hintText: 'otomatis', floatingLabelBehavior: FloatingLabelBehavior.always));
    final discountField = TextField(controller: discount, focusNode: discountFocus, textInputAction: TextInputAction.done, onSubmitted: (_) => save(),
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
        Expanded(child: TextField(controller: quantity, focusNode: quantityFocus, autofocus: true, textAlign: TextAlign.center,
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
    final row = units.length > _maxChipUnits
      ? DropdownButtonFormField<LiveUnit>(initialValue: unit, isExpanded: true,
          items: [for (final u in units) DropdownMenuItem(value: u, child: Text('${u.name} • ${rupiah(u.price)}'))],
          onChanged: (u) { if (u != null) _pickUnit(u); })
      : Wrap(spacing: 8, runSpacing: 8, children: [for (final u in units) _unitChip(u)]);
    return Focus(focusNode: _unitZone, canRequestFocus: false, skipTraversal: true, child: row);
  }

  Widget _unitChip(LiveUnit u) {
    final selected = u.id == unit.id;
    final fg = selected ? KasirColors.onPrimary : KasirColors.ink;
    final ringed = identical(_ringUnit, u);
    // On the filled chip a primary ring would vanish into the fill.
    final ring = BorderSide(color: selected ? KasirColors.ink : KasirColors.primary, width: 2);
    return Semantics(button: true, selected: selected, child: Material(
      color: selected ? KasirColors.primary : KasirColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control), side: ringed ? ring : BorderSide(color: selected ? KasirColors.primary : KasirColors.gridLine)),
      child: InkWell(
        onTap: () => _pickUnit(u), borderRadius: BorderRadius.circular(Corners.control),
        onFocusChange: (focused) { if (mounted) setState(() => _ringUnit = focused ? u : (identical(_ringUnit, u) ? null : _ringUnit)); },
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

  Widget _footer() {
    final theme = Theme.of(context);
    // Simpan is primary-filled, so the themed primary focus border would be invisible on it.
    final filled = (theme.filledButtonTheme.style ?? const ButtonStyle()).copyWith(
      side: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.focused) ? BorderSide(color: KasirColors.ink, width: 2) : BorderSide.none));
    return Focus(focusNode: _footerZone, canRequestFocus: false, skipTraversal: true, child: Theme(
      data: theme.copyWith(filledButtonTheme: FilledButtonThemeData(style: filled)),
      child: Row(children: [
        Expanded(child: Align(alignment: Alignment.centerLeft, child: widget.onRemove == null ? null : TextButton.icon(
          onPressed: remove, icon: const Icon(Icons.delete_outline, size: 18),
          label: const Text('Hapus barang', maxLines: 1, overflow: TextOverflow.ellipsis),
          style: TextButton.styleFrom(foregroundColor: KasirColors.destructive, minimumSize: const Size(0, 44))))),
        PopupButton('Batal', keyHint: 'Esc', onPressed: () => Navigator.of(context).maybePop()),
        const SizedBox(width: 10),
        PopupButton('Simpan', primary: true, tone: KasirColors.primary, keyHint: 'Enter', onPressed: save),
      ]),
    ));
  }
}
