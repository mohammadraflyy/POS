import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../Widgets/popup.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../core/format.dart';
import 'kasir_style.dart';

const _wideFrom = 860.0;
const _digitKeys = [
  LogicalKeyboardKey.digit1, LogicalKeyboardKey.digit2, LogicalKeyboardKey.digit3, LogicalKeyboardKey.digit4, LogicalKeyboardKey.digit5,
  LogicalKeyboardKey.digit6, LogicalKeyboardKey.digit7, LogicalKeyboardKey.digit8, LogicalKeyboardKey.digit9,
];

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
  // Wrap the unit tiles and the footer buttons so up/down can treat each row as one stop.
  final _unitZone = FocusNode(skipTraversal: true, canRequestFocus: false);
  final _footerZone = FocusNode(skipTraversal: true, canRequestFocus: false);
  LiveUnit? _ringUnit;
  String? error;

  bool get _wide => MediaQuery.sizeOf(context).width >= _wideFrom;
  // Keycaps and key legends only make sense where there is a keyboard.
  bool get _hints => _wide && isDesktop;

  @override void initState() {
    super.initState();
    unit = widget.existing?.unit ?? widget.product.units.first;
    final q = widget.existing?.quantity ?? widget.defaultQuantity ?? 1;
    quantity = TextEditingController(text: q == q.roundToDouble() ? q.toInt().toString() : q.toString());
    quantity.selection = TextSelection(baseOffset: 0, extentOffset: quantity.text.length);
    manual = TextEditingController(text: widget.existing?.manualPrice?.toString() ?? '');
    discount = TextEditingController(text: widget.existing?.discount?.toString() ?? '');
    for (final c in [quantity, manual, discount]) { c.addListener(_edited); }
    for (final f in [quantityFocus, manualFocus, discountFocus]) { f.addListener(_focusMoved); }
  }
  @override void dispose() {
    for (final c in [quantity, manual, discount]) { c.dispose(); }
    for (final n in [quantityFocus, manualFocus, discountFocus, _unitZone, _footerZone]) { n.dispose(); }
    super.dispose();
  }

  // Rebuilds the live summary; a stale save error would no longer match what is typed.
  void _edited() => setState(() => error = null);

  // The active row's highlight follows focus.
  void _focusMoved() => setState(() {});

  ({num qty, num? manual, num price, num? discount}) _read() {
    final qtyVal = inputQty(quantity.text);
    final manualVal = manual.text.trim().isEmpty ? null : inputRupiah(manual.text);
    final price = manualVal ?? unit.priceFor(qtyVal) ?? 0;
    final discVal = discount.text.trim().isEmpty
        ? null
        : inputDiscount(discount.text, baseAmount: (price * qtyVal).round());
    return (qty: qtyVal, manual: manualVal, price: price, discount: discVal);
  }

  ({num qty, num? manual, num price, num? discount})? _tryRead() {
    try { return _read(); } on FormatException { return null; }
  }

  // The tier the typed quantity falls in; an unreadable quantity has none.
  LiveTier? get _tier {
    try { return unit.tierFor(inputQty(quantity.text)); } on FormatException { return null; }
  }

  // Rupiah lost on the line (positive), or null when it is not below cost or the cost is unknown.
  num? _loss(({num qty, num? manual, num price, num? discount})? r) {
    final cost = unit.cost;
    if (r == null || cost == null || cost <= 0) return null;
    final profit = (r.price * r.qty - (r.discount ?? 0) - cost * r.qty).round();
    return profit < 0 ? -profit : null;
  }

  void save() {
    try {
      final r = _read();
      final cost = unit.cost;
      // the server refuses a manual price under the unit's cost, so say so here
      if (r.manual != null && cost != null && cost > 0 && r.manual! < cost) {
        setState(() => error = 'Harga satuan di bawah modal (${rupiah(cost)}).');
        return;
      }
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

  void _shiftUnit(int delta) {
    final units = widget.product.units;
    final at = units.indexWhere((u) => u.id == unit.id);
    _pickUnit(units[(at + delta).clamp(0, units.length - 1)]);
  }

  // Whole steps, but a fraction typed below 1 stays: the minus never reaches zero.
  void _step(int delta) {
    num current;
    try { current = inputQty(quantity.text); } on FormatException { current = 1; }
    var next = current + delta;
    if (delta < 0 && next < 1) next = current < 1 ? current : 1;
    quantity.text = quantityText((next * 1000).round() / 1000);
  }

  // Text fields swallow up/down, so the dialog walks its own stops: unit tiles, Jumlah, Harga satuan, Diskon, footer.
  KeyEventResult _onKey(FocusNode _, KeyEvent event) {
    if (event is KeyUpEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final units = widget.product.units;
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isAltPressed) {
      final digit = _digitKeys.indexOf(key);
      if (digit >= 0) {
        if (digit < units.length) _pickUnit(units[digit]);
        return KeyEventResult.handled;
      }
      final jump = {LogicalKeyboardKey.keyJ: 1, LogicalKeyboardKey.keyH: 2, LogicalKeyboardKey.keyD: 3}[key];
      if (jump != null) {
        _land(jump);
        return KeyEventResult.handled;
      }
    }
    if (key == LogicalKeyboardKey.pageUp || key == LogicalKeyboardKey.pageDown) {
      _shiftUnit(key == LogicalKeyboardKey.pageDown ? 1 : -1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.delete && keyboard.isControlPressed && widget.onRemove != null) {
      remove();
      return KeyEventResult.handled;
    }
    // Jumlah never needs a typed sign, so + and - step it instead.
    if (quantityFocus.hasFocus) {
      final plus = key == LogicalKeyboardKey.numpadAdd || key == LogicalKeyboardKey.add || event.character == '+';
      final minus = key == LogicalKeyboardKey.numpadSubtract || key == LogicalKeyboardKey.minus || event.character == '-';
      if (plus || minus) {
        _step(plus ? 1 : -1);
        return KeyEventResult.handled;
      }
    }
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
    final wide = _wide;
    final r = _tryRead();
    final content = Focus(onKeyEvent: _onKey, canRequestFocus: false, child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _header(wide, r),
      Divider(height: 1, color: KasirColors.border),
      Flexible(child: SingleChildScrollView(child: _body(r))),
      if (_hints) _legend(),
      Divider(height: 1, color: KasirColors.border),
      Padding(padding: const EdgeInsets.all(16), child: _footer()),
    ]));
    if (!wide) {
      return SafeArea(top: false, child: Padding(padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom), child: content));
    }
    // A bare shape: the themed dialog shell would draw its own border around the whole dialog area.
    return Dialog(
      backgroundColor: Colors.transparent, elevation: 0, insetPadding: const EdgeInsets.all(24), shape: const RoundedRectangleBorder(),
      child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 660), child: Container(
        decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
        clipBehavior: Clip.antiAlias,
        child: content,
      )),
    );
  }

  Widget _header(bool wide, ({num qty, num? manual, num price, num? discount})? r) {
    final stock = widget.product.stock;
    final code = widget.product.code;
    final sub = [if (code.isNotEmpty) code, if (stock != null) 'stok ${quantityText(stock / unit.conversionFactor)} ${unit.name}'].join(' · ');
    return Padding(
      padding: EdgeInsets.fromLTRB(20, wide ? 16 : 0, 20, 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: KasirColors.ink)),
          if (sub.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(sub, style: TextStyle(fontFamily: monoFamily, fontSize: 12, color: KasirColors.label))),
        ])),
        const SizedBox(width: 12),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('SUBTOTAL', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 1, color: KasirColors.primary)),
          Text(r == null ? '—' : rupiah(r.price * r.qty - (r.discount ?? 0)),
            style: moneyStyle.copyWith(fontSize: 26, fontWeight: FontWeight.w800, color: _loss(r) != null ? KasirColors.destructive : null)),
        ]),
      ]),
    );
  }

  Widget _body(({num qty, num? manual, num price, num? discount})? r) {
    final percent = discount.text.contains('%');
    final disc = r?.discount ?? 0;
    final tier = _tier;
    final loss = _loss(r);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(padding: EdgeInsets.fromLTRB(20, 16, 20, _hints ? 6 : 16), child: _units()),
      if (_hints) Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 12), child: Text('PgUp / PgDn ganti satuan', style: TextStyle(fontSize: 11, color: KasirColors.label))),
      Divider(height: 1, color: KasirColors.border),
      _formRow('Jumlah', active: quantityFocus.hasFocus,
        keys: [_stepKey('+', 'Tambah jumlah', 1), _stepKey('−', 'Kurangi jumlah', -1)],
        lead: unit.name,
        field: _field(const ValueKey('quantity'), quantity, quantityFocus, size: 22, autofocus: true)),
      _formRow('Harga satuan', active: manualFocus.hasFocus,
        lead: manual.text.isEmpty ? (tier == null ? 'otomatis' : 'grosir ${quantityText(tier.minQty)}+') : null,
        field: _field(const ValueKey('manual'), manual, manualFocus, size: 16, hint: rupiah(tier?.price ?? unit.price))),
      _formRow('Diskon', active: discountFocus.hasFocus,
        keys: [if (_hints) const KasirKey('%')],
        lead: r != null && percent ? '= ${rupiah(disc)}' : 'Rp',
        field: _field(const ValueKey('discount'), discount, discountFocus, size: 16, type: TextInputType.text)),
      Padding(padding: const EdgeInsets.fromLTRB(20, 14, 20, 14), child: r == null
        ? Text('—', style: _breakdownStyle)
        : Row(children: [
            Expanded(child: Text('${quantityText(r.qty)} ${unit.name} × ${rupiah(r.price)}', style: _breakdownStyle)),
            Text('− ${rupiah(disc)}${percent ? '  (${discount.text.trim()})' : ''}', style: _breakdownStyle),
          ])),
      if (loss != null) Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 14), child: Text('Di bawah modal — rugi ${rupiah(loss)}', style: TextStyle(fontSize: 13, color: KasirColors.destructive))),
      if (error != null) Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 14), child: Text(error!, style: TextStyle(fontSize: 13, color: KasirColors.destructive))),
    ]);
  }

  TextStyle get _breakdownStyle => TextStyle(fontFamily: monoFamily, fontSize: 13, color: KasirColors.label);

  // The label's first letter is underlined where its Alt shortcut exists.
  Widget _formRow(String label, {required bool active, required Widget field, List<Widget> keys = const [], String? lead}) => Container(
    height: 56,
    decoration: BoxDecoration(color: active ? KasirColors.tint : null, border: Border(bottom: BorderSide(color: KasirColors.border))),
    child: Stack(children: [
      if (active) Positioned(left: 0, top: 0, bottom: 0, width: 4, child: ColoredBox(color: KasirColors.primary)),
      Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: Row(children: [
        Text.rich(TextSpan(style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: active ? KasirColors.primary : KasirColors.ink), children: [
          TextSpan(text: label[0], style: _hints ? const TextStyle(decoration: TextDecoration.underline) : null),
          TextSpan(text: label.substring(1)),
        ])),
        for (final k in keys) Padding(padding: const EdgeInsets.only(left: 8), child: k),
        Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Align(alignment: Alignment.centerRight,
          child: lead == null ? null : Text(lead, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: monoFamily, fontSize: 13, color: KasirColors.label))))),
        field,
      ])),
    ]),
  );

  Widget _field(Key key, TextEditingController controller, FocusNode focus, {required double size, bool autofocus = false, String? hint, TextInputType? type}) => SizedBox(
    width: _wide ? 210 : 130,
    child: TextField(key: key, controller: controller, focusNode: focus, autofocus: autofocus, textAlign: TextAlign.right,
      textInputAction: TextInputAction.done, onSubmitted: (_) => save(),
      keyboardType: type ?? const TextInputType.numberWithOptions(decimal: true),
      style: TextStyle(fontFamily: monoFamily, fontSize: size, fontWeight: FontWeight.w700, color: KasirColors.ink),
      decoration: InputDecoration(isDense: true, hintText: hint, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        hintStyle: TextStyle(fontFamily: monoFamily, fontSize: size, fontWeight: FontWeight.w500, color: KasirColors.label))),
  );

  // Unfocusable: the keyboard steps with + and -, the keycap is for taps.
  Widget _stepKey(String glyph, String label, int delta) {
    final side = _wide ? 28.0 : 40.0;
    return Tooltip(message: label, child: InkWell(
      canRequestFocus: false, onTap: () => _step(delta), borderRadius: BorderRadius.circular(5),
      child: SizedBox(width: side, height: side, child: Center(child: KasirKey(glyph))),
    ));
  }

  Widget _units() {
    final units = widget.product.units;
    final columns = _wide ? 3 : 2;
    return Focus(focusNode: _unitZone, canRequestFocus: false, skipTraversal: true, child: LayoutBuilder(builder: (context, box) {
      final width = (box.maxWidth - 8 * (columns - 1)) / columns;
      return Wrap(spacing: 8, runSpacing: 8, children: [
        for (var i = 0; i < units.length; i++) SizedBox(width: width, height: 52, child: _unitTile(units[i], i)),
      ]);
    }));
  }

  Widget _unitTile(LiveUnit u, int index) {
    final selected = u.id == unit.id;
    final fg = selected ? KasirColors.onPrimary : KasirColors.ink;
    final ringed = identical(_ringUnit, u);
    // On the filled tile a primary ring would vanish into the fill.
    final ring = BorderSide(color: selected ? KasirColors.ink : KasirColors.primary, width: 2);
    final keycap = 'Alt+${index + 1}';
    return Semantics(button: true, selected: selected, child: Material(
      color: selected ? KasirColors.primary : KasirColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control), side: ringed ? ring : BorderSide(color: selected ? KasirColors.primary : KasirColors.gridLine)),
      child: InkWell(
        onTap: () => _pickUnit(u), borderRadius: BorderRadius.circular(Corners.control),
        onFocusChange: (focused) { if (mounted) setState(() => _ringUnit = focused ? u : (identical(_ringUnit, u) ? null : _ringUnit)); },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Row(children: [
            if (_hints && index < _digitKeys.length) ...[
              if (selected) Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: KasirColors.onPrimary.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(5)),
                child: Text(keycap, style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, color: fg)),
              ) else KasirKey(keycap),
              const SizedBox(width: 8),
            ],
            Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(u.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: fg)),
              Text('isi ${u.conversionFactor}', maxLines: 1, softWrap: false, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: selected ? fg : KasirColors.label)),
            ])),
            const SizedBox(width: 8),
            // the price is what the cashier reads, so it keeps its width and the name gives way; a long one shrinks rather than cuts
            ConstrainedBox(constraints: const BoxConstraints(maxWidth: 80), child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight,
              child: Text(rupiah(u.price), maxLines: 1, style: TextStyle(fontFamily: monoFamily, fontSize: 13, fontWeight: FontWeight.w600, color: fg)))),
          ]),
        ),
      ),
    ));
  }

  Widget _legend() {
    Widget item(String keys, String action) => Row(mainAxisSize: MainAxisSize.min, children: [
      KasirKey(keys), const SizedBox(width: 6), Text(action, style: TextStyle(fontSize: 12, color: KasirColors.label)),
    ]);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      decoration: BoxDecoration(color: KasirColors.tint, border: Border(top: BorderSide(color: KasirColors.border))),
      child: Wrap(spacing: 18, runSpacing: 6, children: [
        item('↑↓', 'pindah'),
        item('Alt+J/H/D', 'lompat'),
        if (widget.onRemove != null) item('Ctrl+Del', 'hapus barang'),
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
        Expanded(child: Align(alignment: Alignment.centerLeft, child: widget.onRemove != null
          ? TextButton.icon(
              onPressed: remove, icon: const Icon(Icons.delete_outline, size: 18),
              label: const Text('Hapus barang', maxLines: 1, overflow: TextOverflow.ellipsis),
              style: TextButton.styleFrom(foregroundColor: KasirColors.destructive, minimumSize: const Size(0, 44)))
          : _hints ? Text('Ketik angka, Enter. Selesai.', style: TextStyle(fontSize: 13, color: KasirColors.label)) : null)),
        PopupButton('Batal', keyHint: 'Esc', onPressed: () => Navigator.of(context).maybePop()),
        const SizedBox(width: 10),
        PopupButton('Simpan', primary: true, tone: KasirColors.primary, keyHint: 'Enter', onPressed: save),
      ]),
    ));
  }
}
