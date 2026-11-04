import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';
import 'ProductDetailScreen.dart';

/// Katalog: products on one tab, the shared unit list (Master Satuan) on the other.
class ProductsHub extends StatelessWidget {
  const ProductsHub({super.key, required this.api, required this.isAdmin});
  final StoreApi api;
  final bool isAdmin;
  @override Widget build(BuildContext context) => DefaultTabController(length: 2, child: Column(children: [
    const Material(color: surface, child: TabBar(tabs: [Tab(text: 'Produk'), Tab(text: 'Master Satuan')])),
    Expanded(child: TabBarView(children: [ProductsScreen(api: api, isAdmin: isAdmin), UnitsScreen(api: api, isAdmin: isAdmin)])),
  ]));
}

List<FieldSpec> productFields([Map<String, dynamic>? p]) => [
  FieldSpec('kodeItem', 'Kode item', required: true, initial: p?['kodeItem']),
  FieldSpec('namaItem', 'Nama item', required: true, initial: p?['namaItem']),
  FieldSpec('barcode', 'Barcode', initial: p?['barcode']),
  FieldSpec('kategori', 'Kategori', initial: p?['categoryName']),
  FieldSpec('satuan', 'Satuan dasar', required: true, initial: p?['satuan'] ?? 'PCS', helper: 'Contoh: PCS, KG, BKS'),
  FieldSpec('hargaPokok', 'Harga pokok (modal)', kind: FieldKind.money, required: true, initial: p?['hargaPokok']),
  FieldSpec('hargaJual', 'Harga jual', kind: FieldKind.money, required: true, initial: p?['hargaJual']),
];

class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key, required this.api, required this.isAdmin});
  final StoreApi api;
  final bool isAdmin;
  @override State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  List<Map<String, dynamic>> rows = [];
  String search = '';
  int page = 1, last = 1, total = 0, serial = 0;
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load({int target = 1}) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.products(search, target);
      if (mounted && request == serial) {
        setState(() { rows = jsonRows(data); page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? 1).toInt(); total = (number(data['total']) ?? 0).toInt(); });
      }
    } catch (e) { if (mounted && request == serial) setState(() => error = e.toString()); }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }

  Future<void> create() async {
    final values = await showFormDialog(context, title: 'Produk baru', fields: [
      ...productFields(),
      const FieldSpec('stok', 'Stok awal', kind: FieldKind.number, initial: 0),
    ], onSave: (v) async {
      final result = await widget.api.saveProducts([{...v, 'key': 'baru', 'id': null, 'stok': v['stok'] ?? 0}]);
      if (result['success'] != true) {
        final errors = jsonObject(jsonObject(result['rowErrors'])['baru']);
        throw FormatException(errors.values.join('\n'));
      }
      return null;
    });
    if (values != null && mounted) { showNotice(context, 'Produk ditambahkan.', kind: NoticeKind.success); load(target: page); }
  }

  Future<void> edit(Map<String, dynamic> p) async {
    final values = await showFormDialog(context, title: 'Ubah ${p['namaItem']}', fields: [
      ...productFields(p),
      FieldSpec('isActive', 'Aktif dijual', kind: FieldKind.toggle, initial: p['isActive'] != false,
        helper: 'Matikan untuk menyembunyikan dari kasir tanpa menghapus riwayatnya.'),
    ], onSave: (v) => widget.api.updateProduct(idNumber(p['id']), v));
    if (values != null && mounted) { showNotice(context, 'Produk disimpan.', kind: NoticeKind.success); load(target: page); }
  }

  Future<void> remove(Map<String, dynamic> p) async {
    if (!await confirmAction(context, title: 'Hapus ${p['namaItem']}?', destructive: true, confirmLabel: 'Hapus',
      message: 'Produk yang sudah punya riwayat transaksi tidak bisa dihapus. Nonaktifkan saja lewat Ubah.')) { return; }
    if (mounted && await runAction(context, () => widget.api.deleteProduct(idNumber(p['id'])), success: 'Produk dihapus.')) load(target: page);
  }

  Future<void> import(String kind, String label) async {
    final file = await pickSpreadsheet();
    if (file == null || !mounted) return;
    try {
      final result = await widget.api.importProducts(kind, file.$1, file.$2);
      if (!mounted) return;
      showNotice(context, result.entries.map((e) => '${e.key}: ${e.value}').join('\n'), title: 'Impor $label selesai', kind: NoticeKind.success);
      load();
    } catch (e) { if (mounted) showError(context, e); }
  }

  @override Widget build(BuildContext context) => ScreenBody(onRefresh: () => load(target: page), children: [
    ScreenHeader('Produk', '$total produk. Harga dan stok di sini yang dipakai kasir.', actions: [
      if (widget.isAdmin) FilledButton.icon(onPressed: create, icon: const Icon(Icons.add), label: const Text('Produk baru')),
      if (widget.isAdmin && isDesktop) PopupMenuButton<(String, String)>(tooltip: 'Impor dari Excel',
        onSelected: (choice) => import(choice.$1, choice.$2),
        itemBuilder: (_) => const [
          PopupMenuItem(value: ('products', 'produk'), child: Text('Impor produk (Kode Item, Nama Item, Satuan, Harga...)')),
          PopupMenuItem(value: ('satuan', 'satuan'), child: Text('Impor satuan turunan')),
          PopupMenuItem(value: ('harga-bertingkat', 'harga bertingkat'), child: Text('Impor harga bertingkat')),
          PopupMenuItem(value: ('barcode', 'barcode'), child: Text('Impor barcode')),
        ],
        child: const Padding(padding: EdgeInsets.all(Space.md), child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.upload_file), SizedBox(width: 6), Text('Impor Excel')]))),
    ]),
    SearchBox(onChanged: (v) { search = v; load(); }, hint: 'Cari nama, kode, atau barcode'),
    const SizedBox(height: Space.md),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    LoadSwitch(loading: false, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows,
      emptyTitle: 'Produk tidak ditemukan', emptyMessage: 'Coba kata pencarian lain.',
      onTap: (p) async { await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ProductDetailScreen(api: widget.api, productId: idNumber(p['id']), isAdmin: widget.isAdmin))); if (mounted) load(target: page); },
      actions: widget.isAdmin ? (p) => [
        IconButton(tooltip: 'Ubah', onPressed: () => edit(p), icon: const Icon(Icons.edit_outlined, size: 20)),
        IconButton(tooltip: 'Hapus', onPressed: () => remove(p), icon: const Icon(Icons.delete_outline, size: 20)),
      ] : null,
      columns: [
        DataCol('Produk', (p) => '${p['namaItem']}${p['isActive'] == false ? ' (nonaktif)' : ''}', flex: 4),
        DataCol('Kode', (p) => text(p['kodeItem']), flex: 2),
        DataCol('Kategori', (p) => text(p['categoryName']), flex: 2),
        DataCol('Stok', (p) => '${quantityText(p['stok'])} ${text(p['satuan'], '')}', numeric: true, flex: 2),
        DataCol('Harga pokok', (p) => rupiah(p['hargaPokok']), numeric: true, flex: 2),
        DataCol('Harga jual', (p) => rupiah(p['hargaJual']), numeric: true, flex: 2),
      ])),
    Pager(page: page, last: last, busy: loading, onPage: (p) => load(target: p)),
  ]);
}

