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
class LiveKasirScreen extends StatefulWidget {
  const LiveKasirScreen({super.key, required this.store});
  final LiveStore store;
  @override State<LiveKasirScreen> createState() => _LiveKasirScreenState();
}
class _LiveKasirScreenState extends State<LiveKasirScreen> {
  final search = TextEditingController();
  final searchFocus = FocusNode();
  Timer? timer;
  List<LiveProduct> products = [];
  bool loading = true;
  String? error;
  int page = 1, lastPage = 1, serial = 0, seenCatalogRevision = 0;
  @override void initState() { super.initState(); seenCatalogRevision = widget.store.catalogRevision; widget.store.addListener(watchStock); load(); }
  void watchStock() { if (mounted && seenCatalogRevision != widget.store.catalogRevision) { seenCatalogRevision = widget.store.catalogRevision; load(target: page); } }
  @override void dispose() { widget.store.removeListener(watchStock); timer?.cancel(); search.dispose(); searchFocus.dispose(); super.dispose(); }
  void addOne(LiveProduct p) {
    final existing = widget.store.items.where((i) => i.product.id == p.id && i.unit.id == null).toList();
    final old = existing.isEmpty ? null : existing.first;
    try { widget.store.put(LiveCartItem(product: p, unit: p.units.first,
      quantity: (old?.quantity ?? 0) + 1, manualPrice: old?.manualPrice, discount: old?.discount)); }
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
  void pay() {
    if (!widget.store.canCheckout) return;
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => LivePaymentScreen(store: widget.store)));
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
    final catalog = Column(children: [
      Expanded(child: CustomScrollView(slivers: [SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(Space.lg), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        
        Row(children: [Expanded(child: TextField(controller: search, textInputAction: TextInputAction.search, onChanged: (_) {
          serial++; timer?.cancel(); setState(() { loading = true; error = null; });
          timer = Timer(const Duration(milliseconds: 350), () => load());
        }, focusNode: searchFocus, autofocus: isDesktop, onSubmitted: (_) => submitSearch(), decoration: InputDecoration(labelText: 'Cari barang', hintText: isDesktop ? 'Nama, kode, atau scan barcode • F2' : 'Nama, kode, atau barcode', prefixIcon: const Icon(Icons.search)))),
          if (!isDesktop) ...[const SizedBox(width: 8), IconButton.filled(onPressed: scan, tooltip: 'Scan barcode', icon: const Icon(Icons.qr_code_scanner), style: IconButton.styleFrom(backgroundColor: wine))],
          IconButton(onPressed: () => load(target: page), tooltip: 'Muat ulang katalog', icon: const Icon(Icons.refresh)),
        ]),
        const SizedBox(height: 12), Text('Halaman $page / $lastPage', style: const TextStyle(color: muted, fontSize: 13)),
      ]))),
        if (loading) const SliverToBoxAdapter(child: LinearProgressIndicator(minHeight: 2)),
        if (error != null) SliverToBoxAdapter(child: EmptyPanel(icon: Icons.wifi_off, title: 'Katalog belum dimuat', message: error!, action: OutlinedButton(onPressed: () => load(), child: const Text('Coba lagi'))))
        else if (products.isEmpty && !loading) const SliverToBoxAdapter(child: EmptyPanel(icon: Icons.search_off, title: 'Tidak ada produk', message: 'Coba kata pencarian lain.'))
        else SliverList(delegate: SliverChildBuilderDelegate((context, index) {
          final p = products[index];
          return ProductRow(name: p.name, code: p.code, stock: quantityText(p.stock),
            price: rupiah(p.units.first.price), unit: p.units.first.name,
            inCart: widget.store.items.any((item) => item.product.id == p.id),
            onConfigure: !loading && widget.store.editable ? () => configure(p) : null,
            onAdd: loading || !widget.store.editable ? null : () => addOne(p));
        }, childCount: products.length)),
        SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.all(Space.lg), child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          OutlinedButton(onPressed: !loading && page > 1 ? () => load(target: page - 1) : null, child: const Text('Sebelumnya')),
          const SizedBox(width: 12), OutlinedButton(onPressed: !loading && page < lastPage ? () => load(target: page + 1) : null, child: const Text('Berikutnya')),
        ]))),
      ])),
      if (!wide) CartAction(count: widget.store.items.length,
        total: widget.store.pricing ? 'Menghitung...' : rupiah(widget.store.price?.total),
        onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Scaffold(
          appBar: AppBar(title: const Text('Keranjang')), body: SafeArea(child: LiveCartPanel(store: widget.store)))))),
    ]);
    final body = wide ? Row(children: [Expanded(child: catalog), SizedBox(width: 380, child: Padding(padding: const EdgeInsets.fromLTRB(0, 18, 18, 18), child: LiveCartPanel(store: widget.store)))]) : catalog;
    // F2 jumps to search, F12 opens payment - the till is driven from the keyboard on a PC
    return CallbackShortcuts(bindings: {
      const SingleActivator(LogicalKeyboardKey.f2): () => searchFocus.requestFocus(),
      const SingleActivator(LogicalKeyboardKey.f12): pay,
    }, child: Focus(autofocus: !isDesktop, child: body));
  }));
}
