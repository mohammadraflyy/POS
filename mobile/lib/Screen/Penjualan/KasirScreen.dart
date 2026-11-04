import 'package:flutter/material.dart';
import '../../state/app_state.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../../Widgets/product_row.dart';
import '../../Widgets/CartPanel.dart';
import '../Pairing/ScanScreen.dart';
import 'ProductSheet.dart';
class KasirScreen extends StatefulWidget {
  const KasirScreen({super.key, required this.app});
  final AppState app;
  @override
  State<KasirScreen> createState() => _KasirScreenState();
}
class _KasirScreenState extends State<KasirScreen> {
  final _search = TextEditingController();
  String _category = 'Semua';
  @override
  void dispose() { _search.dispose(); super.dispose(); }
  Future<void> _scan() async {
    final barcode = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (!mounted || barcode == null) return;
    final matches = widget.app.demo.products.where((p) => p.barcode == barcode).toList();
    if (matches.isEmpty) { showError(context, const FormatException('Barcode tidak ditemukan dalam katalog demo.')); return; }
    await showProductSheet(context, widget.app, matches.first);
  }
  void _cart() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => Scaffold(
    appBar: AppBar(title: const Text('Pesanan saat ini')), body: SafeArea(child: Padding(padding: const EdgeInsets.all(12), child: CartPanel(app: widget.app))),
  )));
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
    final wide = usesSplitCart(context, box);
    final categories = ['Semua', ...widget.app.demo.products.map((p) => p.category).toSet()];
    final query = _search.text.toLowerCase().trim();
    final products = widget.app.demo.products.where((p) => (_category == 'Semua' || p.category == _category) &&
      '${p.name} ${p.code} ${p.barcode}'.toLowerCase().contains(query)).toList();
    final catalog = Column(children: [
      Expanded(child: CustomScrollView(slivers: [
      SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(20, 20, 20, 14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        
        Row(children: [Expanded(child: TextField(controller: _search, textInputAction: TextInputAction.search, onChanged: (_) => setState(() {}),
          onSubmitted: (value) {
            final matches = widget.app.demo.products.where((p) => p.barcode == value.trim()).toList();
            if (matches.length == 1) showProductSheet(context, widget.app, matches.first);
          }, decoration: InputDecoration(labelText: 'Cari barang', hintText: 'Nama, kode, atau barcode', prefixIcon: const Icon(Icons.search),
            suffixIcon: _search.text.isEmpty ? null : IconButton(tooltip: 'Hapus pencarian', onPressed: () => setState(_search.clear), icon: const Icon(Icons.close))))),
          const SizedBox(width: 10), IconButton.filled(onPressed: _scan, tooltip: 'Scan barcode', icon: const Icon(Icons.qr_code_scanner), style: IconButton.styleFrom(padding: const EdgeInsets.all(14), backgroundColor: primaryInk)),
        ]),
      ])),
      SingleChildScrollView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: Space.lg),
        child: Row(children: [for (final category in categories) Padding(padding: const EdgeInsets.only(right: Space.sm),
          child: ChoiceChip(label: Text(category), selected: _category == category,
            onSelected: (_) => setState(() => _category = category)))])),
      Padding(padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12), child: Text('${products.length} produk tersedia', style: const TextStyle(color: muted, fontSize: 13))),
      ])),
      products.isEmpty ? const SliverToBoxAdapter(child: SizedBox(height: 220, child: EmptyPanel(icon: Icons.search_off, title: 'Barang tidak ditemukan', message: 'Coba nama lain atau pilih kategori Semua.'))) : SliverList(delegate: SliverChildBuilderDelegate((context, index) {
        final product = products[index];
        return ProductRow(name: product.name, code: product.code, stock: qty(product.stock),
          unit: product.baseUnit.name, price: money(product.baseUnit.price), available: product.stock > 0,
          inCart: widget.app.cart.any((line) => line.product.id == product.id),
          onConfigure: () => showProductSheet(context, widget.app, product), onAdd: () {
            try { widget.app.add(product); } catch (e) { showError(context, e); }
          });
      }, childCount: products.length)),
      ])),
      if (!wide) CartAction(count: widget.app.cart.length, total: money(widget.app.total), onPressed: _cart),
    ]);
    return wide ? Row(children: [Expanded(child: catalog), SizedBox(width: 380, child: Padding(padding: const EdgeInsets.fromLTRB(0, 18, 18, 18), child: CartPanel(app: widget.app)))]) : catalog;
  });
}
