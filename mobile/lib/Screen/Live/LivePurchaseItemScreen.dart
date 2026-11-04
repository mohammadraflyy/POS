import 'package:flutter/material.dart';
import '../../Widgets/admin.dart' show isDesktop;
import '../../services/business_api.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import '../Pairing/ScanScreen.dart';
class PurchaseDraftItem {
  PurchaseDraftItem(this.product, this.unit, this.quantity, this.price, {this.sellPrice});
  final LiveProduct product;
  final LiveUnit unit;
  final num quantity, price;

  /// A new selling price for this unit, set with the purchase; null leaves it as it is.
  final num? sellPrice;
  Map<String, dynamic> toJson() => {'productId': product.id, 'productUnitId': unit.id, 'qty': quantity, 'hargaBeli': price, if (sellPrice != null) 'hargaJual': sellPrice};
}
class LivePurchaseItemScreen extends StatefulWidget {
  const LivePurchaseItemScreen({super.key, required this.api, this.initialProduct});
  final BusinessApi api;

  /// Found by a scan on the purchase screen: its line form opens straight away.
  final LiveProduct? initialProduct;
  @override State<LivePurchaseItemScreen> createState() => _LivePurchaseItemScreenState();
}
class _LivePurchaseItemScreenState extends State<LivePurchaseItemScreen> {
  final query = TextEditingController();
  List<LiveProduct> products = [];
  bool loading = false;
  String? error;
  @override void initState() {
    super.initState();
    final product = widget.initialProduct;
    if (product != null) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) select(product); });
  }
  @override void dispose() { query.dispose(); super.dispose(); }
  Future<void> search() async {
    if (loading) return; setState(() { loading = true; error = null; });
    try { final result = await widget.api.purchaseProducts(query.text.trim()); if (mounted) setState(() => products = result); }
    catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> select(LiveProduct product) async {
    final item = await showModalBottomSheet<PurchaseDraftItem>(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => _PurchaseFields(product: product));
    if (mounted && item != null) Navigator.pop(context, item);
  }
  Future<void> scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (code == null || !mounted) return;
    setState(() { loading = true; error = null; });
    try { final product = await widget.api.purchaseBarcode(code); if (mounted) await select(product); }
    catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Tambah barang masuk')), body: SafeArea(child: ListView(padding: const EdgeInsets.all(Space.lg), children: [
    Row(children: [Expanded(child: TextField(controller: query, onSubmitted: (_) => search(), decoration: const InputDecoration(hintText: 'Cari produk', prefixIcon: Icon(Icons.search)))),
      IconButton(onPressed: loading ? null : search, tooltip: 'Cari produk', icon: const Icon(Icons.arrow_forward)), if (!isDesktop) IconButton(onPressed: loading ? null : scan, tooltip: 'Scan barcode', icon: const Icon(Icons.qr_code_scanner))]),
    const SizedBox(height: Space.lg), if (loading) const Center(child: CircularProgressIndicator()),
    if (error != null) Text(error!, style: TextStyle(color: errorColor)),
    if (!loading && products.isEmpty && error == null) const EmptyPanel(icon: Icons.inventory_2_outlined, title: 'Cari barang masuk', message: 'Masukkan nama atau scan barcode dari produk.'),
    for (final product in products) ListTile(title: Text(product.name), subtitle: Text('${product.code} • Stok ${quantityText(product.stock)}'), trailing: const Icon(Icons.add), onTap: loading ? null : () => select(product)),
  ])));
}
class _PurchaseFields extends StatefulWidget {
  const _PurchaseFields({required this.product});
  final LiveProduct product;
  @override State<_PurchaseFields> createState() => _PurchaseFieldsState();
}
class _PurchaseFieldsState extends State<_PurchaseFields> {
  late LiveUnit unit = widget.product.units.first;
  final quantity = TextEditingController(text: '1'), price = TextEditingController(), sell = TextEditingController();
  String? error;
  @override void dispose() { quantity.dispose(); price.dispose(); sell.dispose(); super.dispose(); }

  num? _read(TextEditingController c) { try { return c.text.trim().isEmpty ? null : inputRupiah(c.text); } catch (_) { return null; } }

  /// "Untung Rp500 per PCS (14%)" from the cost being typed and the price it will sell at.
  String? get _margin {
    final cost = _read(price);
    final selling = _read(sell) ?? unit.price;
    if (cost == null || selling == null || selling <= 0) return null;
    final gain = selling - cost;
    return '${gain < 0 ? 'Rugi' : 'Untung'} ${rupiah(gain.abs())} per ${unit.name} (${(gain / selling * 100).toStringAsFixed(0)}%)';
  }
  @override Widget build(BuildContext context) => SafeArea(child: SingleChildScrollView(padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.viewInsetsOf(context).bottom + 24), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text(widget.product.name, style: Theme.of(context).textTheme.titleLarge), const SizedBox(height: Space.lg),
    DropdownButtonFormField<LiveUnit>(value: unit, isExpanded: true, decoration: const InputDecoration(labelText: 'Satuan pembelian'), items: widget.product.units.map((u) => DropdownMenuItem(value: u, child: Text(u.name))).toList(), onChanged: (u) => setState(() => unit = u!)),
    const SizedBox(height: Space.lg), TextField(controller: quantity, textInputAction: TextInputAction.next, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Jumlah masuk')),
    const SizedBox(height: Space.lg), TextField(controller: price, textInputAction: TextInputAction.next, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Harga beli per satuan (Rp)')),
    const SizedBox(height: Space.lg), TextField(controller: sell, textInputAction: TextInputAction.done, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: 'Harga jual baru per ${unit.name} (opsional)', hintText: unit.price == null ? null : rupiah(unit.price),
        helperText: 'Sekarang ${rupiah(unit.price)}. Kosongkan bila harga jual tidak berubah.')),
    if (_margin != null) Padding(padding: const EdgeInsets.only(top: Space.sm), child: Text(_margin!, style: TextStyle(color: _margin!.startsWith('Rugi') ? errorColor : muted, fontSize: 13))),
    if (error != null) Text(error!, style: TextStyle(color: errorColor)), const SizedBox(height: Space.lg),
    SizedBox(width: double.infinity, child: FilledButton(onPressed: () { try { Navigator.pop(context, PurchaseDraftItem(widget.product, unit, inputQty(quantity.text), inputRupiah(price.text), sellPrice: _read(sell))); } catch (_) { setState(() => error = 'Isi jumlah positif dan harga beli yang valid.'); showError(context, error!); } }, child: const Text('Tambah ke pembelian'))),
  ])));
}
