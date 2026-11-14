import 'package:flutter/material.dart';
import '../../state/kasir_keys.dart';
import '../../state/live_store.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../core/format.dart';
import '../../Widgets/ui.dart';
import '../Pairing/ScanScreen.dart';
import 'LiveItemSheet.dart';
import 'LiveCartPanel.dart';
import 'LivePaymentScreen.dart';
import 'kasir_style.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../services/barcode_burst.dart';
import '../../Widgets/keyboard_picker.dart';

/// The panels of the till that PageDown/PageUp walk between, in screen order.
enum KasirPanel { search, cart }

class LiveKasirScreen extends StatefulWidget {
  const LiveKasirScreen({super.key, required this.store, this.active = true});
  final LiveStore store;

  /// False while another menu is showing: the workspace keeps the till alive offstage,
  /// and its keyboard keys must not fire from there.
  final bool active;
  @override State<LiveKasirScreen> createState() => _LiveKasirScreenState();
}
class _LiveKasirScreenState extends State<LiveKasirScreen> {
  final search = TextEditingController();
  final searchFocus = FocusNode();

  /// "Jumlah", as on the desktop till: the next product added (clicked or scanned) goes
  /// in at this quantity, then it falls back to 1.
  final qty = TextEditingController(text: '1');
  final qtyFocus = FocusNode();
  final customerFocus = FocusNode();
  final discountFocus = FocusNode();
  final holdFocus = FocusNode();
  final clearFocus = FocusNode();

