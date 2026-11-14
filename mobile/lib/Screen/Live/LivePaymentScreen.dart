import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../state/live_store.dart';
import '../../models/live_models.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../services/mobile_api.dart' show ApiFailure;
import '../../state/kasir_keys.dart';
import 'kasir_style.dart';
/// What a finished payment hands back to the till.
class PaidSale {
  const PaidSale({required this.saleId, required this.total, required this.method, required this.paid});
  final int saleId;
  final num total, paid;
  final String method;

  /// Cash back to the customer; only tunai gives change.
  num get change => method == 'tunai' ? (paid - total).clamp(0, double.infinity) : 0;
}

/// Opens payment and, once the sale is saved, asks "Cetak struk #N?" exactly as the
/// desktop till did: the sale is committed first without a receipt, the question shows
/// the change, and printing runs in the background so a stuck printer never holds the
/// till. A failed print names the sale so it can be reprinted from Riwayat.
///
/// Outside the shop the printer is still the shop's, so there Lewati is the default and
/// the question says where the receipt would come out.
Future<void> openPayment(BuildContext context, LiveStore store) async {
  final sale = await Navigator.of(context).push<PaidSale>(MaterialPageRoute(builder: (_) => LivePaymentScreen(store: store)));
  if (sale == null || !context.mounted) return;
  final away = store.viaInternet;
  final amount = sale.method == 'tunai' ? 'Kembalian ${rupiah(sale.change)}.' : 'Total ${rupiah(sale.total)}.';
  final print = await showDialog<bool>(
    context: context,
    builder: (context) => _ReceiptConfirmDialog(
      saleId: sale.saleId,
      amount: amount,
      away: away,
    ),
  );
  if (print != true || !context.mounted) {
    if (context.mounted) showNotice(context, 'Transaksi #${sale.saleId} disimpan.', kind: NoticeKind.success);
    return;
  }
  final messenger = context;
  store.api.printSale(sale.saleId).then((result) {
    if (result['printed'] != true) throw ApiFailure(result['printError']?.toString() ?? 'printer belum mengonfirmasi');
    if (messenger.mounted) showNotice(messenger, 'Struk #${sale.saleId} dicetak.', kind: NoticeKind.success);
  }).catchError((Object e) {
    if (messenger.mounted) {
      showNotice(messenger, 'Transaksi #${sale.saleId} tersimpan, tetapi struk gagal dicetak: ${errorText(e)}. Cetak ulang dari Riwayat.', kind: NoticeKind.error);
    }
  });
}

class LivePaymentScreen extends StatefulWidget {
  const LivePaymentScreen({super.key, required this.store});
  final LiveStore store;
  @override State<LivePaymentScreen> createState() => _LivePaymentScreenState();
}
class _LivePaymentScreenState extends State<LivePaymentScreen> {
  String method = 'tunai';
  final customer = TextEditingController(), paid = TextEditingController();
  final charge = TextEditingController(), note = TextEditingController();
  final customerFocus = FocusNode(), paidFocus = FocusNode(), chargeFocus = FocusNode(), noteFocus = FocusNode();

  /// The other stops of the "Panah global" arrow path: the method row, the Pelanggan cell (which also holds [customerFocus]),
  /// Tanggal & Jam, the quick-amount chips, Diskon nota and the two footer buttons.
  final methodFocus = FocusNode(), customerCell = FocusNode(), dateFocus = FocusNode(), chipsFocus = FocusNode();
  final discountFocus = FocusNode(), saveFocus = FocusNode(), cancelFocus = FocusNode();
  late final _focusNodes = [customerFocus, paidFocus, chargeFocus, noteFocus, methodFocus, customerCell, dateFocus, chipsFocus, discountFocus, saveFocus, cancelFocus];

  /// Which chip Enter applies while the chips row has the arrow-path focus.
  int chipIndex = 0;
  List<String> names = [];
  String? error, customerError;
  bool sending = false;

  /// "Panah global": the footer action Enter runs, Simpan until PgUp/PgDn moves it to Batal.
  bool saveHighlighted = true;

