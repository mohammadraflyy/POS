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

Future<void> _confirmCloseQueue(BuildContext context, LiveStore store, int index) async {
  final q = store.queues[index];
  if (q.items.isNotEmpty) {
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Hapus ${q.label}?'),
        content: Text('Antrean ini berisi ${q.items.length} barang belanjaan. Yakin ingin menghapus antrean ini?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: errorColor),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Hapus Antrean'),
          ),
        ],
      ),
    );
    if (yes != true) return;
  }
  store.removeQueue(index);
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
  @override Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return AnimatedBuilder(animation: Listenable.merge([store, store.guard]), builder: (context, _) => CartLayout(
    header: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (store.queues.length > 1) ...[
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (var i = 0; i < store.queues.length; i++) ...[
                  _CartQueueTab(
                    queue: store.queues[i],
                    isActive: i == store.activeQueueIndex,
                    canClose: store.queues.length > 1,
                    onTap: () => store.switchQueue(i),
                    onClose: () => _confirmCloseQueue(context, store, i),
                  ),
                  const SizedBox(width: 6),
                ],
                IconButton(
                  tooltip: 'Tambah antrean baru',
                  icon: const Icon(Icons.add, size: 18),
                  style: IconButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.all(4),
                    minimumSize: const Size(28, 28),
                  ),
                  onPressed: store.editable ? () => store.newQueue() : null,
                ),
              ],
            ),
          ),
          const SizedBox(height: Space.xs),
        ],
        Row(children: [
          Expanded(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    store.items.isEmpty ? 'Keranjang' : 'Keranjang Kasir',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                ),
                if (store.items.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                    decoration: BoxDecoration(
                      color: primaryInk,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${store.items.length} Item',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: onPrimary),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (store.editable && store.editingSaleId == null)
            IconButton(
              tooltip: 'Tahan antrean saat ini & buka baru (Alt+H)',
              onPressed: () {
                store.newQueue();
                showNotice(context, 'Antrean baru dibuka. Transaksi sebelumnya tersimpan di tab.', kind: NoticeKind.info);
              },
              icon: const Icon(Icons.add_shopping_cart, size: 20),
            ),
          IconButton(
            tooltip: 'Kosongkan keranjang (Alt+K)',
            onPressed: store.items.isEmpty || !store.editable ? null : () => confirmClearCart(context, store),
            icon: const Icon(Icons.delete_outline),
          ),
        ]),
      ],
    ),
    items: [
      if (store.customerName.isNotEmpty)
        Container(
          margin: const EdgeInsets.only(top: Space.sm, bottom: Space.xs),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: isDark ? raised : const Color(0xFFF8FAFC),
            border: Border.all(color: lineColor),
            borderRadius: BorderRadius.circular(Corners.control),
          ),
          child: Row(
            children: [
              Icon(Icons.person_outline, size: 16, color: muted),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Pelanggan: ${store.customerName}',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              TextButton(
                onPressed: store.editable ? () => store.setCustomer('') : null,
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, 26),
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  visualDensity: VisualDensity.compact,
                ),
                child: const Text('Umum', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ),
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
      SizedBox(width: double.infinity, child: FilledButton(
        onPressed: store.canCheckout ? () => openPayment(context, store) : null,
        style: FilledButton.styleFrom(
          minimumSize: const Size(44, 48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
          elevation: 2,
          backgroundColor: primaryInk,
          foregroundColor: onPrimary,
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(Icons.check_circle_outline, size: 19, color: store.canCheckout ? const Color(0xFF34D399) : onPrimary.withValues(alpha: 0.5)),
          const SizedBox(width: Space.sm),
          Text(isDesktop ? 'Bayar  ·  End' : 'Bayar', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
        ]),
      )),
    ]),
  ));
  }
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

    final isRiwayat = item.priceNote != null && item.priceNote!.contains('riwayat');
    final isTambahan = item.priceNote != null && (item.priceNote!.contains('tambahan') || item.priceNote!.contains('katalog'));
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final cardBorder = isRiwayat
        ? (isDark ? const Color(0xFFD97706) : const Color(0xFFFDE68A)) // amber-200
        : isTambahan
            ? (isDark ? const Color(0xFF059669) : const Color(0xFFA7F3D0)) // emerald-200
            : lineColor;

    final cardBg = isRiwayat
        ? (isDark ? const Color(0xFF78350F).withValues(alpha: 0.25) : const Color(0xFFFFFBEB))
        : isTambahan
            ? (isDark ? const Color(0xFF064E3B).withValues(alpha: 0.25) : const Color(0xFFECFDF5))
            : surface;

    return InkWell(
      borderRadius: BorderRadius.circular(Corners.control),
      onTap: !store.editable ? null : () async {
        final result = await editLiveItem(context, item.product, existing: item);
        if (result != null && context.mounted) { try { store.replace(item, result); } catch (e) { showError(context, e); } }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        margin: const EdgeInsets.symmetric(vertical: 3.5),
        decoration: BoxDecoration(
          color: cardBg,
          border: Border.all(color: cardBorder, width: (isRiwayat || isTambahan) ? 1.2 : 1),
          borderRadius: BorderRadius.circular(Corners.control),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: isDark ? 0.2 : 0.02),
              blurRadius: 2,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 3),
            Text('${quantityText(item.quantity)} ${item.unit.name} × ${price == null ? '…' : rupiah(price)}$tierBadge${discount > 0 ? ' · diskon ${rupiah(discount)}' : ''}',
              style: amountStyle.copyWith(fontWeight: FontWeight.w400, color: muted, fontSize: 12)),
            if (item.priceNote != null && item.priceNote!.isNotEmpty) ...[
              const SizedBox(height: 5),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
                decoration: BoxDecoration(
                  color: isRiwayat ? pillWarningBg : pillPositiveBg,
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(
                    color: (isRiwayat ? pillWarningInk : pillPositiveInk).withValues(alpha: 0.25),
                  ),
                ),
                child: Text(
                  item.priceNote!,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: isRiwayat ? pillWarningInk : pillPositiveInk,
                  ),
                ),
              ),
            ],
            if (short) ...[const SizedBox(height: 2), Text('Stok tidak cukup', style: TextStyle(color: errorColor, fontSize: 12))],
          ])),
          const SizedBox(width: Space.md),
          Text(line == null ? '…' : rupiah(line['subtotal']), style: amountStyle.copyWith(fontSize: 14, fontWeight: FontWeight.w700)),
          const SizedBox(width: Space.xs),
          SizedBox(width: 28, height: 22, child: IconButton(padding: EdgeInsets.zero, iconSize: 16, onPressed: store.editable ? () => store.remove(item) : null,
            tooltip: 'Hapus ${item.product.name}', style: IconButton.styleFrom(minimumSize: const Size(24, 24), foregroundColor: muted, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
            icon: const Icon(Icons.close))),
        ]),
      ),
    );
  }
}

