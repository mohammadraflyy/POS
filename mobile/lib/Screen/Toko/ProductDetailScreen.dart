import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';

/// One product's units (with their costs and prices), price tiers, and price history.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.api, required this.productId, required this.isAdmin});
  final StoreApi api;
  final int productId;
  final bool isAdmin;
  @override State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  Map<String, dynamic>? detail;
  List<Map<String, dynamic>> masterUnits = [];
  bool loading = true;
  String? error;
  int get id => widget.productId;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = detail == null; error = null; });
    try {
      final data = await widget.api.product(id);
      final units = widget.isAdmin ? await widget.api.units() : <Map<String, dynamic>>[];
      if (mounted) setState(() { detail = data; masterUnits = units; });
    } catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }

  List<Map<String, dynamic>> get units => detail == null ? const [] : jsonRows(detail!['units']);

  Future<void> editUnit([Map<String, dynamic>? unit]) async {
    final isBase = unit?['isBaseUnit'] == true;
    final others = units.where((u) => u['id'] != unit?['id']).toList();
    final values = await showFormDialog(context, title: unit == null ? 'Tambah satuan' : 'Ubah satuan ${unit['satuan']}', fields: [
      if (!isBase) FieldSpec('unitId', 'Satuan', kind: FieldKind.choice, required: true, initial: unit?['unitId'],
        choices: {for (final m in masterUnits.where((m) => m['isActive'] != false)) m['id']: '${m['code']} — ${m['name']}'}),
      if (!isBase) FieldSpec('parentUnitId', 'Berisi satuan', kind: FieldKind.choice, required: true,
        initial: unit?['parentUnitId'] ?? units.firstWhere((u) => u['isBaseUnit'] == true, orElse: () => {'id': null})['id'],
        choices: {for (final u in others) u['id']: u['satuan'].toString()}, helper: 'Contoh: 1 DUS berisi 12 PCS'),
      if (!isBase) FieldSpec('jumlahKemasan', 'Isi per satuan', kind: FieldKind.integer, required: true, initial: unit?['jumlahKemasan']),
      FieldSpec('hargaJual', 'Harga jual', kind: FieldKind.money, required: true, initial: unit?['hargaJual']),
      if (!isBase) FieldSpec('hargaPokok', 'Harga pokok', kind: FieldKind.money, initial: unit?['hargaPokok'], helper: 'Kosongkan untuk dihitung dari harga pokok dasar'),
    ], onSave: (v) {
      if (isBase) {
        return widget.api.updateUnit(id, idNumber(unit!['id']), {'unitId': unit['unitId'], 'jumlahKemasan': 1, 'hargaJual': v['hargaJual']});
      }
      return unit == null ? widget.api.addUnit(id, v) : widget.api.updateUnit(id, idNumber(unit['id']), v);
    });
    if (values != null && mounted) load();
  }

  Future<void> deleteUnit(Map<String, dynamic> unit) async {
    if (!await confirmAction(context, title: 'Hapus satuan ${unit['satuan']}?', destructive: true, confirmLabel: 'Hapus',
      message: 'Satuan lain yang diukur dengan satuan ini ikut terhapus, begitu juga harga bertingkatnya.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deleteUnit(id, idNumber(unit['id'])))) load();
  }

  Future<void> addTier() async {
    final values = await showFormDialog(context, title: 'Harga bertingkat', fields: [
      FieldSpec('productUnitId', 'Satuan', kind: FieldKind.choice, required: true, initial: units.first['id'],
        choices: {for (final u in units) u['id']: u['satuan'].toString()}),
      const FieldSpec('minQty', 'Qty minimal', kind: FieldKind.integer, required: true),
      const FieldSpec('maxQty', 'Qty maksimal', kind: FieldKind.integer, helper: 'Kosongkan bila tanpa batas'),
      const FieldSpec('hargaJual', 'Harga jual per satuan', kind: FieldKind.money, required: true),
    ], onSave: (v) => widget.api.addTier(id, v));
    if (values != null && mounted) load();
  }

  @override Widget build(BuildContext context) {
    final tiers = detail == null ? const <Map<String, dynamic>>[] : jsonRows(detail!['priceTiers']);
    final history = detail == null ? const <Map<String, dynamic>>[] : jsonRows(detail!['priceHistory']);
    String unitName(Object? unitRowId) => units.firstWhere((u) => u['id'] == unitRowId, orElse: () => {'satuan': '—'})['satuan'].toString();
    return Scaffold(appBar: AppBar(title: Text(detail?['namaItem']?.toString() ?? 'Produk')), body: ScreenBody(onRefresh: load, maxWidth: 1000, children: [
      LoadSwitch(loading: loading, error: error, onRetry: load, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        ScreenHeader('Satuan', 'Kode ${detail?['kodeItem'] ?? ''}. Harga pokok tiap satuan ikut bergerak saat pembelian.', actions: [
          if (widget.isAdmin) FilledButton.icon(onPressed: () => editUnit(), icon: const Icon(Icons.add), label: const Text('Tambah satuan')),
        ]),
        DataView<Map<String, dynamic>>(rows: units, onTap: widget.isAdmin ? editUnit : null,
          actions: widget.isAdmin ? (u) => [if (u['isBaseUnit'] != true) IconButton(tooltip: 'Hapus satuan', onPressed: () => deleteUnit(u), icon: const Icon(Icons.delete_outline, size: 20))] : null,
          columns: [
            DataCol('Satuan', (u) => '${u['satuan']}${u['isBaseUnit'] == true ? ' (dasar)' : ''}', flex: 2),
            DataCol('Isi', (u) => u['isBaseUnit'] == true ? '1' : '${u['konversi']} ${unitName(units.firstWhere((x) => x['isBaseUnit'] == true, orElse: () => {})['id'])}', numeric: true),
            DataCol('Harga pokok', (u) => rupiah(u['hargaPokok']), numeric: true, flex: 2),
            DataCol('Harga jual', (u) => rupiah(u['hargaJual']), numeric: true, flex: 2),
          ]),
        const SizedBox(height: Space.xl),
        ScreenHeader('Harga bertingkat', 'Harga khusus saat membeli dalam jumlah tertentu.', actions: [
          if (widget.isAdmin && units.isNotEmpty) OutlinedButton.icon(onPressed: addTier, icon: const Icon(Icons.add), label: const Text('Tambah harga')),
        ]),
        DataView<Map<String, dynamic>>(rows: tiers, emptyTitle: 'Belum ada harga bertingkat',
          actions: widget.isAdmin ? (t) => [IconButton(tooltip: 'Hapus harga', onPressed: () async {
            if (await runAction(context, () => widget.api.deleteTier(id, idNumber(t['id'])))) load();
          }, icon: const Icon(Icons.delete_outline, size: 20))] : null,
          columns: [
            DataCol('Satuan', (t) => unitName(t['productUnitId'])),
            DataCol('Qty', (t) => t['maxQty'] == null ? '≥ ${t['minQty']}' : '${t['minQty']} – ${t['maxQty']}'),
            DataCol('Harga', (t) => rupiah(t['hargaJual']), numeric: true),
          ]),
        const SizedBox(height: Space.xl),
        Text('Riwayat harga', style: Theme.of(context).textTheme.titleMedium), const SizedBox(height: Space.sm),
        DataView<Map<String, dynamic>>(rows: history, emptyTitle: 'Belum ada perubahan harga', columns: [
          DataCol('Waktu', (h) => dateTimeLabel(h['createdAt']), flex: 2),
          DataCol('Pokok', (h) => '${rupiah(h['hargaPokokLama'])} → ${rupiah(h['hargaPokokBaru'])}', flex: 3),
          DataCol('Jual', (h) => '${rupiah(h['hargaJualLama'])} → ${rupiah(h['hargaJualBaru'])}', flex: 3),
          DataCol('Oleh', (h) => text(h['userName'], 'Pembelian')),
        ]),
      ])),
    ]));
  }
}
