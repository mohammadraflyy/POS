import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/pos_models.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
class ReceiptScreen extends StatelessWidget {
  const ReceiptScreen({super.key, required this.app, required this.receipt, this.justCreated = false});
  final AppState app;
  final SaleReceipt receipt;
  final bool justCreated;
  Future<void> _pay(BuildContext context) async {
    final result = await showDialog<(String, String)>(context: context, builder: (_) => const _BonPaymentDialog());
    if (result == null || !context.mounted) return;
    try { app.demo.payBon(receipt, moneyInput(result.$1), result.$2); app.refreshDemo(); }
    catch (e) { showError(context, e); }
  }
  String _text() => [
    'STRUK DEMO — BUKAN BUKTI PEMBAYARAN', receipt.id,
    '${dateText(receipt.date)} ${timeText(receipt.date)}',
    ...receipt.lines.map((line) => '${line.name} ${qty(line.quantity)} ${line.unit}: ${money(line.total)}'),
    'Diskon nota: ${money(receipt.discount)}', 'TOTAL: ${money(receipt.total)}',
    'Metode: ${receipt.method.name}', 'Dibayar: ${money(receipt.paid)}',
    'Kembalian: ${money(receipt.change)}', 'Sisa bon: ${money(receipt.remaining)}',
  ].join('\n');
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: app, builder: (context, _) => Scaffold(
    appBar: AppBar(title: Text(justCreated ? 'Transaksi selesai' : 'Detail transaksi')),
    body: SafeArea(child: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 540), child: ListView(padding: const EdgeInsets.all(Space.xl), children: [
      Center(child: CircleAvatar(radius: 34, backgroundColor: pillPositiveBg, child: Icon(Icons.check_rounded, size: 36, color: successColor))),
      const SizedBox(height: Space.lg), Center(child: Text('Pesanan berhasil dicatat', style: Theme.of(context).textTheme.titleLarge)),
      const SizedBox(height: 8), const Center(child: Pill('STRUK DEMO • BUKAN BUKTI BAYAR')), const SizedBox(height: Space.xl),
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(child: Icon(Icons.storefront_outlined, size: 32, color: muted)), const SizedBox(height: 8),
        const Center(child: Text('TOKO CONTOH', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, letterSpacing: 2))),
        const SizedBox(height: Space.lg), SummaryRow('Nomor', receipt.id), SummaryRow('Tanggal', '${dateText(receipt.date)} ${timeText(receipt.date)}'),
        SummaryRow('Pelanggan', receipt.customer.isEmpty ? 'Umum' : receipt.customer), const Divider(height: 28),
        for (final line in receipt.lines) Padding(padding: const EdgeInsets.only(bottom: 14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(line.name, style: const TextStyle(fontWeight: FontWeight.w700)),
          SummaryRow('${qty(line.quantity)} ${line.unit} × ${money(line.price)}', money(line.total)),
          if (line.discount > 0) Text('Diskon barang: ${money(line.discount)}', style: TextStyle(color: muted, fontSize: 13)),
        ])), const Divider(), SummaryRow('Subtotal', money(receipt.subtotal)), SummaryRow('Diskon nota', '− ${money(receipt.discount)}'),
        SummaryRow('Total', money(receipt.total), strong: true), const Divider(),
        SummaryRow('Metode', receipt.method.name.toUpperCase()), SummaryRow('Dibayar', money(receipt.paid)),
        if (receipt.method == PaymentMethod.tunai) ...[SummaryRow('Uang diterima', money(receipt.tendered)), SummaryRow('Kembalian', money(receipt.change))],
        if (receipt.method == PaymentMethod.bon) SummaryRow('Sisa bon', money(receipt.remaining)),
        if (receipt.payments.isNotEmpty) ...[const Divider(), const Text('Riwayat cicilan', style: TextStyle(fontWeight: FontWeight.w700)),
          for (final payment in receipt.payments) ListTile(contentPadding: EdgeInsets.zero, title: Text(money(payment.amount)), subtitle: Text('${dateText(payment.date)} • ${payment.note}')),
        ],
      ])),
      const SizedBox(height: Space.lg),
      if (receipt.remaining > 0 && receipt.method == PaymentMethod.bon) Padding(padding: const EdgeInsets.only(bottom: 12), child: FilledButton.icon(onPressed: () => _pay(context), icon: const Icon(Icons.payments_outlined), label: const Text('Catat cicilan demo'))),
      OutlinedButton.icon(onPressed: () async { await Clipboard.setData(ClipboardData(text: _text())); if (context.mounted) showNotice(context, 'Struk demo disalin.', kind: NoticeKind.success); }, icon: const Icon(Icons.copy_outlined), label: const Text('Salin struk demo')),
      const SizedBox(height: 12), Text('Mode demo tidak mencetak ke printer PC.', style: TextStyle(color: muted, fontSize: 13), textAlign: TextAlign.center),
      const SizedBox(height: Space.lg), FilledButton(onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst), child: const Text('Kembali ke kasir')),
    ])))),
  ));
}
class _BonPaymentDialog extends StatefulWidget {
  const _BonPaymentDialog();
  @override
  State<_BonPaymentDialog> createState() => _BonPaymentDialogState();
}
class _BonPaymentDialogState extends State<_BonPaymentDialog> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  @override
  void dispose() { _amount.dispose(); _note.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AlertDialog(title: const Text('Cicilan bon demo'), content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
    TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah rupiah')),
    const SizedBox(height: Space.lg), TextField(controller: _note, maxLength: 500, decoration: const InputDecoration(labelText: 'Keterangan')),
  ])), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
    FilledButton(onPressed: () => Navigator.pop(context, (_amount.text, _note.text)), child: const Text('Catat'))]);
}
