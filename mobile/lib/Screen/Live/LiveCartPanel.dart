import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../models/live_models.dart';
import '../../state/kasir_keys.dart';
import '../../state/live_store.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveItemSheet.dart';
import 'kasir_style.dart';
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

/// Asks for the nota discount (rupiah or %) and applies it to the active queue.
Future<void> showCartDiscount(BuildContext context, LiveStore store) async {
  final value = await showDialog<num>(
    context: context,
    builder: (_) => _DiscountDialog(initial: store.discount, subtotal: store.price?.subtotal ?? 0),
  );
  if (value != null) store.setDiscount(value);
}

// Fixed widths of the table columns; Produk takes what is left.
const _noWidth = 50.0, _unitWidth = 180.0, _priceWidth = 120.0, _discountWidth = 110.0, _qtyWidth = 80.0, _subtotalWidth = 130.0, _removeWidth = 50.0;

Widget _cell(double width, Widget child) => SizedBox(width: width, child: Padding(padding: const EdgeInsets.only(left: 12), child: child));

/// "grosir" or "manual" under a price that did not come from the plain catalog price.
Widget _sourcePill(String text) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
  decoration: BoxDecoration(color: KasirColors.tint2, borderRadius: BorderRadius.circular(8)),
  child: Text(text, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: KasirColors.primary)),
);

class LiveCartPanel extends StatelessWidget {
  const LiveCartPanel({super.key, required this.store, this.onExitTop, this.inCard = false, this.holdFocus, this.clearFocus, this.onRowKey});
  final LiveStore store;
  final VoidCallback? onExitTop;

  /// Focus nodes and arrow handler of the heading buttons, owned by the Kasir screen's arrow path.
  final FocusNode? holdFocus, clearFocus;
  final FocusOnKeyEventCallback? onRowKey;

  /// Sits inside a bigger card: the card supplies the frame, so the table drops its own.
  final bool inCard;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([store, store.guard]),
    builder: (context, _) => LayoutBuilder(builder: (context, box) {
      // the fixed columns alone take 720, so Produk needs room beyond that
      final wide = box.maxWidth >= 840;
      final headStyle = TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.6, color: KasirColors.label);
      void holdQueue() {
        store.newQueue();
        showNotice(context, 'Antrean baru dibuka. Transaksi sebelumnya tersimpan di tab.', kind: NoticeKind.info);
      }
      // 2px primary ring on keyboard focus, like Pelanggan and Diskon nota
      final focusRing = WidgetStateProperty.resolveWith<BorderSide?>((states) => states.contains(WidgetState.focused) ? BorderSide(color: KasirColors.primary, width: 2) : null);
      final table = store.items.isEmpty
        ? Padding(padding: const EdgeInsets.all(48), child: Column(mainAxisSize: MainAxisSize.min, children: [
            Opacity(opacity: 0.4, child: Icon(Icons.shopping_cart_outlined, size: 32, color: KasirColors.muted)),
            const SizedBox(height: Space.sm),
            Text('Keranjang kosong. Scan barcode atau cari barang untuk mulai.', textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: KasirColors.muted)),
          ]))
        : Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (wide) Container(
              height: 40,
              color: KasirColors.accent,
              padding: const EdgeInsets.only(right: 12),
              child: Row(children: [
                _cell(_noWidth, Text('NO', style: headStyle)),
                Expanded(child: Padding(padding: const EdgeInsets.only(left: 12), child: Text('PRODUK', style: headStyle))),
                _cell(_unitWidth, Text('SATUAN', style: headStyle)),
                _cell(_priceWidth, Text('HARGA', textAlign: TextAlign.end, style: headStyle)),
                _cell(_discountWidth, Text('DISKON', textAlign: TextAlign.end, style: headStyle)),
                _cell(_qtyWidth, Text('QTY', textAlign: TextAlign.center, style: headStyle)),
                _cell(_subtotalWidth, Text('SUBTOTAL', textAlign: TextAlign.end, style: headStyle)),
                const SizedBox(width: _removeWidth),
              ]),
            ),
            for (var index = 0; index < store.items.length; index++)
              _CartLine(
                key: ObjectKey(store.items[index]),
                store: store,
                index: index,
                isSelected: store.selectedCartIndex == index,
                wide: wide,
                onExitTop: onExitTop,
              ),
          ]);
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: inCard ? const EdgeInsets.fromLTRB(20, 12, 12, 8) : EdgeInsets.zero, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
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
        Focus(canRequestFocus: false, skipTraversal: true, onKeyEvent: onRowKey, child: Row(children: [
          Expanded(child: Row(children: [
            Icon(Icons.shopping_cart_outlined, size: 18, color: KasirColors.ink),
            const SizedBox(width: 8),
            Flexible(child: Text('Keranjang', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: KasirColors.ink))),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
              decoration: BoxDecoration(color: KasirColors.tint2, borderRadius: BorderRadius.circular(10)),
              child: Text('${store.items.length}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: KasirColors.primary)),
            ),
          ])),
          if (store.editable && store.editingSaleId == null)
            wide
              ? TextButton.icon(
                  focusNode: holdFocus,
                  onPressed: holdQueue,
                  style: TextButton.styleFrom(foregroundColor: KasirColors.label, minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 8)).copyWith(side: focusRing),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Antrean baru', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
                )
              : IconButton(
                  focusNode: holdFocus,
                  tooltip: 'Tahan antrean saat ini & buka baru',
                  onPressed: holdQueue,
                  color: KasirColors.label,
                  visualDensity: VisualDensity.compact,
                  style: const ButtonStyle().copyWith(side: focusRing),
                  icon: const Icon(Icons.add_shopping_cart, size: 20),
                ),
          TextButton.icon(
            focusNode: clearFocus,
            onPressed: store.items.isEmpty || !store.editable ? null : () => confirmClearCart(context, store),
            style: TextButton.styleFrom(foregroundColor: KasirColors.destructive, minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 8)).copyWith(side: focusRing),
            icon: const Icon(Icons.delete_outline, size: 18),
            label: const Text('Kosongkan', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
          ),
        ])),
        ])),
        if (inCard) Container(height: 1, color: lineColor) else const SizedBox(height: Space.sm),
        if (inCard) table else Container(
          decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.gridLine), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow),
          clipBehavior: Clip.antiAlias,
          child: table,
        ),
      ]);
    }),
  );
}

