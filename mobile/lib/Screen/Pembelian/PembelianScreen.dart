import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'FormPembelianScreen.dart';
import 'HutangSupplierScreen.dart';
class PembelianScreen extends StatelessWidget {
  const PembelianScreen({super.key, required this.app});
  final AppState app;
  @override
  Widget build(BuildContext context) {
    final total = app.demo.purchases.fold<int>(0, (s, p) => s + p.total);
    final debt = app.demo.purchases.fold<int>(0, (s, p) => s + p.remaining);
    return ListView(padding: const EdgeInsets.all(Space.lg), children: [
      const PageIntro('Pembelian', 'Simulasi barang masuk dan pembayaran supplier.'),
      WhitePanel(child: Column(children: [SummaryRow('Total pembelian', money(total), strong: true), SummaryRow('Utang supplier', money(debt))])),
      const SizedBox(height: Space.lg), Wrap(spacing: 10, runSpacing: 10, children: [
        FilledButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => FormPembelianScreen(app: app))), icon: const Icon(Icons.add), label: const Text('Pembelian baru')),
        OutlinedButton.icon(onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => HutangSupplierScreen(app: app))), icon: const Icon(Icons.payments_outlined), label: const Text('Utang supplier')),
      ]), const SizedBox(height: 24), Text('Invoice terbaru', style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: 12),
      if (app.demo.purchases.isEmpty) const SizedBox(height: 240, child: EmptyPanel(icon: Icons.shopping_bag_outlined, title: 'Belum ada barang masuk', message: 'Buat pembelian demo untuk melihat penambahan stok pada katalog.')),
      for (final invoice in app.demo.purchases) Padding(padding: const EdgeInsets.only(bottom: 12), child: WhitePanel(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(invoice.supplier, style: Theme.of(context).textTheme.titleMedium), Text('${invoice.id} • ${dateText(invoice.date)}', style: TextStyle(color: muted, fontSize: 13)),
        const SizedBox(height: 10), Text('${invoice.product} • ${qty(invoice.quantity)} ${invoice.unit}'),
        SummaryRow('Total', money(invoice.total)), SummaryRow('Sisa utang', money(invoice.remaining)),
      ]))),
    ]);
  }
}
