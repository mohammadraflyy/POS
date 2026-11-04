import 'package:flutter/material.dart';
import '../../models/live_models.dart';
import '../../state/live_store.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveItemSheet.dart';
import 'LivePaymentScreen.dart';
class LiveCartPanel extends StatelessWidget {
  const LiveCartPanel({super.key, required this.store});
  final LiveStore store;
  Future<void> discount(BuildContext context) async {
    final value = await showDialog<num>(context: context, builder: (_) => _DiscountDialog(initial: store.discount));
    if (value != null) store.setDiscount(value);
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([store, store.guard]), builder: (context, _) => CartLayout(
    header: Row(children: [Expanded(child: Text('Keranjang', style: Theme.of(context).textTheme.titleLarge)),
      IconButton(tooltip: 'Kosongkan keranjang', onPressed: store.items.isEmpty || !store.editable ? null : () async {
        final yes = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Kosongkan keranjang?'),
          content: const Text('Semua barang yang dipilih akan dihapus dari keranjang.'),
          actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Kosongkan'))]));
        if (yes == true) store.clear();
      }, icon: const Icon(Icons.delete_outline)),
    ]),
    items: [for (var index = 0; index < store.items.length; index++) Padding(
      padding: const EdgeInsets.symmetric(vertical: Space.md), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Expanded(child: Text(store.items[index].product.name, style: Theme.of(context).textTheme.titleMedium)),
          IconButton(onPressed: store.editable ? () => store.remove(store.items[index]) : null, tooltip: 'Hapus barang', icon: const Icon(Icons.close, size: 20))]),
        Text(quantityText(store.items[index].quantity) + ' ' + store.items[index].unit.name, style: const TextStyle(color: muted)),
        if (store.price != null) ...[
          SummaryRow('Harga satuan', rupiah(store.price!.lines[index]['hargaJual'])),
          if (store.price!.lines[index]['stokCukup'] == false) const Text('Stok tidak cukup', style: TextStyle(color: errorColor)),
        ],
        TextButton(onPressed: !store.editable ? null : () async {
          final result = await editLiveItem(context, store.items[index].product, existing: store.items[index]);
          if (result != null && context.mounted) { try { store.put(result); } catch (e) { showError(context, e); } }
        }, child: const Text('Ubah jumlah / harga')),
        const Divider(),
      ]))],
    footer: Column(mainAxisSize: MainAxisSize.min, children: [
      if (store.pricing) const LinearProgressIndicator(minHeight: 2),
      if (store.priceError != null) TextButton(onPressed: store.reprice, child: const Text('Coba hitung harga lagi')),
      SummaryRow('Subtotal', rupiah(store.price?.subtotal)),
      Row(children: [const Expanded(child: Text('Diskon nota', style: TextStyle(color: muted))), Flexible(child: TextButton(onPressed: store.items.isEmpty || !store.editable ? null : () => discount(context), child: Text(rupiah(store.discount))))]),
      SummaryRow('Total', rupiah(store.price?.total), strong: true), const SizedBox(height: Space.lg),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: store.canCheckout ? () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LivePaymentScreen(store: store))) : null, child: const Text('Lanjut bayar'))),
    ]),
  ));
}

class _DiscountDialog extends StatefulWidget {
  const _DiscountDialog({required this.initial});
  final num initial;
  @override State<_DiscountDialog> createState() => _DiscountDialogState();
}
class _DiscountDialogState extends State<_DiscountDialog> {
  late final controller = TextEditingController(text: widget.initial.toString());
  String? error;
  @override void dispose() { controller.dispose(); super.dispose(); }
  @override Widget build(BuildContext context) => AlertDialog(title: const Text('Diskon nota'), content: TextField(controller: controller, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Rupiah', errorText: error)),
    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')), FilledButton(onPressed: () {
      try { Navigator.pop(context, inputRupiah(controller.text)); } catch (_) { setState(() => error = 'Masukkan nominal rupiah yang valid.'); showError(context, error!); }
    }, child: const Text('Terapkan'))]);
}
