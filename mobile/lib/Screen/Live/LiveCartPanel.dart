import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

class LiveCartPanel extends StatefulWidget {
  const LiveCartPanel({super.key, required this.store, this.onExitTop});
  final LiveStore store;
  final VoidCallback? onExitTop;

  @override
  State<LiveCartPanel> createState() => _LiveCartPanelState();
}

class _LiveCartPanelState extends State<LiveCartPanel> {
  late final ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();
    widget.store.addListener(_onStoreChanged);
  }

  void _onStoreChanged() {
    final idx = widget.store.selectedCartIndex;
    if (idx != null && idx == 0 && _scrollController.hasClients && _scrollController.offset > 0) {
      _scrollController.animateTo(0, duration: const Duration(milliseconds: 150), curve: Curves.easeInOut);
    }
  }

  @override
  void didUpdateWidget(covariant LiveCartPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.store != widget.store) {
      oldWidget.store.removeListener(_onStoreChanged);
      widget.store.addListener(_onStoreChanged);
    }
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreChanged);
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> discount(BuildContext context) async {
    final value = await showDialog<num>(
      context: context,
      builder: (_) => _DiscountDialog(initial: widget.store.discount, subtotal: widget.store.price?.subtotal ?? 0),
    );
    if (value != null) widget.store.setDiscount(value);
  }

  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return AnimatedBuilder(
      animation: Listenable.merge([store, store.guard]),
      builder: (context, _) => CartLayout(
        scrollController: _scrollController,
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
      if (store.items.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: Space.xl),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Keranjang masih kosong. Scan barang atau pilih dari katalog.', style: TextStyle(color: muted)),
            // an empty cart is the moment a new cashier has time to learn the keys
            if (isDesktop) ...[
              const SizedBox(height: Space.lg),
              for (final (keys, label) in const [('F1 / F2', 'Cari barang'), ('/', 'Daftar semua barang'), ('F3', 'Ubah baris teratas'),
                  ('PgUp / PgDn', 'Pindah panel'), ('Alt+P', 'Pilih pelanggan'), ('F4 / F12', 'Bayar')])
                Padding(padding: const EdgeInsets.only(bottom: 6), child: Row(children: [
                  SizedBox(width: 96, child: Text(keys, style: TextStyle(fontFamily: monoFamily, fontSize: 12, color: secondaryInk))),
                  Expanded(child: Text(label, style: TextStyle(fontSize: 13, color: muted))),
                ])),
            ],
          ]),
        )
      else
        for (var index = 0; index < store.items.length; index++)
          _CartLine(
            key: ObjectKey(store.items[index]),
            store: store,
            index: index,
            isSelected: store.selectedCartIndex == index,
            onExitTop: widget.onExitTop,
          ),
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

/// One cart line: tap it to select/highlight ("di sorot"), delete with Del/Backspace,
/// or double click / Enter to change quantity, unit, price or discount.
class _CartLine extends StatefulWidget {
  const _CartLine({
    super.key,
    required this.store,
    required this.index,
    required this.isSelected,
    this.onExitTop,
  });

  final LiveStore store;
  final int index;
  final bool isSelected;
  final VoidCallback? onExitTop;

  @override
  State<_CartLine> createState() => _CartLineState();
}