  /// PageUp/PageDown pick the footer action in "Panah global" (see handleKey); a text field must not also take them as caret moves.
  static const _pageKeys = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.pageUp): DoNothingAndStopPropagationTextIntent(),
    SingleActivator(LogicalKeyboardKey.pageDown): DoNothingAndStopPropagationTextIntent(),
  };

  /// Keys handleKey already took on the wide page. Key events still reach the focus tree afterwards, which would move the focus
  /// a second time or open a second picker; a text field keeps ←→ and Enter.
  Map<ShortcutActivator, Intent> get _takenKeys {
    final typing = paidFocus.hasFocus || chargeFocus.hasFocus || noteFocus.hasFocus || customerFocus.hasFocus;
    const taken = DoNothingAndStopPropagationIntent();
    return {
      for (final key in [LogicalKeyboardKey.arrowUp, LogicalKeyboardKey.arrowDown]) SingleActivator(key): taken,
      if (!typing) for (final key in [LogicalKeyboardKey.arrowLeft, LogicalKeyboardKey.arrowRight, LogicalKeyboardKey.enter, LogicalKeyboardKey.numpadEnter]) SingleActivator(key): taken,
    };
  }

  static const methods = {'tunai': 'Tunai', 'qris': 'QRIS', 'transfer': 'Transfer', 'bon': 'Bon'};
  static const methodKeys = {'tunai': 'T', 'qris': 'Q', 'transfer': 'R', 'bon': 'B'};
  @override void initState() {
    super.initState();
    final store = widget.store;
    // an edited nota opens with what it was saved with
    if (store.editingSaleId != null) {
      method = store.editMethod; customer.text = store.editCustomer;
      if (store.editPaid > 0) paid.text = _plain(store.editPaid);
    }
    if (store.editingSaleId == null && store.customerName.isNotEmpty) customer.text = store.customerName;
    if (store.otherCharge > 0) charge.text = _plain(store.otherCharge);
    note.text = store.note;
    HardwareKeyboard.instance.addHandler(handleKey); loadCustomers();
  }

  static String _plain(num v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  num get _charge { try { return charge.text.trim().isEmpty ? 0 : inputRupiah(charge.text); } catch (_) { return 0; } }
  num? get _total => widget.store.price == null ? null : widget.store.price!.total + _charge;
  num? get _paid { try { return paid.text.trim().isEmpty ? null : inputRupiah(paid.text); } catch (_) { return null; } }

  Future<void> pickDate() async {
    final now = DateTime.now();
    final current = widget.store.saleDate ?? now;
    final day = await showDatePicker(context: context, initialDate: current, firstDate: DateTime(2000), lastDate: DateTime(now.year + 1, 12, 31));
    if (day == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(current));
    if (!mounted) return;
    widget.store.setDetails(date: DateTime(day.year, day.month, day.day, time?.hour ?? current.hour, time?.minute ?? current.minute));
  }

  bool get _narrow => MediaQuery.sizeOf(context).width < 860;
  bool get _cash => method == 'tunai' || method == 'bon';

  /// The footer action Enter runs: the focused button, else the one PgUp/PgDn highlighted.
  bool get _saveActive => !cancelFocus.hasFocus && (saveFocus.hasFocus || saveHighlighted);

  void _focusField(FocusNode node, TextEditingController field) {
    node.requestFocus();
    field.selection = TextSelection(baseOffset: 0, extentOffset: field.text.length);
  }

  /// Leaving a cash method removes the cash field, so a focus sitting in it moves to the method row instead of falling off the page.
  void _pick(String value) {
    if (!_narrow && value != 'tunai' && value != 'bon' && paidFocus.hasFocus) methodFocus.requestFocus();
    setState(() => method = value);
  }

  /// The desktop's payment keys: Alt+T/B/Q/R pick the method, Alt+U sets exact cash (uang pas), Alt+P goes to Pelanggan,
  /// Alt+S or Enter saves, Esc goes back to the till.
  bool handleKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted || sending || ModalRoute.of(context)?.isCurrent == false) return false;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) { Navigator.of(context).maybePop(); return true; }
    final alt = HardwareKeyboard.instance.isAltPressed;
    if (alt) {
      final picked = {
        LogicalKeyboardKey.keyT: 'tunai',
        LogicalKeyboardKey.keyB: 'bon',
        LogicalKeyboardKey.keyQ: 'qris',
        LogicalKeyboardKey.keyR: 'transfer',
      }[key];
      if (picked != null) {
        _pick(picked);
        return true;
      }
      if (key == LogicalKeyboardKey.keyU && _total != null) {
        setState(() => paid.text = _plain(_total!));
        _focusField(paidFocus, paid);
        return true;
      }
      if (key == LogicalKeyboardKey.keyP) {
        _focusField(customerFocus, customer);
        return true;
      }
      if (key == LogicalKeyboardKey.keyS) {
        if (widget.store.canCheckout) submit();
        return true;
      }
    }
    // End anywhere on payment screen (even when typing in paid/customer):
    if (key == LogicalKeyboardKey.end) {
      if (widget.store.canCheckout) submit();
      return true;
    }
    final enter = key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter;
    if (kasirKeys.isGlobalArrows) {
      if (!_narrow && _arrow(key)) return true;
      if (key == LogicalKeyboardKey.pageUp || key == LogicalKeyboardKey.pageDown) {
        final next = !_saveActive;
        setState(() => saveHighlighted = next);
        if (saveFocus.hasFocus || cancelFocus.hasFocus) (next ? saveFocus : cancelFocus).requestFocus();
        return true;
      }
      // Keterangan keeps its own Enter
      if (enter && !noteFocus.hasFocus) {
        _enter();
        return true;
      }
    }
    // Enter / numpadEnter anywhere when not inside an active text input:
    final typing = FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null;
    if (!typing && enter) {
      if (widget.store.canCheckout) submit();
      return true;
    }
    return false;
  }

  /// The arrow path, top to bottom; the cash field and chips drop out for QRIS and Transfer, a disabled stop is skipped.
  List<FocusNode> _stops() => [
    methodFocus, customerCell, dateFocus, if (_cash) ...[paidFocus, chipsFocus], discountFocus, chargeFocus, noteFocus,
    _saveActive ? saveFocus : cancelFocus,
  ].where((stop) => stop.canRequestFocus).toList();

  void _focusStop(FocusNode stop) {
    final field = {paidFocus: paid, chargeFocus: charge, noteFocus: note}[stop];
    if (field != null) { _focusField(stop, field); } else { stop.requestFocus(); }
    if (stop == saveFocus || stop == cancelFocus) saveHighlighted = stop == saveFocus;
    // a short window scrolls its panes; keep the stop on screen
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final stopContext = stop.context;
      if (stopContext != null && stopContext.mounted) Scrollable.ensureVisible(stopContext, alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd);
    });
  }

  /// "Panah global" on the wide page: ↑↓ walk the stops, ←→ move along a row of them. A text field keeps ←→ as caret moves,
  /// except at the edge between Biaya lain and Keterangan.
  bool _arrow(LogicalKeyboardKey key) {
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isControlPressed || keyboard.isShiftPressed || keyboard.isAltPressed) return false;
    final stops = _stops();
    final at = stops.indexWhere((stop) => stop.hasFocus);
    if (key == LogicalKeyboardKey.arrowDown || key == LogicalKeyboardKey.arrowUp) {
      final to = at < 0 ? 0 : at + (key == LogicalKeyboardKey.arrowDown ? 1 : -1);
      if (to >= 0 && to < stops.length) _focusStop(stops[to]);
      return true;
    }
    if (key != LogicalKeyboardKey.arrowLeft && key != LogicalKeyboardKey.arrowRight) return false;
    if (at < 0) return false;
    final step = key == LogicalKeyboardKey.arrowRight ? 1 : -1;
    final stop = stops[at];
    if (stop == methodFocus) {
      final order = methods.keys.toList();
      _pick(order[(order.indexOf(method) + step).clamp(0, order.length - 1).toInt()]);
    } else if (stop == customerCell) {
      if (customerFocus.hasFocus) return false;
      if (step > 0) _focusStop(dateFocus);
    } else if (stop == dateFocus) {
      if (step < 0) _focusStop(customerCell);
    } else if (stop == chipsFocus) {
      final last = _chipAmounts(3).length - 1;
      setState(() => chipIndex = (chipIndex + step).clamp(0, last < 0 ? 0 : last).toInt());
    } else if (stop == chargeFocus) {
      final caret = charge.selection;
      if (step < 0 || !caret.isCollapsed || caret.baseOffset != charge.text.length) return false;
      _focusStop(noteFocus);
    } else if (stop == noteFocus) {
      final caret = note.selection;
      if (step > 0 || !caret.isCollapsed || caret.baseOffset > 0) return false;
      _focusStop(chargeFocus);
    } else if (stop == saveFocus || stop == cancelFocus) {
      _focusStop(step > 0 ? cancelFocus : saveFocus);
    }
    return true;
  }

  /// Enter in "Panah global": a stop does its own thing; a text field and anywhere else run the footer action.
  void _enter() {
    if (!_narrow && !customerFocus.hasFocus) {
      if (customerCell.hasFocus) { _focusField(customerFocus, customer); return; }
      if (dateFocus.hasFocus) { pickDate(); return; }
      if (chipsFocus.hasFocus) {
        final amounts = _chipAmounts(3);
        if (chipIndex < amounts.length) _useChip(amounts[chipIndex]);
        return;
      }
      if (discountFocus.hasFocus) { _editDiscount(); return; }
      if (methodFocus.hasFocus) return;
    }
    if (!_saveActive) { Navigator.of(context).maybePop(); } else if (widget.store.canCheckout) { submit(); }
  }

  Future<void> _editDiscount() async {
    final store = widget.store;
    final val = await showDialog<num>(
      context: context,
      builder: (_) => _PaymentDiscountDialog(initial: store.discount, subtotal: store.price?.subtotal ?? 0),
    );
    if (val != null) store.setDiscount(val);
  }

  /// What the chips put in the cash field: uang pas, then up to [quick] banknote amounts above the total (tunai only).
  List<num> _chipAmounts(int quick) {
    final total = _total;
    if (total == null) return const [];
    return [total, if (method == 'tunai' && total > 0) ..._quickCashOptions(total).take(quick)];
  }

  void _useChip(num amount) => setState(() => paid.text = _plain(amount));

  Future<void> loadCustomers() async {
    try { final result = await widget.store.api.customers(); if (mounted) setState(() { names = result; customerError = null; }); }
    catch (e) { if (mounted) { setState(() => customerError = e.toString()); showError(context, e); } }
  }
  @override void dispose() {
    HardwareKeyboard.instance.removeHandler(handleKey);
    customer.dispose(); paid.dispose(); charge.dispose(); note.dispose();
    for (final node in _focusNodes) { node.dispose(); }
    super.dispose();
  }
  Future<void> submit() async {
    if (sending) return;
    setState(() { sending = true; error = null; });
    try {
      widget.store.setDetails(charge: _charge, text: note.text);
      final total = _total;
      if (total == null) throw const FormatException('Harga keranjang belum tersedia.');
      final amount = method == 'qris' || method == 'transfer' || (method == 'tunai' && paid.text.trim().isEmpty)
          ? total
          : inputRupiah(paid.text.isEmpty && method == 'bon' ? '0' : paid.text);
      final trimmedCustomer = customer.text.trim();
      if (method == 'bon' && (trimmedCustomer.isEmpty || trimmedCustomer.toLowerCase() == 'umum')) {
        throw const FormatException('Transaksi bon harus atas nama pelanggan, bukan UMUM. Pilih pelanggan dulu.');
      }
      // saved first, without a receipt; openPayment asks about printing, as the desktop did
      final result = await widget.store.checkout(method, amount, customer.text, print: false);
      if (!mounted) return;
      Navigator.of(context).pop(PaidSale(saleId: idNumber(result['saleId']), total: number(result['total']) ?? total, method: method, paid: amount));
    } catch (e) { if (mounted) { setState(() { sending = false; error = errorText(e); }); showError(context, e); } }
  }
  String _dateLabel(DateTime? d) {
    if (d == null) return 'Sekarang';
    final two = (int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year} ${two(d.hour)}.${two(d.minute)}';
  }

  List<int> _quickCashOptions(num total) {
    final t = total.ceil();
    if (t <= 0) return const [];
    final set = <int>{};

    if (t % 5000 != 0) set.add(t + (5000 - (t % 5000)));
    if (t % 10000 != 0) set.add(t + (10000 - (t % 10000)));
    if (t % 50000 != 0) set.add(t + (50000 - (t % 50000)));

    const banknotes = [10000, 20000, 50000, 100000];
    for (final b in banknotes) {
      if (b > t) set.add(b);
    }
    if (t > 100000) {
      final next50k = (t / 50000).ceil() * 50000;
      if (next50k > t) set.add(next50k);
      final next100k = (t / 100000).ceil() * 100000;
      if (next100k > t) set.add(next100k);
    }
    final sorted = set.where((x) => x > t).toList()..sort();
    return sorted.take(4).toList();
  }

  static const _methodIcons = {'tunai': Icons.payments_outlined, 'qris': Icons.qr_code_2, 'transfer': Icons.account_balance_outlined, 'bon': Icons.receipt_long_outlined};

  /// The 2px focus ring of the arrow path, drawn outside the control; a [filled] control gets the ink colour so the ring shows against its fill.
  Widget _ring(bool on, Widget child, {double radius = Corners.control, bool filled = false}) => Container(
    padding: const EdgeInsets.all(2),
    decoration: BoxDecoration(border: Border.all(color: on ? (filled ? KasirColors.ink : KasirColors.primary) : Colors.transparent, width: 2), borderRadius: BorderRadius.circular(radius + 2)),
    child: child);

  /// A method button; [tile] is the wide page's 64px tile with the icon top-left and the key hint top-right.
  Widget _methodButton(String value, {bool tile = false, bool focused = false}) {
    final on = method == value;
    final fg = on ? KasirColors.onPrimary : KasirColors.ink;
    final button = Semantics(button: true, selected: on, child: Material(color: Colors.transparent, child: Ink(
      height: tile ? 64 : 40,
      decoration: BoxDecoration(
        color: on ? KasirColors.primary : KasirColors.surface,
        border: on ? null : Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.control)),
      child: InkWell(
        borderRadius: BorderRadius.circular(Corners.control),
        onTap: sending ? null : () => _pick(value),
        child: tile
          ? Padding(padding: const EdgeInsets.fromLTRB(12, 10, 10, 8), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(_methodIcons[value], size: 20, color: on ? KasirColors.onPrimary : KasirColors.primary), const Spacer(),
                if (isDesktop) Text('Alt+${methodKeys[value]}', style: TextStyle(fontFamily: monoFamily, fontSize: 10, color: on ? KasirColors.onPrimary : KasirColors.label)),
              ]),
              const Spacer(),
              Text(methods[value]!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: fg)),
            ]))
          // scaled down, not clipped, when four buttons share a narrow desktop window
          : FittedBox(fit: BoxFit.scaleDown, child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(_methodIcons[value], size: 18, color: fg), const SizedBox(width: 8),
              Text(methods[value]!, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: fg)),
              if (isDesktop) ...[const SizedBox(width: 8), Text('Alt+${methodKeys[value]}', style: TextStyle(fontFamily: monoFamily, fontSize: 11, color: on ? KasirColors.onPrimary : KasirColors.label))],
            ])),
      ),
    )));
    return Expanded(child: tile ? _ring(focused, button, filled: on) : button);
  }

  /// A bordered 46px row: icon tile, label, then [value] on the right.
  Widget _infoRow(IconData icon, String label, Widget value, {VoidCallback? onTap}) => Material(
    color: KasirColors.surface,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.panel), side: BorderSide(color: KasirColors.border)),
    clipBehavior: Clip.antiAlias,
    child: InkWell(onTap: onTap, child: SizedBox(height: 46, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: Row(children: [
      Container(
        width: 28, height: 28,
        decoration: BoxDecoration(color: KasirColors.tint, borderRadius: BorderRadius.circular(8)),
        child: Icon(icon, size: 16, color: KasirColors.primary),
      ),
      const SizedBox(width: 10),
      Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: KasirColors.label)),
      const SizedBox(width: 10),
      Expanded(child: Align(alignment: Alignment.centerRight, child: value)),
    ])))),
  );

  /// A field with no border of its own, for a container that draws it.
  InputDecoration _bare(String hint, {TextStyle? hintStyle, EdgeInsetsGeometry? padding}) => InputDecoration(
    hintText: hint, hintStyle: hintStyle ?? TextStyle(color: KasirColors.muted), isDense: true, filled: false, contentPadding: padding,
    border: InputBorder.none, enabledBorder: InputBorder.none, disabledBorder: InputBorder.none, focusedBorder: InputBorder.none);

  /// A borderless field for the value half of an [_infoRow] or [_cell].
  Widget _rowField(TextEditingController controller, String hint, {bool end = true}) => TextField(
    controller: controller, focusNode: customerFocus, enabled: !sending, textAlign: end ? TextAlign.end : TextAlign.start, textInputAction: TextInputAction.next,
    onChanged: (_) => setState(() {}),
    style: TextStyle(fontSize: end ? 14 : 15, fontWeight: FontWeight.w600, color: KasirColors.ink),
    decoration: _bare(hint, padding: end ? null : EdgeInsets.zero),
  );

  /// One half of the wide page's Pelanggan | Tanggal & Jam row: a tint icon tile, a small label, the value, then [trailing].
  Widget _cell(IconData icon, String label, Widget value, {Widget? trailing, VoidCallback? onTap, FocusNode? focusNode, bool canFocus = true, bool focused = false}) => Expanded(child: InkWell(
    onTap: onTap, focusNode: focusNode, canRequestFocus: canFocus,
    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6), child: _ring(focused, SizedBox(height: 44, child: Row(children: [
      Container(
        width: 36, height: 36,
        decoration: BoxDecoration(color: KasirColors.tint, borderRadius: BorderRadius.circular(Corners.control)),
        child: Icon(icon, size: 18, color: KasirColors.primary),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: KasirColors.label)),
        value,
      ])),
      if (trailing != null) ...[const SizedBox(width: 8), trailing],
    ])))),
  ));

  Widget _sectionLabel(String text, {Color? color}) => Text(text, maxLines: 1, overflow: TextOverflow.ellipsis,
    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: color ?? KasirColors.label));

  InputDecoration _inputDecoration(String hint, {String? helper}) {
    OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: BorderSide(color: color, width: width));
    return InputDecoration(
      hintText: hint, helperText: helper, helperMaxLines: 2, hintStyle: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: KasirColors.muted), isDense: true, filled: true, fillColor: KasirColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: border(KasirColors.border), enabledBorder: border(KasirColors.border), focusedBorder: border(KasirColors.primary, 2),
    );
  }

  Widget _label(String text) => Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: KasirColors.label)));

  /// A quick-amount chip. On the wide page it is 44px, shows an optional key [hint], is tinted when [on] (its amount is what is typed)
  /// and rings when [focused].
  Widget _chip(String text, VoidCallback? onTap, {bool wide = false, bool on = false, bool focused = false, String? hint}) {
    final ink = onTap == null ? KasirColors.muted : on ? KasirColors.primary : KasirColors.ink;
    final chip = Material(
      color: on ? KasirColors.tint2 : KasirColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control), side: BorderSide(color: on ? KasirColors.tint2 : KasirColors.border)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: SizedBox(height: wide ? 44 : 36, child: Center(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4),
        child: FittedBox(fit: BoxFit.scaleDown, child: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(text, style: TextStyle(fontSize: wide ? 14 : 13, fontWeight: FontWeight.w600, color: ink)),
          if (hint != null) ...[const SizedBox(width: 8), Text(hint, style: TextStyle(fontFamily: monoFamily, fontSize: 10, color: KasirColors.label))],
        ]))))),
    ));
    return Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: wide ? _ring(focused, chip) : chip));
  }

  /// The chips row under the cash field; the wide page gets three banknote amounts, the phone four.
  Widget _chipRow({required bool wide}) {
    final amounts = _chipAmounts(wide ? 3 : 4);
    final paidNow = _paid;
    final ringed = wide && kasirKeys.isGlobalArrows && chipsFocus.hasFocus;
    Widget chip(int i, String text, num? amount, {String? hint}) => _chip(text, sending || amount == null ? null : () => _useChip(amount),
      wide: wide, on: wide && amount != null && paidNow == amount, focused: ringed && chipIndex == i, hint: hint);
    return Row(children: [
      chip(0, 'Uang pas', amounts.isEmpty ? null : amounts.first, hint: wide && isDesktop ? 'Alt+U' : null),
      for (var i = 1; i < amounts.length; i++) chip(i, rupiah(amounts[i]), amounts[i]),
    ]);
  }

  Widget _banner(String label, String amount, {required bool good, bool large = false}) => Container(
    height: large ? 64 : 52, padding: const EdgeInsets.symmetric(horizontal: 16),
    decoration: BoxDecoration(color: good ? KasirColors.changeBg : KasirColors.dueBg, borderRadius: BorderRadius.circular(Corners.panel)),
    child: Row(children: [
      Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: good ? KasirColors.changeInk : KasirColors.dueInk)),
      const Spacer(),
      Text(amount, style: moneyStyle.copyWith(fontSize: large ? 26 : 20, color: good ? KasirColors.changeInk : KasirColors.dueInk)),
    ]),
  );

  /// A dashed rule, the tear line of a receipt.
  Widget _dashed() => LayoutBuilder(builder: (context, box) => Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: List.generate((box.maxWidth / 8).floor(), (_) => Container(width: 4, height: 1, color: KasirColors.gridLine)),
  ));

  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard, ..._focusNodes]), builder: (context, _) {
    final store = widget.store;
    final total = _total;
    final paidNow = _paid;
    final change = method == 'tunai' && total != null && paidNow != null ? paidNow - total : null;
    final editing = store.editingSaleId;
    final narrow = _narrow;
    final global = kasirKeys.isGlobalArrows;
    final lineDisc = store.price?.lineDiscountTotal ?? 0;
    final modal = store.price?.estimatedModal;
    final laba = modal != null && total != null ? total - modal : null;
    final remainder = method == 'bon' && total != null ? (total - (paidNow ?? 0)).clamp(0, double.infinity) : null;

    // the wide page reads red on the tint pane, where the destructive red is under 4.5:1
    final red = narrow ? KasirColors.destructive : pillNegativeInk;
    Widget discountRow() => Row(children: [
      Expanded(child: Text('Diskon nota', style: TextStyle(color: muted))),
      TextButton(
        focusNode: narrow ? null : discountFocus,
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4), minimumSize: const Size(0, 26)),
        onPressed: sending || !store.editable ? null : _editDiscount,
        child: Text(store.discount == 0 ? (narrow ? 'Tambah' : '+ Tambah') : '${narrow ? '-' : '−'}${rupiah(store.discount)}',
          style: amountStyle.copyWith(fontSize: 14, color: store.discount > 0 ? red : KasirColors.primary)),
      ),
    ]);
    final lossWarning = laba == null || laba >= 0 ? null : Padding(
      padding: const EdgeInsets.only(top: Space.sm),
      child: Container(
        padding: const EdgeInsets.all(Space.sm),
        decoration: BoxDecoration(color: pillWarningBg, border: Border.all(color: noticeBorder), borderRadius: BorderRadius.circular(Corners.control)),
        child: Text('Harga setelah diskon di bawah modal — transaksi ini rugi ${rupiah(laba.abs())}. Tetap bisa disimpan kalau memang disengaja.',
          style: TextStyle(color: pillWarningInk, fontSize: 12)),
      ),
    );
    List<Widget> banners({required bool large}) => [
      if (change != null) ...[SizedBox(height: large ? 16 : Space.md), _banner(change < 0 ? 'Kurang' : 'Kembalian', rupiah(change.abs()), good: change >= 0, large: large)],
      if (remainder != null) ...[SizedBox(height: large ? 16 : Space.md), _banner('Sisa bon', rupiah(remainder), good: false, large: large)],
    ];

    final summary = Container(
      padding: const EdgeInsets.all(Space.md),
      decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SummaryRow('Subtotal · ${store.items.length} barang', rupiah(store.price == null ? null : store.price!.subtotal + lineDisc)),
        if (lineDisc > 0) SummaryRow('Diskon item', '-${rupiah(lineDisc)}', color: KasirColors.destructive),
        discountRow(),
        if (_charge > 0) SummaryRow('Biaya lain', rupiah(_charge)),
        if (modal != null) SummaryRow('Modal barang', rupiah(modal)),
        if (laba != null) SummaryRow('Perkiraan laba', rupiah(laba), color: profitColor(laba)),
        if (lossWarning != null) lossWarning,
      ]),
    );

    // inverted on purpose: the one figure the cashier reads aloud
    final totalBanner = Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(color: KasirColors.ink, borderRadius: BorderRadius.circular(Corners.panel)),
      child: Row(children: [
        Text('Total Tagihan', style: TextStyle(fontSize: 14, color: KasirColors.surface.withValues(alpha: 0.7))),
        const SizedBox(width: Space.md),
        Expanded(child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: Text(rupiah(total), style: moneyStyle.copyWith(fontSize: 30, color: KasirColors.surface)))),
      ]),
    );

    final suggestions = customer.text.isEmpty ? const <String>[] : names.where((n) => n.toLowerCase().contains(customer.text.toLowerCase()) && n != customer.text).take(5).toList();
    final customerHelp = <Widget>[
      if (suggestions.isNotEmpty) Padding(padding: const EdgeInsets.only(top: Space.sm), child: Wrap(spacing: Space.sm, runSpacing: Space.xs,
        children: suggestions.map((n) => ActionChip(label: Text(n), onPressed: sending ? null : () => setState(() => customer.text = n))).toList())),
      if (customerError != null) Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: sending ? null : loadCustomers, child: const Text('Muat ulang daftar pelanggan'))),
    ];
    final customerLabel = method == 'bon' ? 'Pelanggan (wajib)' : 'Pelanggan';
    final dateValue = Row(mainAxisSize: MainAxisSize.min, children: [
      Flexible(child: Text(_dateLabel(store.saleDate), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: KasirColors.ink))),
      if (store.saleDate != null && editing == null) IconButton(tooltip: 'Kembali ke sekarang', visualDensity: VisualDensity.compact, onPressed: () => store.setDetails(clearDate: true), icon: const Icon(Icons.close, size: 16)),
    ]);
    final paidField = TextField(controller: paid, focusNode: paidFocus, textInputAction: TextInputAction.done, enabled: !sending, autofocus: isDesktop, onChanged: (_) => setState(() {}),
      onSubmitted: (_) { if (store.canCheckout) submit(); }, keyboardType: const TextInputType.numberWithOptions(decimal: true), textAlign: TextAlign.end, textAlignVertical: TextAlignVertical.center,
      style: narrow ? amountStyle.copyWith(fontSize: 20, fontWeight: FontWeight.w600, color: KasirColors.ink) : moneyStyle.copyWith(fontSize: 32, color: KasirColors.ink),
      decoration: narrow
          ? _inputDecoration(method == 'bon' ? 'Kosong = belum bayar sama sekali' : 'Kosong = uang pas')
          : _bare(method == 'bon' ? 'Kosong = belum bayar sama sekali' : 'Kosong = uang pas', hintStyle: TextStyle(fontSize: 16, color: KasirColors.muted), padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16)));
    final qrisNote = Text('Pastikan pembayaran ${methods[method]} sudah masuk ke rekening toko sebelum menyimpan. Aplikasi tidak membuat QR atau memproses transfer.', style: TextStyle(color: muted, fontSize: 13));
    final errorLine = error == null ? null : Padding(padding: const EdgeInsets.only(top: Space.sm), child: Text(error!, style: TextStyle(color: narrow ? errorColor : pillNegativeInk)));

    if (narrow) {
      final methodButtons = Column(children: [
        Row(children: [_methodButton('tunai'), const SizedBox(width: Space.sm), _methodButton('qris')]),
        const SizedBox(height: Space.sm),
        Row(children: [_methodButton('transfer'), const SizedBox(width: Space.sm), _methodButton('bon')]),
      ]);
      final customerRows = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _infoRow(Icons.person_outline, customerLabel, _rowField(customer, 'Umum')),
        ...customerHelp,
        const SizedBox(height: Space.sm),
        _infoRow(Icons.calendar_today_outlined, 'Tanggal & Jam', dateValue, onTap: sending ? null : pickDate),
      ]);
      final cashBlock = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_cash) ...[
          _label(method == 'bon' ? 'Uang muka' : 'Uang diterima'),
          SizedBox(height: 48, child: paidField),
          const SizedBox(height: Space.sm),
          _chipRow(wide: false),
        ] else
          qrisNote,
      ]);
      final chargeField = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _label('Biaya lain (Rp)'),
        TextField(controller: charge, focusNode: chargeFocus, enabled: !sending, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), style: amountStyle.copyWith(fontSize: 14, color: KasirColors.ink),
          decoration: _inputDecoration('0', helper: 'Ongkos antar, kantong, dan sejenisnya. Ditambahkan ke tagihan dan dicetak di struk.')),
      ]);
      final noteField = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        _label(editing == null ? 'Keterangan' : 'Keterangan / alasan perubahan'),
        TextField(controller: note, focusNode: noteFocus, enabled: !sending, maxLength: 500, style: TextStyle(fontSize: 14, color: KasirColors.ink),
          decoration: _inputDecoration(editing == null ? 'Opsional' : 'Contoh: salah input jumlah')),
      ]);
      final content = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        methodButtons, const SizedBox(height: Space.md),
        summary, const SizedBox(height: Space.sm),
        totalBanner, const SizedBox(height: Space.md),
        customerRows, const SizedBox(height: Space.md),
        cashBlock, ...banners(large: false),
        const SizedBox(height: Space.lg),
        const Text('Detail nota', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), const SizedBox(height: Space.sm),
        chargeField, const SizedBox(height: Space.md),
        noteField,
        if (errorLine != null) errorLine,
      ]);

      // the 2px ring marks which footer action Enter runs; only "Panah global" has one
      Widget ring(bool on, Widget button) => !global ? button : _ring(on, button, radius: 10);
      final footer = Row(children: [
        Expanded(child: ring(saveHighlighted, KasirActionButton(
          height: 44, onPressed: sending || !store.canCheckout ? null : submit,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            sending ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: KasirColors.onPrimary)) : const Icon(Icons.check, size: 18),
            const SizedBox(width: 8),
            Flexible(child: Text(sending ? 'Menyimpan…' : '${editing == null ? 'Simpan transaksi' : 'Simpan perubahan'}${isDesktop ? '  ·  End' : ''}',
              maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600))),
          ]),
        ))),
        const SizedBox(width: Space.sm),
        Expanded(child: ring(!saveHighlighted, SizedBox(height: 44, child: OutlinedButton(
          onPressed: sending ? null : () => Navigator.of(context).maybePop(),
          style: OutlinedButton.styleFrom(foregroundColor: KasirColors.ink, side: BorderSide(color: KasirColors.border), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          child: Text('Batal${isDesktop ? '  ·  Esc' : ''}', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        )))),
      ]);

      return Shortcuts(shortcuts: global ? _pageKeys : const {}, child: PopScope(canPop: !sending, child: Scaffold(
        backgroundColor: KasirColors.surface,
        appBar: AppBar(title: Text(editing == null ? 'Pembayaran' : 'Ubah nota #$editing')),
        bottomNavigationBar: SafeArea(child: Container(
          padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.sm),
          decoration: BoxDecoration(color: KasirColors.surface, border: Border(top: BorderSide(color: KasirColors.border))),
          child: footer)),
        body: SafeArea(child: ListView(padding: const EdgeInsets.all(Space.lg), children: [content])),
      )));
    }

    // wide: one card with two full-height panes, the inputs on the surface and the bill on the tint, so 1366x768 needs no scrolling
    bool at(FocusNode node) => global && node.hasFocus;
    final hairline = Container(height: 1, color: KasirColors.border);
    final vline = Container(width: 1, color: KasirColors.border);
    Widget pad(Widget child, {double top = 16, double bottom = 16}) => Padding(padding: EdgeInsets.fromLTRB(24, top, 24, bottom), child: child);

    final methodRow = Focus(focusNode: methodFocus, canRequestFocus: global, skipTraversal: true, child: Row(children: [
      for (final value in methods.keys) ...[
        if (value != methods.keys.first) const SizedBox(width: 12),
        _methodButton(value, tile: true, focused: at(methodFocus) && method == value),
      ],
    ]));
    final identityRow = SizedBox(height: 64, child: Row(children: [
      _cell(Icons.person_outline, customerLabel, _rowField(customer, 'Umum', end: false),
        trailing: isDesktop ? const KasirKey('Alt+P') : null, onTap: sending ? null : () => customerFocus.requestFocus(), focusNode: customerCell, canFocus: global, focused: at(customerCell)),
      vline,
      _cell(Icons.calendar_today_outlined, 'Tanggal & Jam', dateValue,
        trailing: Icon(Icons.expand_more, size: 20, color: KasirColors.muted), onTap: sending ? null : pickDate, focusNode: dateFocus, focused: at(dateFocus)),
    ]));
    final cashSection = pad(Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_cash) ...[
        _sectionLabel(method == 'bon' ? 'UANG MUKA' : 'UANG DITERIMA'), const SizedBox(height: 8),
        // the 2px primary border is always on, so the focus ring sits outside it
        _ring(at(paidFocus), Container(
          height: 72,
          decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.primary, width: 2), borderRadius: BorderRadius.circular(Corners.control)),
          child: Row(children: [
            Padding(padding: const EdgeInsets.only(left: 20), child: Text('Rp', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w500, color: KasirColors.muted))),
            Expanded(child: paidField),
          ]),
        )),
        const SizedBox(height: 8),
        Focus(focusNode: chipsFocus, canRequestFocus: global, skipTraversal: true, child: _chipRow(wide: true)),
      ] else
        qrisNote,
    ]));
    Widget detail(String label, Widget field, String hint, {bool right = false}) => Expanded(child: DecoratedBox(
      decoration: BoxDecoration(border: right ? Border(left: BorderSide(color: KasirColors.border)) : null),
      child: Padding(padding: EdgeInsets.fromLTRB(right ? 18 : 24, 16, right ? 24 : 18, 16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _sectionLabel(label), const SizedBox(height: 8), field, const SizedBox(height: 6),
        Text(hint, style: TextStyle(fontSize: 12, color: KasirColors.label)),
      ])),
    ));
    final detailsRow = IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      detail('BIAYA LAIN',
        TextField(controller: charge, focusNode: chargeFocus, enabled: !sending, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: amountStyle.copyWith(fontSize: 14, color: KasirColors.ink), decoration: _inputDecoration('0')),
        'Ongkos antar, kantong. Masuk ke tagihan dan struk.'),
      detail(editing == null ? 'KETERANGAN' : 'KETERANGAN / ALASAN PERUBAHAN',
        TextField(controller: note, focusNode: noteFocus, enabled: !sending, maxLength: 500, style: TextStyle(fontSize: 14, color: KasirColors.ink),
          decoration: _inputDecoration(editing == null ? 'Opsional' : 'Contoh: salah input jumlah').copyWith(counterText: '')),
        'Dicetak di struk.', right: true),
    ]));
    final keyStrip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: KasirColors.border))),
      child: Wrap(spacing: 20, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (final (keys, action) in [if (global) ('↑↓', 'pindah bagian'), if (global) ('←→', 'pilih'), ('Enter', 'pakai'), ('End', 'simpan'), ('Esc', 'kembali')])
          Row(mainAxisSize: MainAxisSize.min, children: [KasirKey(keys), const SizedBox(width: 6), Text(action, style: TextStyle(fontSize: 12, color: KasirColors.label))]),
      ]),
    );
    final left = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        pad(Column(crossAxisAlignment: CrossAxisAlignment.start, children: [_sectionLabel('METODE'), const SizedBox(height: 10), methodRow]), top: 18, bottom: 18),
        hairline,
        identityRow,
        if (customerHelp.isNotEmpty) pad(Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: customerHelp), top: 0, bottom: 8),
        hairline,
        cashSection,
        hairline,
        detailsRow,
      ]))),
      if (isDesktop) keyStrip,
    ]);

    final saveButton = Focus(focusNode: saveFocus, canRequestFocus: global, skipTraversal: true, child: _ring(global && _saveActive, KasirActionButton(
      height: 56, onPressed: sending || !store.canCheckout ? null : submit,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        sending ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: KasirColors.onPrimary)) : const Icon(Icons.check, size: 20),
        const SizedBox(width: 10),
        Flexible(child: Text(sending ? 'Menyimpan…' : editing == null ? 'Simpan transaksi' : 'Simpan perubahan', maxLines: 1, overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
        if (isDesktop && !sending) ...[const SizedBox(width: 12), const KasirKey('End')],
      ]),
    ), radius: 10, filled: true));
    final cancelButton = Focus(focusNode: cancelFocus, canRequestFocus: global, skipTraversal: true, child: _ring(global && !_saveActive, SizedBox(height: 48, child: OutlinedButton(
      onPressed: sending ? null : () => Navigator.of(context).maybePop(),
      style: OutlinedButton.styleFrom(foregroundColor: KasirColors.ink, side: BorderSide(color: KasirColors.border), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Text('Batal', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        if (isDesktop) ...[const SizedBox(width: 10), const KasirKey('Esc')],
      ]),
    )), radius: 10));
    final bill = ColoredBox(color: KasirColors.tint, child: Padding(padding: const EdgeInsets.all(24), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          _sectionLabel('RINGKASAN TAGIHAN', color: KasirColors.primary), const Spacer(),
          Text('${store.items.length} barang · ${_plain(store.items.fold<num>(0, (sum, item) => sum + item.quantity))} qty', style: TextStyle(fontSize: 12, color: KasirColors.label)),
        ]),
        const SizedBox(height: 8),
        SummaryRow('Subtotal', rupiah(store.price == null ? null : store.price!.subtotal + lineDisc)),
        if (lineDisc > 0) SummaryRow('Diskon item', '−${rupiah(lineDisc)}', color: red),
        discountRow(),
        if (_charge > 0) SummaryRow('Biaya lain', rupiah(_charge)),
        const SizedBox(height: 10), _dashed(), const SizedBox(height: 16),
        _sectionLabel('TOTAL TAGIHAN'), const SizedBox(height: 4),
        Align(alignment: Alignment.centerRight, child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: Text(rupiah(total), style: moneyStyle.copyWith(fontSize: 44, height: 1.15)))),
        ...banners(large: true),
        if (modal != null && laba != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text.rich(TextSpan(
          style: TextStyle(fontSize: 12, color: KasirColors.label),
          children: [TextSpan(text: 'Modal ${rupiah(modal)} · perkiraan laba '), TextSpan(text: rupiah(laba), style: TextStyle(color: profitColor(laba)))]))),
        if (lossWarning != null) lossWarning,
        if (errorLine != null) errorLine,
      ]))),
      const SizedBox(height: 12),
      saveButton, const SizedBox(height: 12), cancelButton,
    ])));

    return Shortcuts(shortcuts: global ? {..._pageKeys, ..._takenKeys} : const {}, child: PopScope(canPop: !sending, child: Scaffold(
      backgroundColor: palette.canvas,
      body: SafeArea(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          height: 52, padding: const EdgeInsets.symmetric(horizontal: Space.md),
          decoration: BoxDecoration(color: KasirColors.surface, border: Border(bottom: BorderSide(color: KasirColors.border))),
          child: Row(children: [
            TextButton(
              onPressed: sending ? null : () => Navigator.of(context).maybePop(),
              style: TextButton.styleFrom(foregroundColor: KasirColors.ink),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.arrow_back, size: 18), const SizedBox(width: 6),
                const Text('Kasir', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), const SizedBox(width: 8), const KasirKey('Esc'),
              ]),
            ),
            const SizedBox(width: Space.md),
            Text(editing == null ? 'Pembayaran' : 'Ubah nota #$editing', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: KasirColors.ink)),
            const Spacer(),
            Text(editing == null ? '${store.activeQueue.label} · ${store.items.length} barang' : '${store.items.length} barang', style: TextStyle(fontSize: 13, color: muted)),
            const SizedBox(width: Space.sm),
          ]),
        ),
        Expanded(child: Padding(padding: const EdgeInsets.all(24), child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [Expanded(flex: 58, child: left), vline, Expanded(flex: 42, child: bill)]),
        ))),
      ])),
    )));
  });
}

