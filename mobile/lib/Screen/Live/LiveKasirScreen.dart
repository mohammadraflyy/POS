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
  final scanner = BarcodeBurst();
  /// PageUp and PageDown hop between Jumlah and the search on the till (handled in
  /// handleKey); a text field must not also treat them as caret moves.
  static const _hopKeys = <ShortcutActivator, Intent>{
    SingleActivator(LogicalKeyboardKey.pageUp): DoNothingAndStopPropagationTextIntent(),
    SingleActivator(LogicalKeyboardKey.pageDown): DoNothingAndStopPropagationTextIntent(),
  };
  Timer? timer;
  List<LiveProduct> products = [];
  bool loading = true;
  String? error;
  int page = 1, lastPage = 1, serial = 0, seenCatalogRevision = 0;
  @override void initState() { super.initState(); seenCatalogRevision = widget.store.catalogRevision; widget.store.addListener(watchStock); HardwareKeyboard.instance.addHandler(handleKey); load(); }
  void watchStock() { if (mounted && seenCatalogRevision != widget.store.catalogRevision) { seenCatalogRevision = widget.store.catalogRevision; load(target: page); } }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); widget.store.removeListener(watchStock); timer?.cancel(); search.dispose(); searchFocus.dispose(); qty.dispose(); qtyFocus.dispose(); super.dispose(); }
  /// The quantity typed in Jumlah; a blank or unreadable entry means 1.
  num get enteredQty {
    try { final value = inputQty(qty.text.trim().isEmpty ? '1' : qty.text); return value > 0 ? value : 1; }
    catch (_) { return 1; }
  }

  void addOne(LiveProduct p) {
    final existing = widget.store.items.where((i) => i.product.id == p.id && i.unit.id == null).toList();
    final old = existing.isEmpty ? null : existing.first;
    try {
      widget.store.put(LiveCartItem(product: p, unit: p.units.first,
        quantity: (old?.quantity ?? 0) + enteredQty, manualPrice: old?.manualPrice, discount: old?.discount));
      qty.value = const TextEditingValue(text: '1', selection: TextSelection.collapsed(offset: 1));
    }
    catch (e) { showError(context, e); }
  }
  /// Enter in the search box: a barcode scanner types the code then Enter, so a single
  /// match goes straight into the cart and the box clears for the next scan.
  Future<void> submitSearch() async {
    timer?.cancel();
    await load();
    if (!mounted || products.length != 1 || !widget.store.editable) return;
    addOne(products.single);
    search.clear(); searchFocus.requestFocus();
  }
  /// F3: change the quantity of the line at the top of the cart, as on the desktop till.
  Future<void> editTopLine() async {
    if (widget.store.items.isEmpty || !widget.store.editable) return;
    final top = widget.store.items.first;
    final result = await editLiveItem(context, top.product, existing: top);
    if (result == null || !mounted) return;
    try { widget.store.put(result); } catch (e) { showError(context, e); }
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
    if (key == LogicalKeyboardKey.pageUp) {
      action = () { qtyFocus.requestFocus(); qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length); };
    } else if (key == LogicalKeyboardKey.f2 || key == LogicalKeyboardKey.pageDown || (key == LogicalKeyboardKey.slash && !typing)) {
      action = () { searchFocus.requestFocus(); search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length); };
    } else if (key == LogicalKeyboardKey.f12 || (key == LogicalKeyboardKey.end && !typing)) {
      action = pay;
    } else if (key == LogicalKeyboardKey.f3) {
      action = editTopLine;
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
    final exact = products.where((p) => p.barcode == code).toList();
    final match = exact.length == 1 ? exact.single : products.length == 1 ? products.single : null;
    if (match == null) { showNotice(context, 'Barcode $code tidak ditemukan di katalog.', kind: NoticeKind.warning); return; }
    addOne(match);
    search.clear();
    load();
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
      setState(() { products = rows; page = (number(data['currentPage']) ?? target).toInt(); lastPage = (number(data['lastPage']) ?? target).toInt(); });
    } catch (e) { if (mounted && request == serial) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }
  Future<void> configure(LiveProduct p) async {
    final item = await editLiveItem(context, p);
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
    final searchRow = Row(children: [
      SizedBox(width: 92, child: TextField(controller: qty, focusNode: qtyFocus, textAlign: TextAlign.end,
        keyboardType: const TextInputType.numberWithOptions(decimal: true), textInputAction: TextInputAction.next,
        style: amountStyle.copyWith(fontSize: 16),
        // Enter in Jumlah goes on to the search, ready for the scan or the name
        onSubmitted: (_) { searchFocus.requestFocus(); search.selection = TextSelection(baseOffset: 0, extentOffset: search.text.length); },
        onTap: () => qty.selection = TextSelection(baseOffset: 0, extentOffset: qty.text.length),
        decoration: const InputDecoration(prefixText: '× ', hintText: '1', helperText: null, labelText: 'Jumlah'))),
      const SizedBox(width: Space.sm),
      Expanded(child: TextField(controller: search, textInputAction: TextInputAction.search, onChanged: (_) {
        serial++; timer?.cancel(); setState(() { loading = true; error = null; });
        timer = Timer(const Duration(milliseconds: 350), () => load());
      }, focusNode: searchFocus, autofocus: isDesktop, onSubmitted: (_) => submitSearch(),
        decoration: InputDecoration(hintText: isDesktop ? 'Cari nama, kode, atau scan barcode' : 'Cari barang', prefixIcon: const Icon(Icons.search, size: 20)))),
      if (!isDesktop) ...[const SizedBox(width: Space.sm), IconButton.filled(onPressed: scan, tooltip: 'Scan barcode', icon: const Icon(Icons.qr_code_scanner, size: 20),
        style: IconButton.styleFrom(backgroundColor: primaryInk, foregroundColor: Colors.white, minimumSize: const Size(44, 44)))],
      const SizedBox(width: Space.xs),
      IconButton(onPressed: () => load(target: page), tooltip: 'Muat ulang katalog', icon: const Icon(Icons.refresh, size: 20)),
    ]);
    final keys = isDesktop && wide ? const Padding(padding: EdgeInsets.only(top: Space.sm), child: Text('PageUp jumlah · PageDown cari · End bayar · F3 ubah baris atas · Alt+K kosongkan · scan di mana saja',
      style: TextStyle(color: muted, fontSize: 12))) : const SizedBox.shrink();
    final list = CustomScrollView(slivers: [
      if (loading) const SliverToBoxAdapter(child: LinearProgressIndicator(minHeight: 2)),
      if (error != null) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(Space.lg), child: EmptyPanel(icon: Icons.wifi_off, title: 'Katalog belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi')))))
      else if (products.isEmpty && !loading) const SliverToBoxAdapter(child: Padding(padding: EdgeInsets.all(Space.lg), child: Text('Tidak ada barang yang cocok. Coba kata lain atau scan barcodenya.', style: TextStyle(color: muted))))
      else SliverList(delegate: SliverChildBuilderDelegate((context, index) {
        final p = products[index];
        return ProductRow(name: p.name, code: p.code, stock: quantityText(p.stock),
          price: rupiah(p.units.first.price), unit: p.units.first.name,
          inCart: widget.store.items.any((item) => item.product.id == p.id),
          onConfigure: !loading && widget.store.editable ? () => configure(p) : null,
          onAdd: loading || !widget.store.editable ? null : () => addOne(p));
      }, childCount: products.length)),
      if (lastPage > 1) SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md), child: Row(children: [
        Text('Halaman $page dari $lastPage', style: const TextStyle(color: muted, fontSize: 13)),
        const Spacer(),
        OutlinedButton(onPressed: !loading && page > 1 ? () => load(target: page - 1) : null, child: const Text('Sebelumnya')),
        const SizedBox(width: Space.sm), OutlinedButton(onPressed: !loading && page < lastPage ? () => load(target: page + 1) : null, child: const Text('Berikutnya')),
      ]))),
    ]);
    if (!wide) {
      return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.sm, Space.md), child: searchRow),
        const Divider(),
        Expanded(child: ColoredBox(color: surface, child: list)),
        CartAction(count: widget.store.items.length,
          total: widget.store.pricing ? 'Menghitung…' : rupiah(widget.store.price?.total ?? 0),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Scaffold(
            appBar: AppBar(title: const Text('Keranjang')), body: SafeArea(child: Padding(padding: const EdgeInsets.all(Space.md), child: LiveCartPanel(store: widget.store))))))),
      ])));
    }
    // the catalog and the cart are two cards on one 24px frame, so their edges line up
    final catalog = Container(
      decoration: BoxDecoration(color: surface, border: Border.all(color: lineColor), borderRadius: BorderRadius.circular(Corners.panel)),
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.sm, Space.md), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [searchRow, keys])),
        const Divider(),
        Expanded(child: list),
      ]));
    // the till is driven from the keyboard on a PC - see handleKey
    return Shortcuts(shortcuts: _hopKeys, child: Focus(autofocus: !isDesktop, child: Padding(padding: const EdgeInsets.all(Space.xl), child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Expanded(child: catalog), const SizedBox(width: Space.gap), SizedBox(width: 380, child: LiveCartPanel(store: widget.store)),
    ]))));
  }));
}
