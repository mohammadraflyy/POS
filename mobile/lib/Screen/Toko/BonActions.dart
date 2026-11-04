import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';

/// What can be done to a saved sale from its detail screen: collect a bon instalment, add
/// goods to an unpaid bon, and (admin) cancel or delete it.
class SaleActions extends StatelessWidget {
  const SaleActions({super.key, required this.api, required this.sale, required this.isAdmin, required this.onChanged, required this.onDeleted});
  final StoreApi api;
  final Map<String, dynamic> sale;
  final bool isAdmin;
  final VoidCallback onChanged, onDeleted;

  int get id => idNumber(sale['id']);
  bool get active => sale['status'] == 'selesai';
  num get sisa => (number(sale['total']) ?? 0) - (number(sale['dibayar']) ?? 0);
  bool get openBon => active && sale['metodePembayaran'] == 'bon' && sisa > 0;

  Future<void> _pay(BuildContext context) async {
    final values = await showFormDialog(context, title: 'Bayar bon', saveLabel: 'Simpan pembayaran', fields: [
      FieldSpec('jumlah', 'Jumlah bayar (sisa ${rupiah(sisa)})', kind: FieldKind.money, required: true, initial: sisa),
      const FieldSpec('keterangan', 'Keterangan'),
    ], onSave: (v) => api.payBon(id, v['jumlah'] as num, v['keterangan'] as String?));
    if (values != null && context.mounted) { showNotice(context, 'Pembayaran bon tercatat.', kind: NoticeKind.success); onChanged(); }
  }

  Future<void> _addItem(BuildContext context) async {
    final picked = await pickProduct(context, api);
    if (picked == null || !context.mounted) return;
    final values = await showFormDialog(context, title: 'Tambah ${picked.name}', saveLabel: 'Tambahkan ke bon', fields: [
      // keyed by position: the base unit's own id is null, which would read as "not chosen"
      FieldSpec('unit', 'Satuan', kind: FieldKind.choice, required: true, initial: 0,
        choices: {for (var i = 0; i < picked.units.length; i++) i: '${picked.units[i].name} • ${rupiah(picked.units[i].price)}'}),
      const FieldSpec('qty', 'Jumlah', kind: FieldKind.number, required: true, initial: 1),
    ], onSave: (v) => api.addItemsToBon(id, [{'productId': picked.id, 'productUnitId': picked.units[v['unit'] as int].id, 'qty': v['qty']}]));
    if (values != null && context.mounted) { showNotice(context, 'Barang ditambahkan ke bon.', kind: NoticeKind.success); onChanged(); }
  }

  Future<void> _cancel(BuildContext context) async {
    if (!await confirmAction(context, title: 'Batalkan transaksi?', destructive: true, confirmLabel: 'Batalkan',
      message: 'Stok barang dikembalikan dan transaksi ditandai batal. Bon yang sudah ada pembayarannya tidak bisa dibatalkan.')) { return; }
    if (context.mounted && await runAction(context, () => api.cancelSale(id), success: 'Transaksi dibatalkan.')) onChanged();
  }

  Future<void> _delete(BuildContext context) async {
    if (!await confirmAction(context, title: 'Hapus transaksi permanen?', destructive: true, confirmLabel: 'Hapus',
      message: 'Transaksi #$id dihapus permanen, stoknya dikembalikan, dan semua pembayaran bonnya ikut terhapus. Tidak bisa dikembalikan.')) { return; }
    if (context.mounted && await runAction(context, () => api.deleteSale(id), success: 'Transaksi dihapus.')) onDeleted();
  }

  @override Widget build(BuildContext context) {
    final buttons = <Widget>[
      if (openBon) FilledButton.icon(onPressed: () => _pay(context), icon: const Icon(Icons.payments_outlined), label: const Text('Bayar bon')),
      if (openBon) OutlinedButton.icon(onPressed: () => _addItem(context), icon: const Icon(Icons.add_shopping_cart), label: const Text('Tambah barang')),
      if (isAdmin && active) OutlinedButton.icon(onPressed: () => _cancel(context), icon: const Icon(Icons.block), label: const Text('Batalkan')),
      if (isAdmin) OutlinedButton.icon(onPressed: () => _delete(context), style: OutlinedButton.styleFrom(foregroundColor: errorColor),
        icon: const Icon(Icons.delete_outline), label: const Text('Hapus')),
    ];
    if (buttons.isEmpty) return const SizedBox.shrink();
    return Wrap(spacing: Space.sm, runSpacing: Space.sm, children: buttons);
  }
}

/// Searches the selling catalog and returns the product the user taps.
Future<LiveProduct?> pickProduct(BuildContext context, StoreApi api) =>
    showDialog<LiveProduct>(context: context, builder: (_) => _ProductPicker(api: api));

class _ProductPicker extends StatefulWidget {
  const _ProductPicker({required this.api});
  final StoreApi api;
  @override State<_ProductPicker> createState() => _ProductPickerState();
}
class _ProductPickerState extends State<_ProductPicker> {
  List<LiveProduct> results = [];
  bool loading = false;
  String? error;
  int serial = 0;
  @override void initState() { super.initState(); search(''); }
  Future<void> search(String q) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.catalog(q, 1);
      final rows = jsonRows(data).map(LiveProduct.fromJson).toList();
      if (mounted && request == serial) setState(() => results = rows);
    } catch (e) { if (mounted && request == serial) setState(() => error = e.toString()); }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }
  @override Widget build(BuildContext context) => AlertDialog(title: const Text('Pilih barang'),
    content: SizedBox(width: 480, height: 420, child: Column(children: [
      SearchBox(onChanged: search, hint: 'Nama, kode, atau barcode', autofocus: true),
      if (loading) const LinearProgressIndicator(minHeight: 2),
      if (error != null) Padding(padding: const EdgeInsets.all(Space.md), child: Text(error!, style: TextStyle(color: errorColor))),
      Expanded(child: ListView(children: [for (final p in results) ListTile(
        title: Text(p.name), subtitle: Text('${p.code} • stok ${quantityText(p.stock)} ${p.units.first.name}'),
        trailing: Text(rupiah(p.units.first.price), style: amountStyle), onTap: () => Navigator.pop(context, p))])),
    ])),
    actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Tutup'))]);
}
