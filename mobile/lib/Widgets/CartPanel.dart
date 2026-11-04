import 'package:flutter/material.dart';
import '../state/app_state.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../Screen/Penjualan/ProductSheet.dart';
import '../Screen/Penjualan/PaymentScreen.dart';
import 'ui.dart';
class CartPanel extends StatelessWidget {
  const CartPanel({super.key, required this.app});
  final AppState app;
  Future<void> _discount(BuildContext context) async {
    final controller = TextEditingController(text: moneyField(app.billDiscount));
    final text = await showDialog<String>(context: context, builder: (context) => AlertDialog(
      title: const Text('Diskon nota'), content: TextField(controller: controller, autofocus: true,
        keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Nominal rupiah', helperText: 'Tanpa pemisah ribuan')),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Terapkan'))],
    ));
    // Dispose after dialog route's reverse animation has finished.
    Future<void>.delayed(const Duration(milliseconds: 350), controller.dispose);
    if (text == null || !context.mounted) return;
    try { app.setDiscount(moneyInput(text)); } catch (e) { showError(context, e); }
  }
  Future<void> _clear(BuildContext context) async {
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Kosongkan keranjang?'),
      content: const Text('Semua barang yang dipilih akan dihapus dari keranjang.'), actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Kosongkan')),
      ]));
    if (confirmed == true) app.clearCart();
  }
  @override
  Widget build(BuildContext context) => AnimatedBuilder(animation: app, builder: (context, _) => CartLayout(
    header: Row(children: [Expanded(child: Text('Keranjang', style: Theme.of(context).textTheme.titleLarge)),
      IconButton(onPressed: app.cart.isEmpty ? null : () => _clear(context), tooltip: 'Kosongkan keranjang', icon: const Icon(Icons.delete_outline))]),
    items: [for (final line in app.cart) Padding(padding: const EdgeInsets.symmetric(vertical: Space.md), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Expanded(child: Text(line.product.name, style: Theme.of(context).textTheme.titleMedium)),
        IconButton(onPressed: () => app.remove(line), tooltip: 'Hapus barang', icon: const Icon(Icons.close, size: 20))]),
      Text(money(line.price) + ' / ' + line.unit.name, style: const TextStyle(color: muted)),
      if (line.discount > 0) SummaryRow('Diskon', money(line.discount)),
      Wrap(spacing: Space.sm, runSpacing: Space.sm, crossAxisAlignment: WrapCrossAlignment.center, children: [
        IconButton.outlined(tooltip: 'Kurangi satu', onPressed: () {
          if (line.quantity <= 1000) { app.remove(line); return; }
          try { app.putLine(line.copy(quantity: line.quantity - 1000)); } catch (e) { showError(context, e); }
        }, icon: const Icon(Icons.remove, size: 18)),
        TextButton(onPressed: () => showProductSheet(context, app, line.product, existing: line), child: Text(qty(line.quantity))),
        IconButton.outlined(tooltip: 'Tambah satu', onPressed: () {
          try { app.putLine(line.copy(quantity: line.quantity + 1000)); } catch (e) { showError(context, e); }
        }, icon: const Icon(Icons.add, size: 18)),
        Text(money(line.total), style: amountStyle),
      ]),
      TextButton(onPressed: () => showProductSheet(context, app, line.product, existing: line), child: const Text('Ubah jumlah / harga')),
      const Divider(),
    ]))],
    footer: Column(mainAxisSize: MainAxisSize.min, children: [
      SummaryRow('Subtotal', money(app.subtotal)),
      Row(children: [const Expanded(child: Text('Diskon nota', style: TextStyle(color: muted))), Flexible(child: TextButton(onPressed: app.cart.isEmpty ? null : () => _discount(context), child: Text(app.billDiscount == 0 ? 'Tambah diskon' : money(app.billDiscount))))]),
      SummaryRow('Total', money(app.total), strong: true), const SizedBox(height: Space.lg),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: app.cart.isEmpty ? null : () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PaymentScreen(app: app))), child: const Text('Lanjut bayar'))),
    ]),
  ));
}