  /// The Keranjang heading button the arrows were last on, so coming back up from the cart lands there.
  late FocusNode rowLast = holdFocus;
  final scanner = BarcodeBurst();
  /// PageUp and PageDown hop between Jumlah and the search on the till (handled in
  /// handleKey); a text field must not also treat them as caret moves.
  static const _hopKeys = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.pageUp): DoNothingAndStopPropagationTextIntent(),
    SingleActivator(LogicalKeyboardKey.pageDown): DoNothingAndStopPropagationTextIntent(),
  };
  @override void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(handleKey);
  }
  @override void dispose() {
    HardwareKeyboard.instance.removeHandler(handleKey);
    search.dispose();
    searchFocus.dispose();
    qty.dispose();
    qtyFocus.dispose();
    customerFocus.dispose();
    discountFocus.dispose();
    holdFocus.dispose();
    clearFocus.dispose();
    super.dispose();
  }

  /// The quantity typed in Jumlah; a blank or unreadable entry means 1.
  num get enteredQty {
    try { final value = inputQty(qty.text.trim().isEmpty ? '1' : qty.text); return value > 0 ? value : 1; }
    catch (_) { return 1; }
  }

  void addOne(LiveProduct p, {LiveUnit? unit}) {
    final sold = unit ?? p.units.first;
    final isEditingSale = widget.store.editingSaleId != null;
    final currentPrice = sold.price;
    final existingLines = widget.store.items.where((i) => i.product.id == p.id && i.unit.id == sold.id).toList();

    try {
      if (isEditingSale && existingLines.isNotEmpty) {
        final samePriceLine = existingLines.where((i) => (i.manualPrice ?? i.unit.price) == currentPrice).firstOrNull;
        if (samePriceLine != null) {
          widget.store.put(LiveCartItem(
            product: p,
            unit: sold,
            quantity: samePriceLine.quantity + enteredQty,
            manualPrice: samePriceLine.manualPrice,
            discount: samePriceLine.discount,
            priceNote: samePriceLine.priceNote,
          ));
        } else {
          final histLine = existingLines.first;
          final histPrice = histLine.manualPrice ?? histLine.unit.price;
          final newLine = LiveCartItem(
            product: p,
            unit: sold,
            quantity: enteredQty,
            manualPrice: currentPrice,
            priceNote: 'Tambahan baru · harga katalog (${rupiah(currentPrice)})',
          );
          widget.store.put(newLine);
          showNotice(
            context,
            'Harga ${p.name} di katalog (${rupiah(currentPrice)}) berbeda dengan riwayat nota (${rupiah(histPrice)}). Tambahan otomatis dibuat di baris baru.',
            kind: NoticeKind.info,
          );
        }
      } else {
        final old = existingLines.isEmpty ? null : existingLines.first;
        widget.store.put(LiveCartItem(
          product: p,
          unit: sold,
          quantity: (old?.quantity ?? 0) + enteredQty,
          manualPrice: old?.manualPrice,
          discount: old?.discount,
          priceNote: old?.priceNote,
        ));
      }
      qty.value = const TextEditingValue(text: '1', selection: TextSelection.collapsed(offset: 1));
      HapticFeedback.lightImpact();
      SystemSound.play(SystemSoundType.click);
    } catch (e) {
      showError(context, e);
    }
  }
  /// The panel the keyboard is in: the cart while a line is selected, the search row otherwise.
  KasirPanel get currentPanel => widget.store.selectedCartIndex != null ? KasirPanel.cart : KasirPanel.search;

  /// PageDown/PageUp: the other panel. An empty cart is skipped.
  void switchPanel(int step) {
    final panels = [KasirPanel.search, if (widget.store.items.isNotEmpty) KasirPanel.cart];
    final from = panels.indexOf(currentPanel);
    enterPanel(panels[((from < 0 ? 0 : from) + step) % panels.length]);
  }

  void enterPanel(KasirPanel panel) {
    if (panel != KasirPanel.cart) widget.store.selectCartIndex(null);
    switch (panel) {
      case KasirPanel.search:
        searchFocus.requestFocus();
        search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length);
      case KasirPanel.cart:
        // the line takes focus itself once selected - see _CartLineState
        widget.store.selectCartIndex(0);
    }
  }

  void enterQty() {
    qtyFocus.requestFocus();
    qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length);
  }

  /// PageUp in the "Panah global" layout, as on the desktop till: Jumlah from anywhere, even while typing.
  void focusQty() {
    widget.store.selectCartIndex(null);
    enterQty();
  }

  /// Enter in Jumlah in the "Panah global" layout: the palette, with the search text as its query.
  Future<void> openPaletteFromQty() async {
    if (await openPalette(initialQuery: search.text.trim()) && mounted) search.clear();
  }

  /// The one product whose barcode or code is exactly [code]. A scanner burst is always a
  /// whole code, so [acceptSingle] also takes a lone result (a barcode the server found on a unit).
  Future<LiveProduct?> exactMatch(String code, {bool acceptSingle = false}) async {
    final rows = jsonRows(await widget.store.api.catalog(code, 1)).map(LiveProduct.fromJson).toList();
    final exact = rows.where((p) => p.barcode == code || p.code.toLowerCase() == code.toLowerCase()).toList();
    return exact.length == 1 ? exact.single : acceptSingle && rows.length == 1 ? rows.single : null;
  }

  /// Enter in the search box:
  /// - If empty: drops focus (blur) so the next 'End' shortcut pays without mouse, like the old desktop app
  /// - If exact barcode/code match: puts that product in the cart immediately
  /// - Otherwise: opens the product palette with the text typed
  bool _submitting = false;
  Future<void> submitSearch() async {
    if (_submitting) return;
    _submitting = true;
    try {
      final text = search.text.trim();
      if (text.isEmpty) {
        searchFocus.unfocus();
        return;
      }
      if (!widget.store.editable) return;
      final match = await exactMatch(text);
      if (!mounted) return;
      if (match != null) {
        addOne(match);
        search.clear();
        // the old till leaves focus nowhere after an add, so End pays next
        if (kasirKeys.isGlobalArrows) {
          searchFocus.unfocus();
        } else {
          searchFocus.requestFocus();
        }
      } else if (await openPalette(initialQuery: text)) {
        search.clear();
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      _submitting = false;
    }
  }
  /// F3: change the quantity of the line at the top of the cart, as on the desktop till.
  Future<void> editTopLine() async {
    if (widget.store.items.isEmpty || !widget.store.editable) return;
    final top = widget.store.items.first;
    final result = await editLiveItem(context, top.product, existing: top, onRemove: () => widget.store.remove(top));
    if (result == null || !mounted) return;
    try { widget.store.replace(top, result); } catch (e) { showError(context, e); }
  }

  /// The desktop till's keys, so a cashier moving to this app keeps their habits. Like the
  /// desktop they work anywhere in the window - but only while the till is the screen in
  /// front: not under a dialog or the payment screen, and not while another menu is showing.
  /// Keys that would type or move the caret (End, /) only act when no text field has focus.
  bool handleKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted || !widget.active || ModalRoute.of(context)?.isCurrent == false) return false;
    final typing = FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null;
    if (!typing) {
      final scan = scanner.feed(event);
      if (scan.code != null) { scanned(scan.code!); return true; }
    }
    final key = event.logicalKey;
    final alt = HardwareKeyboard.instance.isAltPressed;
    void Function()? action;
    if (key == LogicalKeyboardKey.pageDown || key == LogicalKeyboardKey.pageUp) {
      action = kasirKeys.isGlobalArrows
        ? (key == LogicalKeyboardKey.pageUp ? focusQty : () => enterPanel(KasirPanel.search))
        : () => switchPanel(key == LogicalKeyboardKey.pageDown ? 1 : -1);
    } else if (key == LogicalKeyboardKey.slash && !typing) {
      action = kasirKeys.isGlobalArrows ? () => enterPanel(KasirPanel.search) : () => openPalette();
    } else if (alt && key == LogicalKeyboardKey.keyP) {
      action = pickCustomer;
    } else if (key == LogicalKeyboardKey.f1 || key == LogicalKeyboardKey.f2) {
      action = () => enterPanel(KasirPanel.search);
    } else if (key == LogicalKeyboardKey.f4 || key == LogicalKeyboardKey.f12 || (key == LogicalKeyboardKey.end && !typing)) {
      action = pay;
    } else if (key == LogicalKeyboardKey.f3) {
      action = editTopLine;
    } else if (alt && key == LogicalKeyboardKey.keyH) {
      action = () {
        if (widget.store.items.isNotEmpty) {
          widget.store.newQueue();
          showNotice(context, 'Antrean baru dibuka. Transaksi sebelumnya tersimpan di tab.', kind: NoticeKind.info);
        } else if (widget.store.queues.length > 1) {
          final nextIdx = (widget.store.activeQueueIndex + 1) % widget.store.queues.length;
          widget.store.switchQueue(nextIdx);
          showNotice(context, 'Beralih ke ${widget.store.activeQueue.label}.', kind: NoticeKind.info);
        }
      };
    } else if (alt && key == LogicalKeyboardKey.keyT) {
      action = () {
        widget.store.newQueue();
        showNotice(context, 'Antrean baru dibuka.', kind: NoticeKind.info);
      };
    } else if (alt && key == LogicalKeyboardKey.keyK) {
      action = () => confirmClearCart(context, widget.store);
    }
    if (action == null) return false;
    action();
    return true;
  }

  /// A scanner fired while no text field had focus: find that exact code and put it in the
  /// cart, as the desktop till did, or say plainly that the shop does not carry it.
  Future<void> scanned(String code) async {
    if (!widget.store.editable) return;
    try {
      final match = await exactMatch(code, acceptSingle: true);
      if (!mounted) return;
      if (match == null) { showNotice(context, 'Barcode $code tidak ditemukan di katalog.', kind: NoticeKind.warning); return; }
      addOne(match);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  /// The desktop's product palette (/): every product in every unit it is sold in, with
  /// price and stock; the pick goes in at the Jumlah typed. True when something was picked.
  Future<bool> openPalette({String initialQuery = ''}) async {
    if (!widget.store.editable) return false;
    // unfocused first, so closing the palette (Esc or a pick) hands focus back to nothing and End pays next, as on the old till
    if (kasirKeys.isGlobalArrows) FocusManager.instance.primaryFocus?.unfocus();
    final picked = await showKeyboardPicker<(LiveProduct, LiveUnit)>(context,
      title: 'Cari barang', hint: 'Nama, kode, atau barcode', description: 'Masuk ke keranjang sebanyak ${quantityText(enteredQty)}',
      initialQuery: initialQuery,
      emptyText: 'Barang tidak ditemukan.',
      load: (q) async {
        final rows = jsonRows(await widget.store.api.catalog(q, 1)).map(LiveProduct.fromJson);
        return [
          for (final p in rows)
            for (final u in p.units)
              () {
                final unitStock = p.stock == null ? null : (u.conversionFactor > 1 ? (p.stock! / u.conversionFactor).floor() : p.stock!);
                return PickerOption((p, u),
                  title: '${p.name} · ${u.name}', subtitle: p.code,
                  trailing: (unitStock ?? 1) <= 0 ? 'Habis' : '${rupiah(u.price)} · stok ${quantityText(unitStock)}',
                  enabled: (unitStock ?? 1) > 0);
              }(),
        ];
      });
    if (picked == null || !mounted) return false;
    addOne(picked.$1, unit: picked.$2);
    return true;
  }

  /// The desktop's customer picker (Alt+P): an existing name or a new one; payment starts with it.
  Future<void> pickCustomer() async {
    final names = await widget.store.api.customers().catchError((Object _) => <String>[]);
    if (!mounted) return;
    final picked = await showKeyboardPicker<String>(context,
      title: 'Pilih pelanggan', hint: 'Cari atau ketik nama pelanggan baru',
      load: (q) async => [
        const PickerOption('', title: 'Umum', subtitle: 'tanpa nama pelanggan'),
        for (final n in names.where((n) => q.isEmpty || n.toLowerCase().contains(q.toLowerCase())).take(30)) PickerOption(n, title: n),
      ],
      extra: (q, results) => q.isEmpty || results.any((o) => o.value.toLowerCase() == q.toLowerCase()) ? null
        : PickerOption(q, title: 'Pelanggan baru: $q', subtitle: 'dicatat saat transaksi disimpan'));
    if (picked != null && mounted) widget.store.setCustomer(picked);
  }

  void pay() {
    if (!widget.store.canCheckout) return;
    openPayment(context, widget.store);
  }
  Future<void> scan() async {
    final value = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (!mounted || value == null) return;
    scanned(value);
  }
  OutlineInputBorder _border(Color color, [double width = 1]) =>
    OutlineInputBorder(borderRadius: BorderRadius.circular(Corners.control), borderSide: BorderSide(color: color, width: width));

  InputDecoration _fieldDecoration(String hint, {Widget? prefix, Widget? suffix, String? prefixText}) => InputDecoration(
    hintText: hint, hintStyle: TextStyle(color: KasirColors.muted), isDense: true, filled: true, fillColor: KasirColors.surface,
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    prefixText: prefixText, prefixStyle: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: KasirColors.ink),
    prefixIcon: prefix, prefixIconConstraints: const BoxConstraints(minWidth: 38),
    suffixIcon: suffix == null ? null : Padding(padding: const EdgeInsets.only(right: 8), child: suffix),
    suffixIconConstraints: const BoxConstraints(),
    border: _border(KasirColors.border), enabledBorder: _border(KasirColors.border), focusedBorder: _border(KasirColors.primary, 2),
  );

  /// Down in Jumlah or the search box goes to the Pelanggan box, the first stop below them.
  KeyEventResult enterCustomerOnArrowDown(KeyEvent event) {
    // Ctrl+arrow changes menu (MainScreen); focus must not move as well
    if (event.logicalKey != LogicalKeyboardKey.arrowDown || HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
    enterCustomer();
    return KeyEventResult.handled;
  }

  void enterCustomer() {
    widget.store.selectCartIndex(null);
    customerFocus.requestFocus();
  }

  /// The Diskon nota button is disabled on an empty or locked cart, and then cannot take focus.
  bool get discountEnabled => widget.store.items.isNotEmpty && widget.store.editable;

  void enterDiscount() {
    widget.store.selectCartIndex(null);
    discountFocus.requestFocus();
  }

  /// Same enabled rules as the Keranjang heading buttons: Antrean baru is absent while editing a sale.
  bool get holdEnabled => widget.store.editable && widget.store.editingSaleId == null;
  bool get clearEnabled => widget.store.items.isNotEmpty && widget.store.editable;

  /// Focuses a heading button, [preferred] if it is enabled, else the other one; false when both are disabled.
  bool enterRow(FocusNode preferred) {
    final other = identical(preferred, holdFocus) ? clearFocus : holdFocus;
    bool enabled(FocusNode node) => identical(node, holdFocus) ? holdEnabled : clearEnabled;
    final target = enabled(preferred) ? preferred : enabled(other) ? other : null;
    if (target == null) return false;
    widget.store.selectCartIndex(null);
    target.requestFocus();
    return true;
  }

  /// Down from Diskon nota (or Pelanggan when that is disabled): the heading row, else the first cart line.
  void enterBelowDiscount() {
    if (!enterRow(holdFocus) && widget.store.items.isNotEmpty) enterPanel(KasirPanel.cart);
  }

  /// Up from the first cart line (and Esc in it): the heading row in "Panah global", else Pelanggan.
  void exitCartTop() {
    if (kasirKeys.isGlobalArrows) {
      if (enterRow(rowLast)) return;
      if (discountEnabled) { enterDiscount(); return; }
    }
    enterCustomer();
  }

  /// Arrows on the focused Pelanggan box; Enter and Space open the picker through the InkWell.
  KeyEventResult customerKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || !kasirKeys.isGlobalArrows || HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown) {
      if (discountEnabled) {
        enterDiscount();
      } else {
        enterBelowDiscount();
      }
    } else if (key == LogicalKeyboardKey.arrowUp) {
      enterPanel(KasirPanel.search);
    } else if (key != LogicalKeyboardKey.arrowLeft && key != LogicalKeyboardKey.arrowRight) {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  /// Arrows on the focused Diskon nota button; Enter and Space open the dialog through the button itself.
  KeyEventResult discountKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || !kasirKeys.isGlobalArrows || HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.arrowDown) {
      enterBelowDiscount();
    } else if (key == LogicalKeyboardKey.arrowUp) {
      enterCustomer();
    } else if (key != LogicalKeyboardKey.arrowLeft && key != LogicalKeyboardKey.arrowRight) {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  /// Arrows on the Keranjang heading buttons; Enter and Space press the focused button itself.
  KeyEventResult cartRowKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || !kasirKeys.isGlobalArrows || HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
    final key = event.logicalKey;
    final onClear = clearFocus.hasFocus;
    rowLast = onClear ? clearFocus : holdFocus;
    if (key == LogicalKeyboardKey.arrowDown) {
      if (widget.store.items.isNotEmpty) enterPanel(KasirPanel.cart);
    } else if (key == LogicalKeyboardKey.arrowUp) {
      if (discountEnabled) {
        enterDiscount();
      } else {
        enterCustomer();
      }
    } else if (key == LogicalKeyboardKey.arrowRight) {
      if (!onClear && clearEnabled) clearFocus.requestFocus();
    } else if (key == LogicalKeyboardKey.arrowLeft) {
      if (onClear && holdEnabled) holdFocus.requestFocus();
    } else {
      return KeyEventResult.ignored;
    }
    return KeyEventResult.handled;
  }

  Widget _qtyField(double width, double height) => SizedBox(width: width, height: height, child: Focus(
    // Right at the end of Jumlah (or with it all selected) steps back to the search box
    onKeyEvent: (node, event) {
      if (event is! KeyDownEvent) return KeyEventResult.ignored;
      if (kasirKeys.isGlobalArrows) return enterCustomerOnArrowDown(event);
      if (event.logicalKey != LogicalKeyboardKey.arrowRight) return KeyEventResult.ignored;
      final atEnd = qty.selection.extentOffset >= qty.text.length || qty.selection.start == 0 && qty.selection.end == qty.text.length;
      if (!atEnd) return KeyEventResult.ignored;
      enterPanel(KasirPanel.search);
      return KeyEventResult.handled;
    },
    child: Semantics(label: 'Jumlah', child: TextField(controller: qty, focusNode: qtyFocus, textAlign: TextAlign.center, textAlignVertical: TextAlignVertical.center,
      keyboardType: const TextInputType.numberWithOptions(decimal: true), textInputAction: TextInputAction.next,
      style: amountStyle.copyWith(fontSize: 15, fontWeight: FontWeight.w600, color: KasirColors.ink),
      // Enter in Jumlah goes on to the search, ready for the scan or the name; "Panah global" opens the palette instead
      onSubmitted: (_) {
        if (kasirKeys.isGlobalArrows) { openPaletteFromQty(); return; }
        searchFocus.requestFocus();
        search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length);
      },
      onTap: () => qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length),
      decoration: _fieldDecoration('1', prefixText: '× ')))));

  /// The search box. On a phone it only opens the palette: there is no catalog list to filter.
  Widget _searchField({required bool phone}) => SizedBox(height: phone ? 42 : 38, child: Focus(
    onKeyEvent: (node, event) {
      if (event is! KeyDownEvent) return KeyEventResult.ignored;
      if (kasirKeys.isGlobalArrows) {
        if (enterCustomerOnArrowDown(event) == KeyEventResult.handled) return KeyEventResult.handled;
      } else if (event.logicalKey == LogicalKeyboardKey.arrowLeft && search.selection.isCollapsed && search.selection.baseOffset <= 0) {
        // Left at the start of the search box steps over to Jumlah, in the same panel
        enterQty();
        return KeyEventResult.handled;
      }
      if (event.logicalKey == LogicalKeyboardKey.slash && search.text.isEmpty && !kasirKeys.isGlobalArrows) {
        openPalette();
        return KeyEventResult.handled;
      }
      if (event.logicalKey == LogicalKeyboardKey.enter || event.logicalKey == LogicalKeyboardKey.numpadEnter) {
        submitSearch();
        return KeyEventResult.handled;
      }
      if (event.logicalKey == LogicalKeyboardKey.escape) {
        search.clear();
        searchFocus.unfocus();
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    },
    child: TextField(controller: search, focusNode: searchFocus, textInputAction: TextInputAction.search, textAlignVertical: TextAlignVertical.center,
      readOnly: phone, onTap: phone ? openPalette : null, autofocus: isDesktop, onSubmitted: (_) => submitSearch(),
      style: TextStyle(fontSize: 14, color: KasirColors.ink),
      decoration: _fieldDecoration(phone ? 'Cari barang…' : 'Cari nama / kode / barcode',
        prefix: Icon(Icons.search, size: 20, color: KasirColors.muted), suffix: phone ? null : const KasirKey('/'))),
  ));

  /// A bordered box with a small label over its value, an icon tile at the left; tappable when [onTap] is given.
  /// With [flat] it is a cell of a larger card: no border of its own, a hover wash, and the focus ring drawn inset.
  Widget _infoBox(String label, String value, IconData icon, {required double height, Widget? trailing, VoidCallback? onTap, FocusNode? focusNode, FocusOnKeyEventCallback? onKeyEvent, bool flat = false}) => Focus(
    canRequestFocus: false, skipTraversal: true, onKeyEvent: onKeyEvent,
    child: Builder(builder: (context) => Material(
    color: flat ? Colors.transparent : KasirColors.surface,
    shape: flat ? null : RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: Focus.of(context).hasFocus ? BorderSide(color: KasirColors.primary, width: 2) : BorderSide(color: KasirColors.border)),
    clipBehavior: Clip.antiAlias,
    child: InkWell(onTap: onTap, focusNode: focusNode, hoverColor: flat ? raised : null, child: Container(
      height: height,
      foregroundDecoration: flat && Focus.of(context).hasFocus ? BoxDecoration(border: Border.all(color: KasirColors.primary, width: 2)) : null,
      padding: EdgeInsets.symmetric(horizontal: flat ? 16 : 12), child: Row(children: [
      Container(
        width: 32, height: 32,
        decoration: BoxDecoration(color: KasirColors.tint, borderRadius: BorderRadius.circular(8)),
        child: Icon(icon, size: 18, color: KasirColors.primary),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: KasirColors.label)),
        Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: KasirColors.ink)),
      ])),
      if (trailing != null) trailing,
    ]))),
  )));

  /// Out of the arrow path: End, F4/F12 and a click still pay.
  Widget _payButton(double height, {required bool withKey}) => Focus(canRequestFocus: false, descendantsAreFocusable: false, child: KasirActionButton(
    height: height,
    onPressed: widget.store.canCheckout ? pay : null,
    child: Row(mainAxisSize: MainAxisSize.min, children: [
      Text(widget.store.editingSaleId == null ? 'Bayar' : 'Simpan Perubahan', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
      if (withKey) ...[
        const SizedBox(width: 10),
        // a white wash would drop the onPrimary text under 4.5:1 on the light button, so light mode darkens instead
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
          decoration: BoxDecoration(color: isDark ? Colors.white.withValues(alpha: 0.2) : Colors.black.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(5)),
          child: Text('End', style: TextStyle(fontFamily: monoFamily, fontSize: 11, fontWeight: FontWeight.w600, color: KasirColors.onPrimary)),
        ),
      ],
    ]),
  ));

  /// The nota discount: a small input-like button that opens the discount dialog.
  Widget _discountButton({required bool compact}) {
    final store = widget.store;
    final label = compact
      ? (store.discount == 0 ? 'Diskon nota' : 'Diskon nota −${rupiah(store.discount)}')
      : (store.discount == 0 ? '0 atau 10%' : '−${rupiah(store.discount)}');
    Widget button(bool ringed) => OutlinedButton.icon(
      focusNode: compact ? null : discountFocus,
      onPressed: discountEnabled ? () => showCartDiscount(context, store) : null,
      style: OutlinedButton.styleFrom(
        foregroundColor: store.discount == 0 && !compact ? KasirColors.muted : KasirColors.ink,
        side: ringed ? BorderSide(color: KasirColors.primary, width: 2) : BorderSide(color: KasirColors.border), minimumSize: Size(compact ? 0 : 128, compact ? 40 : 32),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
      ),
      icon: const Icon(Icons.sell_outlined, size: 16),
      label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
    );
    if (compact) return button(false);
    return Focus(canRequestFocus: false, skipTraversal: true, onKeyEvent: discountKey,
      child: Builder(builder: (context) => button(Focus.of(context).hasFocus)));
  }

  /// Pricing progress and the retry when the PC could not price the cart.
  Widget _priceStatus() => Column(mainAxisSize: MainAxisSize.min, children: [
    if (widget.store.pricing) const LinearProgressIndicator(minHeight: 2),
    if (widget.store.priceError != null) TextButton(onPressed: widget.store.reprice, child: const Text('Coba hitung harga lagi')),
  ]);

  /// A right-aligned figure row of the total panel: label, then the value in a fixed column.
  Widget _sumRow(String label, Widget value) => Padding(padding: const EdgeInsets.only(bottom: 4), child: Row(children: [
    Expanded(child: Text(label, textAlign: TextAlign.end, style: TextStyle(fontSize: 12, color: KasirColors.label))),
    const SizedBox(width: 8),
    SizedBox(width: 128, child: value),
  ]));

  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) => LayoutBuilder(builder: (context, box) {
    final wide = usesSplitCart(context, box);
    final store = widget.store;
    final totalText = store.items.isEmpty ? rupiah(0) : rupiah(store.price?.total);
    final editing = widget.store.editingSaleId;
    final editBanner = editing == null ? null : Container(
      padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.sm, Space.sm),
      decoration: BoxDecoration(color: pillWarningBg, border: Border.all(color: noticeBorder), borderRadius: BorderRadius.circular(Corners.panel)),
      child: Row(children: [
        Icon(Icons.edit_note, size: 18, color: pillWarningInk), const SizedBox(width: Space.sm),
        Expanded(child: Text('Mengubah nota #$editing', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: pillWarningInk, fontSize: 13, fontWeight: FontWeight.w600))),
        OutlinedButton.icon(
          onPressed: () {
            widget.store.api.printSale(editing).then((res) {
              if (mounted) showNotice(context, 'Struk #$editing dikirim ke printer PC.', kind: NoticeKind.success);
            }).catchError((e) {
              if (mounted) showError(context, e);
            });
          },
          icon: const Icon(Icons.print_outlined, size: 15),
          label: const Text('Cetak Nota'),
          style: OutlinedButton.styleFrom(
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
            minimumSize: const Size(0, 28),
          ),
        ),
        const SizedBox(width: Space.sm),
        TextButton(onPressed: widget.store.editable ? widget.store.cancelEdit : null, child: const Text('Batal ubah')),
      ]));
    final cart = LiveCartPanel(store: store, onExitTop: exitCartTop, inCard: wide, holdFocus: holdFocus, clearFocus: clearFocus, onRowKey: cartRowKey);
    final customer = store.customerName.isEmpty ? 'Umum' : store.customerName;
    if (!wide) {
      return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: ColoredBox(color: KasirColors.surface, child: Column(children: [
        if (editBanner != null) Padding(padding: const EdgeInsets.fromLTRB(Space.md, Space.md, Space.md, 0), child: editBanner),
        Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 8), child: Row(children: [
          _qtyField(58, 42), const SizedBox(width: Space.sm),
          Expanded(child: _searchField(phone: true)), const SizedBox(width: Space.sm),
          KasirActionButton(onPressed: scan, tooltip: 'Scan barcode', height: 42, width: 42, child: const Icon(Icons.qr_code_scanner, size: 22)),
        ])),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: _infoBox('Pelanggan', customer, Icons.person_outline, height: 54,
          trailing: Icon(Icons.keyboard_arrow_down, color: KasirColors.muted), onTap: store.editable ? pickCustomer : null)),
        Expanded(child: SingleChildScrollView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 16), child: cart)),
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          decoration: BoxDecoration(
            color: KasirColors.tint,
            border: Border(top: BorderSide(color: KasirColors.tint2)),
          ),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _priceStatus(),
            Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('TOTAL', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1, color: KasirColors.primary)),
                FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(totalText, style: moneyStyle.copyWith(fontSize: 28, color: KasirColors.ink))),
              ])),
              const SizedBox(width: Space.sm),
              _discountButton(compact: true),
            ]),
            const SizedBox(height: 10),
            _payButton(54, withKey: false),
          ]),
        ),
      ]))));
    }
    final price = store.price;
    final itemDiscount = price?.lineDiscountTotal ?? 0;
    final grossSubtotal = price == null ? 0 : price.subtotal + itemDiscount;
    final totalQty = store.items.fold<num>(0, (sum, item) => sum + item.quantity);
    final saleAt = store.saleDate ?? DateTime.now();
    final strip = ListenableBuilder(listenable: kasirKeys, builder: (context, _) => Container(
      constraints: const BoxConstraints(minHeight: 36),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      color: KasirColors.accent,
      child: Wrap(spacing: 20, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        for (final (key, label) in kasirKeys.isGlobalArrows
          ? [('/', 'cari'), ('PgUp', 'jumlah'), ('PgDn', 'cari'), ('End', 'bayar'), ('F3', 'ubah qty baris 1'), ('Alt+P', 'pelanggan'), ('Alt+K', 'kosongkan'), ('↑↓', 'pelanggan/diskon/antrean/keranjang')]
          : [('/', 'cari barang'), ('F2', 'kotak cari'), ('End', 'bayar'), ('PgUp/PgDn', 'pindah panel'),
            ('F3', 'ubah baris atas'), ('Alt+P', 'pelanggan'), ('Alt+K', 'kosongkan'), ('Alt+T', 'antrean baru')])
          Row(mainAxisSize: MainAxisSize.min, children: [KasirKey(key), const SizedBox(width: 6), Text(label, style: TextStyle(fontSize: 12, color: KasirColors.label))]),
      ]),
    ));
    // the till is driven from the keyboard on a PC - see handleKey
    return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: SizedBox.expand(child: ColoredBox(color: KasirColors.surface, child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      // the whole page is one card split by hairlines, like the dashboard money panel
      child: Container(
          decoration: BoxDecoration(
            color: KasirColors.surface,
            border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel), boxShadow: KasirColors.softShadow,
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Padding(padding: const EdgeInsets.fromLTRB(20, 16, 20, 16), child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              Expanded(child: Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
                Flexible(child: Text(editing == null ? 'Kasir' : 'Kasir · Ubah nota #$editing', maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: KasirColors.ink))),
                const SizedBox(width: 12),
                Text(store.activeQueue.label, style: TextStyle(fontSize: 12, color: KasirColors.muted)),
              ])),
              Text('Jumlah', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: KasirColors.label)), const SizedBox(width: Space.sm),
              _qtyField(68, 38), const SizedBox(width: Space.sm),
              SizedBox(width: 300, child: _searchField(phone: false)),
            ])),
            if (editBanner != null) Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 16), child: editBanner),
            Container(height: 1, color: lineColor),
            SizedBox(height: 64, child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Expanded(child: _infoBox('Pelanggan', customer, Icons.person_outline, height: 64, flat: true,
                trailing: const KasirKey('Alt+P'), onTap: store.editable ? pickCustomer : null, focusNode: customerFocus, onKeyEvent: customerKey)),
              Container(width: 1, color: lineColor),
              Expanded(child: _infoBox('Tanggal & Jam', '${dateText(saleAt)} · ${timeText(saleAt)}', Icons.calendar_today_outlined, height: 64, flat: true)),
            ])),
            Container(height: 1, color: lineColor),
            Container(color: KasirColors.tint, child: Stack(children: [
            Positioned(left: 0, top: 20, width: 4, height: 70, child: ColoredBox(color: KasirColors.primary)),
            Padding(padding: const EdgeInsets.fromLTRB(24, 20, 24, 20), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              _priceStatus(),
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('TOTAL', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1, color: KasirColors.primary)),
                  Text(totalText, style: moneyStyle.copyWith(fontSize: 34, color: KasirColors.ink)),
                  Text('${store.items.length} barang · ${quantityText(totalQty)} qty', style: TextStyle(fontSize: 12, color: KasirColors.label)),
                ])),
                SizedBox(width: 340, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  _sumRow('Subtotal', Text(store.items.isEmpty ? rupiah(0) : rupiah(grossSubtotal), textAlign: TextAlign.end, style: amountStyle.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: KasirColors.ink))),
                  if (itemDiscount > 0) _sumRow('Diskon item', Text('−${rupiah(itemDiscount)}', textAlign: TextAlign.end, style: amountStyle.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: KasirColors.destructive))),
                  _sumRow('Diskon nota', _discountButton(compact: false)),
                ])),
              ]),
              const SizedBox(height: 12),
              _payButton(56, withKey: true),
            ])),
          ])),
            Container(height: 1, color: lineColor),
            cart,
            Container(height: 1, color: lineColor),
            strip,
          ]),
        ),
    )))));
  }));
}