/// One cart line: tap it to select/highlight ("di sorot"), delete with Del/Backspace,
/// or double click / Enter to change quantity, unit, price or discount.
class _CartLine extends StatefulWidget {
  const _CartLine({
    super.key,
    required this.store,
    required this.index,
    required this.isSelected,
    required this.wide,
    this.onExitTop,
  });

  final LiveStore store;
  final int index;
  final bool isSelected, wide;
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
    final result = await editLiveItem(context, item.product, existing: item, onRemove: () => widget.store.remove(item));
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
    final sourceLabel = priceSource == 'price_tier' ? 'grosir' : priceSource == 'manual' ? 'manual' : null;
    // While editing an existing sale/bon, stock was already deducted so do not warn shortage
    final short = line?['stokCukup'] == false && widget.store.editingSaleId == null;

    final isRiwayat = item.priceNote != null && item.priceNote!.contains('riwayat');
    final isSelected = widget.isSelected;
    final priceText = price == null ? '…' : rupiah(price);
    final subtotalText = displaySubtotal == null ? '…' : rupiah(displaySubtotal);
    final nameStyle = TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: KasirColors.ink);
    final cellStyle = amountStyle.copyWith(fontSize: 14, fontWeight: FontWeight.w400, color: KasirColors.ink);
    final notes = [
      if (item.priceNote != null && item.priceNote!.isNotEmpty)
        Padding(padding: const EdgeInsets.only(top: 4), child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
          decoration: BoxDecoration(
            color: isRiwayat ? pillWarningBg : pillPositiveBg,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: (isRiwayat ? pillWarningInk : pillPositiveInk).withValues(alpha: 0.25)),
          ),
          child: Text(item.priceNote!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: isRiwayat ? pillWarningInk : pillPositiveInk)),
        )),
      if (short) Padding(padding: const EdgeInsets.only(top: 2), child: Text('Stok tidak cukup', style: TextStyle(color: errorColor, fontSize: 12))),
    ];
    final remove = IconButton(
      onPressed: widget.store.editable ? () {
        widget.store.selectCartIndex(widget.index);
        widget.store.removeSelectedCartItem();
      } : null,
      tooltip: 'Hapus ${item.product.name} (Del / Backspace)',
      iconSize: 18,
      color: KasirColors.muted,
      icon: const Icon(Icons.close),
    );

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
        // arrows stay inside the cart; only "Panah global" lets Up on the first line leave it
        if (key == LogicalKeyboardKey.arrowDown) {
          if (widget.index + 1 < widget.store.items.length) widget.store.selectCartIndex(widget.index + 1);
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.arrowUp) {
          if (widget.index > 0) {
            widget.store.selectCartIndex(widget.index - 1);
          } else if (kasirKeys.isGlobalArrows) {
            widget.onExitTop?.call();
          }
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
        onTap: () {
          widget.store.selectCartIndex(widget.index);
          _focusNode.requestFocus();
          if (!isDesktop && widget.store.editable) {
            _openEdit();
          }
        },
        onDoubleTap: (isDesktop && widget.store.editable) ? _openEdit : null,
        child: Container(
          constraints: BoxConstraints(minHeight: widget.wide ? 52 : 66),
          decoration: BoxDecoration(
            color: isSelected ? KasirColors.selectedRow : null,
            border: widget.wide || widget.index > 0 ? Border(top: BorderSide(color: KasirColors.gridLine)) : null,
          ),
          child: Stack(children: [
            if (isSelected && widget.wide) Positioned(left: 0, top: 0, bottom: 0, width: 3, child: ColoredBox(color: KasirColors.primary)),
            widget.wide
              ? Padding(padding: const EdgeInsets.symmetric(vertical: 6).copyWith(right: 12), child: Row(children: [
                  _cell(_noWidth, Text('${widget.index + 1}', style: cellStyle.copyWith(fontSize: 13, color: KasirColors.muted))),
                  Expanded(child: Padding(padding: const EdgeInsets.only(left: 12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(item.product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: nameStyle),
                    Text(item.product.code, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: monoFamily, fontSize: 11, color: KasirColors.muted)),
                    ...notes,
                  ]))),
                  _cell(_unitWidth, Align(alignment: Alignment.centerLeft, child: Container(
                    width: 150, height: 28, padding: const EdgeInsets.only(left: 10, right: 6),
                    decoration: BoxDecoration(color: KasirColors.surface, border: Border.all(color: KasirColors.gridLine), borderRadius: BorderRadius.circular(6)),
                    child: Row(children: [
                      Expanded(child: Text(item.unit.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: KasirColors.ink))),
                      Icon(Icons.keyboard_arrow_down, size: 16, color: KasirColors.muted),
                    ]),
                  ))),
                  _cell(_priceWidth, Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
                    Text(priceText, textAlign: TextAlign.end, style: cellStyle),
                    if (sourceLabel != null) Padding(padding: const EdgeInsets.only(top: 2), child: _sourcePill(sourceLabel)),
                  ])),
                  _cell(_discountWidth, Text(discount > 0 ? '−${rupiah(discount)}' : '-', textAlign: TextAlign.end,
                    style: cellStyle.copyWith(fontWeight: discount > 0 ? FontWeight.w500 : FontWeight.w400, color: discount > 0 ? KasirColors.destructive : KasirColors.muted))),
                  _cell(_qtyWidth, Center(child: Container(
                    height: 28, constraints: const BoxConstraints(minWidth: 44), padding: const EdgeInsets.symmetric(horizontal: 10), alignment: Alignment.center,
                    decoration: BoxDecoration(color: KasirColors.accent, borderRadius: BorderRadius.circular(14)),
                    child: Text(quantityText(item.quantity), style: cellStyle.copyWith(fontWeight: FontWeight.w700)),
                  ))),
                  _cell(_subtotalWidth, Text(subtotalText, textAlign: TextAlign.end, style: cellStyle.copyWith(fontWeight: FontWeight.w700))),
                  SizedBox(width: _removeWidth, child: Center(child: remove)),
                ]))
              : Padding(padding: const EdgeInsets.fromLTRB(14, 8, 0, 8), child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(item.product.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: nameStyle),
                    const SizedBox(height: 2),
                    Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
                      Text('${quantityText(item.quantity)} ${item.unit.name} × $priceText${discount > 0 ? ' · −${rupiah(discount)}' : ''}',
                        style: amountStyle.copyWith(fontWeight: FontWeight.w400, color: KasirColors.muted, fontSize: 12)),
                      if (sourceLabel != null) _sourcePill(sourceLabel),
                    ]),
                    ...notes,
                  ])),
                  const SizedBox(width: Space.sm),
                  Text(subtotalText, style: cellStyle.copyWith(fontWeight: FontWeight.w700)),
                  remove,
                ])),
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
            color: isActive ? (isDark ? activePill : primaryInk) : raised,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isActive ? primaryInk : lineColor,
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
                  color: isActive ? (isDark ? primaryInk : onPrimary) : ink,
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
                      color: isActive ? (isDark ? primaryInk : onPrimary) : muted,
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
