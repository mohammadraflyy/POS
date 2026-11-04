import 'package:flutter/material.dart';
import '../../state/live_store.dart';
import '../../models/live_models.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveSaleScreen.dart';
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
  @override void initState() { super.initState(); loadCustomers(); }
  Future<void> loadCustomers() async {
    try { final result = await widget.store.api.customers(); if (mounted) setState(() { names = result; customerError = null; }); }
    catch (e) { if (mounted) { setState(() => customerError = e.toString()); showError(context, e); } }
  }
  @override void dispose() { customer.dispose(); paid.dispose(); super.dispose(); }
  Future<void> submit() async {
    if (sending) return;
    setState(() { sending = true; error = null; });
    try {
      final total = widget.store.price?.total;
      if (total == null) throw const FormatException('Harga keranjang belum tersedia.');
      final amount = method == 'qris' || method == 'transfer' ? total : inputRupiah(paid.text.isEmpty && method == 'bon' ? '0' : paid.text);
      if (method == 'bon' && customer.text.trim().isEmpty) throw const FormatException('Nama pelanggan wajib untuk bon.');
      final result = await widget.store.checkout(method, amount, customer.text);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => LiveSaleScreen(api: widget.store.api, id: idNumber(result['saleId']), confirmation: result)));
    } catch (e) { if (mounted) { setState(() { sending = false; error = errorText(e); }); showError(context, e); } }
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) => PopScope(
    canPop: !sending, child: Scaffold(appBar: AppBar(title: const Text('Pembayaran')), body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 640), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      PaymentTotal(total: rupiah(widget.store.price?.total), description: 'Harga dan diskon telah dihitung oleh PC toko.'),
      Text('Metode pembayaran', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.md),
      Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [for (final value in ['tunai', 'qris', 'transfer', 'bon']) ChoiceChip(
        label: Text({'tunai': 'Tunai', 'qris': 'QRIS', 'transfer': 'Transfer', 'bon': 'Bon'}[value]!), selected: method == value,
        onSelected: sending ? null : (_) => setState(() => method = value))]), const SizedBox(height: Space.xl),
      TextField(controller: customer, textInputAction: TextInputAction.next, enabled: !sending, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: method == 'bon' ? 'Nama pelanggan (wajib)' : 'Nama pelanggan (opsional)', prefixIcon: const Icon(Icons.person_outline))),
      if (customer.text.isNotEmpty) Wrap(spacing: 8, children: names.where((n) => n.toLowerCase().contains(customer.text.toLowerCase())).take(5).map((n) => ActionChip(label: Text(n), onPressed: sending ? null : () => setState(() => customer.text = n))).toList()),
      if (customerError != null) TextButton(onPressed: sending ? null : loadCustomers, child: const Text('Muat ulang daftar pelanggan')),
      if (method == 'tunai' || method == 'bon') ...[
        const SizedBox(height: 16), TextField(controller: paid, textInputAction: TextInputAction.done, enabled: !sending, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: method == 'bon' ? 'Uang muka (Rp)' : 'Uang diterima (Rp)', helperText: 'Tanpa pemisah ribuan')),
        const SizedBox(height: 12), Align(alignment: Alignment.centerLeft, child: ActionChip(label: const Text('Uang pas'), onPressed: sending || widget.store.price == null ? null : () => setState(() => paid.text = widget.store.price!.total.toString()))),
      ] else ...[
        const SizedBox(height: Space.lg), WhitePanel(child: Text('Pastikan pembayaran ${method.toUpperCase()} sudah diterima toko sebelum menyelesaikan transaksi. Aplikasi tidak memproses transfer atau membuat QR pembayaran.', style: const TextStyle(color: muted))),
      ],
      const SizedBox(height: Space.lg), WhitePanel(child: Column(children: [SummaryRow('Subtotal', rupiah(widget.store.price?.subtotal)), SummaryRow('Diskon nota', rupiah(widget.store.price?.discount)), SummaryRow('Total', rupiah(widget.store.price?.total), strong: true)])),
      if (error != null) Padding(padding: const EdgeInsets.only(top: 18), child: Text(error!, style: const TextStyle(color: wine))),
      const SizedBox(height: Space.xl), FilledButton.icon(onPressed: sending || !widget.store.canCheckout ? null : submit, icon: sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check_circle_outline), label: Text(sending ? 'Menyimpan ke PC…' : 'Selesaikan & cetak di PC')),
    ]))))),
  ));
}
