import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/barcode_burst.dart';
import '../../services/business_api.dart';
import '../../services/mutation_guard.dart';
import '../../models/live_models.dart';
import '../../core/theme.dart';
import '../../Widgets/ui.dart';
import 'LiveSupplierScreen.dart';
import 'LivePurchaseItemScreen.dart';
class LivePurchaseScreen extends StatefulWidget {
  const LivePurchaseScreen({super.key, required this.api, required this.guard, this.onSaved, this.active = true});
  final BusinessApi api;
  final MutationGuard guard;
  final VoidCallback? onSaved;

  /// False while another menu is showing, so a scan there does not land in this purchase.
  final bool active;
  @override State<LivePurchaseScreen> createState() => _LivePurchaseScreenState();
}
class _LivePurchaseScreenState extends State<LivePurchaseScreen> {
  Map<String, dynamic>? supplier;
  DateTime date = DateTime.now();
  final note = TextEditingController(), paid = TextEditingController();
  final List<PurchaseDraftItem> items = [];
  bool saving = false;
  String? error, success;
  final scanner = BarcodeBurst();
  @override void initState() { super.initState(); HardwareKeyboard.instance.addHandler(handleKey); }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); note.dispose(); paid.dispose(); super.dispose(); }

  /// A scanner fired while no text field had focus, as on the desktop's purchase page.
  bool handleKey(KeyEvent event) {
    if (!mounted || !widget.active || saving || ModalRoute.of(context)?.isCurrent == false) return false;
    if (FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null) return false;
    final scan = scanner.feed(event);
    if (scan.code == null) return false;
    addScanned(scan.code!);
    return true;
  }

  Future<void> addScanned(String code) async {
    try {
      final product = await widget.api.purchaseBarcode(code);
      if (!mounted) return;
      await addItem(initialProduct: product);
    } catch (e) { if (mounted) showError(context, e); }
  }

  Future<void> addItem({LiveProduct? initialProduct}) async {
    final item = await Navigator.of(context).push<PurchaseDraftItem>(MaterialPageRoute(builder: (_) => LivePurchaseItemScreen(api: widget.api, initialProduct: initialProduct)));
    if (mounted && item != null) setState(() { items.add(item); success = null; });
  }
  Future<void> save() async {
    if (saving) return; setState(() { saving = true; error = null; success = null; });
    try {
      if (items.isEmpty) throw const FormatException('Tambahkan minimal satu barang.');
      final upfront = paid.text.trim().isEmpty ? null : inputRupiah(paid.text);
      if (upfront != null && upfront != upfront.round()) throw const FormatException('Uang muka harus rupiah bulat.');
      final body = <String, dynamic>{'supplierId': supplier == null ? null : idNumber(supplier!['id'] ?? supplier!['supplierId']),
        'tanggal': isoDate(date), 'catatan': note.text.trim().isEmpty ? null : note.text.trim(),
        'items': items.map((i) => i.toJson()).toList(), if (upfront != null) 'dibayar': upfront};
      final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Simpan pembelian ke PC?'), content: Text('${items.length} baris barang masuk akan dicatat. Stok dan harga pokok diperbarui oleh PC.'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Periksa lagi')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Simpan'))]));
      if (confirmed != true) return;
      final result = await widget.guard.run('Pembelian', () => widget.api.purchase(body));
      if (mounted) widget.onSaved?.call();
      if (mounted) setState(() { items.clear(); paid.clear(); note.clear(); success = 'Pembelian berhasil disimpan di PC${result is Map && result['purchaseId'] != null ? ' (#${result['purchaseId']})' : ''}.'; });
      if (mounted && success != null) showNotice(context, success!, kind: NoticeKind.success);
    } catch (e) { if (mounted) { setState(() => error = e.toString()); showError(context, e); } }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override Widget build(BuildContext context) => AnimatedBuilder(animation: widget.guard, builder: (context, _) {
    final enabled = !saving && !widget.guard.busy && widget.guard.pending == null;
    return ListView(padding: const EdgeInsets.all(Space.lg), children: [
      const PageIntro('Pembelian baru', 'Barang yang disimpan akan menambah stok toko.'),
      WhitePanel(child: Column(children: [ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.local_shipping_outlined, color: wine), title: Text(supplier == null ? 'Pilih supplier (opsional)' : (supplier!['nama'] ?? supplier!['name']).toString()), trailing: const Icon(Icons.chevron_right), onTap: !enabled ? null : () async {
        final result = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => LiveSupplierScreen(api: widget.api, guard: widget.guard)));
        if (mounted && result != null) setState(() => supplier = result);
      }), if (supplier != null) TextButton(onPressed: enabled ? () => setState(() => supplier = null) : null, child: const Text('Tanpa supplier')),
        OutlinedButton.icon(onPressed: !enabled ? null : () async { final selected = await showDatePicker(context: context, initialDate: date, firstDate: DateTime(2000), lastDate: DateTime.now()); if (selected != null && mounted) setState(() => date = selected); }, icon: const Icon(Icons.calendar_today_outlined), label: Text(isoDate(date))),
      ])), const SizedBox(height: Space.lg),
      for (var i = 0; i < items.length; i++) Padding(padding: const EdgeInsets.only(bottom: 10), child: WhitePanel(padding: EdgeInsets.zero, child: ListTile(title: Text(items[i].product.name), subtitle: Text('${quantityText(items[i].quantity)} ${items[i].unit.name} • Harga beli ${rupiah(items[i].price)}'), trailing: IconButton(tooltip: 'Hapus barang pembelian', onPressed: enabled ? () => setState(() => items.removeAt(i)) : null, icon: const Icon(Icons.close))))),
      OutlinedButton.icon(onPressed: !enabled ? null : () => addItem(), icon: const Icon(Icons.add), label: const Text('Tambah barang  ·  atau scan barcode')),
      const SizedBox(height: Space.lg), TextField(controller: paid, enabled: enabled, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Uang muka (opsional, Rp)', helperText: 'Kosong = lunas. Isi 0 untuk utang penuh.')),
      const SizedBox(height: Space.lg), TextField(controller: note, enabled: enabled, decoration: const InputDecoration(labelText: 'Catatan (opsional)')),
      const SizedBox(height: 16), const Text('Jumlah akhir dihitung oleh PC saat penyimpanan.', style: TextStyle(color: muted, fontSize: 13)),
      if (error != null) Text(error!, style: const TextStyle(color: wine)), if (success != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(success!, style: const TextStyle(color: Color(0xFF357361)))),
      const SizedBox(height: Space.lg), FilledButton.icon(onPressed: enabled && items.isNotEmpty && widget.guard.ready ? save : null, icon: const Icon(Icons.save_outlined), label: Text(saving ? 'Menyimpan…' : 'Simpan pembelian ke PC')),
    ]);
  });
}