class _CartQueueTab extends StatelessWidget {
  const _CartQueueTab({
    required this.queue,
    required this.isActive,
    required this.canClose,
    required this.onTap,
    required this.onClose,
  });

  final CartQueue queue;
  final bool isActive;
  final bool canClose;
  final VoidCallback onTap;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final count = queue.items.length;
    final title = queue.label;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: isActive
                ? (isDark ? const Color(0xFF1E293B) : const Color(0xFF0F172A))
                : surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isActive
                  ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F172A))
                  : lineColor,
              width: isActive ? 1.5 : 1,
            ),
            boxShadow: isActive ? [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.3 : 0.12),
                blurRadius: 3,
                offset: const Offset(0, 1),
              ),
            ] : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                count > 0 ? '$title ($count)' : title,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: isActive ? FontWeight.bold : FontWeight.w500,
                  color: isActive ? (isDark ? const Color(0xFF38BDF8) : Colors.white) : ink,
                ),
              ),
              if (canClose) ...[
                const SizedBox(width: 4),
                InkWell(
                  onTap: onClose,
                  borderRadius: BorderRadius.circular(10),
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: Icon(
                      Icons.close,
                      size: 14,
                      color: isActive ? (isDark ? const Color(0xFF38BDF8) : Colors.white70) : muted,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
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