class _CartLineState extends State<_CartLine> {
  late final FocusNode _focusNode;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode(debugLabel: 'CartLine_${widget.index}');
    if (widget.isSelected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          if (!_focusNode.hasFocus) _focusNode.requestFocus();
          _ensureVisible();
        }
      });
    }
  }

  void _ensureVisible() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Scrollable.ensureVisible(
          context,
          alignment: 0.1,
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeInOut,
        );
      }
    });
  }

  @override
  void didUpdateWidget(covariant _CartLine oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isSelected && !oldWidget.isSelected) {
      if (!_focusNode.hasFocus) _focusNode.requestFocus();
      _ensureVisible();
    } else if (!widget.isSelected && oldWidget.isSelected && widget.store.selectedCartIndex == null) {
      // only when no line is selected: moving to another line, that line's requestFocus in this
      // same frame must win, and an unfocus here would land after it and drop the keyboard
      if (_focusNode.hasFocus) _focusNode.unfocus();
    }
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _openEdit() async {
    final item = widget.store.items[widget.index];
    final result = await editLiveItem(context, item.product, existing: item);
    if (result != null && mounted) {
      try {
        widget.store.replace(item, result);
      } catch (e) {
        showError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.store.items[widget.index];
    final line = widget.store.price != null && widget.index < widget.store.price!.lines.length ? widget.store.price!.lines[widget.index] : null;
    final fallbackPrice = item.manualPrice ?? item.unit.price;
    final price = line?['hargaJual'] ?? fallbackPrice;
    final discount = number(line?['diskon']) ?? item.discount ?? 0;
    final fallbackSubtotal = price != null ? (price * item.quantity - discount).round() : null;
    final displaySubtotal = line?['subtotal'] ?? fallbackSubtotal;
    final priceSource = line?['priceSource']?.toString();
    final tierBadge = priceSource == 'price_tier' ? ' · grosir' : priceSource == 'manual' ? ' · manual' : '';
    // While editing an existing sale/bon, stock was already deducted so do not warn shortage
    final short = line?['stokCukup'] == false && widget.store.editingSaleId == null;

    final isRiwayat = item.priceNote != null && item.priceNote!.contains('riwayat');
    final isTambahan = item.priceNote != null && (item.priceNote!.contains('tambahan') || item.priceNote!.contains('katalog'));
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final isSelected = widget.isSelected;

    final cardBorder = isSelected
        ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0284C7))
        : (isRiwayat
            ? (isDark ? const Color(0xFFD97706) : const Color(0xFFFDE68A)) // amber-200
            : isTambahan
                ? (isDark ? const Color(0xFF059669) : const Color(0xFFA7F3D0)) // emerald-200
                : (isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1)));

    final cardBg = isSelected
        ? (isDark ? const Color(0xFF0C4A6E).withValues(alpha: 0.35) : const Color(0xFFF0F9FF))
        : (isRiwayat
            ? (isDark ? const Color(0xFF78350F).withValues(alpha: 0.25) : const Color(0xFFFFFBEB))
            : isTambahan
                ? (isDark ? const Color(0xFF064E3B).withValues(alpha: 0.25) : const Color(0xFFECFDF5))
                : (isDark ? const Color(0xFF1E293B) : const Color(0xFFF8FAFC)));

    return Focus(
      focusNode: _focusNode,
      onFocusChange: (hasFocus) {
        if (hasFocus && widget.store.selectedCartIndex != widget.index) {
          widget.store.selectCartIndex(widget.index);
        }
      },
      onKeyEvent: (node, event) {
        // the only owner of these keys while a line is selected: the till's global handler
        // leaves them alone, so one press is one step (and one Delete removes one line)
        if (event is! KeyDownEvent && event is! KeyRepeatEvent) return KeyEventResult.ignored;
        // Ctrl+arrow changes menu (MainScreen); the cart must not step as well
        if (HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
        final key = event.logicalKey;
        if (key == LogicalKeyboardKey.delete || key == LogicalKeyboardKey.backspace) {
          if (event is KeyDownEvent && widget.store.editable) widget.store.removeSelectedCartItem();
          return KeyEventResult.handled;
        }
        // arrows stay inside the cart, the edges included; PageDown/PageUp change panel
        if (key == LogicalKeyboardKey.arrowDown) {
          if (widget.index + 1 < widget.store.items.length) widget.store.selectCartIndex(widget.index + 1);
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowUp) {
          if (widget.index > 0) widget.store.selectCartIndex(widget.index - 1);
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.arrowRight) {
          return KeyEventResult.handled;
        }
        if (event is! KeyDownEvent) return KeyEventResult.ignored;
        if (key == LogicalKeyboardKey.home) {
          widget.store.selectCartIndex(0);
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter) {
          if (widget.store.editable) {
            _openEdit();
            return KeyEventResult.handled;
          }
        }
        if (key == LogicalKeyboardKey.escape) {
          widget.store.selectCartIndex(null);
          _focusNode.unfocus();
          widget.onExitTop?.call();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: InkWell(
        canRequestFocus: false,
        borderRadius: BorderRadius.circular(Corners.control),
        onTap: () {
          widget.store.selectCartIndex(widget.index);
          _focusNode.requestFocus();
          if (!isDesktop && widget.store.editable) {
            _openEdit();
          }
        },
        onDoubleTap: (isDesktop && widget.store.editable) ? _openEdit : null,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
          margin: const EdgeInsets.symmetric(vertical: 3.5),
          decoration: BoxDecoration(
            color: cardBg,
            border: Border.all(
              color: cardBorder,
              width: isSelected ? 2.0 : ((isRiwayat || isTambahan) ? 1.2 : 1.0),
            ),
            borderRadius: BorderRadius.circular(Corners.control),
            boxShadow: [
              BoxShadow(
                color: isSelected
                    ? (isDark ? const Color(0xFF38BDF8).withValues(alpha: 0.3) : const Color(0xFF0284C7).withValues(alpha: 0.2))
                    : Colors.black.withValues(alpha: isDark ? 0.2 : 0.02),
                blurRadius: isSelected ? 4 : 2,
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
            Text(displaySubtotal == null ? '…' : rupiah(displaySubtotal), style: amountStyle.copyWith(fontSize: 14, fontWeight: FontWeight.w700)),
            const SizedBox(width: Space.xs),
            if (widget.store.editable) ...[
              SizedBox(
                width: 24,
                height: 22,
                child: IconButton(
                  padding: EdgeInsets.zero,
                  iconSize: 15,
                  onPressed: _openEdit,
                  tooltip: 'Ubah ${item.product.name} (Enter atau klik 2x)',
                  style: IconButton.styleFrom(
                    minimumSize: const Size(20, 20),
                    foregroundColor: muted,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  icon: const Icon(Icons.edit_outlined),
                ),
              ),
              const SizedBox(width: 4),
            ],
            SizedBox(
              width: 24,
              height: 22,
              child: IconButton(
                padding: EdgeInsets.zero,
                iconSize: 16,
                onPressed: widget.store.editable ? () {
                  widget.store.selectCartIndex(widget.index);
                  widget.store.removeSelectedCartItem();
                } : null,
                tooltip: 'Hapus ${item.product.name} (Del / Backspace)',
                style: IconButton.styleFrom(
                  minimumSize: const Size(20, 20),
                  foregroundColor: muted,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                icon: const Icon(Icons.close),
              ),
            ),
          ]),
        ),
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
                : (isDark ? const Color(0xFF182234) : const Color(0xFFF1F5F9)),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isActive
                  ? (isDark ? const Color(0xFF38BDF8) : const Color(0xFF0F172A))
                  : (isDark ? const Color(0xFF334155) : const Color(0xFFCBD5E1)),
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
  late final controller = TextEditingController(text: widget.initial == 0 ? '' : widget.initial.toString());
  String? error;
  @override void dispose() { controller.dispose(); super.dispose(); }

  void _apply() {
    if (controller.text.trim().isEmpty) {
      Navigator.pop(context, 0);
      return;
    }
    try {
      Navigator.pop(context, inputDiscount(controller.text, baseAmount: widget.subtotal));
    } catch (_) {
      setState(() => error = 'Masukkan nominal rupiah atau persen (0-100%) yang valid.');
      showError(context, error!);
    }
  }

  @override Widget build(BuildContext context) => AlertDialog(
    title: const Text('Diskon nota'),
    content: TextField(
      controller: controller,
      autofocus: true,
      keyboardType: TextInputType.text,
      textInputAction: TextInputAction.done,
      onSubmitted: (_) => _apply(),
      decoration: InputDecoration(labelText: 'Rupiah atau %', helperText: 'Contoh: 5000 atau 10%', errorText: error),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Batal')),
      FilledButton(onPressed: _apply, child: const Text('Terapkan')),
    ],
  );
}
