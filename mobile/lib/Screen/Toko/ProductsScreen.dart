import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/theme.dart';
import '../../models/live_models.dart';
import '../../services/store_api.dart';
import '../../Widgets/admin.dart';
import '../../Widgets/ui.dart';
import 'ProductDetailScreen.dart';
import 'MassInputScreen.dart';

/// Katalog: products on one tab, the shared unit list (Master Satuan) on the other.
class ProductsHub extends StatelessWidget {
  const ProductsHub({super.key, required this.api, required this.isAdmin, this.active = true});
  final StoreApi api;
  final bool isAdmin;

  /// False while another menu is showing: its keyboard keys stay quiet.
  final bool active;
  @override Widget build(BuildContext context) => DefaultTabController(length: 2, child: Column(children: [
    const PageTabs(tabs: ['Produk', 'Master Satuan']),
    Expanded(child: TabBarView(children: [ProductsScreen(api: api, isAdmin: isAdmin, active: active), UnitsScreen(api: api, isAdmin: isAdmin)])),
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
  const ProductsScreen({super.key, required this.api, required this.isAdmin, this.active = true});
  final StoreApi api;
  final bool isAdmin;
  final bool active;
  @override State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  List<Map<String, dynamic>> rows = [];
  String search = '';
  String stockFilter = '';
  int page = 1, last = 1, total = 0, pageSize = 25, serial = 0;
  final Set<int> selectedIds = {};
  bool loading = true;
  String? error;
  final searchFocus = FocusNode();
  @override void initState() { super.initState(); HardwareKeyboard.instance.addHandler(handleKey); load(); }
  @override void dispose() { HardwareKeyboard.instance.removeHandler(handleKey); searchFocus.dispose(); super.dispose(); }

  /// The desktop's keys on the product list: / jumps to the search, Delete removes the
  /// ticked products. Neither acts while a text field has focus.
  bool handleKey(KeyEvent event) {
    if (event is! KeyDownEvent || !mounted || !widget.active || ModalRoute.of(context)?.isCurrent == false) return false;
    if (FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<EditableText>() != null) return false;
    if (event.logicalKey == LogicalKeyboardKey.slash) { searchFocus.requestFocus(); return true; }
    if ((event.logicalKey == LogicalKeyboardKey.delete || event.logicalKey == LogicalKeyboardKey.backspace) && widget.isAdmin && selectedIds.isNotEmpty) {
      removeSelected();
      return true;
    }
    return false;
  }

  Future<void> load({int target = 1}) async {
    final request = ++serial; setState(() { loading = true; error = null; });
    try {
      final data = await widget.api.products(search, target, pageSize: pageSize, stockFilter: stockFilter.isEmpty ? null : stockFilter);
      if (mounted && request == serial) {
        setState(() { rows = jsonRows(data); page = (number(data['currentPage']) ?? target).toInt(); last = (number(data['lastPage']) ?? 1).toInt(); total = (number(data['total']) ?? 0).toInt(); });
      }
    } catch (e) { if (mounted && request == serial) setState(() => error = e.toString()); }
    finally { if (mounted && request == serial) setState(() => loading = false); }
  }

  Future<void> submitBarcodeSearch(String q) async {
    if (q.isEmpty) return;
    try {
      final found = await widget.api.productByBarcode(q);
      if (!mounted) return;
      final pid = idNumber(found['id']);
      await Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(api: widget.api, productId: pid, isAdmin: widget.isAdmin),
      ));
      if (mounted) load(target: page);
    } catch (_) {
      // Not an exact barcode match; regular search results (or unregistered barcode prompt) handle it.
    }
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

  /// Deletes every ticked product it can; those with sales or purchases are refused by the
  /// server and listed, since their history must stay readable.
  Future<void> removeSelected() async {
    final count = selectedIds.length;
    if (!await confirmAction(context, title: 'Hapus $count produk terpilih?', destructive: true, confirmLabel: 'Hapus',
      message: 'Produk yang sudah punya riwayat transaksi tidak ikut terhapus. Nonaktifkan saja lewat Ubah.')) { return; }
    try {
      final result = await widget.api.bulkDeleteProducts(selectedIds.toList());
      if (!mounted) return;
      final blocked = (result['blocked'] as List? ?? const []).map((e) => e.toString()).toList();
      setState(selectedIds.clear);
      showNotice(context, blocked.isEmpty ? '${result['deleted']} produk dihapus.'
        : '${result['deleted']} produk dihapus. ${blocked.length} tidak bisa dihapus karena sudah punya riwayat transaksi: ${blocked.join(', ')}.',
        kind: blocked.isEmpty ? NoticeKind.success : NoticeKind.warning);
      load(target: page);
    } catch (e) { if (mounted) showError(context, e); }
  }

  /// The desktop's grid: empty for many new products, or filled with the ticked ones.
  Future<void> massInput({bool ticked = false, String? initialBarcode}) async {
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => MassInputScreen(api: widget.api, ids: ticked ? selectedIds.toList() : const [], initialBarcode: initialBarcode),
    ));
    if (changed == true && mounted) { setState(selectedIds.clear); load(target: page); }
  }

