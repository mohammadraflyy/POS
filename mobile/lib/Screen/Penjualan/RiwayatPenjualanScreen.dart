import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'ReceiptScreen.dart';
class RiwayatPenjualanScreen extends StatefulWidget {
  const RiwayatPenjualanScreen({super.key, required this.app});
  final AppState app;
  @override
  State<RiwayatPenjualanScreen> createState() => _RiwayatPenjualanScreenState();
}
class _RiwayatPenjualanScreenState extends State<RiwayatPenjualanScreen> {
  String _query = '', _filter = 'Semua';
  @override
  Widget build(BuildContext context) {
    final sales = widget.app.demo.receipts.where((s) => (_filter == 'Semua' || (_filter == 'Belum lunas' ? s.remaining > 0 : s.method.name == _filter.toLowerCase())) && '${s.id} ${s.customer}'.toLowerCase().contains(_query.toLowerCase())).toList();
    final omzet = widget.app.demo.receipts.fold<int>(0, (sum, r) => sum + r.total);
    return ListView(padding: const EdgeInsets.all(Space.lg), children: [
      const PageIntro('Riwayat penjualan', 'Penjualan dan bon selama sesi demo.'),
      WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Pill('PENJUALAN DEMO'), const SizedBox(height: 10),
        Text(money(omzet), style: Theme.of(context).textTheme.headlineLarge), Text('${widget.app.demo.receipts.length} transaksi', style: const TextStyle(color: muted)),
      ])), const SizedBox(height: Space.lg),
      TextField(onChanged: (v) => setState(() => _query = v), decoration: const InputDecoration(labelText: 'Pencarian', hintText: 'Cari nomor atau pelanggan', prefixIcon: Icon(Icons.search))), const SizedBox(height: 12),
      Wrap(spacing: 8, runSpacing: 8, children: [for (final label in ['Semua', 'Tunai', 'Qris', 'Transfer', 'Bon', 'Belum lunas'])
        ChoiceChip(label: Text(label == 'Qris' ? 'QRIS' : label), selected: _filter == label, onSelected: (_) => setState(() => _filter = label))]),
      const SizedBox(height: Space.lg),
      if (sales.isEmpty) const SizedBox(height: 240, child: EmptyPanel(icon: Icons.receipt_long_outlined, title: 'Belum ada transaksi', message: 'Selesaikan pesanan di kasir. Struk dan bon akan muncul di sini.')),
      for (final sale in sales) RecordRow(title: sale.id,
        subtitle: (sale.customer.isEmpty ? 'Pelanggan umum' : sale.customer) + ' / ' + timeText(sale.date) + '\n' + sale.method.name.toUpperCase() + (sale.remaining > 0 ? ' / Sisa ' + money(sale.remaining) : ' / Lunas'),
        value: money(sale.total),
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ReceiptScreen(app: widget.app, receipt: sale)))),
    ]);
  }
}
