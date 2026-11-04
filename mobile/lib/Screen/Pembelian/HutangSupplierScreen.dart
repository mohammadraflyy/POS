import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
class HutangSupplierScreen extends StatelessWidget {
  const HutangSupplierScreen({super.key, required this.app});
  final AppState app;
  Future<void> _pay(BuildContext context, String supplier) async {
    final text = await showDialog<String>(context: context, builder: (_) => _SupplierPaymentDialog(supplier: supplier));
    if (text == null || !context.mounted) return;
    try {
      final allocations = app.demo.paySupplier(supplier, moneyInput(text)); app.refreshDemo();
      showNotice(context, 'Pembayaran demo dialokasikan ke ${allocations.join(', ')}.', kind: NoticeKind.success);
    } catch (e) { showError(context, e); }
  }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: app, builder: (context, _) {
    final suppliers = app.demo.purchases.where((p) => p.remaining > 0).map((p) => p.supplier).toSet();
    return Scaffold(appBar: AppBar(title: const Text('Utang supplier')), body: SafeArea(child: suppliers.isEmpty
      ? const EmptyPanel(icon: Icons.task_alt, title: 'Tidak ada utang supplier', message: 'Invoice demo yang belum lunas akan ditampilkan di sini.')
      : ListView(padding: const EdgeInsets.all(Space.lg), children: [
        const Text('Pembayaran demo dialokasikan otomatis ke invoice tertua.', style: TextStyle(color: muted)), const SizedBox(height: 16),
        for (final supplier in suppliers) Padding(padding: const EdgeInsets.only(bottom: 14), child: WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(supplier, style: Theme.of(context).textTheme.titleLarge),
          for (final p in app.demo.purchases.where((p) => p.supplier == supplier && p.remaining > 0)) SummaryRow('${p.id}\n${dateText(p.date)}', money(p.remaining)),
          const Divider(), SummaryRow('Total utang', money(app.demo.purchases.where((p) => p.supplier == supplier).fold<int>(0, (s, p) => s + p.remaining)), strong: true),
          const SizedBox(height: 12), FilledButton(onPressed: () => _pay(context, supplier), child: const Text('Bayar utang demo')),
        ]))),
      ])));
  });
}
class _SupplierPaymentDialog extends StatefulWidget {
  const _SupplierPaymentDialog({required this.supplier});
  final String supplier;
  @override
  State<_SupplierPaymentDialog> createState() => _SupplierPaymentDialogState();
}
class _SupplierPaymentDialogState extends State<_SupplierPaymentDialog> {
  final _amount = TextEditingController();
  @override
  void dispose() { _amount.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AlertDialog(title: Text('Bayar ${widget.supplier}'),
    content: TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah rupiah')),
    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
      FilledButton(onPressed: () => Navigator.pop(context, _amount.text), child: const Text('Alokasikan FIFO'))]);
}