  Future<void> efisiensiHarga() async {
    final changed = await showEfisiensiHargaDialog(context, widget.api);
    if (changed == true && mounted) load(target: page);
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
      if (widget.isAdmin) OutlinedButton.icon(onPressed: () => massInput(), icon: const Icon(Icons.table_rows_outlined, size: 18), label: const Text('Input massal')),
      if (widget.isAdmin) OutlinedButton.icon(onPressed: efisiensiHarga, icon: const Icon(Icons.trending_up, size: 18), label: const Text('Efisiensi harga')),
      if (widget.isAdmin && selectedIds.isNotEmpty) OutlinedButton.icon(onPressed: () => massInput(ticked: true), icon: const Icon(Icons.edit_outlined, size: 18), label: Text('Ubah massal (${selectedIds.length})')),
      if (widget.isAdmin && selectedIds.isNotEmpty) OutlinedButton.icon(onPressed: removeSelected,
        style: OutlinedButton.styleFrom(foregroundColor: errorColor), icon: const Icon(Icons.delete_outline), label: Text('Hapus terpilih (${selectedIds.length})')),
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
    Row(children: [
      Expanded(child: SearchBox(
        onChanged: (v) { search = v; load(); },
        onSubmitted: submitBarcodeSearch,
        hint: isDesktop ? 'Cari nama, kode, atau barcode  ·  /' : 'Cari nama, kode, atau barcode',
        focusNode: searchFocus,
      )),
      const SizedBox(width: Space.sm),
      DropdownButton<int>(
        value: pageSize,
        underline: const SizedBox.shrink(),
        items: const [
          DropdownMenuItem(value: 10, child: Text('10 / hal')),
          DropdownMenuItem(value: 25, child: Text('25 / hal')),
          DropdownMenuItem(value: 50, child: Text('50 / hal')),
          DropdownMenuItem(value: 100, child: Text('100 / hal')),
        ],
        onChanged: (v) {
          if (v != null && v != pageSize) {
            setState(() => pageSize = v);
            load(target: 1);
          }
        },
      ),
    ]),
    const SizedBox(height: Space.xs),
    SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          ChoiceChip(
            visualDensity: VisualDensity.compact,
            label: const Text('Semua'),
            selected: stockFilter == '',
            onSelected: (_) { setState(() => stockFilter = ''); load(target: 1); },
          ),
          const SizedBox(width: Space.xs),
          ChoiceChip(
            visualDensity: VisualDensity.compact,
            label: const Text('Stok Menipis (≤5)'),
            selected: stockFilter == 'low',
            onSelected: (_) { setState(() => stockFilter = 'low'); load(target: 1); },
          ),
          const SizedBox(width: Space.xs),
          ChoiceChip(
            visualDensity: VisualDensity.compact,
            label: const Text('Stok Habis (0)'),
            selected: stockFilter == 'out',
            onSelected: (_) { setState(() => stockFilter = 'out'); load(target: 1); },
          ),
        ],
      ),
    ),
    if (!loading && rows.isEmpty && widget.isAdmin && RegExp(r'^\d{8,}$').hasMatch(search.trim())) Padding(
      padding: const EdgeInsets.only(top: Space.md),
      child: WhitePanel(child: Row(children: [
        Expanded(child: Text('Barcode ${search.trim()} belum terdaftar di katalog.')),
        FilledButton.icon(
          onPressed: () => massInput(initialBarcode: search.trim()),
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Buat produk baru dengan barcode ini'),
        ),
      ])),
    ),
    const SizedBox(height: Space.md),
    if (loading) const LinearProgressIndicator(minHeight: 2),
    LoadSwitch(loading: false, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows,
      emptyTitle: 'Produk tidak ditemukan', emptyMessage: 'Coba kata pencarian lain.',
      isSelected: widget.isAdmin ? (p) => selectedIds.contains(idNumber(p['id'])) : null,
      onSelect: widget.isAdmin ? (p, on) => setState(() => on ? selectedIds.add(idNumber(p['id'])) : selectedIds.remove(idNumber(p['id']))) : null,
      onTap: (p) async { await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ProductDetailScreen(api: widget.api, productId: idNumber(p['id']), isAdmin: widget.isAdmin))); if (mounted) load(target: page); },
      actions: widget.isAdmin ? (p) {
        final s = number(p['stok']) ?? 0;
        return [
          if (s <= 0) const Pill('Habis', color: Color(0xFFDC2626))
          else if (s <= 5) Pill('Sisa ${quantityText(s)}', color: Color(0xFFD97706)),
          IconButton(tooltip: 'Ubah', onPressed: () => edit(p), icon: const Icon(Icons.edit_outlined, size: 20)),
          IconButton(tooltip: 'Hapus', onPressed: () => remove(p), icon: const Icon(Icons.delete_outline, size: 20)),
        ];
      } : null,
      actionsWidth: 180,
      columns: [
        DataCol('Produk', (p) => '${p['namaItem']}${p['isActive'] == false ? ' (nonaktif)' : ''}', flex: 4),
        DataCol('Kode', (p) => text(p['kodeItem']), flex: 2),
        DataCol('Kategori', (p) => text(p['categoryName']), flex: 2),
        DataCol('Satuan & grosir', (p) {
          final u = (number(p['unitsCount']) ?? 1).toInt();
          final t = (number(p['priceTiersCount']) ?? 0).toInt();
          return '$u satuan${t > 0 ? ' · $t grosir' : ''}';
        }, flex: 2),
        DataCol('Stok', (p) {
          final s = number(p['stok']) ?? 0;
          final str = '${quantityText(p['stok'])} ${text(p['satuan'], '')}';
          if (s <= 0) return '$str (Habis)';
          if (s <= 5) return '$str (Menipis)';
          return str;
        }, numeric: true, flex: 2),
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
  Future<void> toggleUnitActive(Map<String, dynamic> u) async {
    final active = u['isActive'] != false;
    final id = idNumber(u['id']);
    if (active) {
      if (!await confirmAction(context, title: 'Nonaktifkan satuan ${u['code']}?',
        message: 'Satuan tidak muncul di pilihan produk baru, tetapi produk lama tetap aman.', confirmLabel: 'Nonaktifkan')) { return; }
      if (mounted && await runAction(context, () => widget.api.deactivateUnit(id), success: 'Satuan dinonaktifkan.')) load();
    } else {
      if (mounted && await runAction(context, () => widget.api.updateUnitMaster(id, {
        'code': u['code'], 'name': u['name'], 'symbol': u['symbol'], 'isActive': true,
      }), success: 'Satuan diaktifkan.')) { load(); }
    }
  }
  @override Widget build(BuildContext context) => ScreenBody(onRefresh: load, children: [
    ScreenHeader('Master Satuan', 'Daftar satuan yang bisa dipakai produk.', actions: [
      if (widget.isAdmin) FilledButton.icon(onPressed: () => edit(), icon: const Icon(Icons.add), label: const Text('Satuan baru')),
    ]),
    LoadSwitch(loading: loading, error: error, onRetry: load, child: DataView<Map<String, dynamic>>(rows: rows,
      onTap: widget.isAdmin ? edit : null,
      actionsWidth: 185,
      actions: widget.isAdmin ? (u) => [
        TextButton(
          onPressed: () => toggleUnitActive(u),
          child: Text(u['isActive'] == false ? 'Aktifkan' : 'Nonaktifkan'),
        ),
      ] : null,
      columns: [
        DataCol('Kode', (u) => text(u['code'])),
        DataCol('Nama', (u) => text(u['name']), flex: 2),
        DataCol('Simbol', (u) => text(u['symbol'])),
        DataCol('Status', (u) => u['isActive'] == false ? 'Nonaktif' : 'Aktif'),
      ])),
  ]);
}

