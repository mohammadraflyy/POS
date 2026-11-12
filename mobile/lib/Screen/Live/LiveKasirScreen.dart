import 'dart:async';
import 'package:flutter/material.dart';
import '../../state/live_store.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../Widgets/product_row.dart';
import '../Pairing/ScanScreen.dart';
import 'LiveItemSheet.dart';
import 'LiveCartPanel.dart';
import 'LivePaymentScreen.dart';
import 'package:flutter/services.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../services/barcode_burst.dart';
import '../../Widgets/keyboard_picker.dart';

class CatalogLine {
  const CatalogLine(this.product, this.unit);
  final LiveProduct product;
  final LiveUnit unit;

  String get displayName => unit.conversionFactor > 1 ? '${product.name} (${unit.name})' : product.name;
  num? get stock {
    if (product.stock == null) return null;
    final conv = unit.conversionFactor;
    return conv > 1 ? (product.stock! / conv) : product.stock;
  }
}

/// The three panels of the till that PageDown/PageUp walk between, in screen order.
enum KasirPanel { search, catalog, cart }

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

  List<CatalogLine> get catalogLines {
    final list = <CatalogLine>[];
    for (final p in products) {
      for (final u in p.units) {
        list.add(CatalogLine(p, u));
      }
    }
    return list;
  }

  /// "Jumlah", as on the desktop till: the next product added (clicked or scanned) goes
  /// in at this quantity, then it falls back to 1.
  final qty = TextEditingController(text: '1');
  final qtyFocus = FocusNode();
  final scanner = BarcodeBurst();
  /// PageUp and PageDown hop between Jumlah and the search on the till (handled in
  /// handleKey); a text field must not also treat them as caret moves.
  static const _hopKeys = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.pageUp): DoNothingAndStopPropagationTextIntent(),
    SingleActivator(LogicalKeyboardKey.pageDown): DoNothingAndStopPropagationTextIntent(),
  };
  Timer? timer;
  List<LiveProduct> products = [];
  int selectedIndex = 0;
  final catalogScroll = ScrollController();
  final selectedRowKey = GlobalKey();
  /// The catalog holds focus while the arrows walk it. Merely unfocusing the search box
  /// leaves focus nowhere in particular, and Flutter's own arrow traversal then hops the
  /// next press over to the cart.
  final catalogFocus = FocusNode(debugLabel: 'catalog', skipTraversal: true);
  bool loading = true;
  String? error;
  int page = 1, lastPage = 1, serial = 0, seenCatalogRevision = 0;
  @override void initState() {
    super.initState();
    seenCatalogRevision = widget.store.catalogRevision;
    widget.store.addListener(watchStock);
    searchFocus.addListener(_onFocusChange);
    qtyFocus.addListener(_onFocusChange);
    HardwareKeyboard.instance.addHandler(handleKey);
    load();
  }
  void _onFocusChange() { if (mounted) setState(() {}); }
  void watchStock() { if (mounted && seenCatalogRevision != widget.store.catalogRevision) { seenCatalogRevision = widget.store.catalogRevision; load(target: page); } }
  @override void dispose() {
    HardwareKeyboard.instance.removeHandler(handleKey);
    widget.store.removeListener(watchStock);
    searchFocus.removeListener(_onFocusChange);
    qtyFocus.removeListener(_onFocusChange);
    timer?.cancel();
    search.dispose();
    searchFocus.dispose();
    qty.dispose();
    qtyFocus.dispose();
    catalogScroll.dispose();
    catalogFocus.dispose();
    super.dispose();
  }

  bool get isOutsideCatalog {
    final primary = FocusManager.instance.primaryFocus;
    final context = primary?.context;
    if (context != null) {
      if (context.findAncestorWidgetOfExactType<SidebarArea>() != null) return true;
      if (context.findAncestorWidgetOfExactType<HeaderArea>() != null) return true;
      if (context.findAncestorWidgetOfExactType<LiveCartPanel>() != null) return true;
      if (context.findAncestorWidgetOfExactType<EditableText>() != null) return true;
    }
    if (searchFocus.hasFocus || qtyFocus.hasFocus) return true;
    return false;
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
  /// The panel the keyboard is in. Exactly one at a time: the cart while a line is selected,
  /// the catalog while it holds focus, the search row otherwise.
  KasirPanel get currentPanel => widget.store.selectedCartIndex != null
      ? KasirPanel.cart
      : catalogFocus.hasFocus ? KasirPanel.catalog : KasirPanel.search;

  /// PageDown/PageUp: next or previous panel, wrapping round. An empty cart is skipped.
  void switchPanel(int step) {
    final panels = [KasirPanel.search, KasirPanel.catalog, if (widget.store.items.isNotEmpty) KasirPanel.cart];
    final from = panels.indexOf(currentPanel);
    enterPanel(panels[((from < 0 ? 0 : from) + step) % panels.length]);
  }

  void enterPanel(KasirPanel panel) {
    if (panel != KasirPanel.cart) widget.store.selectCartIndex(null);
    switch (panel) {
      case KasirPanel.search:
        searchFocus.requestFocus();
        search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length);
      case KasirPanel.catalog:
        catalogFocus.requestFocus();
        moveSelection(0);
      case KasirPanel.cart:
        // the line takes focus itself once selected - see _CartLineState
        widget.store.selectCartIndex(0);
    }
  }

  void moveSelection(int delta) {
    final lines = catalogLines;
    if (lines.isEmpty) return;
    setState(() {
      selectedIndex = (selectedIndex + delta).clamp(0, lines.length - 1);
    });
    // scroll by the row's real size: rows grow with text scale and the second line,
    // so a fixed row height drifts further off the more rows it counts
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final row = selectedRowKey.currentContext;
      if (row == null || !mounted) return;
      Scrollable.ensureVisible(row, duration: Duration.zero, alignmentPolicy: delta > 0
          ? ScrollPositionAlignmentPolicy.keepVisibleAtEnd
          : ScrollPositionAlignmentPolicy.keepVisibleAtStart);
    });
  }

  void pickSelected() {
    final lines = catalogLines;
    if (lines.isEmpty || !widget.store.editable) return;
    final idx = selectedIndex.clamp(0, lines.length - 1);
    final line = lines[idx];
    addOne(line.product, unit: line.unit);
  }

  /// Enter in the search box:
  /// - If empty: drops focus (blur) so the next 'End' shortcut pays without mouse, like the old desktop app
  /// - If exact barcode/code match: puts that product in the cart immediately
  /// - If results exist: picks the currently selected/highlighted product
  bool _submitting = false;

  /// - If nothing found: opens the product palette dialog
  Future<void> submitSearch() async {
    if (_submitting) return;
    _submitting = true;
    try {
      timer?.cancel();
      final text = search.text.trim();
      if (text.isEmpty) {
        searchFocus.unfocus();
        return;
      }
      if (loading) await load();
      if (!mounted || !widget.store.editable) return;

      final exact = products.where((p) => p.barcode == text || p.code.toLowerCase() == text.toLowerCase()).toList();
      if (exact.length == 1) {
        addOne(exact.single);
        search.clear();
        searchFocus.requestFocus();
        setState(() => selectedIndex = 0);
        return;
      }

      openPalette(initialQuery: text);
    } finally {
      _submitting = false;
    }
  }
  /// F3: change the quantity of the line at the top of the cart, as on the desktop till.
  Future<void> editTopLine() async {
    if (widget.store.items.isEmpty || !widget.store.editable) return;
    final top = widget.store.items.first;
    final result = await editLiveItem(context, top.product, existing: top);
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
      action = () => switchPanel(key == LogicalKeyboardKey.pageDown ? 1 : -1);
    } else if (key == LogicalKeyboardKey.slash && !typing) {
      action = () => openPalette();
    } else if (alt && key == LogicalKeyboardKey.keyP) {
      action = pickCustomer;
    } else if (key == LogicalKeyboardKey.f1 || key == LogicalKeyboardKey.f2) {
      action = () => enterPanel(KasirPanel.search);
    } else if (key == LogicalKeyboardKey.f4 || key == LogicalKeyboardKey.f12 || (key == LogicalKeyboardKey.end && !typing)) {
      action = pay;
    } else if (key == LogicalKeyboardKey.f3) {
      action = editTopLine;
    } else if (key == LogicalKeyboardKey.enter) {
      final primaryCtx = FocusManager.instance.primaryFocus?.context;
      if (primaryCtx != null && (primaryCtx.findAncestorWidgetOfExactType<SidebarArea>() != null || primaryCtx.findAncestorWidgetOfExactType<HeaderArea>() != null)) {
        return false;
      }
      // the catalog's own Focus takes Enter while it holds focus - this is for focus resting nowhere
      if (!isOutsideCatalog && !catalogFocus.hasFocus) {
        action = pickSelected;
      }
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
    search.text = code;
    await load();
    if (!mounted) return;
    final exact = products.where((p) => p.barcode == code || p.code.toLowerCase() == code.toLowerCase()).toList();
    final match = exact.length == 1 ? exact.single : products.length == 1 ? products.single : null;
    if (match == null) { showNotice(context, 'Barcode $code tidak ditemukan di katalog.', kind: NoticeKind.warning); return; }
    addOne(match);
    search.clear();
    await load();
  }

  /// The desktop's product palette (/): every product in every unit it is sold in, with
  /// price and stock; the pick goes in at the Jumlah typed.
  Future<void> openPalette({String initialQuery = ''}) async {
    if (!widget.store.editable) return;
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
    if (picked == null || !mounted) return;
    addOne(picked.$1, unit: picked.$2);
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
  Future<void> load({int target = 1}) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.store.api.catalog(search.text.trim(), target);
      final rows = jsonRows(data).map(LiveProduct.fromJson).toList();
      if (!mounted || request != serial) return;
      setState(() {
        products = rows;
        page = (number(data['currentPage']) ?? target).toInt();
        lastPage = (number(data['lastPage']) ?? target).toInt();
        final totalLines = catalogLines.length;
        selectedIndex = totalLines == 0 ? 0 : selectedIndex.clamp(0, totalLines - 1);
      });
    } catch (e) { if (mounted && request == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }
  Future<void> configure(LiveProduct p) async {
    final item = await editLiveItem(context, p, defaultQuantity: enteredQty);
    if (!mounted || item == null) return;
    try { widget.store.put(item); } catch (e) { showError(context, e); }
  }
  Future<void> scan() async {
    final value = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (!mounted || value == null) return;
    search.text = value; await load();
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: Listenable.merge([widget.store, widget.store.guard]), builder: (context, _) => LayoutBuilder(builder: (context, box) {
    final wide = usesSplitCart(context, box);
    final searchRow = Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark ? raised : const Color(0xFFF8FAFC),
        border: Border.all(color: lineColor),
        borderRadius: BorderRadius.circular(Corners.control),
      ),
      child: Row(children: [
        SizedBox(width: 88, child: Focus(
          // Right at the end of Jumlah (or with it all selected) steps back to the search box
          onKeyEvent: (node, event) {
            if (event is! KeyDownEvent || event.logicalKey != LogicalKeyboardKey.arrowRight) return KeyEventResult.ignored;
            final atEnd = qty.selection.extentOffset >= qty.text.length || qty.selection.start == 0 && qty.selection.end == qty.text.length;
            if (!atEnd) return KeyEventResult.ignored;
            enterPanel(KasirPanel.search);
            return KeyEventResult.handled;
          },
          child: TextField(controller: qty, focusNode: qtyFocus, textAlign: TextAlign.end,
          keyboardType: const TextInputType.numberWithOptions(decimal: true), textInputAction: TextInputAction.next,
          style: amountStyle.copyWith(fontSize: 16),
          // Enter in Jumlah goes on to the search, ready for the scan or the name
          onSubmitted: (_) { searchFocus.requestFocus(); search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length); },
          onTap: () => qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length),
          decoration: const InputDecoration(prefixText: '× ', hintText: '1', helperText: null, labelText: 'Jumlah')))),
        const SizedBox(width: Space.sm),
        Expanded(child: Focus(
          onKeyEvent: (node, event) {
            if (event is! KeyDownEvent) return KeyEventResult.ignored;
            // Left at the start of the search box steps over to Jumlah, in the same panel
            if (event.logicalKey == LogicalKeyboardKey.arrowLeft && search.selection.isCollapsed && search.selection.baseOffset <= 0) {
              qtyFocus.requestFocus();
              qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length);
              return KeyEventResult.handled;
            }
            if (event.logicalKey == LogicalKeyboardKey.slash && search.text.isEmpty) {
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
          child: TextField(controller: search, textInputAction: TextInputAction.search, onChanged: (_) {
            serial++; timer?.cancel(); setState(() { loading = true; error = null; selectedIndex = 0; });
            timer = Timer(const Duration(milliseconds: 350), () => load());
          }, focusNode: searchFocus, autofocus: isDesktop, onSubmitted: (_) => submitSearch(),
            decoration: InputDecoration(hintText: isDesktop ? 'Cari nama, kode, atau scan barcode' : 'Cari barang', prefixIcon: const Icon(Icons.search, size: 20))),
        )),
        const SizedBox(width: Space.xs),
        IconButton.filled(
          onPressed: scan,
          tooltip: 'Scan barcode',
          icon: const Icon(Icons.qr_code_scanner, size: 20),
          style: IconButton.styleFrom(
            backgroundColor: primaryInk,
            foregroundColor: onPrimary,
            minimumSize: const Size(40, 40),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Corners.control)),
          ),
        ),
        const SizedBox(width: Space.xs),
        IconButton(onPressed: () => load(target: page), tooltip: 'Muat ulang katalog', icon: const Icon(Icons.refresh, size: 20)),
      ]),
    );
    final keys = isDesktop && wide ? Padding(padding: EdgeInsets.only(top: Space.sm), child: Text('PageDown/PageUp pindah panel · ↑↓ pilih · Ctrl+↑↓ ganti menu · Enter ambil · ← jumlah · / palet barang · Alt+P pelanggan · End bayar · F3 ubah baris atas · Alt+H antrean · Alt+T antrean baru · Alt+K kosongkan',
      style: TextStyle(color: muted, fontSize: 12))) : const SizedBox.shrink();
    final queueTabs = widget.store.queues.length > 1 ? Container(
      padding: const EdgeInsets.fromLTRB(Space.lg, Space.xs, Space.sm, Space.xs),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (var i = 0; i < widget.store.queues.length; i++) ...[
              ActionChip(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 4),
                backgroundColor: i == widget.store.activeQueueIndex
                    ? (Theme.of(context).brightness == Brightness.dark ? const Color(0xFF1E293B) : const Color(0xFF0F172A))
                    : surface,
                side: BorderSide(
                  color: i == widget.store.activeQueueIndex
                      ? (Theme.of(context).brightness == Brightness.dark ? const Color(0xFF38BDF8) : const Color(0xFF0F172A))
                      : lineColor,
                  width: i == widget.store.activeQueueIndex ? 1.5 : 1,
                ),
                label: Text(
                  widget.store.queues[i].label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: i == widget.store.activeQueueIndex ? FontWeight.bold : FontWeight.w500,
                    color: i == widget.store.activeQueueIndex
                        ? (Theme.of(context).brightness == Brightness.dark ? const Color(0xFF38BDF8) : Colors.white)
                        : ink,
                  ),
                ),
                onPressed: () => widget.store.switchQueue(i),
              ),
              const SizedBox(width: 6),
            ],
            IconButton(
              tooltip: 'Tambah antrean baru (Alt+T)',
              icon: const Icon(Icons.add, size: 18),
              style: IconButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.all(4),
                minimumSize: const Size(28, 28),
              ),
              onPressed: widget.store.editable ? () => widget.store.newQueue() : null,
            ),
          ],
        ),
      ),
    ) : null;
    final lines = catalogLines;
    final list = CustomScrollView(controller: catalogScroll, slivers: [
      if (loading) const SliverToBoxAdapter(child: LinearProgressIndicator(minHeight: 2)),
      if (error != null) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(Space.lg), child: EmptyPanel(icon: Icons.wifi_off, title: 'Katalog belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi')))))
      else if (lines.isEmpty && !loading) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(Space.lg), child: Text('Tidak ada barang yang cocok. Coba kata lain atau scan barcodenya.', style: TextStyle(color: muted))))
      else SliverList(delegate: SliverChildBuilderDelegate((context, index) {
        final line = lines[index];
        return KeyedSubtree(key: index == selectedIndex ? selectedRowKey : null, child: ProductRow(
          name: line.displayName,
          code: line.unit.conversionFactor > 1 ? '${line.product.code} · ${line.unit.name}' : line.product.code,
          stock: line.stock == null ? '-' : quantityText(line.stock),
          price: rupiah(line.unit.price),
          unit: line.unit.name,
          inCart: widget.store.items.any((item) => item.product.id == line.product.id && item.unit.id == line.unit.id),
          // only while the arrows are in the catalog, so no stale mark while typing or in the cart
          selected: isDesktop && catalogFocus.hasFocus && index == selectedIndex,
          onConfigure: widget.store.editable ? () {
            searchFocus.unfocus();
            qtyFocus.unfocus();
            setState(() => selectedIndex = index);
            if (isDesktop) {
              addOne(line.product, unit: line.unit);
            } else {
              configure(line.product);
            }
          } : null,
          onAdd: !widget.store.editable ? null : () {
            searchFocus.unfocus();
            qtyFocus.unfocus();
            setState(() => selectedIndex = index);
            addOne(line.product, unit: line.unit);
          },
        ));
      }, childCount: lines.length)),
      if (lastPage > 1) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md), child: Row(children: [
        Text('Halaman $page dari $lastPage', style: TextStyle(color: muted, fontSize: 13)),
        const Spacer(),
        OutlinedButton(onPressed: !loading && page > 1 ? () => load(target: page - 1) : null, child: const Text('Sebelumnya')),
        const SizedBox(width: Space.sm), OutlinedButton(onPressed: !loading && page < lastPage ? () => load(target: page + 1) : null, child: const Text('Berikutnya')),
      ]))),
    ]);
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
    final catalogWidget = Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.arrowUp): DoNothingAndStopPropagationTextIntent(),
        SingleActivator(LogicalKeyboardKey.arrowDown): DoNothingAndStopPropagationTextIntent(),
      },
      child: Focus(focusNode: catalogFocus, onFocusChange: (_) => setState(() {}), onKeyEvent: (node, event) {
        if (event is! KeyDownEvent && event is! KeyRepeatEvent) return KeyEventResult.ignored;
        // Ctrl+arrow changes menu (MainScreen); the catalog must not step as well
        if (HardwareKeyboard.instance.isControlPressed) return KeyEventResult.ignored;
        final key = event.logicalKey;
        // arrows stay inside the catalog, the edges included; PageDown/PageUp change panel
        if (key == LogicalKeyboardKey.arrowDown) { moveSelection(1); return KeyEventResult.handled; }
        if (key == LogicalKeyboardKey.arrowUp) { moveSelection(-1); return KeyEventResult.handled; }
        if (key == LogicalKeyboardKey.home) { moveSelection(-selectedIndex); return KeyEventResult.handled; }
        if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.arrowRight) return KeyEventResult.handled;
        if (key == LogicalKeyboardKey.enter || key == LogicalKeyboardKey.numpadEnter) {
          if (event is KeyDownEvent) pickSelected();
          return KeyEventResult.handled;
        }
        if (key == LogicalKeyboardKey.escape) { enterPanel(KasirPanel.search); return KeyEventResult.handled; }
        return KeyEventResult.ignored;
      }, child: list),
    );
    if (!wide) {
      return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: Column(children: [
        if (editBanner != null) Padding(padding: const EdgeInsets.fromLTRB(Space.md, Space.md, Space.md, 0), child: editBanner),
        if (queueTabs != null) queueTabs,
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.sm, Space.md), child: searchRow),
        const Divider(),
        Expanded(child: ColoredBox(color: surface, child: catalogWidget)),
        CartAction(count: widget.store.items.length,
          total: widget.store.pricing ? 'Menghitung…' : rupiah(widget.store.price?.total ?? 0),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Scaffold(
            appBar: AppBar(title: const Text('Keranjang')), body: SafeArea(child: Padding(padding: const EdgeInsets.all(Space.md), child: LiveCartPanel(store: widget.store))))))),
      ])));
    }
    // the catalog and the cart are two cards on one frame, so their edges line up
    final catalog = Container(
      decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.md, Space.md), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (editBanner != null) ...[editBanner, const SizedBox(height: Space.md)],
          if (queueTabs != null) ...[queueTabs, const SizedBox(height: Space.sm)],
          searchRow, keys])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).brightness == Brightness.dark ? raised.withValues(alpha: 0.5) : const Color(0xFFF8FAFC),
            border: Border(top: BorderSide(color: ruleColor), bottom: BorderSide(color: ruleColor)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(child: Text('Daftar Produk (Katalog Aktif)', overflow: TextOverflow.ellipsis, style: TextStyle(color: muted, fontSize: 12, fontWeight: FontWeight.w600))),
              const SizedBox(width: Space.sm),
              Text('${products.length} barang ditampilkan', style: TextStyle(color: muted, fontSize: 12)),
            ],
          ),
        ),
        Expanded(child: catalogWidget),
      ]));
    // the till is driven from the keyboard on a PC - see handleKey
    final cartWidth = box.maxWidth >= 1400 ? 420.0 : box.maxWidth >= 1200 ? 400.0 : 380.0;
    return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: Padding(padding: const EdgeInsets.all(Space.xl), child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: catalog), const SizedBox(width: Space.gap), SizedBox(width: cartWidth, child: LiveCartPanel(
        store: widget.store,
        onExitTop: () {
          searchFocus.requestFocus();
          search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length);
        },
      )),
    ]))));
  }));
}
