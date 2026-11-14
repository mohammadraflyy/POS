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
  final customerFocus = FocusNode(), paidFocus = FocusNode(), noteFocus = FocusNode();
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

  /// The desktop's payment keys: Alt+T/B/Q/R pick the method, Alt+U sets exact cash (uang pas),
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
        setState(() => method = picked);
        return true;
      }
      if (key == LogicalKeyboardKey.keyU && _total != null) {
        setState(() => paid.text = _plain(_total!));
        paidFocus.requestFocus();
        paid.selection = TextSelection(baseOffset: 0, extentOffset: paid.text.length);
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
      if (key == LogicalKeyboardKey.pageUp || key == LogicalKeyboardKey.pageDown) {
        setState(() => saveHighlighted = !saveHighlighted);
        return true;
      }
      // Keterangan keeps its own Enter
      if (enter && !noteFocus.hasFocus) {
        if (!saveHighlighted) { Navigator.of(context).maybePop(); } else if (widget.store.canCheckout) { submit(); }
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
  Future<void> loadCustomers() async {
    try { final result = await widget.store.api.customers(); if (mounted) setState(() { names = result; customerError = null; }); }
    catch (e) { if (mounted) { setState(() => customerError = e.toString()); showError(context, e); } }
  }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); customer.dispose(); paid.dispose(); charge.dispose(); note.dispose(); customerFocus.dispose(); paidFocus.dispose(); noteFocus.dispose(); super.dispose(); }
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

  Widget _methodButton(String value) {
    final on = method == value;
    final fg = on ? KasirColors.onPrimary : KasirColors.ink;
    return Expanded(child: Semantics(button: true, selected: on, child: Material(color: Colors.transparent, child: Ink(
      height: 40,
      decoration: BoxDecoration(
        color: on ? KasirColors.primary : KasirColors.surface,
        border: on ? null : Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.control)),
      child: InkWell(
        borderRadius: BorderRadius.circular(Corners.control),
        onTap: sending ? null : () => setState(() => method = value),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(_methodIcons[value], size: 18, color: fg), const SizedBox(width: 8),
          Text(methods[value]!, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: fg)),
          if (isDesktop) ...[const SizedBox(width: 8), Text('Alt+${methodKeys[value]}', style: TextStyle(fontFamily: monoFamily, fontSize: 11, color: on ? KasirColors.onPrimary : KasirColors.label))],
        ]),
      ),
    ))));
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

  /// A borderless field for the value half of an [_infoRow].
  Widget _rowField(TextEditingController controller, String hint) => TextField(
    controller: controller, enabled: !sending, textAlign: TextAlign.end, textInputAction: TextInputAction.next,
    onChanged: (_) => setState(() {}),
    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: KasirColors.ink),
    decoration: InputDecoration(hintText: hint, hintStyle: TextStyle(color: KasirColors.muted), isDense: true, filled: false,
      border: InputBorder.none, enabledBorder: InputBorder.none, disabledBorder: InputBorder.none, focusedBorder: InputBorder.none),
  );

  InputDecoration _inputDecoration(String hint, {String? helper}) {
    OutlineInputBorder border(Color color, [double width = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: BorderSide(color: color, width: width));
    return InputDecoration(
      hintText: hint, helperText: helper, helperMaxLines: 2, hintStyle: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: KasirColors.muted), isDense: true, filled: true, fillColor: KasirColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: border(KasirColors.border), enabledBorder: border(KasirColors.border), focusedBorder: border(KasirColors.primary, 2),
    );
  }

  Widget _label(String text) => Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: KasirColors.label)));

  Widget _chip(String text, VoidCallback? onTap) => Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: Material(
    color: KasirColors.surface,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control), side: BorderSide(color: KasirColors.border)),
    clipBehavior: Clip.antiAlias,
    child: InkWell(onTap: onTap, child: SizedBox(height: 36, child: Center(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 4),
      child: FittedBox(fit: BoxFit.scaleDown, child: Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: onTap == null ? KasirColors.muted : KasirColors.ink))))))),
  )));

  Widget _banner(String label, String amount, {required bool good}) => Container(
    height: 52, padding: const EdgeInsets.symmetric(horizontal: 16),
    decoration: BoxDecoration(color: good ? KasirColors.changeBg : KasirColors.dueBg, borderRadius: BorderRadius.circular(Corners.panel)),
    child: Row(children: [
      Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: good ? KasirColors.changeInk : KasirColors.dueInk)),
      const Spacer(),
      Text(amount, style: moneyStyle.copyWith(fontSize: 20, color: good ? KasirColors.changeInk : KasirColors.dueInk)),
    ]),
  );

  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) {
    final store = widget.store;
    final total = _total;
    final paidNow = _paid;
    final change = method == 'tunai' && total != null && paidNow != null ? paidNow - total : null;
    final editing = store.editingSaleId;
    final narrow = MediaQuery.sizeOf(context).width < 860;
    final lineDisc = store.price?.lineDiscountTotal ?? 0;
    final modal = store.price?.estimatedModal;
    final laba = modal != null && total != null ? total - modal : null;
    final remainder = method == 'bon' && total != null ? (total - (paidNow ?? 0)).clamp(0, double.infinity) : null;

    final summary = Container(
      padding: const EdgeInsets.all(Space.md),
      decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SummaryRow('Subtotal · ${store.items.length} barang', rupiah(store.price == null ? null : store.price!.subtotal + lineDisc)),
        if (lineDisc > 0) SummaryRow('Diskon item', '-${rupiah(lineDisc)}', color: KasirColors.destructive),
        Row(children: [
          Expanded(child: Text('Diskon nota', style: TextStyle(color: muted))),
          TextButton(
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4), minimumSize: const Size(0, 26)),
            onPressed: sending || !store.editable ? null : () async {
              final val = await showDialog<num>(
                context: context,
                builder: (_) => _PaymentDiscountDialog(initial: store.discount, subtotal: store.price?.subtotal ?? 0),
              );
              if (val != null) store.setDiscount(val);
            },
            child: Text(store.discount == 0 ? 'Tambah' : '-${rupiah(store.discount)}',
              style: amountStyle.copyWith(fontSize: 14, color: store.discount > 0 ? KasirColors.destructive : KasirColors.primary)),
          ),
        ]),
        if (_charge > 0) SummaryRow('Biaya lain', rupiah(_charge)),
        if (modal != null) SummaryRow('Modal barang', rupiah(modal)),
        if (laba != null) SummaryRow('Perkiraan laba', rupiah(laba), color: laba < 0 ? KasirColors.destructive : null),
        if (laba != null && laba < 0) Padding(
          padding: const EdgeInsets.only(top: Space.sm),
          child: Container(
            padding: const EdgeInsets.all(Space.sm),
            decoration: BoxDecoration(color: pillWarningBg, border: Border.all(color: noticeBorder), borderRadius: BorderRadius.circular(Corners.control)),
            child: Text('Harga setelah diskon di bawah modal — transaksi ini rugi ${rupiah(laba.abs())}. Tetap bisa disimpan kalau memang disengaja.',
              style: TextStyle(color: pillWarningInk, fontSize: 12)),
          ),
        ),
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
    final content = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [_methodButton('tunai'), const SizedBox(width: Space.sm), _methodButton('qris')]),
      const SizedBox(height: Space.sm),
      Row(children: [_methodButton('transfer'), const SizedBox(width: Space.sm), _methodButton('bon')]),
      const SizedBox(height: Space.md),
      summary, const SizedBox(height: Space.sm),
      totalBanner, const SizedBox(height: Space.md),
      _infoRow(Icons.person_outline, method == 'bon' ? 'Pelanggan (wajib)' : 'Pelanggan', _rowField(customer, 'Umum')),
      if (suggestions.isNotEmpty) Padding(padding: const EdgeInsets.only(top: Space.sm), child: Wrap(spacing: Space.sm, runSpacing: Space.xs,
        children: suggestions.map((n) => ActionChip(label: Text(n), onPressed: sending ? null : () => setState(() => customer.text = n))).toList())),
      if (customerError != null) Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: sending ? null : loadCustomers, child: const Text('Muat ulang daftar pelanggan'))),
      const SizedBox(height: Space.sm),
      _infoRow(Icons.calendar_today_outlined, 'Tanggal & Jam', Row(mainAxisSize: MainAxisSize.min, children: [
        Flexible(child: Text(_dateLabel(store.saleDate), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: KasirColors.ink))),
        if (store.saleDate != null && editing == null) IconButton(tooltip: 'Kembali ke sekarang', visualDensity: VisualDensity.compact, onPressed: () => store.setDetails(clearDate: true), icon: const Icon(Icons.close, size: 16)),
      ]), onTap: sending ? null : pickDate),
      const SizedBox(height: Space.md),
      if (method == 'tunai' || method == 'bon') ...[
        _label(method == 'bon' ? 'Uang muka' : 'Uang diterima'),
        SizedBox(height: 48, child: TextField(controller: paid, focusNode: paidFocus, textInputAction: TextInputAction.done, enabled: !sending, autofocus: isDesktop, onChanged: (_) => setState(() {}),
          onSubmitted: (_) { if (store.canCheckout) submit(); }, keyboardType: const TextInputType.numberWithOptions(decimal: true), textAlign: TextAlign.end, textAlignVertical: TextAlignVertical.center,
          style: amountStyle.copyWith(fontSize: 20, fontWeight: FontWeight.w600, color: KasirColors.ink),
          decoration: _inputDecoration(method == 'bon' ? 'Kosong = belum bayar sama sekali' : 'Kosong = uang pas'))),
        const SizedBox(height: Space.sm),
        Row(children: [
          _chip('Uang pas', sending || total == null ? null : () => setState(() => paid.text = _plain(total))),
          if (method == 'tunai' && total != null && total > 0)
            for (final opt in _quickCashOptions(total)) _chip(rupiah(opt), sending ? null : () => setState(() => paid.text = opt.toString())),
        ]),
      ] else
        Text('Pastikan pembayaran ${methods[method]} sudah masuk ke rekening toko sebelum menyimpan. Aplikasi tidak membuat QR atau memproses transfer.', style: TextStyle(color: muted, fontSize: 13)),
      if (change != null) ...[const SizedBox(height: Space.md), _banner(change < 0 ? 'Kurang' : 'Kembalian', rupiah(change.abs()), good: change >= 0)],
      if (remainder != null) ...[const SizedBox(height: Space.md), _banner('Sisa bon', rupiah(remainder), good: false)],
      const SizedBox(height: Space.lg),
      const Text('Detail nota', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)), const SizedBox(height: Space.sm),
      _label('Biaya lain (Rp)'),
      TextField(controller: charge, enabled: !sending, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), style: amountStyle.copyWith(fontSize: 14, color: KasirColors.ink),
        decoration: _inputDecoration('0', helper: 'Ongkos antar, kantong, dan sejenisnya. Ditambahkan ke tagihan dan dicetak di struk.')),
      const SizedBox(height: Space.md),
      _label(editing == null ? 'Keterangan' : 'Keterangan / alasan perubahan'),
      TextField(controller: note, focusNode: noteFocus, enabled: !sending, maxLength: 500, style: TextStyle(fontSize: 14, color: KasirColors.ink),
        decoration: _inputDecoration(editing == null ? 'Opsional' : 'Contoh: salah input jumlah')),
      if (error != null) Padding(padding: const EdgeInsets.only(top: Space.sm), child: Text(error!, style: TextStyle(color: errorColor))),
    ]);

    // the 2px ring marks which footer action Enter runs; only "Panah global" has one
    Widget ring(bool on, Widget button) => !kasirKeys.isGlobalArrows ? button : Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(border: Border.all(color: on ? KasirColors.primary : Colors.transparent, width: 2), borderRadius: BorderRadius.circular(12)),
      child: button);
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

    if (narrow) {
      return Shortcuts(shortcuts: kasirKeys.isGlobalArrows ? _pageKeys : const {}, child: PopScope(canPop: !sending, child: Scaffold(
        backgroundColor: KasirColors.surface,
        appBar: AppBar(title: Text(editing == null ? 'Pembayaran' : 'Ubah nota #$editing')),
        bottomNavigationBar: SafeArea(child: Container(
          padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.sm),
          decoration: BoxDecoration(color: KasirColors.surface, border: Border(top: BorderSide(color: KasirColors.border))),
          child: footer)),
        body: SafeArea(child: ListView(padding: const EdgeInsets.all(Space.lg), children: [content])),
      )));
    }
    // the old app's dialog: a dimmed page with one centred card, its footer pinned inside it
    return Shortcuts(shortcuts: kasirKeys.isGlobalArrows ? _pageKeys : const {}, child: PopScope(canPop: !sending, child: Scaffold(
      backgroundColor: Color.alphaBlend(KasirColors.ink.withValues(alpha: 0.45), KasirColors.surface),
      body: SafeArea(child: LayoutBuilder(builder: (context, box) => Center(child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 560, maxHeight: box.maxHeight * 0.92),
        child: Container(
          decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.border), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
          clipBehavior: Clip.antiAlias,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(padding: const EdgeInsets.fromLTRB(20, 8, 8, 8), child: Row(children: [
              Expanded(child: Text(editing == null ? 'Pembayaran' : 'Ubah nota #$editing', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: KasirColors.ink))),
              IconButton(tooltip: 'Tutup', onPressed: sending ? null : () => Navigator.of(context).maybePop(), icon: const Icon(Icons.close)),
            ])),
            Divider(height: 1, color: KasirColors.border),
            Flexible(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: content)),
            Divider(height: 1, color: KasirColors.border),
            Padding(padding: const EdgeInsets.all(16), child: footer),
          ]),
        ),
      )))),
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
