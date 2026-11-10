import 'package:flutter/material.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../models/live_models.dart';
import '../../state/live_store.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveItemSheet.dart';
import 'LivePaymentScreen.dart';
/// Asks before emptying the cart - from the bin button or Alt+K on the PC.
Future<void> confirmClearCart(BuildContext context, LiveStore store) async {
  if (store.items.isEmpty || !store.editable) return;
  final yes = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Kosongkan keranjang?'),
    content: const Text('Semua barang yang dipilih akan dihapus dari keranjang.'),
    actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Batal')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Kosongkan'))]));
  if (yes == true) store.clear();
}

class LiveCartPanel extends StatelessWidget {
  const LiveCartPanel({super.key, required this.store});
  final LiveStore store;
  Future<void> discount(BuildContext context) async {
    final value = await showDialog<num>(
      context: context,
      builder: (_) => _DiscountDialog(initial: store.discount, subtotal: store.price?.subtotal ?? 0),
    );
    if (value != null) store.setDiscount(value);
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([store, store.guard]), builder: (context, _) => CartLayout(
    header: Row(children: [Expanded(child: Text(store.items.isEmpty ? 'Keranjang' : 'Keranjang · ${store.items.length} barang', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500))),
      IconButton(tooltip: 'Kosongkan keranjang (Alt+K)', onPressed: store.items.isEmpty || !store.editable ? null : () => confirmClearCart(context, store),
        icon: const Icon(Icons.delete_outline)),
    ]),
    items: [
      if (store.customerName.isNotEmpty) Padding(padding: const EdgeInsets.only(top: Space.sm, bottom: Space.xs), child: Row(children: [
        Icon(Icons.person_outline, size: 16, color: muted), const SizedBox(width: 6),
        Expanded(child: Text('Pelanggan: ${store.customerName}', style: const TextStyle(fontSize: 13))),
        TextButton(onPressed: store.editable ? () => store.setCustomer('') : null, style: TextButton.styleFrom(minimumSize: const Size(0, 28), padding: const EdgeInsets.symmetric(horizontal: 6)),
          child: const Text('Umum')),
      ])),
      for (var index = 0; index < store.items.length; index++) _CartLine(store: store, index: index),
    ],
    footer: Column(mainAxisSize: MainAxisSize.min, children: [
      if (store.pricing) const LinearProgressIndicator(minHeight: 2),
      if (store.priceError != null) TextButton(onPressed: store.reprice, child: const Text('Coba hitung harga lagi')),
      SummaryRow('Subtotal', store.items.isEmpty ? rupiah(0) : rupiah(store.price?.subtotal)),
      Row(children: [
        Expanded(child: Text('Diskon nota', style: TextStyle(color: muted))),
        // tappable, but the figure still ends on the totals' right edge
        TextButton(onPressed: store.items.isEmpty || !store.editable ? null : () => discount(context),
          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6), minimumSize: const Size(0, 32)),
          child: Text(store.discount == 0 ? 'Tambah' : '-${rupiah(store.discount)}', style: amountStyle.copyWith(fontSize: 14, decoration: TextDecoration.underline, decorationColor: controlBorder))),
      ]),
      // the answer figure: the bill, in the shop's one hue; an empty cart is a real Rp0, not a dash
      SummaryRow('Total', store.items.isEmpty ? rupiah(0) : rupiah(store.price?.total), strong: true, color: store.items.isEmpty ? muted : dataHue), const SizedBox(height: Space.lg),
      SizedBox(width: double.infinity, child: FilledButton(onPressed: store.canCheckout ? () => openPayment(context, store) : null, style: FilledButton.styleFrom(minimumSize: const Size(44, 44)), child: Text(isDesktop ? 'Bayar  ·  End' : 'Bayar'))),
    ]),
  ));
}

/// One cart line: tap it to change quantity, unit, price or discount.
class _CartLine extends StatelessWidget {
  const _CartLine({required this.store, required this.index});
  final LiveStore store;
  final int index;
  @override
  Widget build(BuildContext context) {
    final item = store.items[index];
    final line = store.price != null && index < store.price!.lines.length ? store.price!.lines[index] : null;
    final price = line?['hargaJual'];
    final discount = number(line?['diskon']) ?? 0;
    final priceSource = line?['priceSource']?.toString();
    final tierBadge = priceSource == 'price_tier' ? ' · grosir' : priceSource == 'manual' ? ' · manual' : '';
    final short = line?['stokCukup'] == false;
    return InkWell(
      onTap: !store.editable ? null : () async {
        final result = await editLiveItem(context, item.product, existing: item);
        if (result != null && context.mounted) { try { store.replace(item, result); } catch (e) { showError(context, e); } }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(border: index == 0 ? null : Border(top: BorderSide(color: ruleColor))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
            const SizedBox(height: 3),
            Text('${quantityText(item.quantity)} ${item.unit.name} × ${price == null ? '…' : rupiah(price)}$tierBadge${discount > 0 ? ' · diskon ${rupiah(discount)}' : ''}',
              style: amountStyle.copyWith(fontWeight: FontWeight.w400, color: muted, fontSize: 12)),
            if (short) ...[const SizedBox(height: 2), Text('Stok tidak cukup', style: TextStyle(color: errorColor, fontSize: 12))],
          ])),
          const SizedBox(width: Space.md),
          Text(line == null ? '…' : rupiah(line['subtotal']), style: amountStyle.copyWith(fontSize: 14, fontWeight: FontWeight.w500)),
          const SizedBox(width: Space.xs),
          SizedBox(width: 28, height: 22, child: IconButton(padding: EdgeInsets.zero, iconSize: 16, onPressed: store.editable ? () => store.remove(item) : null,
            tooltip: 'Hapus ${item.product.name}', style: IconButton.styleFrom(minimumSize: const Size(24, 24), foregroundColor: muted, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
            icon: const Icon(Icons.close))),
        ]),
      ),
    );
  }
}

class _DiscountDialog extends StatefulWidget {
  const _DiscountDialog({required this.initial, required this.subtotal});
  final num initial, subtotal;
  @override State<_DiscountDialog> createState() => _DiscountDialogState();
}
class _DiscountDialogState extends State<_DiscountDialog> {
  late final controller = TextEditingController(text: widget.initial.toString());
  String? error;
  @override void dispose() { controller.dispose(); super.dispose(); }
  @override Widget build(BuildContext context) => AlertDialog(title: const Text('Diskon nota'), content: TextField(controller: controller, keyboardType: TextInputType.text, decoration: InputDecoration(labelText: 'Rupiah atau %', helperText: 'Contoh: 5000 atau 10%', errorText: error)),
    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')), FilledButton(onPressed: () {
      try { Navigator.pop(context, inputDiscount(controller.text, baseAmount: widget.subtotal)); } catch (_) { setState(() => error = 'Masukkan nominal rupiah atau persen (0-100%) yang valid.'); showError(context, error!); }
    }, child: const Text('Terapkan'))]);
}
