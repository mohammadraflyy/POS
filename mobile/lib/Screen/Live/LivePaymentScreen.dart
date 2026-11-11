import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../state/live_store.dart';
import '../../models/live_models.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../services/mobile_api.dart' show ApiFailure;
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
  final print = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
    title: Text('Cetak struk #${sale.saleId}?'),
    content: Text(away ? '$amount\n\nAnda terhubung lewat internet: struk akan tercetak di printer toko.' : amount),
    actions: [
      away
        ? FilledButton(autofocus: true, onPressed: () => Navigator.pop(context, false), child: const Text('Lewati'))
        : TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Lewati')),
      away
        ? TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cetak di toko'))
        : FilledButton(autofocus: true, onPressed: () => Navigator.pop(context, true), child: const Text('Cetak')),
    ],
  ));
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
  final customerFocus = FocusNode(), paidFocus = FocusNode();
  List<String> names = [];
  String? error, customerError;
  bool sending = false;

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
    // Enter / numpadEnter anywhere when not inside an active text input:
    final typing = FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null;
    if (!typing && (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter)) {
      if (widget.store.canCheckout) submit();
      return true;
    }
    return false;
  }
  Future<void> loadCustomers() async {
    try { final result = await widget.store.api.customers(); if (mounted) setState(() { names = result; customerError = null; }); }
    catch (e) { if (mounted) { setState(() => customerError = e.toString()); showError(context, e); } }
  }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); customer.dispose(); paid.dispose(); charge.dispose(); note.dispose(); customerFocus.dispose(); paidFocus.dispose(); super.dispose(); }
  Future<void> submit() async {
    if (sending) return;
    setState(() { sending = true; error = null; });
    try {
      widget.store.setDetails(charge: _charge, text: note.text);
      final total = _total;
      if (total == null) throw const FormatException('Harga keranjang belum tersedia.');
      final amount = method == 'qris' || method == 'transfer' ? total : inputRupiah(paid.text.isEmpty && method == 'bon' ? '0' : paid.text);
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

  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) {
    final store = widget.store;
    final total = _total;
    final paidNow = _paid;
    final change = method == 'tunai' && total != null && paidNow != null ? paidNow - total : null;
    final editing = store.editingSaleId;

    final form = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('Metode pembayaran', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)), const SizedBox(height: Space.sm),
      Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [for (final value in methods.keys) ChoiceChip(showCheckmark: false,
        label: Text(
          isDesktop ? '${methods[value]}  ·  Alt+${methodKeys[value]}' : methods[value]!,
          style: TextStyle(
            fontWeight: method == value ? FontWeight.bold : FontWeight.w500,
            color: method == value ? (isDark ? const Color(0xFF38BDF8) : Colors.white) : ink,
          ),
        ),
        selected: method == value,
        selectedColor: isDark ? const Color(0xFF1E293B) : const Color(0xFF0F172A),
        backgroundColor: surface,
        side: BorderSide(
          color: method == value ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F172A)) : controlBorder,
          width: method == value ? 2.0 : 1.0,
        ),
        onSelected: sending ? null : (_) => setState(() => method = value))]),
      const SizedBox(height: Space.xl),
      TextField(controller: customer, textInputAction: TextInputAction.next, enabled: !sending, onChanged: (_) => setState(() {}),
        decoration: InputDecoration(labelText: method == 'bon' ? 'Nama pelanggan (wajib untuk bon)' : 'Nama pelanggan', hintText: 'Umum', prefixIcon: const Icon(Icons.person_outline, size: 20))),
      if (customer.text.isNotEmpty) Padding(padding: const EdgeInsets.only(top: Space.sm), child: Wrap(spacing: Space.sm, runSpacing: Space.xs,
        children: names.where((n) => n.toLowerCase().contains(customer.text.toLowerCase()) && n != customer.text).take(5).map((n) => ActionChip(label: Text(n), onPressed: sending ? null : () => setState(() => customer.text = n))).toList())),
      if (customerError != null) Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: sending ? null : loadCustomers, child: const Text('Muat ulang daftar pelanggan'))),
      if (method == 'tunai' || method == 'bon') ...[
        const SizedBox(height: Space.lg),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: TextField(controller: paid, textInputAction: TextInputAction.done, enabled: !sending, autofocus: isDesktop, onChanged: (_) => setState(() {}),
            onSubmitted: (_) { if (store.canCheckout) submit(); }, keyboardType: const TextInputType.numberWithOptions(decimal: true), style: amountStyle.copyWith(fontSize: 16),
            decoration: InputDecoration(labelText: method == 'bon' ? 'Uang muka (Rp)' : 'Uang diterima (Rp)', helperText: method == 'bon' ? 'Kosong = belum bayar sama sekali' : 'Tanpa titik ribuan'))),
          const SizedBox(width: Space.sm),
          Padding(padding: const EdgeInsets.only(top: 2), child: OutlinedButton(onPressed: sending || total == null ? null : () => setState(() => paid.text = _plain(total)), child: const Text('Uang pas'))),
        ]),
        if (method == 'tunai' && total != null && total > 0) ...[
          const SizedBox(height: Space.xs),
          Wrap(
            spacing: Space.xs,
            runSpacing: Space.xs,
            children: [
              ActionChip(
                avatar: const Icon(Icons.check, size: 14),
                label: const Text('Uang Pas'),
                onPressed: sending ? null : () => setState(() => paid.text = _plain(total)),
              ),
              for (final opt in _quickCashOptions(total))
                ActionChip(
                  label: Text(rupiah(opt)),
                  onPressed: sending ? null : () => setState(() => paid.text = opt.toString()),
                ),
            ],
          ),
        ],
      ] else ...[
        const SizedBox(height: Space.lg),
        Text('Pastikan pembayaran ${methods[method]} sudah masuk ke rekening toko sebelum menyimpan. Aplikasi tidak membuat QR atau memproses transfer.', style: TextStyle(color: muted, fontSize: 13)),
      ],
      const SizedBox(height: Space.xl), const Divider(), const SizedBox(height: Space.lg),
      const Text('Detail nota', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)), const SizedBox(height: Space.sm),
      Row(children: [
        Expanded(child: Text('Tanggal transaksi', style: TextStyle(color: muted))),
        TextButton.icon(onPressed: sending ? null : pickDate, icon: const Icon(Icons.event_outlined, size: 18), label: Text(_dateLabel(store.saleDate))),
        if (store.saleDate != null && editing == null) IconButton(tooltip: 'Kembali ke sekarang', onPressed: () => store.setDetails(clearDate: true), icon: const Icon(Icons.close, size: 16)),
      ]),
      const SizedBox(height: Space.sm),
      TextField(controller: charge, enabled: !sending, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), style: amountStyle.copyWith(fontSize: 14),
        decoration: const InputDecoration(labelText: 'Biaya lain (Rp)', hintText: '0', helperText: 'Ongkos antar, kantong, dan sejenisnya. Ditambahkan ke tagihan dan dicetak di struk.')),
      const SizedBox(height: Space.md),
      TextField(controller: note, enabled: !sending, maxLength: 500,
        decoration: InputDecoration(labelText: editing == null ? 'Keterangan' : 'Keterangan / alasan perubahan', hintText: editing == null ? 'Opsional' : 'Contoh: salah input jumlah')),
    ]);

    final lineDisc = store.price?.lineDiscountTotal ?? 0;
    final modal = store.price?.estimatedModal;
    final laba = modal != null && total != null ? total - modal : null;

    final summary = WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(editing == null ? 'Tagihan' : 'Tagihan nota #$editing', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
      const SizedBox(height: Space.sm),
      SummaryRow('Subtotal · ${store.items.length} barang', rupiah(store.price?.subtotal)),
      if (lineDisc > 0) SummaryRow('Diskon barang', '-${rupiah(lineDisc)}'),
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
            style: amountStyle.copyWith(fontSize: 14, color: store.discount > 0 ? warningColor : dataHue)),
        ),
      ]),
      if (_charge > 0) SummaryRow('Biaya lain', rupiah(_charge)),
      const Divider(height: Space.lg),
      SummaryRow('Total', rupiah(total), strong: true, color: dataHue),
      if (modal != null) SummaryRow('Modal barang', rupiah(modal)),
      if (laba != null) SummaryRow('Perkiraan laba', rupiah(laba), color: laba < 0 ? errorColor : null),
      if (laba != null && laba < 0) Padding(
        padding: const EdgeInsets.only(top: Space.sm),
        child: Container(
          padding: const EdgeInsets.all(Space.sm),
          decoration: BoxDecoration(color: pillWarningBg, border: Border.all(color: noticeBorder), borderRadius: BorderRadius.circular(Corners.control)),
          child: Text('Harga setelah diskon di bawah modal — transaksi ini rugi ${rupiah(laba.abs())}. Tetap bisa disimpan kalau memang disengaja.',
            style: TextStyle(color: pillWarningInk, fontSize: 12)),
        ),
      ),
      if (change != null) SummaryRow(change < 0 ? 'Kurang' : 'Kembalian', rupiah(change.abs()), color: change < 0 ? errorColor : ink),
      if (method == 'bon' && total != null) SummaryRow('Sisa bon', rupiah((total - (paidNow ?? 0)).clamp(0, double.infinity))),
      if (error != null) Padding(padding: const EdgeInsets.only(top: Space.md), child: Text(error!, style: TextStyle(color: errorColor))),
      const SizedBox(height: Space.lg),
      SizedBox(height: 44, child: FilledButton.icon(onPressed: sending || !store.canCheckout ? null : submit,
        icon: sending ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: onPrimary)) : const Icon(Icons.check, size: 18),
        label: Text(sending ? 'Menyimpan…' : '${editing == null ? 'Simpan transaksi' : 'Simpan perubahan'}${isDesktop ? '  ·  End / Alt+S' : ''}'))),
    ]));

    return PopScope(canPop: !sending, child: Scaffold(
      appBar: AppBar(title: Text(editing == null ? 'Pembayaran' : 'Ubah nota #$editing')),
      body: SafeArea(child: LayoutBuilder(builder: (context, box) {
        if (box.maxWidth < 860) {
          return ListView(padding: const EdgeInsets.all(Space.lg), children: [
            PaymentTotal(total: rupiah(total), description: 'Harga dan diskon dihitung oleh PC toko.'),
            form, const SizedBox(height: Space.xl), summary,
          ]);
        }
        // the form on the left, the bill with its change on the right, on one 32px frame
        return SingleChildScrollView(padding: const EdgeInsets.all(Space.xxl), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 3, child: form),
          const SizedBox(width: Space.xxl),
          Expanded(flex: 2, child: summary),
        ]));
      })),
    ));
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