class _PaymentDiscountDialog extends StatefulWidget {
  const _PaymentDiscountDialog({required this.initial, required this.subtotal});
  final num initial, subtotal;
  @override State<_PaymentDiscountDialog> createState() => _PaymentDiscountDialogState();
}
class _PaymentDiscountDialogState extends State<_PaymentDiscountDialog> {
  late final controller = TextEditingController(text: widget.initial == 0 ? '' : widget.initial.toString());
  String? error;
  @override void dispose() { controller.dispose(); super.dispose(); }
  void _apply() {
    if (controller.text.trim().isEmpty) {
      Navigator.pop(context, 0);
      return;
    }
    try {
      Navigator.pop(context, inputDiscount(controller.text, baseAmount: widget.subtotal));
    } catch (_) {
      setState(() => error = 'Masukkan nominal rupiah atau persen (0-100%) yang valid.');
      showError(context, error!);
    }
  }

  @override Widget build(BuildContext context) => AlertDialog(
    title: const Text('Diskon Nota'),
    content: TextField(
      controller: controller,
      autofocus: true,
      keyboardType: TextInputType.text,
      textInputAction: TextInputAction.done,
      onSubmitted: (_) => _apply(),
      decoration: InputDecoration(labelText: 'Rupiah atau %', helperText: 'Contoh: 5000 atau 10%', errorText: error),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
      FilledButton(
        onPressed: _apply,
        child: const Text('Terapkan'),
      ),
    ],
  );
}

