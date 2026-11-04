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
Future<void> openPayment(BuildContext context, LiveStore store) async {
  final sale = await Navigator.of(context).push<PaidSale>(MaterialPageRoute(builder: (_) => LivePaymentScreen(store: store)));
  if (sale == null || !context.mounted) return;
  final print = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
    title: Text('Cetak struk #${sale.saleId}?'),
    content: Text(sale.method == 'tunai' ? 'Kembalian ${rupiah(sale.change)}.' : 'Total ${rupiah(sale.total)}.'),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Lewati')),
      FilledButton(autofocus: true, onPressed: () => Navigator.pop(context, true), child: const Text('Cetak')),
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
  List<String> names = [];
  String? error, customerError;
  bool sending = false;

  static const methods = {'tunai': 'Tunai', 'qris': 'QRIS', 'transfer': 'Transfer', 'bon': 'Bon'};
  static const methodKeys = {'tunai': 'T', 'qris': 'Q', 'transfer': 'R', 'bon': 'B'};
  @override void initState() { super.initState(); HardwareKeyboard.instance.addHandler(handleKey); loadCustomers(); }

  /// The desktop's payment keys: Alt+T/B/Q/R pick the method, Alt+S saves, Esc goes back
  /// to the till. Only while this screen is in front.
  bool handleKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted || sending || ModalRoute.of(context)?.isCurrent == false) return false;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.escape) { Navigator.of(context).maybePop(); return true; }
    if (!HardwareKeyboard.instance.isAltPressed) return false;
    final picked = {LogicalKeyboardKey.keyT: 'tunai', LogicalKeyboardKey.keyB: 'bon', LogicalKeyboardKey.keyQ: 'qris', LogicalKeyboardKey.keyR: 'transfer'}[key];
    if (picked != null) { setState(() => method = picked); return true; }
    if (key == LogicalKeyboardKey.keyS) { if (widget.store.canCheckout) submit(); return true; }
    return false;
  }
  Future<void> loadCustomers() async {
    try { final result = await widget.store.api.customers(); if (mounted) setState(() { names = result; customerError = null; }); }
    catch (e) { if (mounted) { setState(() => customerError = e.toString()); showError(context, e); } }
  }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); customer.dispose(); paid.dispose(); super.dispose(); }
  Future<void> submit() async {
    if (sending) return;
    setState(() { sending = true; error = null; });
    try {
      final total = widget.store.price?.total;
      if (total == null) throw const FormatException('Harga keranjang belum tersedia.');
      final amount = method == 'qris' || method == 'transfer' ? total : inputRupiah(paid.text.isEmpty && method == 'bon' ? '0' : paid.text);
      if (method == 'bon' && customer.text.trim().isEmpty) throw const FormatException('Nama pelanggan wajib untuk bon.');
      // saved first, without a receipt; openPayment asks about printing, as the desktop did
      final result = await widget.store.checkout(method, amount, customer.text, print: false);
      if (!mounted) return;
      Navigator.of(context).pop(PaidSale(saleId: idNumber(result['saleId']), total: number(result['total']) ?? total, method: method, paid: amount));
    } catch (e) { if (mounted) { setState(() { sending = false; error = errorText(e); }); showError(context, e); } }
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) => PopScope(
    canPop: !sending, child: Scaffold(appBar: AppBar(title: const Text('Pembayaran')), body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 640), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      PaymentTotal(total: rupiah(widget.store.price?.total), description: 'Harga dan diskon telah dihitung oleh PC toko.'),
      Text('Metode pembayaran', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.md),
      Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [for (final value in methods.keys) ChoiceChip(
        label: Text(isDesktop ? '${methods[value]}  ·  Alt+${methodKeys[value]}' : methods[value]!), selected: method == value,
        onSelected: sending ? null : (_) => setState(() => method = value))]), const SizedBox(height: Space.xl),
      TextField(controller: customer, textInputAction: TextInputAction.next, enabled: !sending, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: method == 'bon' ? 'Nama pelanggan (wajib)' : 'Nama pelanggan (opsional)', prefixIcon: const Icon(Icons.person_outline))),
      if (customer.text.isNotEmpty) Wrap(spacing: 8, children: names.where((n) => n.toLowerCase().contains(customer.text.toLowerCase())).take(5).map((n) => ActionChip(label: Text(n), onPressed: sending ? null : () => setState(() => customer.text = n))).toList()),
      if (customerError != null) TextButton(onPressed: sending ? null : loadCustomers, child: const Text('Muat ulang daftar pelanggan')),
      if (method == 'tunai' || method == 'bon') ...[
        const SizedBox(height: 16), TextField(controller: paid, textInputAction: TextInputAction.done, enabled: !sending, autofocus: isDesktop,
          onSubmitted: (_) { if (widget.store.canCheckout) submit(); }, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: method == 'bon' ? 'Uang muka (Rp)' : 'Uang diterima (Rp)', helperText: 'Tanpa pemisah ribuan')),
        const SizedBox(height: 12), Align(alignment: Alignment.centerLeft, child: ActionChip(label: const Text('Uang pas'), onPressed: sending || widget.store.price == null ? null : () => setState(() => paid.text = widget.store.price!.total.toString()))),
      ] else ...[
        const SizedBox(height: Space.lg), WhitePanel(child: Text('Pastikan pembayaran ${method.toUpperCase()} sudah diterima toko sebelum menyelesaikan transaksi. Aplikasi tidak memproses transfer atau membuat QR pembayaran.', style: const TextStyle(color: muted))),
      ],
      const SizedBox(height: Space.lg), WhitePanel(child: Column(children: [SummaryRow('Subtotal', rupiah(widget.store.price?.subtotal)), SummaryRow('Diskon nota', rupiah(widget.store.price?.discount)), SummaryRow('Total', rupiah(widget.store.price?.total), strong: true)])),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 18), child: Text(error!, style: const TextStyle(color: errorColor))),
      const SizedBox(height: Space.xl), FilledButton.icon(onPressed: sending || !widget.store.canCheckout ? null : submit, icon: sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check_circle_outline),
        label: Text(sending ? 'Menyimpan ke PC…' : 'Simpan transaksi${isDesktop ? '  ·  Alt+S' : ''}')),
    ]))))),
  ));
}