Future<bool?> showEfisiensiHargaDialog(BuildContext context, StoreApi api, {String initialCakupan = 'margin'}) =>
    showDialog<bool>(context: context, builder: (_) => _EfisiensiHargaDialog(api: api, initialCakupan: initialCakupan));

class _EfisiensiHargaDialog extends StatefulWidget {
  const _EfisiensiHargaDialog({required this.api, required this.initialCakupan});
  final StoreApi api;
  final String initialCakupan;
  @override State<_EfisiensiHargaDialog> createState() => _EfisiensiHargaDialogState();
}

class _EfisiensiHargaDialogState extends State<_EfisiensiHargaDialog> {
  late String cakupan = widget.initialCakupan;
  String metode = 'margin_minimal';
  final nilai = TextEditingController(text: '10');
  Map<String, dynamic>? preview;
  bool loading = false, applying = false;
  String? error;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  @override
  void dispose() {
    nilai.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _filter => {
    'cakupan': cakupan,
    'metode': metode,
    if (metode != 'margin_minimal')
      'nilai': metode == 'nominal' ? inputRupiah(nilai.text) : (num.tryParse(nilai.text.replaceAll(',', '.')) ?? 0),
  };

  Future<void> _loadPreview() async {
    setState(() { loading = true; error = null; });
    try {
      final res = await widget.api.previewEfisiensiHarga(_filter);
      if (mounted) setState(() => preview = res);
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _apply() async {
    setState(() { applying = true; error = null; });
    try {
      final res = await widget.api.applyEfisiensiHarga({'filter': _filter});
      if (!mounted) return;
      showNotice(context, '${res['satuanDiubah'] ?? 0} harga satuan & ${res['tierDiubah'] ?? 0} harga bertingkat dinaikkan.', kind: NoticeKind.success);
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { applying = false; error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final baris = preview == null ? const <Map<String, dynamic>>[] : jsonRows(preview!['baris']);
    final dilewati = preview == null ? const <Map<String, dynamic>>[] : jsonRows(preview!['dilewati']);
    return AlertDialog(
      title: const Text('Efisiensi harga jual'),
      content: SizedBox(width: 620, child: SingleChildScrollView(child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<String>(
            value: cakupan,
            decoration: const InputDecoration(labelText: 'Cakupan barang'),
            items: const [
              DropdownMenuItem(value: 'rugi', child: Text('Hanya yang di bawah modal (rugi)')),
              DropdownMenuItem(value: 'margin', child: Text('Di bawah margin minimal toko')),
              DropdownMenuItem(value: 'semua', child: Text('Semua barang')),
            ],
            onChanged: (v) { if (v != null) { setState(() => cakupan = v); _loadPreview(); } },
          ),
          const SizedBox(height: Space.md),
          DropdownButtonFormField<String>(
            value: metode,
            decoration: const InputDecoration(labelText: 'Metode kenaikan'),
            items: const [
              DropdownMenuItem(value: 'margin_minimal', child: Text('Sesuaikan ke rekomendasi margin minimal')),
              DropdownMenuItem(value: 'persen', child: Text('Naikkan sekian persen (%)')),
              DropdownMenuItem(value: 'nominal', child: Text('Naikkan sekian rupiah (Rp)')),
            ],
            onChanged: (v) { if (v != null) { setState(() => metode = v); _loadPreview(); } },
          ),
          if (metode != 'margin_minimal') ...[
            const SizedBox(height: Space.md),
            Row(children: [
              Expanded(child: TextField(
                controller: nilai,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: metode == 'persen' ? 'Kenaikan (%)' : 'Kenaikan (Rp)'),
              )),
              const SizedBox(width: Space.sm),
              OutlinedButton(onPressed: loading ? null : _loadPreview, child: const Text('Hitung pratinjau')),
            ]),
          ],
          const SizedBox(height: Space.md),
          if (loading) const LinearProgressIndicator(minHeight: 2),
          if (error != null) Text(error!, style: TextStyle(color: errorColor)),
          if (!loading && preview != null) ...[
            Text('${baris.length} harga akan dinaikkan${dilewati.isNotEmpty ? ' · ${dilewati.length} dilewati karena selisih mencurigakan' : ''}.',
              style: const TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(height: Space.sm),
            for (final b in baris.take(15))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text('${b['namaItem']} (${b['satuan']}) · ${rupiah(b['hargaLama'])} → ${rupiah(b['hargaBaru'])} (modal ${rupiah(b['hargaPokok'])})',
                  style: const TextStyle(fontSize: 13)),
              ),
            if (baris.length > 15) Text('…dan ${baris.length - 15} baris lainnya.', style: TextStyle(color: muted, fontSize: 12)),
          ],
        ],
      ))),
      actions: [
        TextButton(onPressed: applying ? null : () => Navigator.pop(context), child: const Text('Batal')),
        FilledButton(
          onPressed: applying || loading || baris.isEmpty ? null : _apply,
          child: Text(applying ? 'Menerapkan…' : 'Terapkan (${baris.length})'),
        ),
      ],
    );
  }
}