class _ReceiptConfirmDialog extends StatefulWidget {
  const _ReceiptConfirmDialog({
    required this.saleId,
    required this.amount,
    required this.away,
  });

  final int saleId;
  final String amount;
  final bool away;

  @override
  State<_ReceiptConfirmDialog> createState() => _ReceiptConfirmDialogState();
}

class _ReceiptConfirmDialogState extends State<_ReceiptConfirmDialog> {
  late bool choosePrint = !widget.away;
  final lewatiFocus = FocusNode();
  final cetakFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        if (choosePrint) {
          cetakFocus.requestFocus();
        } else {
          lewatiFocus.requestFocus();
        }
      }
    });
  }

  @override
  void dispose() {
    lewatiFocus.dispose();
    cetakFocus.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(choosePrint);
  }

  KeyEventResult _handleKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final alt = HardwareKeyboard.instance.isAltPressed;

    if (key == LogicalKeyboardKey.escape || key == LogicalKeyboardKey.keyL || (alt && key == LogicalKeyboardKey.keyL)) {
      Navigator.of(context).pop(false);
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.keyC || (alt && key == LogicalKeyboardKey.keyC)) {
      Navigator.of(context).pop(true);
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.arrowLeft ||
        key == LogicalKeyboardKey.arrowRight ||
        key == LogicalKeyboardKey.tab ||
        key == LogicalKeyboardKey.pageUp ||
        key == LogicalKeyboardKey.pageDown) {
      setState(() {
        choosePrint = !choosePrint;
        if (choosePrint) {
          cetakFocus.requestFocus();
        } else {
          lewatiFocus.requestFocus();
        }
      });
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter || key == LogicalKeyboardKey.space || key == LogicalKeyboardKey.end) {
      _submit();
      return KeyEventResult.handled;
    }

    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final printLabel = widget.away ? 'Cetak di toko' : 'Cetak';

    return Focus(
      autofocus: true,
      onKeyEvent: _handleKey,
      child: AlertDialog(
        title: Text('Cetak struk #${widget.saleId}?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.away
                ? '${widget.amount}\n\nAnda terhubung lewat internet: struk akan tercetak di printer toko.'
                : widget.amount),
            const SizedBox(height: Space.md),
            Text(
              'Gunakan ← / → untuk pilih, Enter untuk konfirmasi (L: Lewati, C: Cetak)',
              style: TextStyle(color: muted, fontSize: 12),
            ),
          ],
        ),
        actions: [
          widget.away
              ? FilledButton(
                  focusNode: lewatiFocus,
                  autofocus: !choosePrint,
                  onPressed: () => Navigator.of(context).pop(false),
                  style: FilledButton.styleFrom(
                    side: !choosePrint ? BorderSide(color: primaryInk, width: 2) : BorderSide.none,
                  ),
                  child: const Text('Lewati'),
                )
              : TextButton(
                  focusNode: lewatiFocus,
                  autofocus: !choosePrint,
                  onPressed: () => Navigator.of(context).pop(false),
                  style: TextButton.styleFrom(
                    side: !choosePrint ? BorderSide(color: primaryInk, width: 2) : BorderSide.none,
                  ),
                  child: const Text('Lewati'),
                ),
          widget.away
              ? TextButton(
                  focusNode: cetakFocus,
                  autofocus: choosePrint,
                  onPressed: () => Navigator.of(context).pop(true),
                  style: TextButton.styleFrom(
                    side: choosePrint ? BorderSide(color: primaryInk, width: 2) : BorderSide.none,
                  ),
                  child: Text(printLabel),
                )
              : FilledButton(
                  focusNode: cetakFocus,
                  autofocus: choosePrint,
                  onPressed: () => Navigator.of(context).pop(true),
                  style: FilledButton.styleFrom(
                    side: choosePrint ? BorderSide(color: primaryInk, width: 2) : BorderSide.none,
                  ),
                  child: Text(printLabel),
                ),
        ],
      ),
    );
  }
}