class UnitsScreen extends StatefulWidget {
  const UnitsScreen({super.key, required this.api, required this.isAdmin});
  final StoreApi api;
  final bool isAdmin;
  @override State<UnitsScreen> createState() => _UnitsScreenState();
}

class _UnitsScreenState extends State<UnitsScreen> {
  List<Map<String, dynamic>> rows = [];
  bool loading = true;
  String? error;
  @override void initState() { super.initState(); load(); }
  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try { final data = await widget.api.units(); if (mounted) setState(() => rows = data); }
    catch (e) { if (mounted) setState(() => error = e.toString()); }
    finally { if (mounted) setState(() => loading = false); }
  }
  Future<void> edit([Map<String, dynamic>? unit]) async {
    final values = await showFormDialog(context, title: unit == null ? 'Satuan baru' : 'Ubah satuan ${unit['code']}', fields: [
      FieldSpec('code', 'Kode', required: true, initial: unit?['code'], helper: 'Contoh: DUS'),
      FieldSpec('name', 'Nama', required: true, initial: unit?['name']),
      FieldSpec('symbol', 'Simbol', required: true, initial: unit?['symbol']),
      if (unit != null) FieldSpec('isActive', 'Aktif', kind: FieldKind.toggle, initial: unit['isActive'] != false),
    ], onSave: (v) => unit == null ? widget.api.createUnit(v) : widget.api.updateUnitMaster(idNumber(unit['id']), v));
    if (values != null && mounted) load();
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: load, maxWidth: 900, children: [
    ScreenHeader('Master Satuan', 'Daftar satuan yang bisa dipakai produk.', actions: [
      if (widget.isAdmin) FilledButton.icon(onPressed: () => edit(), icon: const Icon(Icons.add), label: const Text('Satuan baru')),
    ]),
    LoadSwitch(loading: loading, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows,
      onTap: widget.isAdmin ? edit : null,
      columns: [
        DataCol('Kode', (u) => text(u['code'])),
        DataCol('Nama', (u) => text(u['name']), flex: 2),
        DataCol('Simbol', (u) => text(u['symbol'])),
        DataCol('Status', (u) => u['isActive'] == false ? 'Nonaktif' : 'Aktif'),
      ])),
  ]);
}
