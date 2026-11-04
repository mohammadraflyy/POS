import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../models/pos_models.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'ReceiptScreen.dart';
class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key, required this.app});
  final AppState app;
  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}
class _PaymentScreenState extends State<PaymentScreen> {
  PaymentMethod _method = PaymentMethod.tunai;
  final _paid = TextEditingController();
  final _customer = TextEditingController();
  bool _processing = false;
  String? _error;
  @override
  void dispose() { _paid.dispose(); _customer.dispose(); super.dispose(); }
  int get _entered { try { return moneyInput(_paid.text); } catch (_) { return 0; } }
  void _submit() {
    if (_processing) return;
    setState(() { _processing = true; _error = null; });
    try {
      final paid = _method == PaymentMethod.qris || _method == PaymentMethod.transfer ? widget.app.total : moneyInput(_paid.text.isEmpty && _method == PaymentMethod.bon ? '0' : _paid.text);
      final receipt = widget.app.checkout(_method, paid, _customer.text);
      Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => ReceiptScreen(app: widget.app, receipt: receipt, justCreated: true)));
    } catch (e) { setState(() { _error = errorText(e); _processing = false; }); showError(context, e); }
  }
  @override
  Widget build(BuildContext context) {
    final total = widget.app.total;
    const labels = {PaymentMethod.tunai: 'Tunai', PaymentMethod.qris: 'QRIS', PaymentMethod.transfer: 'Transfer', PaymentMethod.bon: 'Bon'};
    const icons = {PaymentMethod.tunai: Icons.payments_outlined, PaymentMethod.qris: Icons.qr_code_2, PaymentMethod.transfer: Icons.account_balance_outlined, PaymentMethod.bon: Icons.person_outline};
    return Scaffold(appBar: AppBar(title: const Text('Pembayaran')), body: SafeArea(child: Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 680), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
        PaymentTotal(total: money(total), description: 'Mode demo / Transaksi tidak dikirim ke toko.'),
        Text('Metode pembayaran', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.md),
        Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [for (final method in PaymentMethod.values)
          ChoiceChip(label: Text(labels[method]!), selected: _method == method,
            onSelected: _processing ? null : (_) => setState(() { _method = method; _error = null; })),
        ]), const SizedBox(height: Space.xl),
        TextField(controller: _customer, textInputAction: TextInputAction.next, enabled: !_processing, decoration: InputDecoration(labelText: _method == PaymentMethod.bon ? 'Nama pelanggan (wajib)' : 'Nama pelanggan (opsional)', prefixIcon: const Icon(Icons.person_outline))),
        if (_method == PaymentMethod.tunai || _method == PaymentMethod.bon) ...[
          const SizedBox(height: 16), TextField(controller: _paid, textInputAction: TextInputAction.done, enabled: !_processing, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(labelText: _method == PaymentMethod.bon ? 'Uang muka (Rp)' : 'Uang diterima (Rp)', hintText: _method == PaymentMethod.bon ? '0' : 'Masukkan nominal', helperText: 'Tanpa pemisah ribuan, contoh 50000')),
          const SizedBox(height: 12), Wrap(spacing: 8, runSpacing: 8, children: [
            ActionChip(label: const Text('Uang pas'), onPressed: () => setState(() => _paid.text = moneyField(total))),
            for (final value in [2000000, 5000000, 10000000].where((v) => v >= total)) ActionChip(label: Text(money(value)), onPressed: () => setState(() => _paid.text = moneyField(value))),
          ]),
          const SizedBox(height: Space.lg), WhitePanel(child: SummaryRow(_method == PaymentMethod.bon ? 'Sisa bon' : (_entered < total ? 'Kekurangan' : 'Kembalian'),
            money(_method == PaymentMethod.bon ? (total - _entered) : (_entered - total).abs()), strong: true)),
        ] else ...[
          const SizedBox(height: Space.lg), WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icons[_method], size: 32, color: muted), const SizedBox(height: 12),
            Text(_method == PaymentMethod.qris ? 'Simulasi pembayaran QRIS' : 'Simulasi pembayaran transfer', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6), Text('Tidak ada QR pembayaran atau transfer uang sungguhan. Demo mencatat metode ini sebagai lunas sesuai total.', style: TextStyle(color: muted)),
          ])),
        ],
        const SizedBox(height: Space.xl), WhitePanel(child: Column(children: [SummaryRow('Subtotal', money(widget.app.subtotal)), SummaryRow('Diskon nota', '− ${money(widget.app.billDiscount)}'), const Divider(), SummaryRow('Total', money(total), strong: true)])),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_error!, style: TextStyle(color: errorColor))),
        const SizedBox(height: 24), FilledButton.icon(onPressed: _processing ? null : _submit, icon: const Icon(Icons.check_circle_outline), label: const Text('Selesaikan transaksi demo')),
        const SizedBox(height: 12), Text('Hanya simulasi • tidak mengubah data atau kas toko', textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: muted)),
      ]),
    ))));
  }
}
